import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  BackHandler,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { PublicKey } from '@solana/web3.js';
import * as multisig from '@sqds/multisig';
import { useMobileWallet } from '@wallet-ui/react-native-web3js';

import { checkReviewAllowlist } from '../squads/instructionAllowlist';
import {
  signAndSendProposalApproval,
  type ProposalApprovalSignSendResult,
} from '../squads/signAndSendProposalApproval';
import {
  signAndSendProposalExecution,
  type ProposalExecutionSignSendResult,
} from '../squads/signAndSendProposalExecution';
import { connection } from '../solana/connection';
import { confirmSignature } from '../solana/confirmSignature';
import { SAFE_TOP_PADDING } from '../ui/safeAreaPadding';
import { colors, radii, spacing, typography } from '../ui/theme';
import { Card, DevnetPill, InfoBox, InfoText, PillButton } from '../ui/v2/primitives';
import {
  estimateRemainingBalance,
  formatSol,
  describeTransferSource,
  lamportsToSolDisplay,
} from '../wallet/vaultBalance';

import { useWalletGuard, type ReviewGuardContext } from '../wallet/useWalletGuard';
import {
  loadProposalReview,
  summarizeOperation,
  type ProposalStatusKind,
} from '../squads/proposals';
import {
  APPROVAL_OUTCOME_LABELS,
  approvalOutcomeActions,
  classifyApprovalOutcome,
  walletHasApproved,
} from '../squads/approvalOutcome';
import {
  PROPOSAL_ACTION_LABELS,
  approvalProgress,
  deriveProposalActionState,
  deriveProposalExecuteState,
  executionNotAvailableDetail,
} from '../squads/proposalActionState';
import { abbreviateAddress, type TransactionReviewModel } from '../types/transactionReview';
import { computeCanConfirm, TransactionReviewScreen } from './TransactionReviewScreen';
import { formatMwaError } from '../wallet/mwaDiagnostics';
import { buildOperationReport, classifyOperationResult, describeAttemptOutcome, isTemporaryNetworkFailure } from '../wallet/operationState';
import { signingStateTitle, type SigningState } from '../wallet/signingWindow';

/**
 * Message d'échec homogène : la machine d'état parle d'abord (pour ne jamais
 * présenter « signature obtenue » comme un échec), puis le diagnostic MWA
 * d'origine est repris verbatim avec son code.
 */
function describeOperationFailure(result: {
  confirmed?: boolean;
  errorCode?: string | null;
  errorMessage: string | null;
  signature: string | null;
  signingState?: SigningState;
  validationErrors: string[];
  verified: boolean;
}): string {
  const evidence = {
    confirmed: result.confirmed === true,
    readBackVerified: result.verified,
    signatureObtained: result.signature !== null,
  };
  // L'état de signature du module prime : il distingue « requête expirée
  // avant signature » de « signée, confirmation en attente ».
  const title =
    result.signingState !== undefined
      ? signingStateTitle(result.signingState)
      : buildOperationReport({
          evidence,
          state: classifyOperationResult(evidence),
        }).title;
  const detail =
    result.errorMessage !== null
      ? formatMwaError({
          code: result.errorCode ?? null,
          message: result.errorMessage,
          step: 'signAndSendTransactions',
        })
      : result.validationErrors.join(' ');
  return `${title} ${detail}`;
}

/**
 * Detail d'une proposition : LECTURE SEULE.
 *
 * Aucune écriture : pas d'approbation, pas de rejet, pas d'execution, aucune
 * signature. Aucun appel réseau non plus : tout ce qui est affiché provient des
 * entites déjà lues (`ProposalView`) et d'un modèle DÉJÀ décodé s'il est fourni
 * par l'appelant. Le PDA de proposition et l'adresse de la vault transaction
 * sont dérivés localement par le SDK.
 */

function proposalPda(multisigAddress: string, index: number): string | null {
  try {
    const [pda] = multisig.getProposalPda({
      multisigPda: new PublicKey(multisigAddress),
      transactionIndex: BigInt(index),
    });
    return pda.toBase58();
  } catch {
    return null;
  }
}

