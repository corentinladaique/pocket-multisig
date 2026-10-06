// VUE TECHNIQUE FACULTATIVE — READ ONLY.
// Affiche uniquement des détails de transaction décodés : programme, comptes,
// source, destination, montant, lamports et avertissements. Aucune
// autorisation wallet, aucune signature, aucun envoi de transaction : la seule
// action de cet écran est Back (retour vers l'écran appelant).
// L'approbation d'une proposition se fait EXCLUSIVEMENT depuis
// ProposalDetailsScreen (signAndSendProposalApproval).
// Lecture seule sur modèle déjà construit (voir src/types/transactionReview.ts).
//
// UI V2 « Seeker style » : seule la présentation a changé. Le CTA optionnel
// « Create proposal » est fourni par l'appelant (création d'une proposition) ;
// il n'est rendu QUE si `onCreate` est passé. Aucun wallet n'est ouvert depuis
// cet écran : le callback appartient au flux de l'appelant, qui garde sa double
// confirmation explicite.
import { useCallback, useEffect, useState } from 'react';
import { BackHandler, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { PublicKey } from '@solana/web3.js';
import * as multisig from '@sqds/multisig';

import {
  isAlreadyApprovedVerdict,
  useWalletGuard,
} from '../wallet/useWalletGuard';
import { checkReviewAllowlist } from '../squads/instructionAllowlist';
import { SAFE_TOP_PADDING } from '../ui/safeAreaPadding';
import { colors, radii, spacing, typography } from '../ui/theme';
import { DevnetPill, InfoBox, InfoText } from '../ui/v2/primitives';
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

/**
 * Montant principal : SOL seul. Les lamports exacts ne disparaissent pas pour
 * autant : ils vivent dans les details techniques bruts (voir `rawLamports`).
 * `formatLamportsExact` ne fait AUCUN arrondi : la valeur affichee est exacte.
 */
function amountText(field: ReviewField<SolAmount>): string {
  if (!field.known) return 'Unknown';
  return formatLamportsExact(field.value.lamports);
}

/** Lamports bruts, pour la section technique uniquement. */
function rawLamports(field: ReviewField<SolAmount>): string | null {
  return field.known ? `${field.value.lamports} lamports` : null;
}

export interface TransactionReviewScreenProps {
  model: TransactionReviewModel;
  onBack: () => void;
  /** Données déjà chargées, injectées par l'appelant. Aucun RPC dans le guard. */
  guardContext?: ReviewGuardContext | null;
  /**
   * CTA optionnel de création, fourni par l'appelant (préparation + double
   * confirmation + wallet restent chez lui). Absent ⇒ aucun CTA de création.
   */
  onCreate?: () => void;
  /**
   * Vrai uniquement si la simulation réelle du flux appelant a réussi. Aucun
   * état de simulation n'est inventé ici : sans ce drapeau, rien n'est affiché.
   */
  simulationPassed?: boolean;
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
  onCreate,
  simulationPassed = false,
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
  /** Diagnostics techniques repliés par défaut (présentation seule). */
  const [advancedOpen, setAdvancedOpen] = useState(false);

  return (
    <ScrollView
      contentContainerStyle={[styles.container, SAFE_TOP_PADDING]}
      keyboardShouldPersistTaps="handled"
      style={styles.scrollView}
    >
      <View style={styles.headerRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to proposal details"
          onPress={handleBack}
          style={({ pressed }) => [styles.backButton, pressed && styles.backButtonPressed]}
        >
          <Text style={styles.backGlyph}>‹</Text>
        </Pressable>
        <DevnetPill />
      </View>

      <Text style={styles.title}>Review proposal</Text>
      <Text style={styles.subtitle}>
        Review the decoded transaction details. Approval is performed from Proposal
        Details.
        {REVIEW_SCREEN_CAPABILITIES.readOnly
          ? ' No wallet action is available on this screen.'
          : ''}
      </Text>

      {/* Résultat de simulation : affiché UNIQUEMENT si la simulation réelle du
          flux appelant a réussi. */}
      {simulationPassed ? (
        <InfoBox glyph="✓" style={styles.infoBox} tone="success">
          <InfoText tone="success">Simulation passed</InfoText>
          <InfoText tone="success">The transaction is valid.</InfoText>
        </InfoBox>
      ) : null}

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

      {/* 5. From : les fonds partent du Main vault (source décodée si connue). */}
      <Text style={styles.fieldLabel}>From</Text>
      <Text style={styles.fieldValue}>
        {model.source.known ? `Main vault · ${abbreviateAddress(model.source.value)}` : 'Main vault'}
      </Text>

      {/* 6. Progression des approbations */}
      <Text style={styles.fieldLabel}>Approvals</Text>
      <Text style={styles.fieldValue}>
        {approvalsConfirmed} of {guardThreshold} confirmed
      </Text>

      {/* 7. Proposé par (signataire réel du modèle, jamais inventé). */}
      <Text style={styles.fieldLabel}>Proposed by</Text>
      <Text style={styles.fieldValue}>
        {model.signerWallet.length > 0 ? abbreviateAddress(model.signerWallet) : 'Unknown'}
      </Text>

      {/* 8. Coût estimé : uniquement si les frais sont réellement décodés. */}
      {model.fee.known ? (
        <>
          <Text style={styles.fieldLabel}>Estimated cost</Text>
          <Text style={styles.fieldValue}>{amountText(model.fee)}</Text>
        </>
      ) : null}

      {/* 9. Lecture seule : aucun CTA d'approbation ici, on informe seulement. */}
      <Text style={styles.fieldLabel}>Approval</Text>
      <Text style={styles.fieldNote}>
        {canConfirm
          ? 'Guard and allowlist are satisfied. Approval is performed from Proposal Details.'
          : 'Approval is not available for this proposal in its current state.'}
      </Text>

      {/* 10. Rappel de sécurité sur le déclenchement de l'exécution. */}
      <InfoBox glyph="ℹ" style={styles.infoBox}>
        <InfoText>
          The transfer occurs only after the approval threshold is reached and an
          authorized member executes the proposal.
        </InfoText>
      </InfoBox>

      {/* 11. Avertissement ou prochaine etape */}
      {needsWarning || (guard.status === 'blocked' && !showUserState) ? (
        <InfoBox glyph="⚠" style={styles.infoBox} tone="warning">
          {model.decodeStatus !== 'decoded' ? (
            <InfoText tone="warning">
              {model.decodeStatus === 'partial'
                ? 'Warning: instruction only partially decoded. A critical field is missing. Verify on a devnet explorer before acting.'
                : 'Warning: program not recognized. No interpretation was attempted. Verify on a devnet explorer before acting.'}
            </InfoText>
          ) : null}
          {guard.status === 'blocked' && !showUserState
            ? // Un contexte absent n'est PAS un refus : c'est un chargement en
              // cours. Le refus réel (rôle manquant, réseau, statut) s'affiche
              // avec ses raisons d'origine.
              guardContext === null
              ? (
                  <InfoText tone="warning">
                    • Checking approval permissions…
                  </InfoText>
                )
              : guard.reasons.map((reason) => (
                  <InfoText key={reason} tone="warning">
                    • {reason}
                  </InfoText>
                ))
            : null}
          {model.notes.map((note) => (
            <InfoText key={note} tone="warning">
              {note}
            </InfoText>
          ))}
        </InfoBox>
      ) : null}

      {/* 12. Détails techniques, repliés par défaut. */}
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: advancedOpen }}
        accessibilityLabel="Toggle advanced diagnostics"
        onPress={() => setAdvancedOpen((previous) => !previous)}
        style={({ pressed }) => [styles.toggle, pressed && styles.togglePressed]}
      >
        <Text style={styles.toggleText}>
          {advancedOpen ? 'Hide advanced diagnostics' : 'Advanced diagnostics'}
        </Text>
      </Pressable>
      {advancedOpen ? (
        <>
          <Text style={styles.sectionTitle}>Technical transaction details</Text>
          {/* Lamports EXACTS : deplaces ici, plus jamais dans le montant principal. */}
          <Text style={styles.fieldLabel}>Raw amount</Text>
          <Text style={styles.fieldValue}>{rawLamports(model.amount) ?? 'Unknown'}</Text>
          <TransactionTechnicalDetails
            model={model}
            guard={guard}
            allowlist={allowlist}
            proposalAddress={proposalAddress}
          />
        </>
      ) : null}

      {/* CTA de création : rendu uniquement si l'appelant le fournit. */}
      {onCreate !== undefined ? (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Create proposal"
            onPress={onCreate}
            style={({ pressed }) => [styles.primaryButton, pressed && styles.primaryPressed]}
          >
            <Text style={styles.primaryText}>Create proposal</Text>
          </Pressable>
          <Text style={styles.fieldNote}>Your wallet will ask you to sign.</Text>
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scrollView: { backgroundColor: colors.background, flex: 1, width: '100%' },
  container: {
    alignItems: 'stretch',
    backgroundColor: colors.background,
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
  backButtonPressed: { backgroundColor: colors.surface },
  backGlyph: { color: colors.text, fontSize: 24, lineHeight: 26 },
  title: {
    color: colors.text,
    fontSize: typography.screenTitle - 8,
    fontWeight: '800',
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: typography.secondary,
    lineHeight: 19,
    marginBottom: spacing.md,
    marginTop: spacing.sm,
  },
  infoBox: { marginTop: spacing.md },
  previewBanner: {
    backgroundColor: colors.warningSoft,
    borderColor: colors.warningSoft,
    borderRadius: radii.field,
    borderWidth: 1,
    color: colors.warning,
    fontSize: typography.caption,
    fontWeight: '700',
    marginBottom: spacing.md,
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    textAlign: 'center',
  },
  onchainBanner: {
    backgroundColor: colors.successSoft,
    borderColor: colors.successSoft,
    color: colors.success,
  },
  onchainLine: {
    color: colors.success,
    fontSize: typography.caption,
    fontWeight: '700',
    marginBottom: spacing.lg,
    textAlign: 'center',
  },
  decisionOk: {
    alignSelf: 'stretch',
    backgroundColor: colors.successSoft,
    borderColor: colors.successSoft,
    borderRadius: radii.card,
    borderWidth: 1,
    marginBottom: spacing.lg,
    padding: spacing.lg,
  },
  decisionNeutral: {
    alignSelf: 'stretch',
    backgroundColor: colors.surface,
    borderColor: colors.divider,
    borderRadius: radii.card,
    borderWidth: 1,
    marginBottom: spacing.lg,
    padding: spacing.lg,
  },
  decisionTitle: {
    color: colors.text,
    fontSize: typography.sectionTitle,
    fontWeight: '800',
  },
  decisionSub: {
    color: colors.mint,
    fontSize: typography.secondary,
    fontWeight: '700',
    marginTop: 2,
  },
  decisionState: {
    color: colors.textSecondary,
    fontSize: typography.secondary,
    marginTop: spacing.sm,
  },
  actionValue: {
    color: colors.text,
    fontSize: typography.body,
    fontWeight: '700',
  },
  amountValue: {
    color: colors.text,
    fontSize: typography.balance - 12,
    fontWeight: '800',
  },
  decode: {
    color: colors.success,
    fontSize: typography.caption,
    fontWeight: '700',
    marginTop: spacing.sm,
  },
  decodeWarn: { color: colors.error },
  fieldLabel: {
    color: colors.textMuted,
    fontSize: typography.micro,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginTop: spacing.lg,
    textTransform: 'uppercase',
  },
  fieldValue: {
    color: colors.text,
    fontFamily: 'monospace',
    fontSize: typography.bodySmall,
    marginTop: spacing.xs,
  },
  fieldNote: {
    color: colors.textSecondary,
    fontSize: typography.secondary,
    lineHeight: 18,
    marginTop: spacing.sm,
  },
  toggle: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.divider,
    borderRadius: radii.field,
    borderWidth: 1,
    justifyContent: 'center',
    marginTop: spacing.lg,
    minHeight: 48,
    paddingHorizontal: spacing.md,
  },
  togglePressed: { backgroundColor: colors.surfaceElevated },
  toggleText: { color: colors.text, fontSize: typography.bodySmall, fontWeight: '700' },
  sectionTitle: {
    color: colors.text,
    fontSize: typography.bodySmall,
    fontWeight: '800',
    marginTop: spacing.lg,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: colors.text,
    borderRadius: radii.button,
    justifyContent: 'center',
    marginTop: spacing.xl,
    minHeight: 52,
    paddingHorizontal: spacing.xl,
  },
  primaryPressed: { opacity: 0.82 },
  primaryText: {
    color: colors.onLight,
    fontSize: typography.body,
    fontWeight: '800',
    textAlign: 'center',
  },
  secondaryButton: {
    alignItems: 'center',
    backgroundColor: colors.surfaceElevated,
    borderColor: colors.divider,
    borderRadius: radii.button,
    borderWidth: 1,
    justifyContent: 'center',
    marginTop: spacing.lg,
    minHeight: 48,
    paddingHorizontal: spacing.lg,
  },
  secondaryPressed: { backgroundColor: colors.surface },
  secondaryText: {
    color: colors.text,
    fontSize: typography.bodySmall,
    fontWeight: '700',
    textAlign: 'center',
  },
});
