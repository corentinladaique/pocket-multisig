// Écran de revue de transaction — LECTURE SEULE.
// Ce composant n'appelle AUCUNE fonction d'écriture : ni approve, ni execute,
// ni signTransaction, ni signAndSendTransaction, ni aucune fonction RPC.
// Il affiche un modèle déjà construit (voir src/types/transactionReview.ts).
import { useCallback } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  formatLamportsExact,
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
}

export function TransactionReviewScreen({ model, onBack }: TransactionReviewScreenProps) {
  // Aucune confirmation n'est possible dans cette mission, y compris pour un
  // décodage complet : le branchement on-chain n'existe pas encore (T11/T12).
  const canConfirm = false;
  const needsWarning = model.decodeStatus !== 'decoded' || model.notes.length > 0;

  const handleBack = useCallback(() => {
    onBack();
  }, [onBack]);

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.badge}>DEVNET</Text>
      <Text style={styles.title}>Transaction review</Text>

      {model.isPreview ? (
        <Text style={styles.previewBanner}>Development preview — not on-chain data</Text>
      ) : null}

      <View style={styles.card}>
        <Text style={styles.summaryLabel}>Action</Text>
        <Text style={styles.summaryValue}>{fieldText(model.action)}</Text>
        <Text style={[styles.decode, needsWarning && styles.decodeWarn]}>
          {DECODE_LABEL[model.decodeStatus]}
        </Text>
      </View>

      {needsWarning ? (
        <View style={styles.warnBox}>
          {model.decodeStatus !== 'decoded' ? (
            <Text style={styles.warnText}>
              {model.decodeStatus === 'partial'
                ? 'Warning: instruction only partially decoded. A critical field is missing. Verify on a devnet explorer before acting.'
                : 'Warning: program not recognized. No interpretation was attempted. Verify on a devnet explorer before acting.'}
            </Text>
          ) : null}
          {model.notes.map((note) => (
            <Text key={note} style={styles.warnText}>
              {note}
            </Text>
          ))}
        </View>
      ) : null}

      <View style={styles.card}>
        <Text style={styles.fieldLabel}>Network</Text>
        <Text style={styles.fieldValue}>Devnet</Text>

        <Text style={styles.fieldLabel}>Multisig configuration address</Text>
        <Text selectable style={styles.fieldValue}>
          {model.multisigAddress}
        </Text>

        <Text style={styles.fieldLabel}>Vault address</Text>
        <Text selectable style={styles.fieldValue}>
          {model.vaultAddress}
        </Text>

        <Text style={styles.fieldLabel}>Proposal index</Text>
        <Text style={styles.fieldValue}>#{model.proposalIndex}</Text>

        <Text style={styles.fieldLabel}>Proposal status</Text>
        <Text style={styles.fieldValue}>{model.proposalStatus}</Text>

        <Text style={styles.fieldLabel}>Signer wallet</Text>
        <Text selectable style={styles.fieldValue}>
          {model.signerWallet}
        </Text>

        <Text style={styles.fieldLabel}>Program called</Text>
        {model.program.known ? (
          <>
            <Text style={styles.fieldValue}>{model.program.value.label}</Text>
            <Text selectable style={styles.fieldValue}>
              {model.program.value.id}
            </Text>
          </>
        ) : (
          <Text style={styles.fieldValue}>Unknown</Text>
        )}

        <Text style={styles.fieldLabel}>Source</Text>
        <Text selectable style={styles.fieldValue}>
          {fieldText(model.source)}
        </Text>

        <Text style={styles.fieldLabel}>Destination</Text>
        <Text selectable style={styles.fieldValue}>
          {fieldText(model.destination)}
        </Text>

        <Text style={styles.fieldLabel}>Amount</Text>
        <Text style={styles.fieldValue}>{amountText(model.amount)}</Text>

        <Text style={styles.fieldLabel}>Fees</Text>
        <Text style={styles.fieldValue}>{amountText(model.fee)}</Text>
      </View>

      <Pressable
        accessibilityRole="button"
        disabled={!canConfirm}
        onPress={() => {
          /* Aucune action : la confirmation n'est pas disponible (T11/T12). */
        }}
        style={[styles.button, styles.disabled]}
      >
        <Text style={styles.buttonText}>Confirmation not available yet</Text>
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