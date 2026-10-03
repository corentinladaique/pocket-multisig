// Section « Advanced transaction details » de la revue on-chain : LECTURE SEULE.
//
// Premier niveau : l'essentiel décodé pour la décision — action, montant SOL,
// source, destination, programme reconnu. Un second niveau repliable, FERMÉ par
// défaut, regroupe les identifiants techniques bruts (« Raw transaction data »).
//
// Aucune donnée n'est recalculée ni transformée : ce composant ne fait
// qu'afficher le modèle déjà calculé. Aucun appel réseau, aucune fonction
// d'écriture, aucun CTA d'approbation ou d'exécution, aucun wallet ni signature.
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radii, spacing, typography } from '../ui/theme';
import {
  formatLamportsExact,
  SYSTEM_PROGRAM_ID,
  type ReviewField,
  type SolAmount,
  type TransactionReviewModel,
} from '../types/transactionReview';
import type { GuardVerdict } from '../wallet/useWalletGuard';
import type { AllowlistVerdict } from '../squads/instructionAllowlist';

const DECODE_LABEL: Record<TransactionReviewModel['decodeStatus'], string> = {
  decoded: 'Decoded',
  partial: 'Partially decoded',
  unknown: 'Not decoded',
};

function fieldText(field: ReviewField<string>): string {
  return field.known ? field.value : 'Unknown';
}

function amountText(field: ReviewField<SolAmount>): string {
  if (!field.known) return 'Unknown';
  return `${formatLamportsExact(field.value.lamports)} (${field.value.lamports} lamports)`;
}

function Row({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text selectable style={styles.value}>
        {value}
      </Text>
    </View>
  );
}

export interface TransactionTechnicalDetailsProps {
  model: TransactionReviewModel;
  guard: GuardVerdict;
  allowlist: AllowlistVerdict;
  /** PDA de la proposition, dérivé localement (aucun RPC). */
  proposalAddress: string | null;
}

export function TransactionTechnicalDetails({
  model,
  proposalAddress,
}: TransactionTechnicalDetailsProps): React.JSX.Element {
  const [rawOpen, setRawOpen] = useState(false);

  // Libellé d'action dérivé des champs RÉELLEMENT décodés (programme + action).
  const isSystemTransfer =
    model.program.known &&
    model.program.value.id === SYSTEM_PROGRAM_ID &&
    model.action.known &&
    /transfer/i.test(model.action.value);
  const actionLabel = isSystemTransfer ? 'SOL transfer' : fieldText(model.action);
  const amountSol = model.amount.known
    ? formatLamportsExact(model.amount.value.lamports)
    : 'Unknown';
  const programLabel = model.program.known
    ? `${model.program.value.label} — ${model.program.value.id}`
    : 'Unknown';

  return (
    <View style={styles.wrapper}>
      {/* --- Premier niveau : ce qui aide à la décision immédiate. --- */}
      <Row label="Action" value={actionLabel} />
      <Row label="Amount (SOL)" value={amountSol} />
      <Row label="Source" value={fieldText(model.source)} />
      <Row label="Destination" value={fieldText(model.destination)} />
      <Row label="Program" value={programLabel} />

      {/* --- Second niveau : identifiants techniques, replié par défaut. --- */}
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: rawOpen }}
        accessibilityLabel="Toggle raw transaction data"
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        onPress={() => setRawOpen((previous) => !previous)}
        style={styles.toggle}
      >
        <Text style={styles.toggleText}>
          {rawOpen ? '▾ Raw transaction data' : '▸ Raw transaction data'}
        </Text>
      </Pressable>

      {rawOpen ? (
        <View style={styles.body}>
          <Row label="Network" value="Devnet" />
          <Row label="Multisig configuration address" value={model.multisigAddress} />
          <Row label="Vault address" value={model.vaultAddress} />
          <Row
            label="Proposal"
            value={
              proposalAddress === null
                ? `#${model.proposalIndex} (PDA not derived)`
                : `#${model.proposalIndex} — ${proposalAddress}`
            }
          />
          <Row label="Action (raw)" value={fieldText(model.action)} />
          <Row label="Source (raw)" value={fieldText(model.source)} />
          <Row label="Destination (raw)" value={fieldText(model.destination)} />
          <Row
            label="Program called"
            value={
              model.program.known
                ? `${model.program.value.label} — ${model.program.value.id}`
                : 'Unknown'
            }
          />
          <Row label="Fees" value={amountText(model.fee)} />
          <Row label="Amount (raw)" value={amountText(model.amount)} />
          <Row label="Decode status" value={DECODE_LABEL[model.decodeStatus]} />
          {model.notes.length > 0 ? (
            <Row label="Technical notes" value={model.notes.join(' ')} />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    alignSelf: 'stretch',
    marginTop: spacing.sm,
  },
  row: {
    marginTop: spacing.sm,
  },
  label: {
    color: colors.textMuted,
    fontSize: typography.micro,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  value: {
    color: colors.text,
    fontSize: typography.bodySmall,
    marginTop: 2,
  },
  toggle: {
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
  toggleText: {
    color: colors.text,
    fontSize: typography.secondary,
    fontWeight: '700',
  },
  body: {
    backgroundColor: colors.surface,
    borderColor: colors.divider,
    borderRadius: radii.field,
    borderWidth: 1,
    marginTop: spacing.sm,
    padding: spacing.md,
  },
});
