import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
import { useWalletGuard, type ReviewGuardContext } from '../wallet/useWalletGuard';
import {
  computeProposalDecision,
  loadProposalReview,
  summarizeOperation,
  type ProposalStatusKind,
} from '../squads/proposals';
import type { TransactionReviewModel } from '../types/transactionReview';
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
  walletCanApprove,
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

  // Décodage automatique à l'ouverture, uniquement si l'appelant n'a pas déjà
  // fourni un modèle (aucune lecture dupliquée dans ce cas).
  useEffect(() => {
    if (decodedModel === null) void runDecode();
  }, [decodedModel, runDecode]);

  const model = decodedModel ?? selfModel;
  const effectiveGuardContext = guardContext ?? selfGuardContext;

  const guard = useWalletGuard(effectiveGuardContext ?? null);
  const allowlist = model === null ? null : checkReviewAllowlist(model);
  const canConfirm =
    model !== null &&
    allowlist !== null &&
    computeCanConfirm(model, guard.status, allowlist.status);
  const [approving, setApproving] = useState(false);
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [approvalResult, setApprovalResult] = useState<ProposalApprovalSignSendResult | null>(null);
  // Une seule tentative : jamais deux envois en parallele, jamais de second
  // envoi apres une signature obtenue.
  const approvalAttemptedRef = useRef(false);

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
  const thresholdReached = proposal.approvedAddresses.length >= threshold;
  const canExecute =
    proposal.status === 'Approved' && thresholdReached && walletHasExecute;
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
    if (!canExecute || executing || executionAttemptedRef.current) return;
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

  const runApproval = async () => {
    if (model === null || allowlist === null || approvalAttemptedRef.current) return;
    if (walletAddress === null) {
      setApprovalError('No wallet connected: an approval must be signed by a member.');
      return;
    }
    approvalAttemptedRef.current = true;
    setApproving(true);
    setApprovalError(null);
    setApprovalResult(null);
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
      if (!result.verified) {
        setApprovalError(describeOperationFailure(result));
      }
    } catch (caught: unknown) {
      setApprovalError(caught instanceof Error ? caught.message : String(caught));
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

  const decision = computeProposalDecision({
    index,
    status: proposal.status,
    approvedAddresses: proposal.approvedAddresses,
    threshold,
    walletAddress,
    walletCanApprove,
  });

  const summary = summarizeOperation(model);
  // Adresse de destination COMPLETE, telle que décodée : l'abréviation des
  // cartes compactes ne permet pas de vérifier où part l'argent.
  const fullDestination =
    model !== null && model.destination.known ? model.destination.value : null;
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

  return (
    <KeyboardAvoidingView behavior="padding" style={styles.keyboardAvoider}>
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
        style={styles.scrollView}
      >
        <Text style={styles.badge}>DEVNET · READ ONLY</Text>
        <Text style={styles.title}>Proposal #{index}</Text>
        <Text style={styles.subtitle}>
          Read-only detail. No approval, no rejection and no execution exist on this screen.
        </Text>

        <View style={styles.block}>
          <Text style={styles.fieldLabel}>Status</Text>
          <Text style={styles.statusLine}>{decision.stateLabel}</Text>
          <Text style={styles.fieldNote}>On-chain status: {proposal.status}</Text>

          <Text style={styles.fieldLabel}>Approvals</Text>
          <Text style={styles.fieldValue}>
            {decision.approvals} of {decision.threshold} required
          </Text>

          <Text style={styles.fieldLabel}>Voters ({proposal.approvedAddresses.length})</Text>
          {proposal.approvedAddresses.length === 0 ? (
            <Text style={styles.fieldNote}>
              No member has approved this proposal yet.
            </Text>
          ) : (
            proposal.approvedAddresses.map((voter) => (
              <Text key={voter} selectable style={styles.monoValue}>
                {voter}
              </Text>
            ))
          )}

          <Text style={styles.fieldLabel}>Operation summary</Text>
          {summary === null ? (
            <Text style={styles.fieldNote}>
              Decoding this proposal… the amount and the destination appear as soon as the
              transaction message is decoded. No wallet is involved.
            </Text>
          ) : (
            <>
              <Text style={styles.fieldValue}>{summary.action}</Text>
              <Text selectable style={styles.monoValue}>
                Amount: {summary.amount}
              </Text>
              {/* Destination en entier : l'adresse abrégée des cartes compactes
                  ne suffit pas pour vérifier où part l'argent. */}
              <Text style={styles.fieldNote}>Destination</Text>
              <Text selectable style={styles.monoValue}>
                {fullDestination ?? summary.destination}
              </Text>
              {model !== null && model.source.known ? (
                <>
                  <Text style={styles.fieldNote}>From</Text>
                  <Text selectable style={styles.monoValue}>
                    {model.source.value}
                  </Text>
                </>
              ) : null}
            </>
          )}

          <Text style={styles.fieldLabel}>Transaction information</Text>
          <Text style={styles.fieldNote}>Proposal account</Text>
          <Text selectable style={styles.monoValue}>{pda ?? 'unavailable'}</Text>
          <Text style={styles.fieldNote}>Vault transaction account</Text>
          <Text selectable style={styles.monoValue}>{vaultTransactionAddress}</Text>
          <Text style={styles.fieldNote}>Multisig</Text>
          <Text selectable style={styles.monoValue}>{address}</Text>
          {model !== null ? (
            <>
              <Text style={styles.fieldNote}>Decode status</Text>
              <Text style={styles.fieldValue}>{model.decodeStatus}</Text>
              {model.notes.length > 0 ? (
                <>
                  <Text style={styles.fieldNote}>Notes ({model.notes.length})</Text>
                  {model.notes.map((note) => (
                    <Text key={note} style={styles.fieldNote}>
                      · {note}
                    </Text>
                  ))}
                </>
              ) : null}
            </>
          ) : null}

          <Pressable
              accessibilityRole="button"
              accessibilityLabel="Approve this proposal"
              accessibilityState={{
                busy: approving,
                disabled: !canConfirm || approving || (approvalResult !== null && !(approvalOutcome?.allowNewAttempt ?? false)),
              }}
              disabled={!canConfirm || approving || (approvalResult !== null && !(approvalOutcome?.allowNewAttempt ?? false))}
              onPress={onApprove}
              style={[
                styles.button,
                (!canConfirm || approving || (approvalResult !== null && !(approvalOutcome?.allowNewAttempt ?? false))) &&
                  styles.disabled,
              ]}
            >
              {approving ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <Text style={styles.buttonText}>
                  {approvalResult !== null && (approvalOutcome?.allowNewAttempt ?? false)
                    ? 'Prepare again'
                    : 'Approve'}
                </Text>
              )}
            </Pressable>

            {!canConfirm ? (
              <Text style={styles.fieldNote}>
                {model === null
                  ? 'Approval needs the decoded transaction review: the guard and the allowlist cannot be evaluated without it.'
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

            {approvalError !== null ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{approvalError}</Text>
              </View>
            ) : null}

            {approvalResult !== null ? (
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
                  {approvalOutcome?.label ?? 'Approval recorded on-chain'}
                </Text>
                {approvalResult.signature !== null ? (
                  <Text selectable style={styles.monoValue}>
                    Signature: {approvalResult.signature}
                  </Text>
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
              </View>
            ) : null}

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Execute this proposal"
              accessibilityState={{
                busy: executing,
                disabled: !canExecute || executing || (executionResult !== null && !(executionOutcome?.allowNewAttempt ?? false)),
              }}
              disabled={!canExecute || executing || (executionResult !== null && !(executionOutcome?.allowNewAttempt ?? false))}
              onPress={onExecute}
              style={[
                styles.button,
                styles.executeButton,
                (!canExecute || executing || (executionResult !== null && !(executionOutcome?.allowNewAttempt ?? false))) &&
                  styles.disabled,
              ]}
            >
              {executing ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <Text style={styles.buttonText}>Execute</Text>
              )}
            </Pressable>

            {!canExecute ? (
              <Text style={styles.fieldNote}>
                {proposal.status !== 'Approved'
                  ? `Execution requires an Approved proposal (current status: ${proposal.status}).`
                  : !thresholdReached
                    ? `Execution requires ${threshold} approval(s); ${proposal.approvedAddresses.length} recorded.`
                    : 'Your wallet is not a member with the Execute permission.'}
              </Text>
            ) : (
              <Text style={styles.fieldNote}>
                Executing submits the stored transaction to the vault. It is irreversible and
                requires a double confirmation.
              </Text>
            )}

            {executing ? (
              <Text style={styles.fieldNote}>Waiting for the wallet…</Text>
            ) : null}

            {executionError !== null ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{executionError}</Text>
              </View>
            ) : null}

            {executionResult !== null ? (
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
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{decodeError}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Retry decoding this proposal"
                onPress={() => {
                  void runDecode();
                }}
                style={styles.retry}
              >
                <Text style={styles.retryText}>Retry decode</Text>
              </Pressable>
            </View>
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
            style={[styles.button, styles.secondary, decoding && styles.disabled]}
          >
            <Text style={styles.secondaryText}>
              {decoding ? 'Refreshing…' : 'Refresh proposal'}
            </Text>
          </Pressable>

          <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: model === null }}
              disabled={model === null}
              onPress={() => setReviewOpen(true)}
              style={[styles.button, model === null && styles.disabled]}
            >
            <Text style={styles.buttonText}>Review proposal</Text>
          </Pressable>
          {model === null ? (
            <Text style={styles.fieldNote}>
              The full transaction review is available once the proposal has been decoded by the
              existing review flow.
            </Text>
          ) : null}
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to proposals"
          onPress={onBack}
          style={[styles.button, styles.secondary]}
        >
          <Text style={styles.secondaryText}>Back</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  keyboardAvoider: {
    flex: 1,
    width: '100%',
  },
  scrollView: {
    flex: 1,
    width: '100%',
  },
  container: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    flexGrow: 1,
    padding: 24,
    paddingBottom: 96,
  },
  badge: {
    backgroundColor: '#e8f0fe',
    borderRadius: 999,
    color: '#1a56db',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 8,
    overflow: 'hidden',
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
  },
  subtitle: {
    color: '#6b7280',
    fontSize: 13,
    marginBottom: 12,
    marginTop: 4,
    textAlign: 'center',
  },
  block: {
    alignSelf: 'stretch',
  },
  fieldLabel: {
    color: '#6b7280',
    fontSize: 11,
    marginTop: 14,
    textTransform: 'uppercase',
  },
  fieldValue: {
    color: '#101317',
    fontSize: 13,
    marginTop: 2,
  },
  monoValue: {
    color: '#101317',
    fontFamily: 'monospace',
    fontSize: 11,
    marginTop: 4,
  },
  fieldNote: {
    color: '#6b7280',
    fontSize: 12,
    marginTop: 6,
  },
  statusLine: {
    color: '#065f46',
    fontSize: 14,
    fontWeight: '800',
    marginTop: 2,
  },
  errorBox: {
    backgroundColor: '#fef2f2',
    borderColor: '#fecaca',
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 12,
    padding: 12,
  },
  errorText: {
    color: '#991b1b',
    fontSize: 13,
  },
  successBox: {
    backgroundColor: '#ecfdf5',
    borderColor: '#a7f3d0',
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 12,
    padding: 12,
  },
  successText: {
    color: '#065f46',
    fontSize: 13,
    fontWeight: '800',
  },
  button: {
    alignItems: 'center',
    backgroundColor: '#1a56db',
    borderRadius: 10,
    justifyContent: 'center',
    marginTop: 16,
    minHeight: 48,
    paddingHorizontal: 24,
    width: '100%',
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'center',
  },
  disabled: {
    backgroundColor: '#9ca3af',
  },
  secondary: {
    backgroundColor: '#f3f4f6',
    borderColor: '#d1d5db',
    borderWidth: 1,
    marginTop: 24,
  },
  // Execute : action irreversible, visuellement distincte d'Approve.
  executeButton: {
    backgroundColor: '#b45309',
    marginTop: 24,
  },
  secondaryText: {
    color: '#101317',
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'center',
  },
  retry: {
    alignItems: 'center',
    marginTop: 8,
    paddingVertical: 6,
  },
  retryText: {
    color: '#1a56db',
    fontSize: 14,
    fontWeight: '700',
  },
});