import { useCallback, useEffect, useState } from 'react';
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
import { PublicKey } from '@solana/web3.js';
import * as multisig from '@sqds/multisig';
import { useMobileWallet } from '@wallet-ui/react-native-web3js';

import { describeVaultBalance, type BalanceStatus } from '../wallet/vaultBalance';
import { SAFE_TOP_PADDING } from '../ui/safeAreaPadding';

import type { ReviewGuardContext } from '../wallet/useWalletGuard';
import { connection } from '../solana/connection';
import { loadMultisig, MultisigLookupError, type MultisigView } from '../squads/multisig';
import { loadSingleProposalView, type ProposalView } from '../squads/proposals';
import type { TransactionReviewModel } from '../types/transactionReview';
import { colors, radii, spacing, typography } from '../ui/theme';
import { Card, DevnetPill, InfoBox, InfoText, ListRow, PillButton } from '../ui/v2/primitives';
import { ProposalDetailsScreen } from './ProposalDetailsScreen';
import { ProposalListScreen } from './ProposalListScreen';
import { NewProposalScreen } from './NewProposalScreen';
import { ReceiveScreen } from './ReceiveScreen';

/**
 * Detail d'un multisig (Vault Details) : LECTURE SEULE, theme UI V2.
 *
 * Un seul appel RPC (le `getAccountInfo` de `loadMultisig`, déjà utilisé
 * ailleurs) plus la dérivation locale du vault PDA par le SDK. Aucune création,
 * aucune signature, aucune proposition, aucun envoi.
 *
 * Receive reutilise le ReceiveScreen existant avec EXCLUSIVEMENT
 * `view.vaultAddress` (Main vault PDA index 0). Aucun faucet, aucun wallet.
 */

type LoadState =
  | { status: 'loading' }
  | { status: 'loaded'; view: MultisigView }
  | { status: 'error'; message: string };

/** Pubkey::default() : le multisig est autonome, aucune autorite d'admin. */
const FROZEN_AUTHORITY = '11111111111111111111111111111111';

/** Adresse abregée pour les listes (les details gardent l'adresse complète). */
function shortenAddress(address: string): string {
  return address.length <= 10 ? address : `${address.slice(0, 4)}…${address.slice(-4)}`;
}

/** Badge lisible pour un role effectivement lu on-chain. */
function roleBadge(role: string): string | null {
  if (role === 'Initiate') return 'Can initiate';
  if (role === 'Vote') return 'Can vote';
  if (role === 'Execute') return 'Can execute';
  return null;
}