export function ProposalDetailsScreen({
  address,
  decodedModel,
  guardContext,
  index,
  members,
  onBack,
  proposal,
  threshold,
  vaultTransactionAddress,
  walletAddress,
}: {
  address: string;
  /** Modèle déjà décodé, aucune lecture déclenchée ici. */
  decodedModel: TransactionReviewModel | null;
  /** Contexte de revue déjà construit par l'appelant, transmis tel quel. */
  guardContext?: ReviewGuardContext | null;
  index: number;
  /** Membres et rôles lus dans le multisig (déjà chargés par le détail). */
  members: readonly { address: string; roles: readonly string[] }[];
  onBack: () => void;
  proposal: {
    approvedAddresses: string[];
    status: ProposalStatusKind;
  };
  threshold: number;
  vaultTransactionAddress: string;
  walletAddress: string | null;
  walletCanApprove: boolean;
}) {
  const [reviewOpen, setReviewOpen] = useState(false);
  // Section technique repliée par défaut : aucun détail brut à l'ouverture.
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // --- Approbation : uniquement des verdicts DÉJÀ calculés par l'existant.
  const { signAndSendTransactions } = useMobileWallet();
  // Décodage fait ICI, quel que soit le chemin d'entrée (Home ou Inbox) :
  // c'est ce qui rend visibles le montant, la destination et la revue, et qui
  // les rafraîchit en relisant la chaîne. Lecture seule, aucun wallet.
  const [selfModel, setSelfModel] = useState<TransactionReviewModel | null>(null);
  const [selfGuardContext, setSelfGuardContext] = useState<ReviewGuardContext | null>(null);
  const [decoding, setDecoding] = useState(false);
  const [decodeError, setDecodeError] = useState<string | null>(null);

  const deriveGuardContext = useCallback(
    (reviewModel: TransactionReviewModel): ReviewGuardContext | null => {
      try {
        const multisigPda = new PublicKey(address);
        const [vaultPda] = multisig.getVaultPda({ index: 0, multisigPda });
        return {
          multisig: {
            address,
            members: members.map((member) => ({
              address: member.address,
              roles: [...member.roles],
            })),
            threshold,
            vaultAddress: vaultPda.toBase58(),
          },
          proposal: {
            approvedAddresses: proposal.approvedAddresses,
            index,
            status: proposal.status,
          },
          review: reviewModel,
          walletAddress,
        };
      } catch {
        return null;
      }
    },
    [address, index, members, proposal.approvedAddresses, proposal.status, threshold, walletAddress],
  );

  /** Relecture + décodage : aucune signature, aucun envoi, aucun wallet. */
  const runDecode = useCallback(async () => {
    setDecoding(true);
    setDecodeError(null);
    try {
      const multisigPda = new PublicKey(address);
      const [vaultPda] = multisig.getVaultPda({ index: 0, multisigPda });
      const result = await loadProposalReview(
        connection,
        multisigPda,
        {
          multisigAddress: address,
          network: 'devnet',
          proposalIndex: index,
          proposalStatus: proposal.status,
          signerWallet: walletAddress ?? 'Unknown',
          vaultAddress: vaultPda.toBase58(),
        },
        index,
      );
      setSelfModel(result.model);
      setSelfGuardContext(deriveGuardContext(result.model));
    } catch (caught: unknown) {
      setDecodeError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setDecoding(false);
    }
  }, [address, deriveGuardContext, index, proposal.status, walletAddress]);

  // Relecture canonique à l'ouverture, quel que soit le chemin (Home ou Inbox) :
  // le modèle et le contexte fournis par l'appelant servent d'affichage immédiat,
  // mais le verdict du guard est TOUJOURS calculé sur une relecture on-chain
  // fraîche — exactement la même lecture que « Refresh proposal ». Strictement
  // en lecture seule : aucun wallet, aucune signature, aucun envoi.
  useEffect(() => {
    void runDecode();
  }, [runDecode]);

  const model = selfModel ?? decodedModel;
  const effectiveGuardContext = selfGuardContext ?? guardContext;

  // Solde du vault, relu à l'ouverture et AVANT chaque exécution. Lecture seule.
  const vaultPda = (() => {
    try {
      return multisig.getVaultPda({ index: 0, multisigPda: new PublicKey(address) })[0].toBase58();
    } catch {
      return null;
    }
  })();
  const [proposalVaultLamports, setProposalVaultLamports] = useState<number | null>(null);
  const readVaultBalance = useCallback(async (): Promise<number | null> => {
    if (vaultPda === null) return null;
    try {
      const lamports = await connection.getBalance(new PublicKey(vaultPda), 'confirmed');
      setProposalVaultLamports(lamports);
      return lamports;
    } catch {
      // Une lecture impossible ne bloque pas l'écran : l'estimation devient
      // indisponible, sans inventer de valeur.
      return null;
    }
  }, [vaultPda]);

  useEffect(() => {
    void readVaultBalance();
  }, [readVaultBalance]);

  const guard = useWalletGuard(effectiveGuardContext ?? null);
  const allowlist = model === null ? null : checkReviewAllowlist(model);
  const [approving, setApproving] = useState(false);
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [approvalResult, setApprovalResult] = useState<ProposalApprovalSignSendResult | null>(null);
  // Une seule tentative : jamais deux envois en parallele, jamais de second
  // envoi apres une signature obtenue.
  const approvalAttemptedRef = useRef(false);
  // Approbateurs RELUS on-chain : source unique du libelle « Already approved ».
  // Jamais un etat memoire local seul — une reouverture repart de la chaine.
  const [onchainApproval, setOnchainApproval] = useState<{
    approvedAddresses: string[];
    status: string;
  } | null>(null);
  // Relecture seule « Check approval again ».
  const [checkingApproval, setCheckingApproval] = useState(false);
  const [approvalCheckReport, setApprovalCheckReport] = useState<string | null>(null);
  // Diagnostic technique d'une tentative ANTERIEURE : jamais prioritaire sur
  // l'etat courant, uniquement dans « Troubleshooting details ».
  const [approvalDiagnostics, setApprovalDiagnostics] = useState<string[]>([]);
  const [troubleshootingOpen, setTroubleshootingOpen] = useState(false);

  // Verite on-chain si elle a ete relue, sinon donnee fournie par l'appelant.
  const effectiveApprovedAddresses = onchainApproval?.approvedAddresses ?? proposal.approvedAddresses;
  const effectiveProposalStatus = onchainApproval?.status ?? proposal.status;
  const walletAlreadyApproved = walletHasApproved(effectiveApprovedAddresses, walletAddress);

  const canConfirm =
    model !== null &&
    allowlist !== null &&
    !walletAlreadyApproved &&
    effectiveProposalStatus === 'Active' &&
    computeCanConfirm(model, guard.status, allowlist.status);

  // --- Execution : trois conditions lisibles, aucune invention.
  // Note : le guard de revue vérifie la permission `Vote` (il bloque donc à
  // juste titre un membre qui n'aurait que `Execute`). Exécuter n'est pas
  // approuver : la condition ICI est la permission `Execute`, plus le statut
  // `Approved` et le seuil réellement atteint.
  const walletHasExecute =
    walletAddress !== null &&
    members.some(
      (member) => member.address === walletAddress && member.roles.includes('Execute'),
    );
  const thresholdReached = effectiveApprovedAddresses.length >= threshold;
  const canExecute =
    effectiveProposalStatus === 'Approved' && thresholdReached && walletHasExecute;
  const [executing, setExecuting] = useState(false);
  const [executionError, setExecutionError] = useState<string | null>(null);
  const [executionResult, setExecutionResult] = useState<ProposalExecutionSignSendResult | null>(
    null,
  );
  const executionAttemptedRef = useRef(false);

  // Verdict unique de l'UI : sans signature, jamais de libellé « Sent ».
  const approvalOutcome =
    approvalResult === null
      ? null
      : describeAttemptOutcome({
          confirmed: approvalResult.confirmed === true,
          evidence: {
            blockHeight: null,
            lastValidBlockHeight: approvalResult.lastValidBlockHeight ?? null,
            status: approvalResult.confirmationStatus ?? 'notFound',
          },
          networkFailure: isTemporaryNetworkFailure(approvalResult.errorMessage ?? ''),
          signature: approvalResult.signature,
          verified: approvalResult.verified,
        });
  // Etat lisible de l'approbation (libelles exacts) + actions autorisees.
  const approvalState =
    approvalResult === null
      ? null
      : classifyApprovalOutcome({
          confirmed: approvalResult.confirmed === true,
          signature: approvalResult.signature,
          verified: approvalResult.verified,
        });
  const approvalActions = approvalState === null ? null : approvalOutcomeActions(approvalState);
  const approvalLabel =
    approvalState === null ? 'Approval recorded on-chain' : APPROVAL_OUTCOME_LABELS[approvalState];

  // --- États principaux EXCLUSIFS (présentation pure) -------------------
  // « Exécutée » : statut on-chain terminal, ou exécution vérifiée.
  const executed =
    effectiveProposalStatus === 'Executed' || executionResult?.verified === true;
  // Une signature existe mais l'approbation n'est pas encore vérifiée.
  const signaturePendingVerification =
    approvalResult !== null && approvalResult.signature !== null && approvalResult.verified !== true;
  // Nouvelle tentative sans signature (échec avant envoi) : seul cas où le CTA reste.
  const approvalRetry =
    approvalResult !== null &&
    approvalResult.signature === null &&
    (approvalActions?.allowPrepareAgain ?? false);
  // Progression : EXCLUSIVEMENT issue des approbations relues on-chain.
  const progress = approvalProgress({
    approvedCount: effectiveApprovedAddresses.length,
    threshold,
  });
  const actionState = deriveProposalActionState({
    executed,
    signaturePendingVerification,
    thresholdReached: progress.reached,
    walletAlreadyApproved,
  });
  const executeState = deriveProposalExecuteState({
    executed,
    thresholdReached: progress.reached,
    walletHasExecute,
  });

  const executionOutcome =
    executionResult === null
      ? null
      : describeAttemptOutcome({
          confirmed: executionResult.confirmed === true,
          evidence: {
            blockHeight: null,
            lastValidBlockHeight: executionResult.lastValidBlockHeight ?? null,
            status: executionResult.confirmationStatus ?? 'notFound',
          },
          networkFailure: isTemporaryNetworkFailure(executionResult.errorMessage ?? ''),
          signature: executionResult.signature,
          verified: executionResult.verified,
        });

  const runExecution = async () => {
    // Contrôle pré-exécution : le solde est RELU ici. L'affichage précédent ne
    // remplace jamais ce contrôle.
    const freshLamports = await readVaultBalance();
    if (
      freshLamports !== null &&
      isRecognizedTransfer &&
      sourceVerdict.matches &&
      amountLamports !== null &&
      freshLamports < amountLamports
    ) {
      setExecutionError(
        'Insufficient vault balance: the vault does not hold the amount this proposal moves. Nothing was sent.',
      );
      executionAttemptedRef.current = false;
      setExecuting(false);
      return;
    }
    if (approvalAttemptedRef.current || executionAttemptedRef.current) return;
    if (walletAddress === null) {
      setExecutionError('No wallet connected: an execution must be signed by a member.');
      return;
    }
    executionAttemptedRef.current = true;
    setExecuting(true);
    setExecutionError(null);
    setExecutionResult(null);
    let signature: string | null = null;
    try {
      const result = await signAndSendProposalExecution({
        connection,
        memberAddress: walletAddress,
        multisigPda: address,
        signAndSendTransactions,
        threshold,
        transactionIndex: index,
      });
      signature = result.signature;
      setExecutionResult(result);
      // Après une exécution vérifiée, le solde du vault a changé : on le relit.
      if (result.verified) void readVaultBalance();
      if (!result.verified) {
        setExecutionError(describeOperationFailure(result));
      }
    } catch (caught: unknown) {
      setExecutionError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      if (signature === null) executionAttemptedRef.current = false;
      setExecuting(false);
    }
  };

  /**
   * Tap sur Execute : DOUBLE confirmation explicite avant toute demande au
   * wallet. Rien ne part du premier dialogue, ni d'un effet, ni d'un rendu.
   */
  const onExecute = () => {
    if (!canExecute || insufficientBalance || executing || executionAttemptedRef.current) return;
    if (insufficientBalance) {
      setExecutionError(
        'Insufficient vault balance: the vault does not currently hold the amount this proposal moves. Nothing was sent.',
      );
      return;
    }
    // Nouvelle tentative après un échec SANS signature : on repart d'un état
    // propre. Une tentative déjà signée n'ouvre jamais ce chemin (bouton
    // désactivé), donc aucun résultat signé n'est effacé ici.
    if (executionResult !== null && executionOutcome?.allowNewAttempt === true) {
      setExecutionResult(null);
      setExecutionError(null);
    }
    Alert.alert(
      'Execute this proposal?',
      [
        `Proposal #${index}`,
        `Status: ${proposal.status} · ${proposal.approvedAddresses.length} of ${threshold} approvals`,
        `You will sign ONE vaultTransactionExecute instruction as ${walletAddress ?? 'unknown wallet'}.`,
        'The stored transaction will be submitted to the vault and its effects are permanent.',
      ].join('\n'),
      [
        { style: 'cancel', text: 'Cancel' },
        {
          onPress: () => {
            Alert.alert(
              'Confirm execution',
              [
                'This cannot be undone and cannot be cancelled once sent.',
                'The vault will execute the approved transaction now.',
                'Tap Execute to sign with your wallet, or Cancel to stop.',
              ].join('\n'),
              [
                { style: 'cancel', text: 'Cancel' },
                {
                  onPress: () => {
                    void runExecution();
                  },
                  style: 'destructive',
                  text: 'Execute',
                },
              ],
              { cancelable: true },
            );
          },
          text: 'Continue',
        },
      ],
      { cancelable: true },
    );
  };

  /**
   * Relecture on-chain de la Proposal : approbateurs et statut RÉELS.
   * Strictement en lecture seule : aucun wallet, aucune signature, aucun envoi.
   */
  const refreshProposalFromChain = async (): Promise<{
    approvedAddresses: string[];
    status: string;
  } | null> => {
    try {
      const [proposalPdaKey] = multisig.getProposalPda({
        multisigPda: new PublicKey(address),
        transactionIndex: BigInt(index),
      });
      const info = await connection.getAccountInfo(proposalPdaKey, 'confirmed');
      if (info === null) return null;
      const [decoded] = multisig.accounts.Proposal.fromAccountInfo(info);
      const fresh = {
        approvedAddresses: decoded.approved.map((entry) => entry.toBase58()),
        status: decoded.status.__kind,
      };
      setOnchainApproval(fresh);
      return fresh;
    } catch {
      // Une lecture impossible ne fabrique aucun état : on garde le précédent.
      return null;
    }
  };

  /**
   * « Check approval again » : LECTURES uniquement (statut de signature,
   * confirmation, relecture de la Proposal). Jamais de reconstruction, jamais
   * d'ouverture du wallet, jamais de signature, jamais de second envoi.
   */
  const onCheckApprovalAgain = async () => {
    const signature = approvalResult?.signature ?? null;
    if (signature === null || checkingApproval) return;
    setCheckingApproval(true);
    setApprovalCheckReport('Checking the approval…');
    try {
      const confirmation = await confirmSignature({ connection, signature });
      const fresh = await refreshProposalFromChain();
      const confirmed = confirmation.status === 'confirmed';
      const verified =
        confirmed && fresh !== null && walletHasApproved(fresh.approvedAddresses, walletAddress);
      setApprovalResult((previous) =>
        previous === null
          ? previous
          : {
              ...previous,
              confirmed,
              confirmationStatus: confirmation.status,
              readBack:
                fresh === null
                  ? previous.readBack
                  : {
                      address: proposalPda(address, index) ?? previous.readBack?.address ?? '',
                      approvedAddresses: fresh.approvedAddresses,
                      index,
                      status: fresh.status,
                    },
              verified,
            },
      );
      setApprovalCheckReport(
        verified
          ? 'Proposal approved and verified.'
          : confirmed
            ? 'Approval confirmed, proposal verification pending.'
            : 'Approval signed, confirmation pending.',
      );
      if (verified) {
        // Etat courant REUSSI : l'ancienne erreur disparait du bloc principal.
        // L'historique technique reste consultable dans Troubleshooting details.
        setApprovalError(null);
      }
    } catch (caught: unknown) {
      const detail = isTemporaryNetworkFailure(caught)
        ? 'Verification temporarily unavailable: check again later.'
        : 'Verification failed — this action sent nothing.';
      setApprovalCheckReport(detail);
      setApprovalDiagnostics((previous) => [...previous, detail]);
    } finally {
      setCheckingApproval(false);
    }
  };

  const runApproval = async () => {
    if (model === null || allowlist === null || approvalAttemptedRef.current) return;
    if (walletAddress === null) {
      setApprovalError('No wallet connected: an approval must be signed by a member.');
      return;
    }
    // Défense on-chain AVANT toute construction : un wallet déjà approbateur ne
    // reconstruit rien (le module relit aussi la Proposal, mais on évite ici
    // même d'ouvrir le wallet).
    if (walletAlreadyApproved) {
      setApprovalError('Already approved: this wallet already approved this proposal.');
      return;
    }
    approvalAttemptedRef.current = true;
    setApproving(true);
    setApprovalError(null);
    setApprovalResult(null);
    setApprovalCheckReport(null);
    let signature: string | null = null;
    try {
      const result = await signAndSendProposalApproval({
        connection,
        memberAddress: walletAddress,
        multisigPda: address,
        preconditions: {
          allowlistStatus: allowlist.status,
          guardReasons: guard.reasons,
          guardStatus: guard.status,
        },
        signAndSendTransactions,
        threshold,
        transactionIndex: index,
      });
      signature = result.signature;
      setApprovalResult(result);
      // Une signature existe : on relit la Proposal pour afficher l'état RÉEL
      // (dont « Already approved »). Lecture seule, aucun wallet.
      if (signature !== null) {
        void refreshProposalFromChain();
      }
      if (!result.verified) {
        const failure = describeOperationFailure(result);
        setApprovalError(failure);
        setApprovalDiagnostics((previous) => [...previous, failure]);
      }
    } catch (caught: unknown) {
      const detail = caught instanceof Error ? caught.message : String(caught);
      setApprovalError(detail);
      setApprovalDiagnostics((previous) => [...previous, detail]);
    } finally {
      // Aucune signature obtenue : rien n'a ete produit, un nouvel essai reste
      // possible. Sinon, plus aucune tentative automatique.
      if (signature === null) approvalAttemptedRef.current = false;
      setApproving(false);
    }
  };

  /** Tap sur Approve : préparation des verdicts déjà là, puis confirmation. */
  const onApprove = () => {
    if (!canConfirm || approving || approvalAttemptedRef.current) return;
    // Même logique qu'Execute : un échec sans signature redevient une tentative
    // neuve, un envoi signé ne peut jamais être réessayé.
    if (approvalResult !== null && approvalOutcome?.allowNewAttempt === true) {
      setApprovalResult(null);
      setApprovalError(null);
    }
    Alert.alert(
      'Approve this proposal?',
      [
        `Proposal #${index}`,
        `Approvals: ${proposal.approvedAddresses.length} of ${threshold} required`,
        `You will sign ONE proposalApprove instruction as ${walletAddress ?? 'unknown wallet'}.`,
        'No account is created and no rent is paid.',
        'Nothing is executed and nothing is rejected by this action.',
        'Nothing is sent until you tap Approve.',
      ].join('\n'),
      [
        { style: 'cancel', text: 'Cancel' },
        {
          onPress: () => {
            void runApproval();
          },
          text: 'Approve',
        },
      ],
      { cancelable: true },
    );
  };

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onBack();
      return true;
    });
    return () => subscription.remove();
  }, [onBack]);

  const summary = summarizeOperation(model);
  // Adresse de destination COMPLETE, telle que décodée : l'abréviation des
  // cartes compactes ne permet pas de vérifier où part l'argent.
  const fullDestination =
    model !== null && model.destination.known ? model.destination.value : null;
  // Vault index 0 dérivé localement : aucune lecture réseau pour l'obtenir.
  const vaultPdaAddress = (() => {
    try {
      return multisig.getVaultPda({ index: 0, multisigPda: new PublicKey(address) })[0].toBase58();
    } catch {
      return null;
    }
  })();
  const sourceVerdict = describeTransferSource({
    source: model !== null && model.source.known ? model.source.value : null,
    vaultAddress: vaultPdaAddress ?? '',
  });
  const amountLamports = model !== null && model.amount.known ? Number(model.amount.value.lamports) : null;
  const isRecognizedTransfer = summary !== null && summary.action === 'SOL transfer';

  // Instrumentation de développement : quelles données sont disponibles, pour
  // diagnostiquer un guard bloqué au premier rendu. Aucune donnée sensible.
  useEffect(() => {
    if (!__DEV__) return;
    console.log(
      '[proposal-details] availability',
      JSON.stringify({
        allowlistReady: model !== null,
        decodedModelReady: model !== null,
        guardContextReady: effectiveGuardContext !== null,
        multisigReady: address.length > 0,
        proposalReady: index >= 0,
        vaultPdaReady: vaultPdaAddress !== null,
        walletReady: walletAddress !== null,
      }),
    );
  }, [address, effectiveGuardContext, index, model, vaultPdaAddress, walletAddress]);
  const remaining = estimateRemainingBalance({
    amountLamports,
    recognizedSolTransfer: isRecognizedTransfer,
    sourceMatchesVault: sourceVerdict.matches,
    vaultLamports: proposalVaultLamports,
  });
  // Solde insuffisant : découvert AVANT toute signature, jamais présenté comme
  // un solde restant négatif.
  const insufficientBalance =
    isRecognizedTransfer &&
    sourceVerdict.matches &&
    proposalVaultLamports !== null &&
    amountLamports !== null &&
    proposalVaultLamports < amountLamports;
  const pda = proposalPda(address, index);

  // Relecture de la revue existante : aucun nouvel écran, aucune écriture.
  if (reviewOpen && model !== null) {
    return (
      <TransactionReviewScreen
        guardContext={effectiveGuardContext ?? null}
        model={model}
        onBack={() => setReviewOpen(false)}
      />
    );
  }

  // --- Présentation pure (UI V2) : aucune logique métier, aucun nouveau CTA.
  // CTA Approve : porte EXACTEMENT la même garde que l'existant.
  const approveCtaVisible = actionState === 'approval-available' || approvalRetry;
  // Statut utilisateur RÉEL : uniquement dérivé des verdicts déjà calculés.
  const userStatusTitle = executed
    ? 'Executed'
    : effectiveProposalStatus === 'Approved' && progress.reached
      ? PROPOSAL_ACTION_LABELS.thresholdReached
      : walletAlreadyApproved
        ? PROPOSAL_ACTION_LABELS.approvedByYou
        : canConfirm
          ? 'Needs your approval'
          : `Status: ${effectiveProposalStatus}`;
  // « Confirmed on-chain » : uniquement sur une preuve réelle.
  const confirmedOnchain =
    executionResult?.verified === true || effectiveProposalStatus === 'Executed';
  // Statut wallet « déjà approuvé » : information, jamais un bouton, et jamais
  // affiché dans l'état terminal exécuté.
  const showApprovedStatus = actionState !== 'executed' && walletAlreadyApproved;

  return (
    <KeyboardAvoidingView behavior="padding" style={[styles.keyboardAvoider, SAFE_TOP_PADDING]}>
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
        style={styles.scrollView}
      >
        {/* --- En-tête : retour existant + DevnetPill + titre. --- */}
        <View style={styles.headerRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to proposals"
            onPress={onBack}
            style={({ pressed }) => [styles.backButton, pressed && styles.backButtonPressed]}
          >
            <Text style={styles.backGlyph}>‹</Text>
          </Pressable>
          <DevnetPill />
        </View>

        <Text style={styles.title}>Proposal #{index}</Text>

        {/* --- Résumé RÉEL : action décodée, montant on-chain, destination. --- */}
        <Card style={styles.hero}>
          <Text style={styles.heroAction}>
            {summary === null ? 'Transaction' : summary.action}
          </Text>
          <Text style={styles.heroAmount}>
            {amountLamports === null ? 'Amount unavailable' : lamportsToSolDisplay(amountLamports)}
          </Text>
          <Text style={styles.heroCaption}>To</Text>
          <Text selectable style={styles.monoValue}>
            {summary === null ? 'Destination unavailable' : summary.destination}
          </Text>
        </Card>

        {/* --- Étapes Proposed → Approved → Execute : état RÉEL uniquement,
            aucune étape remplie artificiellement. --- */}
        <View style={styles.stepper}>
          {[
            { label: 'Proposed', done: true },
            { label: 'Approved', done: progress.reached },
            { label: 'Execute', done: executed },
          ].map((step, position) => (
            <View key={step.label} style={styles.stepItem}>
              <View style={[styles.stepDot, step.done && styles.stepDotDone]}>
                <Text style={[styles.stepDotText, step.done && styles.stepDotTextDone]}>
                  {step.done ? '✓' : String(position + 1)}
                </Text>
              </View>
              <Text style={[styles.stepLabel, step.done && styles.stepLabelDone]}>
                {step.label}
              </Text>
            </View>
          ))}
        </View>

        {/* --- Carte principale UNIQUE : statut utilisateur, progression on-chain
            et statut du wallet fusionnés (aucune répétition). Masquée dans
            l'état terminal où la carte « Executed » fait seule foi. --- */}
        {actionState !== 'executed' ? (
          <Card style={styles.statusCard}>
            <Text style={styles.statusTitle}>{userStatusTitle}</Text>
            <Text style={styles.statusDetail}>{progress.collectedLabel}</Text>
            {/* Statut du wallet : INFORMATION, jamais un bouton. */}
            {showApprovedStatus ? (
              <View
                accessibilityLabel="Approved by you"
                accessibilityRole="text"
                accessible
                style={styles.successBox}
              >
                <Text style={styles.fieldNote}>{PROPOSAL_ACTION_LABELS.approvedByYouDetail}</Text>
              </View>
            ) : null}
            {!progress.reached ? (
              <Text style={styles.fieldNote}>
                {progress.remaining === 1
                  ? 'Execution becomes available after one more approval.'
                  : executionNotAvailableDetail(progress.remaining)}
              </Text>
            ) : null}
          </Card>
        ) : null}

        {/* --- CTA Approve : uniquement si les guards l'autorisent. --- */}
        {approveCtaVisible && canConfirm ? (
          <PillButton
            accessibilityLabel={
              approvalRetry ? 'Prepare the approval again' : 'Approve this proposal'
            }
            busy={approving}
            disabled={!canConfirm || approving}
            label={approvalRetry ? 'Prepare again' : 'Approve'}
            onPress={onApprove}
          />
        ) : null}

        {actionState === 'approval-available' && !canConfirm ? (
          <Text style={styles.fieldNote}>
            {decoding || model === null
              ? // Pas refus terminal : le contexte se construit localement
                // (multisig + proposition + modèle + wallet + vault PDA).
                'Checking approval permissions…'
              : effectiveGuardContext === null
                ? 'Checking approval permissions…'
                : guard.status !== 'allowed'
                  ? `Guard: ${guard.reasons.join(' ') || 'blocked'}`
                  : allowlist !== null && allowlist.status !== 'allowed'
                    ? `Instruction allowlist: ${allowlist.status}.`
                    : 'Approval is not available for this proposal in its current state.'}
          </Text>
        ) : null}

        {approving ? (
          <Text style={styles.fieldNote}>
            Preparing the instruction and waiting for the wallet…
          </Text>
        ) : null}

        {approvalError !== null && actionState !== 'executed' ? (
          <InfoBox glyph="⚠" style={styles.infoBox} tone="error">
            <InfoText tone="error">{approvalError}</InfoText>
          </InfoBox>
        ) : null}

        {approvalResult !== null && actionState !== 'executed' ? (
          <View
            style={
              approvalOutcome !== null && approvalOutcome.tone === 'success'
                ? styles.successBox
                : styles.errorBox
            }
          >
            <Text
              style={
                approvalOutcome !== null && approvalOutcome.tone === 'success'
                  ? styles.successText
                  : styles.errorText
              }
            >
              {/* Sans signature, ce libellé est le SEUL autorisé : jamais « Sent ». */}
              {approvalLabel}
            </Text>
            {approvalResult.signature !== null ? (
              <>
                <Text style={styles.fieldNote}>Signature</Text>
                <Text selectable style={styles.monoValue}>
                  {abbreviateAddress(approvalResult.signature)}
                </Text>
                <Text selectable style={styles.monoValue}>
                  {approvalResult.signature}
                </Text>
              </>
            ) : null}
            {approvalResult.readBack !== null ? (
              <>
                <Text style={styles.fieldValue}>
                  Status: {approvalResult.readBack.status} (was{' '}
                  {approvalResult.approvalsBefore} approval(s))
                </Text>
                <Text style={styles.fieldValue}>
                  Approvals: {approvalResult.readBack.approvedAddresses.length} of {threshold}
                </Text>
                <Text selectable style={styles.monoValue}>
                  {approvalResult.readBack.address}
                </Text>
              </>
            ) : null}
            {approvalActions?.allowCheckAgain ? (
              <PillButton
                accessibilityLabel="Check approval again"
                busy={checkingApproval}
                disabled={checkingApproval}
                label={checkingApproval ? 'Checking…' : 'Check approval again'}
                onPress={() => {
                  void onCheckApprovalAgain();
                }}
                variant="secondary"
              />
            ) : null}
            {approvalCheckReport !== null ? (
              <Text style={styles.fieldNote}>{approvalCheckReport}</Text>
            ) : null}
          </View>
        ) : null}

        {/* --- Progression : fusionnée dans la carte principale (aucun doublon). --- */}

        {/* --- Execute : uniquement quand les guards l'autorisent. --- */}
        {executeState === 'available' ? (
          insufficientBalance ? (
            <InfoBox glyph="⚠" style={styles.infoBox} tone="error">
              <InfoText tone="error">Insufficient vault balance</InfoText>
            </InfoBox>
          ) : (
            <>
              <PillButton
                accessibilityLabel="Execute this proposal"
                busy={executing}
                disabled={
                  executing ||
                  (executionResult !== null && !(executionOutcome?.allowNewAttempt ?? false))
                }
                label={PROPOSAL_ACTION_LABELS.executeCta}
                onPress={onExecute}
                variant="danger"
              />
              <Text style={styles.fieldNote}>
                Executing submits the stored transaction to the vault. It is irreversible and
                requires a double confirmation.
              </Text>
            </>
          )
        ) : executeState === 'unavailable-threshold' ? (
          // Raison déjà portée par la carte principale (« Waiting for N more
          // approval(s). » + « Execution becomes available… ») : aucun bloc séparé.
          null
        ) : executeState === 'no-permission' ? (
          <InfoBox glyph="•" style={styles.infoBox}>
            <InfoText>{PROPOSAL_ACTION_LABELS.executeNoPermissionTitle}</InfoText>
            <InfoText>{PROPOSAL_ACTION_LABELS.executeNoPermissionDetail}</InfoText>
          </InfoBox>
        ) : (
          /* Etat terminal : proposition exécutée, AUCUN CTA Approve/Execute. */
          <View style={styles.executedCard}>
            <Text style={styles.executedCheck}>✓</Text>
            <Text style={styles.executedTitle}>Executed</Text>
            <Text style={styles.executedMeta}>{PROPOSAL_ACTION_LABELS.executed}</Text>
            <Text style={styles.fieldNote}>Proposal #{index}</Text>
            <Text style={styles.executedAmount}>
              {amountLamports === null ? 'Amount unavailable' : lamportsToSolDisplay(amountLamports)}
            </Text>
            <Text style={styles.fieldNote}>Destination</Text>
            <Text selectable style={styles.monoValue}>
              {fullDestination ?? (summary !== null ? summary.destination : 'Destination unavailable')}
            </Text>
            <Text style={styles.fieldNote}>{progress.collectedLabel}</Text>
            {/* Aucune date n'est affichée : aucune date n'est réellement disponible. */}
            {confirmedOnchain ? (
              <Text style={styles.successText}>Confirmed on-chain</Text>
            ) : null}
            {executionResult?.signature != null ? (
              <>
                <Text style={styles.fieldNote}>Signature</Text>
                <Text selectable style={styles.monoValue}>
                  {abbreviateAddress(executionResult.signature)}
                </Text>
                <Text selectable style={styles.monoValue}>
                  {executionResult.signature}
                </Text>
              </>
            ) : null}
            <Text style={styles.fieldNote}>On-chain status: {effectiveProposalStatus}</Text>
          </View>
        )}

        {executing ? (
          <Text style={styles.fieldNote}>Waiting for the wallet…</Text>
        ) : null}

        {executionError !== null ? (
          <InfoBox glyph="⚠" style={styles.infoBox} tone="error">
            <InfoText tone="error">{executionError}</InfoText>
          </InfoBox>
        ) : null}

        {executionResult !== null && executeState !== 'executed' ? (
          <View
            style={
              executionOutcome !== null && executionOutcome.tone === 'success'
                ? styles.successBox
                : styles.errorBox
            }
          >
            <Text
              style={
                executionOutcome !== null && executionOutcome.tone === 'success'
                  ? styles.successText
                  : styles.errorText
              }
            >
              {/* Sans signature, jamais « Sent » : le libellé vient du verdict. */}
              {executionOutcome?.label ?? 'Execution verified on-chain'}
            </Text>
            {executionResult.signature !== null ? (
              <Text selectable style={styles.monoValue}>
                Signature: {executionResult.signature}
              </Text>
            ) : null}
            <Text style={styles.fieldValue}>
              Status before: {executionResult.statusBefore ?? 'unknown'} ·{' '}
              {executionResult.approvalsBefore} approval(s)
            </Text>
            {executionResult.readBack !== null ? (
              <>
                <Text style={styles.fieldValue}>
                  Proposal after:{' '}
                  {executionResult.readBack.proposalAccountPresent
                    ? executionResult.readBack.proposalStatusAfter ?? 'unknown status'
                    : 'account consumed (no longer present)'}
                </Text>
                <Text style={styles.fieldValue}>
                  Vault:{' '}
                  {executionResult.readBack.vaultLamportsDelta === null
                    ? 'balance change not measurable'
                    : `${executionResult.readBack.vaultLamportsDelta} lamports`}
                </Text>
                <Text selectable style={styles.monoValue}>
                  {executionResult.readBack.vaultAddress}
                </Text>
              </>
            ) : null}
            {executionResult.validationWarnings.map((warning) => (
              <Text key={warning} style={styles.fieldNote}>
                · {warning}
              </Text>
            ))}
          </View>
        ) : null}

        {decoding ? (
          <Text style={styles.fieldNote}>Decoding the transaction from the chain…</Text>
        ) : null}

        {decodeError !== null ? (
          <InfoBox glyph="⚠" style={styles.infoBox} tone="error">
            <InfoText tone="error">{decodeError}</InfoText>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Retry decoding this proposal"
              onPress={() => {
                void runDecode();
              }}
              style={styles.inlineAction}
            >
              <Text style={styles.inlineActionText}>Retry decode</Text>
            </Pressable>
          </InfoBox>
        ) : null}

        {/* Relecture lecture seule : re-decode la proposition et son message.
            Aucune signature, aucun envoi, aucun wallet sollicité. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Refresh this proposal and decode it again"
          disabled={decoding}
          onPress={() => {
            void runDecode();
          }}
          style={({ pressed }) => [
            styles.inlineAction,
            pressed && styles.secondaryPressed,
            decoding && styles.disabled,
          ]}
        >
          <Text style={styles.inlineActionText}>
            {decoding ? 'Refreshing…' : 'Refresh proposal'}
          </Text>
        </Pressable>

        {/* --- Advanced transaction details : repliée par défaut. Ouvre la vue
            de revue lecture seule existante. Aucun CTA d'écriture ici. --- */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Advanced transaction details"
          accessibilityState={{ expanded: advancedOpen }}
          onPress={() => setAdvancedOpen((open) => !open)}
          style={styles.advancedToggle}
        >
          <Text style={styles.advancedToggleText}>
            {advancedOpen ? '▾ Advanced transaction details' : '▸ Advanced transaction details'}
          </Text>
        </Pressable>

        {advancedOpen ? (
          <Card style={styles.advancedBody}>
            {summary === null ? (
              <Text style={styles.fieldNote}>
                Decoding this proposal… the amount and the destination appear as soon as the
                transaction message is decoded. No wallet is involved.
              </Text>
            ) : (
              <>
                <Text style={styles.fieldLabel}>Action</Text>
                <Text style={styles.fieldValue}>{summary.action}</Text>
                <Text selectable style={styles.monoValue}>Amount: {summary.amount}</Text>
                {/* Valeur technique exacte (9 décimales, non arrondie) : le montant
                    compact reste la seule information de premier niveau. */}
                <Text selectable style={styles.monoValue}>
                  Exact amount:{' '}
                  {amountLamports === null ? 'unavailable' : `${formatSol(amountLamports)} SOL`}
                </Text>
                <Text style={styles.fieldLabel}>Destination</Text>
                <Text selectable style={styles.monoValue}>
                  {fullDestination ?? summary.destination}
                </Text>
                {model !== null && model.source.known ? (
                  <>
                    <Text style={styles.fieldLabel}>Funds will be sent from</Text>
                    <Text selectable style={styles.monoValue}>
                      {model.source.value}
                    </Text>
                  </>
                ) : null}
                <Text style={styles.fieldNote}>{sourceVerdict.label}</Text>
                <Text style={styles.fieldNote}>{sourceVerdict.hint}</Text>
                {/* Estimation LOCALE, jamais un solde inventé : « Not available »
                    si la lecture du vault n'a pas abouti. */}
                <Text style={styles.fieldLabel}>Estimated remaining balance</Text>
                <Text selectable style={styles.monoValue}>
                  {remaining.sol === null ? 'Not available' : `${remaining.sol} SOL`}
                </Text>
                <Text style={styles.fieldNote}>{remaining.reason}</Text>
              </>
            )}
            <Text style={styles.fieldLabel}>Proposal account</Text>
            <Text selectable style={styles.monoValue}>{pda ?? 'unavailable'}</Text>
            <Text style={styles.fieldLabel}>Vault transaction account</Text>
            <Text selectable style={styles.monoValue}>{vaultTransactionAddress}</Text>
            <Text style={styles.fieldLabel}>Multisig</Text>
            <Text selectable style={styles.monoValue}>{address}</Text>
            <PillButton
              disabled={model === null}
              label="Open read-only review"
              onPress={() => setReviewOpen(true)}
              variant="secondary"
            />
            {model === null ? (
              <Text style={styles.fieldNote}>
                The technical review is available once the proposal has been decoded by the
                existing review flow.
              </Text>
            ) : null}
          </Card>
        ) : null}

        {/* TROUBLESHOOTING DETAILS — diagnostic d'une tentative ANTERIEURE,
            replie par defaut, jamais prioritaire sur l'etat courant. */}
        {approvalDiagnostics.length > 0 ||
        (approvalResult?.validationErrors.length ?? 0) > 0 ||
        executionError !== null ? (
          <View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Troubleshooting details"
              accessibilityState={{ expanded: troubleshootingOpen }}
              onPress={() => setTroubleshootingOpen((open) => !open)}
              style={styles.advancedToggle}
            >
              <Text style={styles.advancedToggleText}>
                {troubleshootingOpen
                  ? '▾ Troubleshooting details'
                  : '▸ Troubleshooting details'}
              </Text>
            </Pressable>
            {troubleshootingOpen ? (
              <Card style={styles.advancedBody}>
                <Text style={styles.fieldNote}>Diagnostics from an earlier attempt.</Text>
                {approvalDiagnostics.map((message, position) => (
                  <Text key={`approval-detail-${position}`} selectable style={styles.fieldNote}>
                    {message}
                  </Text>
                ))}
                {(approvalResult?.validationErrors ?? []).map((message, position) => (
                  <Text key={`approval-validation-${position}`} selectable style={styles.fieldNote}>
                    {message}
                  </Text>
                ))}
                {executionError !== null ? (
                  <Text selectable style={styles.fieldNote}>
                    {executionError}
                  </Text>
                ) : null}
              </Card>
            ) : null}
          </View>
        ) : null}

        <PillButton
          accessibilityLabel="Back to proposals"
          label="Back to proposals"
          onPress={onBack}
          variant={executed ? 'primary' : 'secondary'}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  keyboardAvoider: {
    backgroundColor: colors.background,
    flex: 1,
    width: '100%',
  },
  scrollView: {
    backgroundColor: colors.background,
    flex: 1,
    width: '100%',
  },
  container: {
    alignItems: 'stretch',
    backgroundColor: colors.background,
    flexGrow: 1,
    padding: spacing.lg,
    paddingBottom: spacing.xxl * 2,
  },
  headerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.lg,
  },
  backButton: {
    alignItems: 'center',
    backgroundColor: colors.surfaceElevated,
    borderRadius: radii.pill,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  backButtonPressed: {
    backgroundColor: colors.surface,
  },
  backGlyph: {
    color: colors.text,
    fontSize: 24,
    lineHeight: 26,
  },
  title: {
    color: colors.text,
    fontSize: typography.screenTitle - 6,
    fontWeight: '800',
    marginBottom: spacing.lg,
  },
  hero: {
    marginBottom: spacing.lg,
  },
  heroAction: {
    color: colors.textSecondary,
    fontSize: typography.secondary,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  heroAmount: {
    color: colors.text,
    fontSize: typography.balance,
    fontWeight: '800',
    marginTop: spacing.sm,
  },
  heroCaption: {
    color: colors.textMuted,
    fontSize: typography.micro,
    marginTop: spacing.md,
    textTransform: 'uppercase',
  },
  stepper: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.lg,
  },
  stepItem: {
    alignItems: 'center',
    flex: 1,
  },
  stepDot: {
    alignItems: 'center',
    backgroundColor: colors.surfaceElevated,
    borderRadius: radii.pill,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  stepDotDone: {
    backgroundColor: colors.successSoft,
  },
  stepDotText: {
    color: colors.textMuted,
    fontSize: typography.secondary,
    fontWeight: '800',
  },
  stepDotTextDone: {
    color: colors.success,
  },
  stepLabel: {
    color: colors.textMuted,
    fontSize: typography.caption,
    fontWeight: '700',
    marginTop: spacing.xs,
  },
  stepLabelDone: {
    color: colors.text,
  },
  statusCard: {
    marginBottom: spacing.md,
  },
  statusTitle: {
    color: colors.text,
    fontSize: typography.sectionTitle,
    fontWeight: '800',
  },
  statusDetail: {
    color: colors.textSecondary,
    fontSize: typography.bodySmall,
    marginTop: spacing.xs,
  },
  progressCard: {
    marginTop: spacing.md,
  },
  progressLabel: {
    color: colors.text,
    fontSize: typography.bodySmall,
    fontWeight: '700',
  },
  fieldLabel: {
    color: colors.textMuted,
    fontSize: typography.micro,
    marginTop: spacing.md,
    textTransform: 'uppercase',
  },
  fieldValue: {
    color: colors.text,
    fontSize: typography.bodySmall,
    marginTop: 2,
  },
  monoValue: {
    color: colors.text,
    fontFamily: 'monospace',
    fontSize: typography.secondary,
    marginTop: spacing.xs,
  },
  fieldNote: {
    color: colors.textSecondary,
    fontSize: typography.secondary,
    marginTop: spacing.sm,
  },
  errorBox: {
    backgroundColor: colors.errorSoft,
    borderRadius: radii.field,
    marginTop: spacing.md,
    padding: spacing.md,
  },
  errorText: {
    color: colors.error,
    fontSize: typography.secondary,
  },
  successBox: {
    backgroundColor: colors.successSoft,
    borderRadius: radii.field,
    marginTop: spacing.md,
    padding: spacing.md,
  },
  successText: {
    color: colors.success,
    fontSize: typography.secondary,
    fontWeight: '800',
  },
  infoBox: {
    marginTop: spacing.md,
  },
  button: {
    alignItems: 'center',
    borderRadius: radii.button,
    justifyContent: 'center',
    marginTop: spacing.lg,
    minHeight: 52,
    paddingHorizontal: spacing.xl,
    width: '100%',
  },
  secondary: {
    backgroundColor: colors.surfaceElevated,
    borderColor: colors.divider,
    borderWidth: 1,
  },
  secondaryPressed: {
    backgroundColor: colors.surface,
  },
  secondaryText: {
    color: colors.text,
    fontSize: typography.body,
    fontWeight: '700',
    textAlign: 'center',
  },
  disabled: {
    backgroundColor: colors.disabled,
  },
  inlineAction: {
    borderRadius: radii.pill,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  inlineActionText: {
    color: colors.mint,
    fontSize: typography.secondary,
    fontWeight: '700',
  },
  advancedToggle: {
    alignItems: 'center',
    backgroundColor: colors.surfaceElevated,
    borderColor: colors.divider,
    borderRadius: radii.field,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.lg,
    minHeight: 48,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  advancedToggleText: {
    color: colors.text,
    fontSize: typography.secondary,
    fontWeight: '700',
  },
  advancedBody: {
    marginTop: spacing.sm,
  },
  executedCard: {
    alignItems: 'center',
    backgroundColor: colors.successSoft,
    borderRadius: radii.card,
    marginTop: spacing.md,
    padding: spacing.lg,
  },
  executedCheck: {
    color: colors.mint,
    fontSize: 56,
    fontWeight: '800',
    lineHeight: 60,
  },
  executedTitle: {
    color: colors.success,
    fontSize: typography.sectionTitle,
    fontWeight: '800',
    marginTop: spacing.sm,
  },
  executedMeta: {
    color: colors.textSecondary,
    fontSize: typography.caption,
    marginTop: spacing.xs,
  },
  executedAmount: {
    color: colors.text,
    fontSize: typography.balance - 10,
    fontWeight: '800',
    marginTop: spacing.md,
  },
});