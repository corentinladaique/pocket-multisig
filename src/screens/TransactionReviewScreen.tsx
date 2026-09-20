// Écran de revue de transaction — LECTURE SEULE.
// Ce composant n'appelle AUCUNE fonction d'écriture : ni approve, ni execute,
// ni signTransaction, ni signAndSendTransaction, ni aucune fonction RPC.
// Il affiche un modèle déjà construit (voir src/types/transactionReview.ts).
import { useCallback } from 'react';
import { Platform, Pressable, ScrollView, StatusBar, StyleSheet, Text, View } from 'react-native';

import { useWalletGuard } from '../wallet/useWalletGuard';
import { checkReviewAllowlist } from '../squads/instructionAllowlist';
import type { ReviewGuardContext } from '../wallet/useWalletGuard';

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
  /** Données déjà chargées, injectées par l'appelant. Aucun RPC dans le guard. */
  guardContext?: ReviewGuardContext | null;
}

export function TransactionReviewScreen({
  model,
  onBack,
  guardContext = null,
}: TransactionReviewScreenProps) {
  // Aucune confirmation n'est possible dans cette mission, y compris pour un
  // décodage complet : le branchement on-chain n'existe pas encore (T11/T12).
  const canConfirm = false;
  const needsWarning = model.decodeStatus !== 'decoded' || model.notes.length > 0;

  // Préparation T11 : évaluation purement informative. `canConfirm` reste faux
  // et n'est jamais dérivé de ces verdicts — aucun chemin d'écriture n'est
  // ouvert par ce branchement.
  const guard = useWalletGuard(guardContext);
  const allowlist = checkReviewAllowlist(model);

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

      <Text style={[styles.previewBanner, model.isPreview ? null : styles.onchainBanner]}>
        {model.isPreview
          ? 'Development preview — not on-chain data'
          : 'On-chain proposal — Devnet'}
      </Text>

      {model.isPreview ? null : (
        <Text style={styles.onchainLine}>
          Proposal #{model.proposalIndex} · {fieldText(model.action)} · approved:{' '}
          {model.proposalStatus === 'Active' ? '0' : 'n/a'}
        </Text>
      )}

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
      <Text style={styles.fieldLabel}>Wallet guard</Text>
        <Text style={guard.status === 'allowed' ? styles.fieldValue : styles.warnText}>
          {guard.status === 'allowed' ? 'allowed' : `blocked — ${guard.reasons.length} reason(s)`}
        </Text>
        {guard.reasons.map((reason) => (
          <Text key={reason} style={styles.warnText}>
            • {reason}
          </Text>
        ))}

        <Text style={styles.fieldLabel}>Instruction allowlist</Text>
        <Text style={allowlist.allowed ? styles.fieldValue : styles.warnText}>
          {allowlist.allowed ? 'allowed' : 'blocked'} — {allowlist.reason}
        </Text>
        <Text style={styles.secondaryText}>
          Confirmation remains unavailable: these checks do not enable any write.
        </Text>
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
    // Inset haut : sans ce décalage, le titre et le bandeau passent sous la
    // barre d'état du Seeker (Android 16, API 36). Basé uniquement sur l'API
    // React Native déjà présente, sans nouvelle dépendance.
    // Doit rester APRÈS `padding` pour ne pas être écrasé par le raccourci.
    paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight ?? 0) + 16 : 16,
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