export function MultisigDetailsScreen({
  address,
  decodedModelFor,
  onBack,
  vaultName,
}: {
  address: string;
  /** Modèles déjà décodés uniquement : ce détail ne déclenche aucune lecture. */
  decodedModelFor?: (index: number) => TransactionReviewModel | null;
  onBack: () => void;
  /** Nom local du vault (registre local uniquement), s'il est connu. */
  vaultName?: string | null;
}) {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  // Liste des propositions : etage lecture seule, ouvert depuis ce detail.
  const [proposalsOpen, setProposalsOpen] = useState(false);
  // Proposition ouverte depuis la liste (lecture seule).
  const [openProposal, setOpenProposal] = useState<ProposalView | null>(null);
  // Creation d'une nouvelle proposition (transfert SOL simple).
  const [newProposalOpen, setNewProposalOpen] = useState(false);
  // Vue Receive SOL (informative) : reutilise le ReceiveScreen du Groupe 1.
  const [receiveOpen, setReceiveOpen] = useState(false);
  // Détails purement techniques (config authority, rent collector, program) :
  // repliés par défaut, jamais supprimés.
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const { account } = useMobileWallet();
  const walletAddress = account === undefined ? null : account.address.toString();

  // Solde du vault : information de premier niveau, indépendante des propositions.
  // Il porte toujours SON adresse : changer de multisig remet l'affichage à zéro
  // immédiatement, sans jamais montrer le solde du multisig précédent.
  const [vaultBalance, setVaultBalance] = useState<{
    address: string;
    lamports: number | null;
    stale: boolean;
    status: BalanceStatus;
  } | null>(null);

  const load = useCallback(() => {
    setState({ status: 'loading' });
    // Changement de multisig : le solde de l'ancien disparaît tout de suite.
    setVaultBalance(null);
    void (async () => {
      try {
        const key = new PublicKey(address);
        setState({ status: 'loaded', view: await loadMultisig(connection, key) });
      } catch (caught: unknown) {
        setState({
          status: 'error',
          message:
            caught instanceof MultisigLookupError
              ? caught.message
              : `Lecture impossible : ${caught instanceof Error ? caught.message : String(caught)}`,
        });
      }
    })();
  }, [address]);

  // Actualisation EXPLICITE (bouton Refresh, ou après une création vérifiée) :
  // relit le compte Multisig (donc le transactionIndex courant) puis incrémente
  // un jeton qui force la relecture des propositions. Lecture seule : aucun
  // wallet, aucune signature, aucun envoi.
  const [refreshing, setRefreshing] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const reloadFromChain = useCallback(async (): Promise<boolean> => {
    setRefreshing(true);
    try {
      const key = new PublicKey(address);
      const fresh = await loadMultisig(connection, key);
      setState({ status: 'loaded', view: fresh });
      setRefreshNonce((previous) => previous + 1);
      return true;
    } catch {
      return false;
    } finally {
      setRefreshing(false);
    }
  }, [address]);

  /**
   * Ouvre la proposition tout juste créée : relecture on-chain CIBLÉE de la
   * Proposal (aucune donnée locale inventée). Lecture seule, aucun wallet.
   */
  const openCreatedProposal = useCallback(
    (index: number) => {
      void (async () => {
        try {
          const fresh = await loadSingleProposalView(connection, new PublicKey(address), index);
          if (fresh === null) return;
          setNewProposalOpen(false);
          setOpenProposal(fresh);
        } catch {
          // Relecture impossible : on reste sur l'écran courant, sans inventer.
        }
      })();
    },
    [address],
  );

  const view = state.status === 'loaded' ? state.view : null;
  const vaultAddress = view?.vaultAddress ?? null;

  // Le solde affiché appartient TOUJOURS à l'adresse du vault courant : sinon
  // il est considéré comme absent, jamais comme celui du multisig précédent.
  const balanceView = describeVaultBalance({
    addressMatches: vaultBalance !== null && vaultAddress !== null && vaultBalance.address === vaultAddress,
    lamports: vaultBalance?.lamports ?? null,
    status: vaultBalance?.status ?? 'idle',
    stale: vaultBalance?.stale === true,
  });

  /** Lecture seule du solde du vault index 0. Aucun wallet, aucune signature. */
  const refreshBalance = useCallback(
    (targetVaultAddress: string) => {
      setVaultBalance((previous) => ({
        // Une lecture en cours ne conserve l'ancienne valeur que si elle
        // concerne la MÊME adresse de vault.
        address: targetVaultAddress,
        lamports: previous !== null && previous.address === targetVaultAddress ? previous.lamports : null,
        stale: previous !== null && previous.address === targetVaultAddress && previous.lamports !== null,
        status: 'loading',
      }));
      void (async () => {
        try {
          const lamports = await connection.getBalance(new PublicKey(targetVaultAddress), 'confirmed');
          setVaultBalance({ address: targetVaultAddress, lamports, stale: false, status: 'loaded' });
        } catch {
          // Un échec de lecture du solde ne fait JAMAIS échouer le détail.
          setVaultBalance((previous) => ({
            address: targetVaultAddress,
            lamports: previous !== null && previous.address === targetVaultAddress ? previous.lamports : null,
            stale: previous !== null && previous.address === targetVaultAddress && previous.lamports !== null,
            status: 'error',
          }));
        }
      })();
    },
    [],
  );

  // Rafraîchissement : ouverture, changement d'adresse, retour d'un écran
  // enfant (une exécution vérifiée y change le solde).
  useEffect(() => {
    if (vaultAddress === null) return;
    refreshBalance(vaultAddress);
  }, [vaultAddress, proposalsOpen, openProposal, newProposalOpen, receiveOpen, refreshBalance]);

  useEffect(() => {
    load();
  }, [load]);

  // Retour systeme Android (bouton physique et geste) : rend la main a l'appelant.
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onBack();
      return true;
    });
    return () => subscription.remove();
  }, [onBack]);

  // Membres porteurs du droit de vote : sert a qualifier l'etat des propositions.
  const votingMembers =
    view === null
      ? []
      : view.members
          .filter((member) => member.roles.includes('Vote'))
          .map((member) => member.address);
  // Membres porteurs du droit d'execution : filtre « To do » des propositions.
  const executingMembers =
    view === null
      ? []
      : view.members
          .filter((member) => member.roles.includes('Execute'))
          .map((member) => member.address);

  // Role REEL du wallet connecte, s'il est membre (sinon Observer).
  const walletRoles =
    view === null || walletAddress === null
      ? null
      : (view.members.find((member) => member.address === walletAddress)?.roles ?? null);
  const walletIsMember = walletRoles !== null;

  // Receive SOL : vue informative, adresse = Main vault PDA index 0 uniquement.
  if (receiveOpen && view !== null) {
    return <ReceiveScreen address={view.vaultAddress} onBack={() => setReceiveOpen(false)} />;
  }

  // Creation d'une proposition : ecran dedie, retour vers la liste apres succes.
  if (newProposalOpen && view !== null) {
    return (
      <NewProposalScreen
        address={view.address}
        members={view.members}
        onBack={() => setNewProposalOpen(false)}
        onCreatedVerified={reloadFromChain}
        onDone={() => {
          setNewProposalOpen(false);
          setProposalsOpen(true);
        }}
        onOpenCreatedProposal={openCreatedProposal}
        transactionIndex={view.transactionIndex}
        vaultAddress={view.vaultAddress}
      />
    );
  }

  // Detail d'une proposition : lecture seule, aucun appel reseau.
  if (openProposal !== null && view !== null) {
    const model = decodedModelFor?.(openProposal.index) ?? null;
    const guardContext: ReviewGuardContext | null =
      model === null
        ? null
        : {
            multisig: {
              address: view.address,
              members: view.members.map((member) => ({
                address: member.address,
                roles: member.roles,
              })),
              threshold: view.threshold,
              vaultAddress: view.vaultAddress,
            },
            proposal: {
              approvedAddresses: openProposal.approvedAddresses,
              index: openProposal.index,
              status: openProposal.status,
            },
            review: model,
            walletAddress,
          };
    return (
      <ProposalDetailsScreen
        address={view.address}
        decodedModel={model}
        guardContext={guardContext}
        index={openProposal.index}
        members={view.members}
        onBack={() => setOpenProposal(null)}
        proposal={{
          approvedAddresses: openProposal.approvedAddresses,
          status: openProposal.status,
        }}
        threshold={view.threshold}
        vaultTransactionAddress={openProposal.vaultTransactionAddress}
        walletAddress={walletAddress}
        walletCanApprove={walletAddress !== null && votingMembers.includes(walletAddress)}
      />
    );
  }

  // Liste des propositions : lecture seule, aucun appel RPC propre.
  if (proposalsOpen && view !== null) {
    return (
      <ProposalListScreen
        address={view.address}
        decodedModelFor={decodedModelFor}
        executingMembers={executingMembers}
        onBack={() => setProposalsOpen(false)}
        onOpenProposal={(proposal) => setOpenProposal(proposal)}
        onRefresh={reloadFromChain}
        refreshNonce={refreshNonce}
        refreshing={refreshing}
        staleTransactionIndex={view.staleTransactionIndex}
        threshold={view.threshold}
        transactionIndex={view.transactionIndex}
        vaultName={vaultName}
        votingMembers={votingMembers}
      />
    );
  }

  const vaultIsEmpty = balanceView.title === 'Main vault not funded';

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
            accessibilityLabel="Back to inbox"
            onPress={onBack}
            style={({ pressed }) => [styles.backButton, pressed && styles.backButtonPressed]}
          >
            <Text style={styles.backGlyph}>‹</Text>
          </Pressable>
          <DevnetPill />
        </View>

        <Text style={styles.title}>
          {vaultName !== null && vaultName !== undefined && vaultName.length > 0
            ? vaultName
            : 'Main vault'}
        </Text>
        {view !== null ? (
          <Text style={styles.subtitle}>
            Threshold {view.threshold} of {view.members.length} signers
          </Text>
        ) : null}

        {state.status === 'loading' ? (
          <View style={styles.centerBlock}>
            <ActivityIndicator color={colors.mint} />
            <Text style={styles.note}>Reading the multisig account…</Text>
          </View>
        ) : null}

        {state.status === 'error' ? (
          <InfoBox glyph="⚠" style={styles.errorBox} tone="error">
            <InfoText tone="error">{state.message}</InfoText>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Retry reading the multisig"
              onPress={load}
              style={styles.inlineAction}
            >
              <Text style={styles.inlineActionText}>Retry</Text>
            </Pressable>
          </InfoBox>
        ) : null}

        {view !== null ? (
          <View style={styles.block}>
            {/* BALANCE CARD — « Main vault », solde reel, petite action Refresh. */}
            <Card elevated style={styles.balanceCard}>
              <Text style={styles.cardLabel}>Main vault</Text>
              {balanceView.sol !== null ? (
                <Text selectable style={styles.balanceValue}>
                  {balanceView.sol} SOL
                </Text>
              ) : null}
              {balanceView.title !== 'Main vault' && balanceView.sol === null ? (
                <Text style={styles.balanceNote}>{balanceView.title}</Text>
              ) : null}
              {balanceView.stale ? <Text style={styles.note}>stale</Text> : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Refresh the vault balance"
                disabled={vaultBalance?.status === 'loading'}
                onPress={() => {
                  refreshBalance(view.vaultAddress);
                }}
                style={({ pressed }) => [
                  styles.inlineAction,
                  pressed && styles.inlineActionPressed,
                ]}
              >
                <Text style={styles.inlineActionText}>
                  {vaultBalance?.status === 'loading' ? 'Refreshing…' : 'Refresh balance'}
                </Text>
              </Pressable>
            </Card>

            {/* VAULT VIDE — avertissement honnete, sans pretendre que la
                creation d'une proposition est impossible (elle reste permise). */}
            {vaultIsEmpty ? (
              <InfoBox glyph="⚠" style={styles.emptyBox} tone="warning">
                <InfoText tone="warning">The vault is empty.</InfoText>
                <InfoText tone="warning">
                  Receive Devnet SOL before executing a transfer.
                </InfoText>
              </InfoBox>
            ) : null}

            {/* ACTIONS — Receive / New proposal (+ acces Proposals reel). */}
            <View style={styles.actionRow}>
              <View style={styles.actionItem}>
                <PillButton
                  accessibilityLabel="Receive SOL into the Main vault"
                  label="Receive"
                  onPress={() => setReceiveOpen(true)}
                />
              </View>
              <View style={styles.actionItem}>
                <PillButton
                  accessibilityLabel="Create a new proposal"
                  label="New proposal"
                  onPress={() => setNewProposalOpen(true)}
                  variant="secondary"
                />
              </View>
            </View>

            <ListRow
              accessibilityLabel="Open proposals list"
              glyph="≡"
              onPress={() => setProposalsOpen(true)}
              subtitle={`${view.transactionIndex} indexed transaction(s)`}
              title="Proposals"
              trailing={<Text style={styles.chevron}>›</Text>}
            />

            {/* SIGNERS — compteur, adresses reelles, roles reels. */}
            <Text style={styles.sectionTitle}>Signers · {view.members.length}</Text>
            {view.members.map((member, index) => {
              const isYou = walletAddress !== null && member.address === walletAddress;
              const badges = member.roles
                .map(roleBadge)
                .filter((badge): badge is string => badge !== null);
              return (
                <View key={member.address} style={styles.memberRow}>
                  <View style={styles.memberAvatar}>
                    <Text style={styles.memberAvatarText}>{index + 1}</Text>
                  </View>
                  <View style={styles.memberBody}>
                    <Text style={styles.memberTitle}>
                      {shortenAddress(member.address)}
                      {isYou ? ' (you)' : ''}
                    </Text>
                    <Text selectable style={styles.memberAddress}>
                      {member.address}
                    </Text>
                    <View style={styles.badgeRow}>
                      {badges.length > 0 ? (
                        badges.map((badge) => (
                          <View key={badge} style={styles.roleBadge}>
                            <Text style={styles.roleBadgeText}>{badge}</Text>
                          </View>
                        ))
                      ) : (
                        <View style={styles.roleBadgeMuted}>
                          <Text style={styles.roleBadgeMutedText}>No permission</Text>
                        </View>
                      )}
                    </View>
                  </View>
                </View>
              );
            })}

            {/* METRIQUES — Members / Threshold / My role (Observer si non membre). */}
            <View style={styles.metricsRow}>
              <View style={styles.metric}>
                <Text style={styles.metricLabel}>Members</Text>
                <Text style={styles.metricValue}>{view.members.length}</Text>
              </View>
              <View style={styles.metric}>
                <Text style={styles.metricLabel}>Threshold</Text>
                <Text style={styles.metricValue}>{view.threshold}</Text>
              </View>
              <View style={styles.metric}>
                <Text style={styles.metricLabel}>My role</Text>
                <Text style={styles.metricValue}>
                  {walletIsMember
                    ? walletRoles.length > 0
                      ? walletRoles.join(' · ')
                      : 'No permission'
                    : 'Observer'}
                </Text>
              </View>
            </View>
            {!walletIsMember ? (
              <Text style={styles.note}>This wallet is not a multisig member.</Text>
            ) : null}

            {/* DETAILS TECHNIQUES (replies) : verdicts prouves + identifiants bruts. */}
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: advancedOpen }}
              accessibilityLabel="Toggle advanced details"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              onPress={() => setAdvancedOpen((previous) => !previous)}
              style={styles.detailsToggle}
            >
              <Text style={styles.detailsToggleText}>
                {advancedOpen ? '▾ Advanced details' : '▸ Advanced details'}
              </Text>
            </Pressable>

            {advancedOpen ? (
              <View style={styles.detailsBody}>
                <Text style={styles.detailsHeading}>Raw identifiers</Text>

                <Text style={styles.fieldLabel}>Main vault address</Text>
                <Text selectable style={styles.fieldValue}>{view.vaultAddress}</Text>
                <Text style={styles.fieldNote}>
                  This account holds the funds controlled by the multisig.
                </Text>

                <Text style={styles.fieldLabel}>Multisig configuration address</Text>
                <Text selectable style={styles.fieldValue}>{view.address}</Text>
                <Text style={styles.fieldNote}>Do not send funds to this address.</Text>

                <Text style={styles.fieldLabel}>Config authority</Text>
                <Text selectable style={styles.fieldValue}>{view.configAuthority}</Text>
                <Text style={styles.fieldNote}>
                  {view.configAuthority === FROZEN_AUTHORITY
                    ? 'Frozen: only the members can change the configuration, through a proposal.'
                    : 'Controlled multisig: this key can change members and threshold directly.'}
                </Text>

                <Text style={styles.fieldLabel}>Rent collector</Text>
                <Text selectable style={styles.fieldValue}>
                  {view.rentCollector ?? 'none'}
                </Text>
                <Text style={styles.fieldNote}>
                  {view.rentCollector === null
                    ? 'Rent reclamation is turned off.'
                    : 'Rent of closed transactions is reclaimed by this address.'}
                </Text>

                <Text style={styles.fieldLabel}>Program ID</Text>
                <Text selectable style={styles.fieldValue}>
                  {multisig.PROGRAM_ID.toString()}
                </Text>
              </View>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
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
  title: {
    color: colors.text,
    fontSize: typography.screenTitle - 6,
    fontWeight: '800',
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: typography.bodySmall,
    marginTop: spacing.xs,
  },
  centerBlock: {
    alignItems: 'center',
    marginTop: spacing.xl,
  },
  block: {
    alignSelf: 'stretch',
    marginTop: spacing.md,
  },
  balanceCard: {
    marginTop: spacing.md,
  },
  cardLabel: {
    color: colors.textMuted,
    fontSize: typography.micro,
    textTransform: 'uppercase',
  },
  balanceValue: {
    color: colors.text,
    fontSize: 40,
    fontWeight: '800',
    marginTop: spacing.xs,
  },
  balanceNote: {
    color: colors.warning,
    fontSize: typography.bodySmall,
    fontWeight: '700',
    marginTop: spacing.xs,
  },
  emptyBox: {
    marginTop: spacing.md,
  },
  actionRow: {
    flexDirection: 'row',
    marginTop: spacing.lg,
  },
  actionItem: {
    flex: 1,
    marginHorizontal: spacing.xs,
  },
  chevron: {
    color: colors.textMuted,
    fontSize: 22,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: typography.sectionTitle,
    fontWeight: '800',
    marginTop: spacing.xl,
  },
  memberRow: {
    alignItems: 'flex-start',
    backgroundColor: colors.surface,
    borderColor: colors.divider,
    borderRadius: radii.field,
    borderWidth: 1,
    flexDirection: 'row',
    marginTop: spacing.sm,
    padding: spacing.md,
  },
  memberAvatar: {
    alignItems: 'center',
    backgroundColor: colors.surfaceElevated,
    borderRadius: radii.pill,
    height: 36,
    justifyContent: 'center',
    marginRight: spacing.md,
    width: 36,
  },
  memberAvatarText: {
    color: colors.mint,
    fontSize: typography.bodySmall,
    fontWeight: '700',
  },
  memberBody: {
    flex: 1,
  },
  memberTitle: {
    color: colors.text,
    fontSize: typography.bodySmall,
    fontWeight: '700',
  },
  memberAddress: {
    color: colors.textMuted,
    fontFamily: 'monospace',
    fontSize: typography.micro,
    marginTop: 2,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: spacing.sm,
  },
  roleBadge: {
    backgroundColor: colors.successSoft,
    borderRadius: radii.pill,
    marginRight: spacing.xs,
    marginTop: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  roleBadgeText: {
    color: colors.success,
    fontSize: typography.micro,
    fontWeight: '700',
  },
  roleBadgeMuted: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: radii.pill,
    marginTop: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  roleBadgeMutedText: {
    color: colors.textMuted,
    fontSize: typography.micro,
    fontWeight: '700',
  },
  metricsRow: {
    flexDirection: 'row',
    marginTop: spacing.lg,
  },
  metric: {
    flex: 1,
    marginHorizontal: spacing.xs,
  },
  metricLabel: {
    color: colors.textMuted,
    fontSize: typography.micro,
    textTransform: 'uppercase',
  },
  metricValue: {
    color: colors.text,
    fontSize: typography.bodySmall,
    fontWeight: '700',
    marginTop: spacing.xs,
  },
  note: {
    color: colors.textMuted,
    fontSize: typography.secondary,
    marginTop: spacing.sm,
  },
  inlineAction: {
    alignSelf: 'flex-start',
    borderRadius: radii.pill,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  inlineActionPressed: {
    backgroundColor: colors.surface,
  },
  inlineActionText: {
    color: colors.mint,
    fontSize: typography.secondary,
    fontWeight: '700',
  },
  errorBox: {
    marginTop: spacing.md,
  },
  detailsToggle: {
    alignItems: 'center',
    borderColor: colors.divider,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.xl,
    minHeight: 48,
    paddingHorizontal: spacing.lg - 2,
    paddingVertical: spacing.md,
  },
  detailsToggleText: {
    color: colors.textSecondary,
    fontSize: typography.secondary,
    fontWeight: '700',
  },
  detailsBody: {
    borderColor: colors.divider,
    borderRadius: 8,
    borderWidth: 1,
    marginTop: spacing.sm,
    padding: spacing.md,
  },
  detailsHeading: {
    color: colors.text,
    fontSize: typography.bodySmall,
    fontWeight: '800',
    marginBottom: spacing.sm,
  },
  fieldLabel: {
    color: colors.textMuted,
    fontSize: typography.micro,
    marginTop: spacing.md,
    textTransform: 'uppercase',
  },
  fieldValue: {
    color: colors.text,
    fontFamily: 'monospace',
    fontSize: typography.micro + 1,
    marginTop: 2,
  },
  fieldNote: {
    color: colors.textSecondary,
    fontSize: typography.secondary,
    marginTop: spacing.xs,
  },
});
