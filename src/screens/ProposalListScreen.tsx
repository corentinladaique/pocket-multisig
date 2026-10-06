import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SAFE_TOP_PADDING } from '../ui/safeAreaPadding';

import { summarizeOperation, type ProposalView, type ProposalsState } from '../squads/proposals';
import {
  classifyProposal,
  proposalStatusLabel,
  type ProposalFilterGroup,
} from '../squads/proposalFilters';
import type { TransactionReviewModel } from '../types/transactionReview';
import { colors, radii, spacing, typography } from '../ui/theme';
import { DevnetPill, InfoBox, InfoText } from '../ui/v2/primitives';

/**
 * Liste des propositions d'un multisig : LECTURE SEULE, theme UI V2.
 *
 * Aucun appel RPC propre : l'état `proposals` est FOURNI par l'appelant, qui en
 * est le SEUL propriétaire (un seul `useProposals` par écran). Ni cet écran ni
 * son corps `ProposalListBody` ne relisent quoi que ce soit — c'est ce qui
 * permet d'afficher la MÊME liste dans l'écran Vault et dans un onglet sans
 * jamais lire les propositions deux fois.
 *
 * Aucune création, aucun vote, aucune exécution, aucune signature.
 *
 * Le résumé d'opération n'est affiché que si un modèle DÉJÀ décodé est fourni
 * par l'appelant (`decodedModelFor`) : la liste ne déclenche donc aucune lecture
 * supplémentaire pour décoder les transactions.
 *
 * Les filtres To do / Open / Done sont LOCAUX (fonctions pures de
 * `proposalFilters`) : aucun RPC, aucun wallet, aucune transaction.
 */

const FILTERS: readonly { key: ProposalFilterGroup; label: string }[] = [
  { key: 'todo', label: 'To do' },
  { key: 'open', label: 'Open' },
  { key: 'done', label: 'Done' },
];

const EMPTY_STATE: Record<ProposalFilterGroup, { title: string; body?: string }> = {
  todo: {
    title: 'Nothing waiting',
    body: 'Proposals that need your action will appear here.',
  },
  open: { title: 'No open proposals' },
  done: { title: 'No completed proposals yet' },
};

