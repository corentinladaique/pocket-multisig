// Écran de revue de transaction — LECTURE SEULE.
// Ce composant n'appelle AUCUNE fonction d'écriture : ni approve, ni execute,
// ni signTransaction, ni signAndSendTransaction, ni aucune fonction RPC.
// Il affiche un modèle déjà construit (voir src/types/transactionReview.ts).
import { useCallback, useEffect, useState } from 'react';
import { BackHandler, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { PublicKey, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import * as multisig from '@sqds/multisig';
import { useMobileWallet } from '@wallet-ui/react-native-web3js';

import {
  isAlreadyApprovedVerdict,
  useWalletGuard,
} from '../wallet/useWalletGuard';
import { checkReviewAllowlist } from '../squads/instructionAllowlist';
import { SAFE_TOP_PADDING } from '../ui/safeAreaPadding';
import { planProposalApproval, type ApprovalPlan } from '../squads/proposalApproval';
import { connection } from '../solana/connection';
import { TransactionTechnicalDetails } from './TransactionTechnicalDetails';
import type { GuardVerdict, ReviewGuardContext } from '../wallet/useWalletGuard';

import {
  abbreviateAddress,
  formatLamportsExact,
  SYSTEM_PROGRAM_ID,
  type DecodeStatus,
  type ReviewField,
  type SolAmount,
  type TransactionReviewModel,
} from '../types/transactionReview';

const DECODE_LABEL: Record<DecodeStatus, string> = {
  decoded: 'Decoded',
  partial: 'Partially decoded',
  unknown: 'Not decoded',
};

/** Rend un champ : `Unknown` quand l'information n'est pas disponible. */
function fieldText(field: ReviewField<string>): string {
  return field.known ? field.value : 'Unknown';
}

/** Montant : SOL et lamports bruts, sans aucun arrondi. */
function amountText(field: ReviewField<SolAmount>): string {
  if (!field.known) return 'Unknown';
  return `${formatLamportsExact(field.value.lamports)} (${field.value.lamports} lamports)`;
}

export interface TransactionReviewScreenProps {
  model: TransactionReviewModel;
  onBack: () => void;
  /** Données déjà chargées, injectées par l'appelant. Aucun RPC dans le guard. */
  guardContext?: ReviewGuardContext | null;
}

/**
 * Condition locale d'activation de la première confirmation (T11a).
 *
 * Purement déductive : elle ne consulte aucun réseau, ne relit aucune donnée et
 * n'active aucun envoi. Elle exige que la revue soit RÉELLE (jamais une preview)
 * et que TOUS les verdicts déjà calculés soient favorables.
 */
export function computeCanConfirm(
  review: TransactionReviewModel,
  guardStatus: GuardVerdict['status'],
  allowlistStatus: 'allowed' | 'blocked',
): boolean {
  return (
    review.isPreview === false &&
    guardStatus === 'allowed' &&
    allowlistStatus === 'allowed' &&
    review.decodeStatus === 'decoded'
  );
}

export function TransactionReviewScreen({
  model,
  onBack,
  guardContext = null,
}: TransactionReviewScreenProps) {
  // Aucune confirmation n'est possible dans cette mission, y compris pour un
  // décodage complet : le branchement on-chain n'existe pas encore (T11/T12).
  const needsWarning = model.decodeStatus !== 'decoded' || model.notes.length > 0;

  const guard = useWalletGuard(guardContext);
  const { signAndSendTransactions } = useMobileWallet();
  const allowlist = checkReviewAllowlist(model);

  // T11a : condition locale stricte. Aucune donnée réseau n'est relue ici, et
  // aucune fonction d'écriture n'est branchée : le bouton final de la seconde
  // confirmation reste désactivé dans cette mission.
  const canConfirm = computeCanConfirm(model, guard.status, allowlist.status);

  // Cas utilisateur positif : le wallet connecté a DÉJÀ approuvé. Le verdict
  // interne reste `blocked` — aucune confirmation n'est possible — mais
  // l'affichage explique la situation au lieu d'une liste de raisons brutes.
  const alreadyApproved = isAlreadyApprovedVerdict(guard);
  const approvalsConfirmed = guardContext?.proposal?.approvedAddresses.length ?? 0;
  const guardThreshold = guardContext?.multisig?.threshold ?? 0;
  // Seuil atteint : la proposition est passée `Approved` côté chaîne.
  const proposalApproved = model.proposalStatus === 'Approved';
  // Le wallet connecté figure-t-il déjà parmi les approbateurs ?
  const walletInApproved =
    guardContext !== null &&
    guardContext.walletAddress !== null &&
    (guardContext.proposal?.approvedAddresses.includes(guardContext.walletAddress) ?? false);
  // Affichage utilisateur positif : soit le seul blocage est « déjà approuvé »,
  // soit le seuil est atteint et ce wallet a voté. Tous les autres cas `blocked`
  // gardent la liste de raisons brute.
  const showApprovedState = proposalApproved && walletInApproved;
  const showUserState = showApprovedState || alreadyApproved;

  // Libelle d'action principal, derive des champs REELLEMENT decodes (programme
  // + action). La valeur brute du modele reste affichee dans les details.
  const isSystemTransfer =
    model.program.known &&
    model.program.value.id === SYSTEM_PROGRAM_ID &&
    model.action.known &&
    /transfer/i.test(model.action.value);
  const primaryActionLabel = isSystemTransfer ? 'SOL transfer' : fieldText(model.action);

  // Hierarchie n°1 de l'ecran : mise en avant de ce qui est deja calcule.
  const decisionTitle = proposalApproved
    ? 'Approved'
    : alreadyApproved
      ? 'Approved by this wallet'
      : DECODE_LABEL[model.decodeStatus];
  const decisionSub =
    showUserState || alreadyApproved
      ? `${approvalsConfirmed} of ${guardThreshold} approvals confirmed`
      : fieldText(model.action);
  const decisionState = proposalApproved
    ? 'Ready to execute'
    : alreadyApproved
      ? 'Waiting for 1 more approval'
      : 'Execution is not implemented yet';

  // PDA de la proposition : derivation locale par le SDK, aucun appel RPC.
  const proposalAddress = (() => {
    const address = guardContext?.multisig?.address ?? model.multisigAddress;
    try {
      return multisig.getProposalPda({
        multisigPda: new PublicKey(address),
        transactionIndex: BigInt(model.proposalIndex),
      })[0].toBase58();
    } catch {
      return null;
    }
  })();

  // T11c : étape « ready to approve ». Le bouton final est branché sur la
  // PRÉPARATION uniquement — aucune ouverture du wallet, aucune signature,
  // aucun envoi. L'appel MWA reste hors de portée de cette mission.
  const [plan, setPlan] = useState<ApprovalPlan | null>(null);
  const [signature, setSignature] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  // Une seule tentative d'envoi autorisée pour toute la session d'écran.
  const [sendAttempted, setSendAttempted] = useState(false);
  const [planning, setPlanning] = useState(false);

  // Seconde confirmation locale (T11a) : aucun envoi, le bouton final reste
  // désactivé. Cet état n'ouvre aucun chemin d'écriture.
  const [confirmStep, setConfirmStep] = useState(false);

  const handleBack = useCallback(() => {
    onBack();
  }, [onBack]);

  // Retour systeme Android (bouton physique et geste) : revient a l'ecran
  // appelant. Sans ce handler, un geste depuis cet ecran fermait l'application.
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      handleBack();
      return true;
    });
    return () => subscription.remove();
  }, [handleBack]);

  const handleCancelConfirm = useCallback(() => {
    setConfirmStep(false);
  }, []);

  const handleRequestApproval = useCallback(async () => {
    if (guardContext === null || guardContext.multisig === null) return;
    if (guardContext.walletAddress === null) return;
    setPlanning(true);
    try {
      const result = await planProposalApproval({
        connection,
        multisigPda: new PublicKey(guardContext.multisig.address),
        transactionIndex: model.proposalIndex,
        walletAddress: guardContext.walletAddress,
        preconditions: {
          guardStatus: guard.status,
          allowlistStatus: allowlist.status,
          guardReasons: guard.reasons,
        },
      });
      setPlan(result);
    } finally {
      setPlanning(false);
    }
  }, [allowlist.status, guard.reasons, guard.status, guardContext, model.proposalIndex]);

  const handleCancelPlan = useCallback(() => {
    setPlan(null);
  }, []);

  /**
   * T11d : UNE SEULE tentative d'envoi. Aucun retry, aucune reconstruction
   * après un retour de signature. `vaultTransactionExecute` n'est jamais
   * atteignable depuis ce composant.
   */
  const handleSendApproval = useCallback(async () => {
    if (plan === null || plan.status !== 'ready') return;
    if (sendAttempted || sending) return;
    if (guardContext === null || guardContext.walletAddress === null) return;
    setSendAttempted(true);
    setSending(true);
    setSendError(null);
    try {
      const latest = await connection.getLatestBlockhash('confirmed');
      const message = new TransactionMessage({
        payerKey: new PublicKey(guardContext.walletAddress),
        recentBlockhash: latest.blockhash,
        instructions: [plan.instruction],
      }).compileToV0Message([]);
      const transaction = new VersionedTransaction(message);
      const minContextSlot = await connection.getSlot('confirmed');
      // Unique demande MWA : le wallet signe ET envoie.
      const returned = await signAndSendTransactions(transaction, minContextSlot);
      setSignature(returned);
    } catch (caught: unknown) {
      setSendError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSending(false);
    }
  }, [connection, guardContext, plan, sendAttempted, sending, signAndSendTransactions]);



  if (plan !== null) {
    // Étape « ready to approve » : résumé public uniquement. Aucun appel
    // wallet, aucune signature, aucun envoi — l'appel MWA est délibérément
    // laissé hors de ce composant.
    const threshold = guardContext?.multisig?.threshold ?? 0;
    // Le bouton final n'est actif qu'après TOUS les contrôles, et une seule fois.
    const canSend = plan.status === 'ready' && !sendAttempted && !sending;
    return (
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.badge}>DEVNET</Text>
        <Text style={styles.title}>Ready to approve</Text>
        <Text style={styles.previewBanner}>Prepared only — no signature requested</Text>

        {plan.status === 'refused' ? (
          <View style={styles.card}>
            <Text style={styles.fieldLabel}>Refused</Text>
            {plan.reasons.map((reason) => (
              <Text key={reason} style={styles.warnText}>
                • {reason}
              </Text>
            ))}
          </View>
        ) : (
          <View style={styles.card}>
            <Text style={styles.fieldLabel}>Network</Text>
            <Text style={styles.fieldValue}>Devnet</Text>

            <Text style={styles.fieldLabel}>Multisig configuration address</Text>
            <Text selectable style={styles.fieldValue}>
              {model.multisigAddress}
            </Text>

            <Text style={styles.fieldLabel}>Proposal</Text>
            <Text style={styles.fieldValue}>#{model.proposalIndex}</Text>

            <Text style={styles.fieldLabel}>Proposal PDA</Text>
            <Text selectable style={styles.fieldValue}>
              {plan.proposalAddress}
            </Text>

            <Text style={styles.fieldLabel}>Member wallet</Text>
            <Text selectable style={styles.fieldValue}>
              {model.signerWallet}
            </Text>

            <Text style={styles.fieldLabel}>Proposal status</Text>
            <Text style={styles.fieldValue}>{plan.proposalStatus}</Text>

            <Text style={styles.fieldLabel}>Approvals</Text>
            <Text style={styles.fieldValue}>
              {plan.approvedAddresses.length} / {threshold}
            </Text>

            <Text style={styles.fieldLabel}>Program</Text>
            <Text selectable style={styles.fieldValue}>
              {plan.instruction.programId.toBase58()}
            </Text>

            <Text style={styles.fieldLabel}>Execution</Text>
            <Text style={styles.fieldValue}>No automatic execution.</Text>

            {signature !== null ? (
              <>
                <Text style={styles.fieldLabel}>Signature</Text>
                <Text selectable style={styles.fieldValue}>
                  {signature}
                </Text>
              </>
            ) : null}
          </View>
        )}

        {sendError !== null ? (
          <Text style={styles.warnText}>Send failed: {sendError}</Text>
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: !canSend }}
          disabled={!canSend}
          onPress={() => {
            void handleSendApproval();
          }}
          style={[styles.button, canSend ? null : styles.disabled]}
        >
          <Text style={styles.buttonText}>
            {sending ? 'Waiting for wallet…' : 'Approve now'}
          </Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Cancel approval plan"
          onPress={handleCancelPlan}
          style={[styles.button, styles.secondary]}
        >
          <Text style={styles.secondaryText}>Cancel</Text>
        </Pressable>
      </ScrollView>
    );
  }

  if (confirmStep) {
    // Seconde confirmation, strictement locale : rappel du contenu réel, puis
    // Cancel ou un bouton final DÉSACTIVÉ. Aucun appel réseau, aucune signature.
    return (
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.badge}>DEVNET</Text>
        <Text style={styles.title}>Confirm approval</Text>
        <Text style={styles.previewBanner}>Second confirmation — no send in this build</Text>

        <View style={styles.card}>
          <Text style={styles.fieldLabel}>Network</Text>
          <Text style={styles.fieldValue}>Devnet</Text>

          <Text style={styles.fieldLabel}>Proposal</Text>
          <Text style={styles.fieldValue}>#{model.proposalIndex}</Text>

          <Text style={styles.fieldLabel}>Multisig configuration address</Text>
          <Text selectable style={styles.fieldValue}>
            {model.multisigAddress}
          </Text>

          <Text style={styles.fieldLabel}>Vault address</Text>
          <Text selectable style={styles.fieldValue}>
            {model.vaultAddress}
          </Text>

          <Text style={styles.fieldLabel}>Connected wallet</Text>
          <Text selectable style={styles.fieldValue}>
            {model.signerWallet}
          </Text>

          <Text style={styles.fieldLabel}>Action</Text>
          <Text style={styles.fieldValue}>{fieldText(model.action)}</Text>

          <Text style={styles.fieldLabel}>Destination</Text>
          <Text selectable style={styles.fieldValue}>
            {fieldText(model.destination)}
          </Text>

          <Text style={styles.fieldLabel}>Amount</Text>
          <Text style={styles.fieldValue}>{amountText(model.amount)}</Text>

          <Text style={styles.fieldLabel}>Approvals already recorded</Text>
          <Text style={styles.fieldValue}>0</Text>

          <Text style={styles.fieldLabel}>Execution</Text>
          <Text style={styles.fieldValue}>No automatic execution.</Text>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: !canConfirm || planning }}
          disabled={!canConfirm || planning}
          onPress={() => {
            // Prépare l'approbation : aucune ouverture du wallet, aucune
            // signature, aucun envoi. Uniquement un résumé public.
            void handleRequestApproval();
          }}
          style={[styles.button, canConfirm ? null : styles.disabled]}
        >
          <Text style={styles.buttonText}>
            {planning ? 'Preparing…' : 'Approve proposal'}
          </Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Cancel approval"
          onPress={handleCancelConfirm}
          style={[styles.button, styles.secondary]}
        >
          <Text style={styles.secondaryText}>Cancel</Text>
        </Pressable>
      </ScrollView>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={[styles.container, SAFE_TOP_PADDING]}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.badge}>DEVNET</Text>
      <Text style={styles.title}>Transaction review</Text>

      <Text style={[styles.previewBanner, model.isPreview ? null : styles.onchainBanner]}>
        {model.isPreview
          ? 'Development preview — not on-chain data'
          : 'On-chain proposal — Devnet'}
      </Text>

      {model.isPreview ? null : (
        <Text style={styles.onchainLine}>
          Proposal #{model.proposalIndex} · {primaryActionLabel} · approved{' '}
          {approvalsConfirmed} of {guardThreshold}
        </Text>
      )}

      <Text style={[styles.decode, needsWarning && styles.decodeWarn]}>
        {DECODE_LABEL[model.decodeStatus]}
      </Text>

      {/* 1. Statut de decision */}
      <View style={proposalApproved && walletInApproved ? styles.decisionOk : styles.decisionNeutral}>
        <Text style={styles.decisionTitle}>{decisionTitle}</Text>
        <Text style={styles.decisionSub}>{decisionSub}</Text>
        <Text style={styles.decisionState}>{decisionState}</Text>
      </View>

      {/* 2. Action */}
      <Text style={styles.fieldLabel}>Action</Text>
      <Text style={styles.actionValue}>{primaryActionLabel}</Text>

      {/* 3. Montant */}
      <Text style={styles.fieldLabel}>Amount</Text>
      <Text style={styles.amountValue}>{amountText(model.amount)}</Text>

      {/* 4. Destination, abregee ; adresse complete dans les details. */}
      <Text style={styles.fieldLabel}>Destination</Text>
      <Text style={styles.fieldValue}>
        {model.destination.known ? abbreviateAddress(model.destination.value) : 'Unknown'}
      </Text>

      {/* 5. Progression des approbations */}
      <Text style={styles.fieldLabel}>Approvals</Text>
      <Text style={styles.fieldValue}>
        {approvalsConfirmed} of {guardThreshold} confirmed
      </Text>

      {/* 6. Avertissement ou prochaine etape */}
      {needsWarning || (guard.status === 'blocked' && !showUserState) ? (
        <View style={styles.warnBox}>
          {model.decodeStatus !== 'decoded' ? (
            <Text style={styles.warnText}>
              {model.decodeStatus === 'partial'
                ? 'Warning: instruction only partially decoded. A critical field is missing. Verify on a devnet explorer before acting.'
                : 'Warning: program not recognized. No interpretation was attempted. Verify on a devnet explorer before acting.'}
            </Text>
          ) : null}
          {guard.status === 'blocked' && !showUserState
            ? // Un contexte absent n'est PAS un refus : c'est un chargement en
              // cours. Le refus réel (rôle manquant, réseau, statut) s'affiche
              // avec ses raisons d'origine.
              guardContext === null
              ? (
                  <Text style={styles.warnText}>
                    • Checking approval permissions…
                  </Text>
                )
              : guard.reasons.map((reason) => (
                  <Text key={reason} style={styles.warnText}>
                    • {reason}
                  </Text>
                ))
            : null}
          {model.notes.map((note) => (
            <Text key={note} style={styles.warnText}>
              {note}
            </Text>
          ))}
        </View>
      ) : null}
      <Text style={styles.secondaryText}>
        Execution is not implemented yet — no Execute button is active in this build.
      </Text>

      {/* 7. Details techniques, replies par defaut */}
      <TransactionTechnicalDetails
        model={model}
        guard={guard}
        allowlist={allowlist}
        proposalAddress={proposalAddress}
      />

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: !canConfirm }}
        disabled={!canConfirm}
        onPress={() => {
          // Ouvre uniquement la seconde confirmation locale : aucun envoi ici.
          setConfirmStep(true);
        }}
        style={[styles.button, canConfirm ? null : styles.disabled]}
      >
        <Text style={styles.buttonText}>Review and confirm</Text>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back to main screen"
        onPress={handleBack}
        style={[styles.button, styles.secondary]}
      >
        <Text style={styles.secondaryText}>Back</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    padding: 24,
    // Inset haut : sans ce décalage, le titre et le bandeau passent sous la
    // barre d'état du Seeker (Android 16, API 36). Basé uniquement sur l'API
    // React Native déjà présente, sans nouvelle dépendance.
    // Doit rester APRÈS `padding` pour ne pas être écrasé par le raccourci.
    paddingTop: SAFE_TOP_PADDING.paddingTop + 16,
    paddingBottom: 48,
  },
  badge: {
    backgroundColor: '#e8f0fe',
    borderRadius: 999,
    color: '#1a56db',
    fontSize: 12,
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
    marginBottom: 12,
  },
  previewBanner: {
    backgroundColor: '#fff7ed',
    borderColor: '#fdba74',
    borderRadius: 8,
    borderWidth: 1,
    color: '#9a3412',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 16,
    paddingHorizontal: 10,
    paddingVertical: 6,
    textAlign: 'center',
  },
  onchainBanner: {
    backgroundColor: '#ecfdf5',
    borderColor: '#6ee7b7',
    color: '#065f46',
  },
  onchainLine: {
    color: '#065f46',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 16,
    textAlign: 'center',
  },
  decisionOk: {
    alignSelf: 'stretch',
    backgroundColor: '#ecfdf5',
    borderColor: '#6ee7b7',
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 16,
    padding: 16,
  },
  decisionNeutral: {
    alignSelf: 'stretch',
    backgroundColor: '#f3f4f6',
    borderColor: '#e5e7eb',
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 16,
    padding: 16,
  },
  decisionTitle: {
    color: '#065f46',
    fontSize: 20,
    fontWeight: '800',
  },
  decisionSub: {
    color: '#065f46',
    fontSize: 13,
    fontWeight: '600',
    marginTop: 2,
  },
  decisionState: {
    color: '#065f46',
    fontSize: 13,
    marginTop: 6,
  },
  actionValue: {
    color: '#111827',
    fontSize: 16,
    fontWeight: '700',
  },
  amountValue: {
    color: '#111827',
    fontSize: 26,
    fontWeight: '800',
  },
  card: {
    alignSelf: 'stretch',
    borderColor: '#e5e7eb',
    borderRadius: 10,
    borderWidth: 1,
    padding: 14,
  },
  summaryLabel: {
    color: '#6b7280',
    fontSize: 11,
    textTransform: 'uppercase',
  },
  summaryValue: {
    color: '#101317',
    fontSize: 18,
    fontWeight: '600',
    marginTop: 2,
  },
  decode: {
    color: '#047857',
    fontSize: 12,
    fontWeight: '700',
    marginTop: 6,
  },
  decodeWarn: {
    color: '#b91c1c',
  },
  warnBox: {
    alignSelf: 'stretch',
    backgroundColor: '#fef2f2',
    borderColor: '#fecaca',
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 12,
    padding: 12,
  },
  warnText: {
    color: '#991b1b',
    fontSize: 13,
  },
  fieldLabel: {
    color: '#6b7280',
    fontSize: 11,
    marginTop: 12,
    textTransform: 'uppercase',
  },
  fieldValue: {
    color: '#101317',
    fontFamily: 'monospace',
    fontSize: 12,
    marginTop: 2,
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
  disabled: {
    backgroundColor: '#9ca3af',
    opacity: 0.7,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
  },
  secondary: {
    backgroundColor: '#f3f4f6',
  },
  secondaryText: {
    color: '#101317',
    fontSize: 16,
    fontWeight: '600',
  },
});