import { useEffect, useState } from 'react';
import {
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

import type { ReviewGuardContext } from '../wallet/useWalletGuard';
import {
  computeProposalDecision,
  summarizeOperation,
  type ProposalStatusKind,
} from '../squads/proposals';
import type { TransactionReviewModel } from '../types/transactionReview';
import { TransactionReviewScreen } from './TransactionReviewScreen';

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

  const summary = summarizeOperation(decodedModel);
  const pda = proposalPda(address, index);

  // Relecture de la revue existante : aucun nouvel écran, aucune écriture.
  if (reviewOpen && decodedModel !== null) {
    return (
      <TransactionReviewScreen
        guardContext={guardContext ?? null}
        model={decodedModel}
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
              Not decoded yet: no already-decoded model is available for this proposal, and this
              screen never triggers a new read.
            </Text>
          ) : (
            <>
              <Text style={styles.fieldValue}>{summary.action}</Text>
              <Text selectable style={styles.monoValue}>{summary.amount}</Text>
              <Text selectable style={styles.monoValue}>to {summary.destination}</Text>
            </>
          )}

          <Text style={styles.fieldLabel}>Transaction information</Text>
          <Text style={styles.fieldNote}>Proposal account</Text>
          <Text selectable style={styles.monoValue}>{pda ?? 'unavailable'}</Text>
          <Text style={styles.fieldNote}>Vault transaction account</Text>
          <Text selectable style={styles.monoValue}>{vaultTransactionAddress}</Text>
          <Text style={styles.fieldNote}>Multisig</Text>
          <Text selectable style={styles.monoValue}>{address}</Text>
          {decodedModel !== null ? (
            <>
              <Text style={styles.fieldNote}>Decode status</Text>
              <Text style={styles.fieldValue}>{decodedModel.decodeStatus}</Text>
              {decodedModel.notes.length > 0 ? (
                <>
                  <Text style={styles.fieldNote}>Notes ({decodedModel.notes.length})</Text>
                  {decodedModel.notes.map((note) => (
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
            accessibilityState={{ disabled: decodedModel === null }}
            disabled={decodedModel === null}
            onPress={() => setReviewOpen(true)}
            style={[styles.button, decodedModel === null && styles.disabled]}
          >
            <Text style={styles.buttonText}>Open transaction review</Text>
          </Pressable>
          {decodedModel === null ? (
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
  secondaryText: {
    color: '#101317',
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'center',
  },
});