export function ProposalListScreen({
  decodedModelFor,
  executingMembers = [],
  onBack,
  onOpenProposal,
  onRefresh,
  proposals,
  refreshing = false,
  threshold,
  vaultName,
  votingMembers,
  walletAddress,
}: {
  /** État de lecture fourni par l'appelant : cet écran ne lit RIEN lui-même. */
  proposals: ProposalsState;
  /** Modèles déjà en mémoire uniquement (aucun appel réseau ici). */
  decodedModelFor?: (index: number) => TransactionReviewModel | null;
  /** Adresses des membres porteurs du droit d'exécution (filtre To do). */
  executingMembers?: readonly string[];
  onBack: () => void;
  /** Ouvre le détail d'une proposition (lecture seule). */
  onOpenProposal?: (proposal: ProposalView) => void;
  /**
   * Actualisation RÉELLE demandée au parent : il relit le compte Multisig
   * (transactionIndex courant) puis les propositions. Lecture seule, aucun wallet.
   */
  onRefresh?: () => Promise<boolean>;
  /** Vrai pendant que le parent relit le multisig. */
  refreshing?: boolean;
  threshold: number;
  vaultName?: string | null;
  /** Adresses des membres porteurs du droit de vote (pour l'état « needs you »). */
  votingMembers: readonly string[];
  /** Adresse du wallet connecté, fournie par l'appelant (jamais relue ici). */
  walletAddress: string | null;
}) {
  const walletCanApprove = walletAddress !== null && votingMembers.includes(walletAddress);
  const walletCanExecute = walletAddress !== null && executingMembers.includes(walletAddress);

  const busy = refreshing || proposals.status === 'loading';

  /**
   * Refresh : le parent RELIT le compte Multisig (index courant) puis la liste.
   * Aucun wallet, aucune signature, aucun envoi. Si aucun parent n'est branché,
   * on relit au moins la liste avec l'index déjà connu.
   */
  const onPressRefresh = () => {
    if (onRefresh === undefined) {
      proposals.retry();
      return;
    }
    void onRefresh();
  };

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onBack();
      return true;
    });
    return () => subscription.remove();
  }, [onBack]);

  return (
    <KeyboardAvoidingView behavior="padding" style={[styles.keyboardAvoider, SAFE_TOP_PADDING]}>
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
        style={styles.scrollView}
      >
        <View style={styles.headerRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to multisig details"
            onPress={onBack}
            style={({ pressed }) => [styles.backButton, pressed && styles.backButtonPressed]}
          >
            <Text style={styles.backGlyph}>‹</Text>
          </Pressable>
          <DevnetPill />
        </View>

        <View style={styles.titleRow}>
          <Text style={styles.title}>
            {vaultName !== null && vaultName !== undefined && vaultName.length > 0
              ? `${vaultName} · Proposals`
              : 'Proposals'}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Refresh proposals from the chain"
            disabled={busy}
            onPress={onPressRefresh}
            style={({ pressed }) => [
              styles.inlineAction,
              pressed && styles.secondaryPressed,
            ]}
          >
            <Text style={styles.inlineActionText}>{busy ? 'Refreshing…' : 'Refresh'}</Text>
          </Pressable>
        </View>

        <ProposalListBody
          busy={busy}
          decodedModelFor={decodedModelFor}
          onOpenProposal={onOpenProposal}
          proposals={proposals}
          threshold={threshold}
          walletAddress={walletAddress}
          walletCanApprove={walletCanApprove}
          walletCanExecute={walletCanExecute}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/**
 * CORPS de la liste : filtres + états + entrées. Volontairement SANS en-tête et
 * SANS défilement propre : il se pose aussi bien dans l'écran Vault que DANS un
 * onglet déjà contenu dans un défilement (imbriquer deux ScrollView casserait
 * le défilement sur Android). Il ne lit RIEN — tout vient de ses props.
 */
export function ProposalListBody({
  busy,
  decodedModelFor,
  onOpenProposal,
  proposals,
  threshold,
  walletAddress,
  walletCanApprove,
  walletCanExecute,
}: {
  busy: boolean;
  decodedModelFor?: (index: number) => TransactionReviewModel | null;
  onOpenProposal?: (proposal: ProposalView) => void;
  proposals: ProposalsState;
  threshold: number;
  walletAddress: string | null;
  walletCanApprove: boolean;
  walletCanExecute: boolean;
}) {
  const [filter, setFilter] = useState<ProposalFilterGroup>('todo');

  // Classement LOCAL : aucune I/O, aucune valeur inventée.
  const rows = (proposals.list?.proposals ?? []).map((proposal) => {
    const input = {
      index: proposal.index,
      status: proposal.status,
      approvals: proposal.approvals,
      threshold,
      approvedAddresses: proposal.approvedAddresses,
      walletAddress,
      walletCanApprove,
      walletCanExecute,
    };
    const group = classifyProposal(input);
    const statusLabel = proposalStatusLabel(input);
    const summary = summarizeOperation(decodedModelFor?.(proposal.index) ?? null);
    return { proposal, group, statusLabel, summary };
  });

  const counts: Record<ProposalFilterGroup, number> = {
    todo: rows.filter((row) => row.group === 'todo').length,
    open: rows.filter((row) => row.group === 'open').length,
    done: rows.filter((row) => row.group === 'done').length,
  };
  const visible = rows.filter((row) => row.group === filter);

  return (
    <View>
      {/* Filtres locaux : To do / Open / Done. */}
      <View style={styles.filterRow}>
        {FILTERS.map((entry) => {
          const active = entry.key === filter;
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`Show ${entry.label} proposals`}
              key={entry.key}
              onPress={() => setFilter(entry.key)}
              style={({ pressed }) => [
                styles.filterPill,
                active && styles.filterPillActive,
                pressed && !active && styles.filterPillPressed,
              ]}
            >
              <Text style={[styles.filterText, active && styles.filterTextActive]}>
                {entry.label} {counts[entry.key]}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {busy ? (
        <View style={styles.centerBlock}>
          <ActivityIndicator color={colors.mint} />
          <Text style={styles.note}>Refreshing proposals…</Text>
        </View>
      ) : null}

      {/* Liste périmée conservée (jamais supprimée en silence). */}
      {proposals.stale && proposals.list !== null ? (
        <InfoBox glyph="⚠" style={styles.infoBox} tone="warning">
          <InfoText tone="warning">
            Showing the last successfully read list. Refresh failed:{' '}
            {proposals.error ?? 'unknown error'}
          </InfoText>
        </InfoBox>
      ) : null}

      {proposals.status === 'error' ? (
        <InfoBox glyph="⚠" style={styles.infoBox} tone="error">
          <InfoText tone="error">{proposals.error ?? 'Reading proposals failed.'}</InfoText>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Retry reading proposals"
            onPress={proposals.retry}
            style={styles.inlineAction}
          >
            <Text style={styles.inlineActionText}>Retry</Text>
          </Pressable>
        </InfoBox>
      ) : null}

      {proposals.status === 'loaded' ? (
        <View style={styles.block}>
          {visible.length === 0 ? (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyTitle}>{EMPTY_STATE[filter].title}</Text>
              {EMPTY_STATE[filter].body !== undefined ? (
                <Text style={styles.emptyText}>{EMPTY_STATE[filter].body}</Text>
              ) : null}
            </View>
          ) : null}

          {visible.map(({ proposal, statusLabel, summary }) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Open proposal ${proposal.index}`}
              disabled={onOpenProposal === undefined}
              key={proposal.index}
              onPress={() => onOpenProposal?.(proposal)}
              style={({ pressed }) => [styles.entryCard, pressed && styles.entryCardPressed]}
            >
              <View style={styles.entryIndexChip}>
                <Text style={styles.entryIndexText}>#{proposal.index}</Text>
              </View>
              <View style={styles.entryBody}>
                <Text style={styles.entryTitle}>
                  {summary === null
                    ? 'Details available after opening'
                    : `${summary.amount} → ${summary.destination}`}
                </Text>
                <Text style={styles.entryMeta}>
                  {proposal.approvals} of {threshold} approvals
                </Text>
              </View>
              <View style={styles.entryBadge}>
                <Text style={styles.entryBadgeText}>{statusLabel}</Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </Pressable>
          ))}

          {proposals.list !== null && proposals.list.unreadable > 0 ? (
            <Text style={styles.note}>
              {proposals.list.unreadable} derived account(s) absent or unreadable (config
              transactions and batches are not indexed here).
            </Text>
          ) : null}

          {__DEV__ ? (
            <Text style={styles.note}>
              RPC calls used for this list: {proposals.list?.rpcCalls ?? 0} (one
              getMultipleAccountsInfo).
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  keyboardAvoider: {
    backgroundColor: colors.background,
    flex: 1,
    width: '100%',
  },
  scrollView: {
    backgroundColor: colors.background,
    flex: 1,
    width: '100%',
  },
  container: {
    alignItems: 'stretch',
    backgroundColor: colors.background,
    flexGrow: 1,
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
  backButtonPressed: {
    backgroundColor: colors.surface,
  },
  backGlyph: {
    color: colors.text,
    fontSize: 24,
    lineHeight: 26,
  },
  titleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  title: {
    color: colors.text,
    flexShrink: 1,
    fontSize: typography.screenTitle - 10,
    fontWeight: '800',
  },
  inlineAction: {
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  inlineActionText: {
    color: colors.mint,
    fontSize: typography.secondary,
    fontWeight: '700',
  },
  secondaryPressed: {
    backgroundColor: colors.surface,
  },
  filterRow: {
    flexDirection: 'row',
    marginTop: spacing.lg,
  },
  filterPill: {
    backgroundColor: colors.surfaceElevated,
    borderColor: colors.divider,
    borderRadius: radii.pill,
    borderWidth: 1,
    marginRight: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  filterPillActive: {
    backgroundColor: colors.text,
    borderColor: colors.text,
  },
  filterPillPressed: {
    backgroundColor: colors.surface,
  },
  filterText: {
    color: colors.textSecondary,
    fontSize: typography.secondary,
    fontWeight: '700',
  },
  filterTextActive: {
    color: colors.onLight,
  },
  centerBlock: {
    alignItems: 'center',
    marginTop: spacing.xl,
  },
  block: {
    alignSelf: 'stretch',
    marginTop: spacing.md,
  },
  entryCard: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.divider,
    borderRadius: radii.card,
    borderWidth: 1,
    flexDirection: 'row',
    marginTop: spacing.sm,
    padding: spacing.md,
  },
  entryCardPressed: {
    backgroundColor: colors.surfaceElevated,
  },
  entryIndexChip: {
    alignItems: 'center',
    backgroundColor: colors.surfaceElevated,
    borderRadius: radii.pill,
    height: 36,
    justifyContent: 'center',
    marginRight: spacing.md,
    width: 44,
  },
  entryIndexText: {
    color: colors.mint,
    fontSize: typography.secondary,
    fontWeight: '700',
  },
  entryBody: {
    flex: 1,
  },
  entryTitle: {
    color: colors.text,
    fontSize: typography.bodySmall,
    fontWeight: '700',
  },
  entryMeta: {
    color: colors.textSecondary,
    fontSize: typography.secondary,
    marginTop: 2,
  },
  entryBadge: {
    backgroundColor: colors.successSoft,
    borderRadius: radii.pill,
    marginLeft: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  entryBadgeText: {
    color: colors.success,
    fontSize: typography.micro,
    fontWeight: '700',
  },
  chevron: {
    color: colors.textMuted,
    fontSize: 22,
    marginLeft: spacing.sm,
  },
  emptyBox: {
    backgroundColor: colors.surface,
    borderColor: colors.divider,
    borderRadius: radii.card,
    borderStyle: 'dashed',
    borderWidth: 1,
    marginTop: spacing.sm,
    padding: spacing.lg,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: typography.bodySmall,
    fontWeight: '800',
  },
  emptyText: {
    color: colors.textSecondary,
    fontSize: typography.secondary,
    marginTop: spacing.sm,
  },
  infoBox: {
    marginTop: spacing.md,
  },
  note: {
    color: colors.textMuted,
    fontSize: typography.secondary,
    marginTop: spacing.sm,
  },
});
