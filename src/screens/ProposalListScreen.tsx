import { useEffect } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useMobileWallet } from '@wallet-ui/react-native-web3js';

import {
  computeProposalDecision,
  summarizeOperation,
  useProposals,
  type ProposalView,
} from '../squads/proposals';
import type { TransactionReviewModel } from '../types/transactionReview';

/**
 * Liste des propositions d'un multisig : LECTURE SEULE.
 *
 * Aucun appel RPC propre : tout passe par `useProposals` / `loadProposals`, qui
 * dérivent les PDA localement et font un seul `getMultipleAccountsInfo`.
 * Aucune création, aucun vote, aucune exécution, aucune signature.
 *
 * Le résumé d'opération n'est affiché que si un modèle DÉJÀ décodé est fourni
 * par l'appelant (`decodedModelFor`) : la liste ne déclenche donc aucune lecture
 * supplémentaire pour décoder les transactions.
 */

export function ProposalListScreen({
  address,
  decodedModelFor,
  onBack,
  onOpenProposal,
  staleTransactionIndex,
  threshold,
  transactionIndex,
  vaultName,
  votingMembers,
}: {
  address: string;
  /** Modèles déjà en mémoire uniquement (aucun appel réseau ici). */
  decodedModelFor?: (index: number) => TransactionReviewModel | null;
  onBack: () => void;
  /** Ouvre le détail d'une proposition (lecture seule). */
  onOpenProposal?: (proposal: ProposalView) => void;
  staleTransactionIndex: number;
  threshold: number;
  transactionIndex: number;
  vaultName?: string | null;
  /** Adresses des membres porteurs du droit de vote (pour l'état « needs you »). */
  votingMembers: readonly string[];
}) {
  const { account } = useMobileWallet();
  const walletAddress = account === undefined ? null : account.address.toString();
  const walletCanApprove = walletAddress !== null && votingMembers.includes(walletAddress);

  const proposals = useProposals(address, transactionIndex, staleTransactionIndex);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onBack();
      return true;
    });
    return () => subscription.remove();
  }, [onBack]);

  return (
    <KeyboardAvoidingView behavior="padding" style={styles.keyboardAvoider}>
      <View style={styles.safeTop} />
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
        style={styles.scrollView}
      >
        <Text style={styles.badge}>DEVNET · READ ONLY</Text>
        <Text style={styles.title}>
          {vaultName !== null && vaultName !== undefined && vaultName.length > 0
            ? `${vaultName} · Proposals`
            : 'Proposals'}
        </Text>
        <Text style={styles.subtitle}>
          Proposals are derived from the multisig index. Nothing is created, voted or executed
          here.
        </Text>

        {proposals.status === 'loading' ? (
          <View style={styles.centerBlock}>
            <ActivityIndicator color="#1a56db" />
            <Text style={styles.hint}>Reading proposals…</Text>
          </View>
        ) : null}

        {/* Relecture explicite : en lecture seule, aucun wallet, aucune signature. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Refresh proposals from the chain"
          disabled={proposals.status === 'loading'}
          onPress={proposals.retry}
          style={[styles.button, styles.secondary, proposals.status === 'loading' && styles.disabled]}
        >
          <Text style={styles.secondaryText}>
            {proposals.status === 'loading' ? 'Refreshing…' : 'Refresh'}
          </Text>
        </Pressable>

        {proposals.status === 'error' ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>
              {proposals.error ?? 'Reading proposals failed.'}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Retry reading proposals"
              onPress={proposals.retry}
              style={styles.retry}
            >
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          </View>
        ) : null}

        {proposals.status === 'loaded' ? (
          <View style={styles.block}>
            <Text style={styles.summaryLine}>
              {proposals.list?.proposals.length ?? 0} proposal(s) · {threshold} approval(s) needed
              · indexes 1..{transactionIndex}
            </Text>
            <Text style={styles.fieldNote}>
              Dates are not stored on-chain: no creation date is available for a proposal.
            </Text>

            {proposals.list !== null && proposals.list.proposals.length === 0 ? (
              <View style={styles.emptyBox}>
                <Text style={styles.emptyTitle}>No proposal yet</Text>
                <Text style={styles.emptyText}>
                  This multisig has no transaction indexed between 1 and {transactionIndex}.
                </Text>
              </View>
            ) : null}

            {(proposals.list?.proposals ?? []).map((proposal) => {
              const decision = computeProposalDecision({
                index: proposal.index,
                status: proposal.status,
                approvedAddresses: proposal.approvedAddresses,
                threshold,
                walletAddress,
                walletCanApprove,
              });
              const model = decodedModelFor?.(proposal.index) ?? null;
              const summary = summarizeOperation(model);
              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Open proposal ${proposal.index}`}
                  disabled={onOpenProposal === undefined}
                  key={proposal.index}
                  onPress={() => onOpenProposal?.(proposal)}
                  style={styles.entryCard}
                >
                  <Text style={styles.entryIndex}>Proposal #{proposal.index}</Text>
                  <Text style={styles.entryMeta}>
                    {decision.stateLabel} · status {proposal.status}
                  </Text>
                  <Text style={styles.entryMeta}>
                    {decision.approvals} of {decision.threshold} approvals
                  </Text>
                  <Text style={styles.entryOperation}>
                    {summary === null
                      ? 'Operation not decoded yet'
                      : `${summary.amount} · Devnet · to ${summary.destination}`}
                  </Text>
                  {summary === null ? (
                    <Text style={styles.fieldNote}>
                      The operation summary appears once the proposal review is opened.
                    </Text>
                  ) : null}
                </Pressable>
              );
            })}

            {proposals.list !== null && proposals.list.unreadable > 0 ? (
              <Text style={styles.fieldNote}>
                {proposals.list.unreadable} derived account(s) absent or unreadable (config
                transactions and batches are not indexed here).
              </Text>
            ) : null}

            <Text style={styles.fieldNote}>
              RPC calls used for this list: {proposals.list?.rpcCalls ?? 0} (one
              getMultipleAccountsInfo).
            </Text>
          </View>
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to multisig details"
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
    textAlign: 'center',
  },
  subtitle: {
    color: '#6b7280',
    fontSize: 13,
    marginBottom: 12,
    marginTop: 4,
    textAlign: 'center',
  },
  centerBlock: {
    alignItems: 'center',
    marginTop: 24,
  },
  block: {
    alignSelf: 'stretch',
  },
  summaryLine: {
    color: '#111827',
    fontSize: 13,
    fontWeight: '700',
    marginTop: 4,
  },
  entryCard: {
    backgroundColor: '#f9fafb',
    borderColor: '#e5e7eb',
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 10,
    padding: 14,
  },
  entryIndex: {
    color: '#111827',
    fontSize: 16,
    fontWeight: '800',
  },
  entryMeta: {
    color: '#4b5563',
    fontSize: 13,
    marginTop: 2,
  },
  entryOperation: {
    color: '#101317',
    fontSize: 13,
    fontWeight: '700',
    marginTop: 8,
  },
  emptyBox: {
    backgroundColor: '#f9fafb',
    borderColor: '#e5e7eb',
    borderRadius: 10,
    borderStyle: 'dashed',
    borderWidth: 1,
    marginTop: 10,
    padding: 14,
  },
  emptyTitle: {
    color: '#111827',
    fontSize: 15,
    fontWeight: '800',
  },
  emptyText: {
    color: '#4b5563',
    fontSize: 13,
    marginTop: 6,
  },
  fieldNote: {
    color: '#6b7280',
    fontSize: 12,
    marginTop: 6,
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
  hint: {
    color: '#6b7280',
    fontSize: 13,
    marginTop: 8,
  },
  errorBox: {
    alignSelf: 'stretch',
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
  retry: {
    alignItems: 'center',
    marginTop: 12,
    paddingVertical: 8,
  },
  retryText: {
    color: '#1a56db',
    fontSize: 15,
    fontWeight: '600',
  },
  safeTop: {
    backgroundColor: '#ffffff',
    height: StatusBar.currentHeight ?? 24,
    width: '100%',
  },
  disabled: {
    opacity: 0.5,
  },
});