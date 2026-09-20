// Section « Technical details » de la revue on-chain : repliable, FERMÉE par
// défaut, elle regroupe tout ce qui n'aide pas à la décision immédiate.
//
// Aucune donnée n'est recalculée ni transformée : ce composant ne fait
// qu'afficher le modèle et les verdicts déjà calculés. Aucun appel réseau,
// aucune fonction d'écriture.
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  formatLamportsExact,
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
    <View>
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
  guard,
  allowlist,
  proposalAddress,
}: TransactionTechnicalDetailsProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);

  return (
    <View style={styles.wrapper}>
      {/* Toute la ligne est tactile : chevron + titre dans une seule Pressable,
          avec une hauteur minimale confortable. */}
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel="Toggle technical details"
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        onPress={() => setExpanded((previous) => !previous)}
        style={styles.toggle}
      >
        <Text style={styles.toggleText}>
          {expanded ? '▾ Technical details' : '▸ Technical details'}
        </Text>
      </Pressable>

      {expanded ? (
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
          <Row label="Source" value={fieldText(model.source)} />
          <Row label="Destination" value={fieldText(model.destination)} />
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
          <Row
            label="Wallet guard"
            value={
              guard.status === 'allowed'
                ? 'allowed'
                : `blocked — ${guard.reasons.join(' ') || 'no detail'}`
            }
          />
          <Row
            label="Instruction allowlist"
            value={`${allowlist.status} — ${allowlist.reason}`}
          />
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
    marginTop: 8,
  },
  toggle: {
    alignItems: 'center',
    borderColor: '#d1d5db',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 48,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  toggleText: {
    color: '#374151',
    fontSize: 13,
    fontWeight: '700',
  },
  body: {
    borderColor: '#e5e7eb',
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 8,
    padding: 12,
  },
  label: {
    color: '#6b7280',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginTop: 8,
    textTransform: 'uppercase',
  },
  value: {
    color: '#374151',
    fontSize: 12,
  },
});