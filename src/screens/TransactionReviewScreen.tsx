// VUE TECHNIQUE FACULTATIVE — READ ONLY.
// Affiche uniquement des détails de transaction décodés : programme, comptes,
// source, destination, montant, lamports et avertissements. Aucune
// autorisation wallet, aucune signature, aucun envoi de transaction : la seule
// action de cet écran est Back (retour vers ProposalDetailsScreen).
// L'approbation d'une proposition se fait EXCLUSIVEMENT depuis
// ProposalDetailsScreen (signAndSendProposalApproval).
// Lecture seule sur modèle déjà construit (voir src/types/transactionReview.ts).
import { useCallback, useEffect } from 'react';
import { BackHandler, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { PublicKey } from '@solana/web3.js';
import * as multisig from '@sqds/multisig';

import {
  isAlreadyApprovedVerdict,
  useWalletGuard,
} from '../wallet/useWalletGuard';
import { checkReviewAllowlist } from '../squads/instructionAllowlist';
import { SAFE_TOP_PADDING } from '../ui/safeAreaPadding';
import { REVIEW_SCREEN_CAPABILITIES } from './reviewScreenCapabilities';
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
  // Avertissements affichés quand le décodage est incomplet ou porte des notes.
  const needsWarning = model.decodeStatus !== 'decoded' || model.notes.length > 0;

  // Guard et allowlist restent évalués, mais UNIQUEMENT pour afficher un état
  // informatif : aucune action d'écriture n'est branchée sur cet écran.
  const guard = useWalletGuard(guardContext);
  const allowlist = checkReviewAllowlist(model);
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
    ? 'Ready to execute (from Proposal Details)'
    : alreadyApproved
      ? 'Waiting for 1 more approval'
      : 'Read-only technical view';

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

  // (Aucun état ni handler de signature : cet écran n'envoie rien.)

  return (
    <ScrollView
      contentContainerStyle={[styles.container, SAFE_TOP_PADDING]}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.badge}>DEVNET</Text>
      <Text style={styles.title}>Technical transaction details</Text>
      <Text style={styles.subtitle}>
        Review the decoded transaction details. Approval is performed from Proposal
        Details.
        {REVIEW_SCREEN_CAPABILITIES.readOnly
          ? ' No wallet action is available on this screen.'
          : ''}
      </Text>

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

      {/* 5bis. Lecture seule : aucun CTA ici, on informe seulement. */}
      <Text style={styles.fieldLabel}>Approval</Text>
      <Text style={styles.fieldNote}>
        {canConfirm
          ? 'Guard and allowlist are satisfied. Approval is performed from Proposal Details.'
          : 'Approval is not available for this proposal in its current state.'}
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
      {/* 7. Details techniques, replies par defaut */}
      <TransactionTechnicalDetails
        model={model}
        guard={guard}
        allowlist={allowlist}
        proposalAddress={proposalAddress}
      />

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back to proposal details"
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
    marginBottom: 4,
  },
  subtitle: {
    color: '#6b7280',
    fontSize: 13,
    marginBottom: 12,
    textAlign: 'center',
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
  fieldNote: {
    color: '#6b7280',
    fontSize: 12,
    marginTop: 4,
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
  secondary: {
    backgroundColor: '#f3f4f6',
  },
  secondaryText: {
    color: '#101317',
    fontSize: 16,
    fontWeight: '600',
  },
});