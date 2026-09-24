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

import type { ReviewGuardContext } from '../wallet/useWalletGuard';
import { connection } from '../solana/connection';
import { loadMultisig, MultisigLookupError, type MultisigView } from '../squads/multisig';
import type { ProposalView } from '../squads/proposals';
import type { TransactionReviewModel } from '../types/transactionReview';
import { ProposalDetailsScreen } from './ProposalDetailsScreen';
import { ProposalListScreen } from './ProposalListScreen';
import { NewProposalScreen } from './NewProposalScreen';

/**
 * Detail d'un multisig : LECTURE SEULE.
 *
 * Un seul appel RPC (le `getAccountInfo` de `loadMultisig`, déjà utilisé
 * ailleurs) plus la dérivation locale du vault PDA par le SDK. Aucune création,
 * aucune signature, aucune proposition, aucun envoi.
 */

type LoadState =
  | { status: 'loading' }
  | { status: 'loaded'; view: MultisigView }
  | { status: 'error'; message: string };

/** Pubkey::default() : le multisig est autonome, aucune autorite d'admin. */
const FROZEN_AUTHORITY = '11111111111111111111111111111111';

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
  const { account } = useMobileWallet();
  const walletAddress = account === undefined ? null : account.address.toString();

  const load = useCallback(() => {
    setState({ status: 'loading' });
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

  const view = state.status === 'loaded' ? state.view : null;

  // Membres porteurs du droit de vote : sert a qualifier l'etat des propositions.
  const votingMembers =
    view === null
      ? []
      : view.members
          .filter((member) => member.roles.includes('Vote'))
          .map((member) => member.address);

  // Creation d'une proposition : ecran dedie, retour vers la liste apres succes.
  if (newProposalOpen && view !== null) {
    return (
      <NewProposalScreen
        address={view.address}
        members={view.members}
        onBack={() => setNewProposalOpen(false)}
        onDone={() => {
          setNewProposalOpen(false);
          setProposalsOpen(true);
        }}
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
        onBack={() => setProposalsOpen(false)}
        onOpenProposal={(proposal) => setOpenProposal(proposal)}
        staleTransactionIndex={view.staleTransactionIndex}
        threshold={view.threshold}
        transactionIndex={view.transactionIndex}
        vaultName={vaultName}
        votingMembers={votingMembers}
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
        <Text style={styles.title}>
          {vaultName !== null && vaultName !== undefined && vaultName.length > 0
            ? vaultName
            : 'Multisig'}
        </Text>
        <Text style={styles.subtitle}>Read from devnet. Nothing can be changed here.</Text>

        {state.status === 'loading' ? (
          <View style={styles.centerBlock}>
            <ActivityIndicator color="#1a56db" />
            <Text style={styles.hint}>Reading the multisig account…</Text>
          </View>
        ) : null}

        {state.status === 'error' ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{state.message}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Retry reading the multisig"
              onPress={load}
              style={styles.retry}
            >
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          </View>
        ) : null}

        {view !== null ? (
          <View style={styles.block}>
            <Text style={styles.fieldLabel}>Multisig address</Text>
            <Text selectable style={styles.fieldValue}>{view.address}</Text>

            <Text style={styles.fieldLabel}>Vault address (index 0)</Text>
            <Text selectable style={styles.fieldValue}>{view.vaultAddress}</Text>

            <Text style={styles.fieldLabel}>Threshold</Text>
            <Text style={styles.fieldValue}>
              {view.threshold} of {view.members.length}
            </Text>

            <Text style={styles.fieldLabel}>Members ({view.members.length})</Text>
            {view.members.map((member) => (
              <View key={member.address} style={styles.memberCard}>
                <Text selectable style={styles.memberAddress}>{member.address}</Text>
                <Text style={styles.memberRoles}>
                  {member.roles.length > 0 ? member.roles.join(' + ') : 'No permission'}
                </Text>
              </View>
            ))}

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

            <Text style={styles.fieldLabel}>Program</Text>
            <Text selectable style={styles.fieldValue}>
              {multisig.PROGRAM_ID.toString()}
            </Text>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open proposals list"
              onPress={() => setProposalsOpen(true)}
              style={[styles.button, styles.secondary, styles.proposalsButton]}
            >
              <Text style={styles.secondaryText}>Proposals</Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Create a new proposal"
              onPress={() => setNewProposalOpen(true)}
              style={[styles.button, styles.secondary, styles.proposalsButton]}
            >
              <Text style={styles.secondaryText}>New Proposal</Text>
            </Pressable>
          </View>
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to inbox"
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
  centerBlock: {
    alignItems: 'center',
    marginTop: 24,
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
    fontFamily: 'monospace',
    fontSize: 12,
    marginTop: 2,
  },
  fieldNote: {
    color: '#6b7280',
    fontSize: 12,
    marginTop: 4,
  },
  memberCard: {
    backgroundColor: '#f9fafb',
    borderColor: '#e5e7eb',
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 8,
    padding: 12,
  },
  memberAddress: {
    color: '#101317',
    fontFamily: 'monospace',
    fontSize: 12,
  },
  memberRoles: {
    color: '#065f46',
    fontSize: 12,
    fontWeight: '700',
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
    borderColor: '#d1d5db',
    borderWidth: 1,
    marginTop: 24,
  },
  // Acces a la liste des propositions (lecture seule).
  proposalsButton: {
    borderColor: '#1a56db',
    marginTop: 20,
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
});