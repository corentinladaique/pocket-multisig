import { useCallback, useEffect, useRef, useState } from 'react';
import { SAFE_TOP_PADDING } from '../ui/safeAreaPadding';
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { useMobileWallet } from '@wallet-ui/react-native-web3js';

import {
  describeMwaError,
  describeWalletIdentity,
  type MwaErrorReport,
} from '../wallet/mwaDiagnostics';
import { PublicKey } from '@solana/web3.js';

import { connection } from '../solana/connection';
import type { TransactionReviewModel } from '../types/transactionReview';
import { useRpcHealth } from '../solana/useRpcHealth';
import { useMultisigLookup } from '../squads/useMultisigLookup';
import type { MultisigRegistryEntry } from '../vault/multisigRegistry';
import { computeProposalDecision, summarizeDecisions, summarizeOperation, loadProposalReview,
  useProposals,
  type ProposalReviewResult, } from '../squads/proposals';
import { TransactionReviewScreen } from './TransactionReviewScreen';
import { CreateVaultScreen } from './CreateVaultScreen';
import { MultisigDetailsScreen } from './MultisigDetailsScreen';
import { MultisigInboxScreen } from './MultisigInboxScreen';
import { OnboardingScreen } from './OnboardingScreen';
import { useOnboarding } from '../onboarding/useOnboarding';
import { useMultisigRegistry } from '../vault/useMultisigRegistry';
import { describeVaultBalance, type BalanceStatus } from '../wallet/vaultBalance';
import { ProposalDetailsScreen } from './ProposalDetailsScreen';
import { buildReviewPreviews } from '../solana/decodeTransactionMessage';
import type { DecodeStatus } from '../types/transactionReview';

// Marge conservee entre le haut du bloc multisig (label + champ + bouton Load
// multisig) et le haut de la zone visible : uniquement une valeur de confort,
// aucune dimension d'ecran codee en dur.
const MULTISIG_KEYBOARD_MARGIN = 24;

// Jeux de preview construits localement par le décodeur pur (aucun RPC,
// aucune signature). Voir src/solana/decodeTransactionMessage.ts.
const PREVIEW_CASES = buildReviewPreviews();

type Phase = 'idle' | 'connecting' | 'disconnecting';

function shortenAddress(address: string): string {
  return address.length <= 10 ? address : `${address.slice(0, 4)}…${address.slice(-4)}`;
}

/**
 * Traduit l'erreur brute remontée par Mobile Wallet Adapter en message lisible.
 * Un refus de l'utilisateur n'est jamais présenté comme une erreur technique
 * (SECURITY.md §6).
 */
function toReadableError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  if (/reject|cancel|denied|declin|refus/i.test(raw)) {
    return "Connexion refusée dans le wallet. Aucune autorisation n'a été accordée.";
  }
  if (/no wallet|no activity|not found|not installed|unable to (find|open)/i.test(raw)) {
    return 'Aucun wallet Mobile Wallet Adapter trouvé sur cet appareil.';
  }
  return `Échec de la connexion : ${raw}`;
}

export function ConnectScreen() {
  const { account, connect, connectAnd, disconnect, store } = useMobileWallet();
  const { detail: rpcDetail, retry: retryRpc, status: rpcStatus } = useRpcHealth();
  const msig = useMultisigLookup();
  const proposals = useProposals(
    msig.view?.address ?? null,
    msig.view?.transactionIndex ?? 0,
    msig.view?.staleTransactionIndex ?? 0,
  );
  const [multisigInput, setMultisigInput] = useState('');
  const [previewCase, setPreviewCase] = useState<DecodeStatus | null>(null);
  const [review, setReview] = useState<ProposalReviewResult | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  // Assistant local de configuration de vault (aucun RPC, aucune signature).
  const [vaultCreationOpen, setVaultCreationOpen] = useState(false);
  // Inbox des multisigs connus (registre local uniquement, aucun RPC).
  const [inboxOpen, setInboxOpen] = useState(false);
  // Multisig ouvert depuis l'inbox (registre local) : lecture seule.
  const [openEntry, setOpenEntry] = useState<MultisigRegistryEntry | null>(null);
  // Proposition ouverte depuis l'inbox : MÊME écran que depuis Home, et son
  // décodage est fait sur place. Aucun envoi, aucun wallet sollicité ici.
  const [openDecisionIndex, setOpenDecisionIndex] = useState<number | null>(null);
  // Multisig charge manuellement : meme ecran de detail que ceux de l'inbox.
  const [manualDetailsOpen, setManualDetailsOpen] = useState(false);
  // Prechargement de l'operation de la proposition PRIORITAIRE : un seul appel
  // cible (getAccountInfo sur sa VaultTransaction), jamais pour les autres.
  const [inboxDecoded, setInboxDecoded] = useState<ProposalReviewResult | null>(null);
  const [inboxDecoding, setInboxDecoding] = useState(false);
  const [inboxDecodeError, setInboxDecodeError] = useState<string | null>(null);
  // Ref et non state : marquer la tentative ne doit PAS provoquer un rendu,
  // sinon l'effet se relance et annule la lecture en cours (cleanup).
  const inboxAttemptedRef = useRef<number | null>(null);
  const scrollViewRef = useRef<ScrollView>(null);
  const multisigInputRef = useRef<TextInput>(null);
  // Position verticale reelle du bloc multisig (label + champ + bouton Load
  // multisig), mesuree dans le repere du contenu scrollable.
  const multisigBlockYRef = useRef<number | null>(null);
  // Le champ est-il actuellement focus ? Le clavier peut s'ouvrir pour une
  // autre raison : on ne remonte l'ecran que si la saisie multisig est active.
  const multisigFocusedRef = useRef(false);

  const onMultisigBlockLayout = useCallback((event: LayoutChangeEvent) => {
    multisigBlockYRef.current = event.nativeEvent.layout.y;
  }, []);

  const onMultisigInputFocus = useCallback(() => {
    multisigFocusedRef.current = true;
  }, []);

  const onMultisigInputBlur = useCallback(() => {
    multisigFocusedRef.current = false;
  }, []);

  /**
   * Android : la fenetre n'est plus redimensionnee par l'IME en edge-to-edge,
   * donc on remonte explicitement le bloc multisig a l'ouverture reelle du
   * clavier (keyboardDidShow), en utilisant la position mesuree. Aucun delai
   * arbitraire, aucune fermeture du clavier, aucune remise a zero du texte.
   */
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const subscription = Keyboard.addListener('keyboardDidShow', () => {
      if (!multisigFocusedRef.current) return;
      const blockY = multisigBlockYRef.current;
      if (blockY === null) return;
      const targetY = Math.max(blockY - MULTISIG_KEYBOARD_MARGIN, 0);
      if (__DEV__) {
        console.log(
          '[keyboard] keyboardDidShow ; blockY =',
          blockY,
          '; scrollTo.y =',
          targetY,
        );
      }
      scrollViewRef.current?.scrollTo({ animated: true, y: targetY });
    });
    return () => subscription.remove();
  }, []);

  // Boite de reception de decisions : classement par etat ON-CHAIN reel.
  const walletAddress = account === undefined ? null : account.address.toString();
  const walletCanApprove =
    msig.view !== null &&
    walletAddress !== null &&
    msig.view.members.some(
      (member) => member.address === walletAddress && member.roles.includes('Vote'),
    );
  const decisions =
    proposals.list === null
      ? []
      : proposals.list.proposals.map((proposal) =>
          computeProposalDecision({
            index: proposal.index,
            status: proposal.status,
            approvedAddresses: proposal.approvedAddresses,
            threshold: msig.view?.threshold ?? 0,
            walletAddress,
            walletCanApprove,
          }),
        );
  const inboxDecisions = decisions.filter((entry) => entry.kind !== 'none');
  const priorityIndex = inboxDecisions[0]?.index ?? null;
  const decisionSummary = summarizeDecisions(decisions);
  const inboxHeading =
    decisionSummary.attention > 0
      ? 'Needs your attention'
      : decisionSummary.approved > 0
        ? 'Approved proposals'
        : decisionSummary.approvedByYou > 0
          ? 'Approved by you'
          : 'Proposals';

  // Modele deja en memoire pour un index donne : la revue ouverte, ou le
  // prechargement de la boite de reception. Aucun appel reseau ici.
  const decodedModelFor = (index: number): TransactionReviewModel | null => {
    if (review !== null && review.model.proposalIndex === index) return review.model;
    if (inboxDecoded !== null && inboxDecoded.model.proposalIndex === index) return inboxDecoded.model;
    return null;
  };
  const [reviewLoading, setReviewLoading] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  // Diagnostics MWA : étape, code et message exacts, jamais reformulés.
  const [mwaReport, setMwaReport] = useState<MwaErrorReport | null>(null);
  const [resetReport, setResetReport] = useState<string | null>(null);

  const onConnect = useCallback(async () => {
    setError(null);
    setMwaReport(null);
    setResetReport(null);
    setPhase('connecting');
    try {
      await connect();
    } catch (caught: unknown) {
      setError(toReadableError(caught));
      setMwaReport(describeMwaError(caught, 'authorize'));
    } finally {
      setPhase('idle');
    }
  }, [connect]);

  const onDisconnect = useCallback(async () => {
    setError(null);
    setMwaReport(null);
    setResetReport(null);
    setPhase('disconnecting');
    try {
      await disconnect();
    } catch (caught: unknown) {
      setError(toReadableError(caught));
      setMwaReport(describeMwaError(caught, 'deauthorize'));
    } finally {
      setPhase('idle');
    }
  }, [disconnect]);

  /**
   * Reset explicite d'une session MWA devenue invalide.
   *
   * Ne signe rien et n'envoie aucune transaction : la seule opération
   * éventuellement demandée au wallet est `deauthorize`. Le cache local est
   * vidé dans tous les cas, même si la révocation côté wallet échoue.
   */
  const onResetWalletSession = useCallback(async () => {
    setError(null);
    setMwaReport(null);
    setResetReport(null);
    setPhase('disconnecting');
    const parts: string[] = [];
    try {
      let authToken: string | null = null;
      try {
        const authorization = await store.fetch();
        authToken =
          authorization === null || authorization.authToken.length === 0
            ? null
            : authorization.authToken;
      } catch (caught: unknown) {
        parts.push(`Stored authorization unreadable (${describeMwaError(caught, 'deauthorize').message}).`);
      }

      if (authToken === null) {
        parts.push('No stored authorization: nothing to revoke on the wallet side.');
      } else {
        try {
          await connectAnd(async (wallet) => {
            // Le wrapper type ce paramètre comme `AuthorizeAPI`, alors que
            // l'objet réel implémente le `MobileWallet` complet (le protocole
            // déclare `MobileWallet extends … DeauthorizeAPI …`). On ne peut
            // donc pas appeler `deauthorize` sans le préciser explicitement.
            const protocolWallet = wallet as unknown as {
              deauthorize(params: { auth_token: string }): Promise<unknown>;
            };
            await protocolWallet.deauthorize({ auth_token: authToken });
          });
          parts.push('Wallet-side session revoked.');
        } catch (caught: unknown) {
          const report = describeMwaError(caught, 'deauthorize');
          parts.push(`Wallet-side revocation failed (${report.message}).`);
        }
      }
    } finally {
      try {
        await disconnect();
        parts.push('Local authorization cache cleared.');
      } catch (caught: unknown) {
        parts.push(`Local cache clear failed (${toReadableError(caught)}).`);
      }
      setPhase('idle');
      setResetReport(parts.join(' '));
    }
  }, [connectAnd, disconnect, store]);

  const busy = phase !== 'idle';

  // Ce que le wallet a réellement fourni lors de l'autorisation : labels et
  // icône sont facultatifs dans le protocole, donc on affiche aussi leur absence.
  const walletIdentity =
    account === undefined
      ? null
      : describeWalletIdentity({
          address: account.address.toString(),
          icon: account.icon,
          label: account.label,
        });

  // Charge la revue RÉELLE d'une proposition : un seul appel RPC ciblé.
  // Une seule lecture par index prioritaire ; aucun retry automatique.
  // Dependances PRIMITIVES : sans cela, les nouvelles identites d'objet a
  // chaque rendu relanceraient l'effet et annuleraient la lecture en cours.
  const viewAddress = msig.view?.address ?? null;
  const viewVaultAddress = msig.view?.vaultAddress ?? null;
  const view = msig.view ?? null;

  // --- Tableau de bord Home -------------------------------------------------
  // Solde du Main vault, chargé en lecture seule AVEC son adresse : changer de
  // multisig purge immédiatement la valeur précédente.
  const [homeBalance, setHomeBalance] = useState<{
    address: string;
    lamports: number | null;
    stale: boolean;
    status: BalanceStatus;
  } | null>(null);
  const [homeBalanceError, setHomeBalanceError] = useState(false);
  // Registre LOCAL : sert uniquement à afficher le nom donné au vault par
  // l'utilisateur. Rien n'en est jamais transmis ni synchronisé.
  const registry = useMultisigRegistry();
  // Onboarding pedagogique : profil LOCAL uniquement, aucun wallet, aucun RPC.
  const onboarding = useOnboarding();

  const refreshHomeBalance = useCallback((targetVaultAddress: string) => {
    setHomeBalance((previous) => ({
      address: targetVaultAddress,
      lamports:
        previous !== null && previous.address === targetVaultAddress ? previous.lamports : null,
      stale:
        previous !== null && previous.address === targetVaultAddress && previous.lamports !== null,
      status: 'loading',
    }));
    setHomeBalanceError(false);
    void (async () => {
      try {
        const lamports = await connection.getBalance(
          new PublicKey(targetVaultAddress),
          'confirmed',
        );
        setHomeBalance({ address: targetVaultAddress, lamports, stale: false, status: 'loaded' });
      } catch {
        setHomeBalance((previous) => ({
          address: targetVaultAddress,
          lamports:
            previous !== null && previous.address === targetVaultAddress ? previous.lamports : null,
          stale:
            previous !== null && previous.address === targetVaultAddress && previous.lamports !== null,
          status: 'error',
        }));
        setHomeBalanceError(true);
      }
    })();
  }, []);

  // Purge + lecture à chaque changement d'adresse de multisig / de vault.
  useEffect(() => {
    if (viewVaultAddress === null) {
      setHomeBalance(null);
      return;
    }
    refreshHomeBalance(viewVaultAddress);
  }, [viewVaultAddress, refreshHomeBalance]);

  const homeBalanceView = describeVaultBalance({
    addressMatches:
      homeBalance !== null && viewVaultAddress !== null && homeBalance.address === viewVaultAddress,
    lamports: homeBalance?.lamports ?? null,
    status: homeBalance?.status ?? 'idle',
    stale: homeBalance?.stale === true,
  });

  // Rôles RÉELLEMENT lus on-chain pour le wallet connecté.
  const homeWalletRoles =
    view === null || walletAddress === null
      ? []
      : (view.members.find((member) => member.address === walletAddress)?.roles ?? []);
  const homeIsMember = homeWalletRoles.length > 0;
  const homeVaultName = registry.entries.find((entry) => entry.address === viewAddress)?.vaultName ?? null;

  // Compteurs : ce qui attend une action du wallet (vote) et ce qui est prêt à
  // être exécuté par lui. Aucune lecture supplémentaire : propositions déjà lues.
  const homeNeedsVote = view === undefined
    ? 0
    : (proposals.list?.proposals ?? []).filter(
        (proposal) =>
          proposal.status === 'Active' &&
          homeIsMember &&
          homeWalletRoles.includes('Vote') &&
          !proposal.approvedAddresses.includes(walletAddress ?? ''),
      ).length;
  const homeReadyToExecute = view === undefined
    ? 0
    : (proposals.list?.proposals ?? []).filter(
        (proposal) =>
          proposal.status === 'Approved' && homeIsMember && homeWalletRoles.includes('Execute'),
      ).length;
  const proposalsLoaded = proposals.list !== null;

  useEffect(() => {
    const view = msig.view;
    const list = proposals.list;
    if (view === null || list === null) return;
    if (priorityIndex === null) return;
    if (inboxAttemptedRef.current === priorityIndex) return;
    inboxAttemptedRef.current = priorityIndex;
    setInboxDecoding(true);
    setInboxDecodeError(null);
    let cancelled = false;
    void (async () => {
      try {
        const status =
          list.proposals.find((entry) => entry.index === priorityIndex)?.status ?? 'Unknown';
        const result = await loadProposalReview(
          connection,
          new PublicKey(view.address),
          {
            network: 'devnet',
            multisigAddress: view.address,
            vaultAddress: view.vaultAddress,
            proposalIndex: priorityIndex,
            proposalStatus: status,
            signerWallet: account === undefined ? 'Unknown' : account.address.toString(),
          },
          priorityIndex,
        );
        if (!cancelled) setInboxDecoded(result);
      } catch (caught: unknown) {
        if (!cancelled) {
          setInboxDecoded(null);
          setInboxDecodeError(caught instanceof Error ? caught.message : String(caught));
        }
      } finally {
        if (!cancelled) setInboxDecoding(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [account, priorityIndex, proposalsLoaded, viewAddress, viewVaultAddress]);

  const openProposalReview = useCallback(
    async (index: number) => {
      const view = msig.view;
      if (view === null) return;
      // Reutilisation du modele deja en memoire : aucun second appel reseau.
      if (inboxDecoded !== null && inboxDecoded.model.proposalIndex === index) {
        setReviewError(null);
        setReview(inboxDecoded);
        return;
      }
      setReviewError(null);
      setReviewLoading(true);
      try {
        const status =
          proposals.list?.proposals.find((entry) => entry.index === index)?.status ?? 'Unknown';
        const result = await loadProposalReview(
          connection,
          new PublicKey(view.address),
          {
            network: 'devnet',
            multisigAddress: view.address,
            vaultAddress: view.vaultAddress,
            proposalIndex: index,
            proposalStatus: status,
            signerWallet: account === undefined ? 'Unknown' : account.address.toString(),
          },
          index,
        );
        setReview(result);
      } catch (caught: unknown) {
        setReviewError(
          `Lecture de la proposition impossible : ${
            caught instanceof Error ? caught.message : String(caught)
          }`,
        );
      } finally {
        setReviewLoading(false);
      }
    },
    [account, msig.view, proposals.list],
  );

  // Revue d'une proposition réelle : prioritaire sur les previews de dev.
  // Onboarding : premiere utilisation (ou reouverture depuis Home). Cet ecran ne
  // connecte aucun wallet, ne signe rien et ne fait aucun appel reseau.
  if (onboarding.ready && onboarding.show) {
    return (
      <OnboardingScreen
        initialProfile={onboarding.profile}
        onFinish={(profile) => {
          void onboarding.complete(profile);
        }}
        onSkip={(profile) => {
          void onboarding.skip(profile);
        }}
      />
    );
  }

  // Proposition ouverte depuis l'inbox : exactement le MEME ecran que depuis
  // Home (ProposalDetailsScreen), avec decodage sur place. Lecture seule.
  if (openDecisionIndex !== null && msig.view !== null) {
    const view = msig.view;
    const decision =
      proposals.list?.proposals.find((entry) => entry.index === openDecisionIndex) ?? null;
    if (decision !== null) {
      return (
        <ProposalDetailsScreen
          address={view.address}
          decodedModel={
            inboxDecoded !== null && inboxDecoded.model.proposalIndex === decision.index
              ? inboxDecoded.model
              : null
          }
          index={decision.index}
          members={view.members}
          onBack={() => setOpenDecisionIndex(null)}
          proposal={{ approvedAddresses: decision.approvedAddresses, status: decision.status }}
          threshold={view.threshold}
          vaultTransactionAddress={decision.vaultTransactionAddress}
          walletAddress={walletAddress}
          walletCanApprove={view.members.some(
            (member) => member.address === walletAddress && member.roles.includes('Vote'),
          )}
        />
      );
    }
  }

  if (review !== null) {
    // Données déjà chargées uniquement : le guard ne fait aucun appel RPC.
    const matched = proposals.list?.proposals.find(
      (entry) => entry.index === review.model.proposalIndex,
    );
    return (
      <TransactionReviewScreen
        model={review.model}
        guardContext={{
          review: review.model,
          multisig:
            msig.view === null
              ? null
              : {
                  address: msig.view.address,
                  vaultAddress: msig.view.vaultAddress,
                  threshold: msig.view.threshold,
                  members: msig.view.members.map((member) => ({
                    address: member.address,
                    roles: member.roles,
                  })),
                },
          proposal:
            matched === undefined
              ? null
              : {
                  index: matched.index,
                  status: matched.status,
                  approvedAddresses: matched.approvedAddresses,
                },
          walletAddress: account === undefined ? null : account.address.toString(),
        }}
        onBack={() => {
          setReview(null);
          setReviewError(null);
        }}
      />
    );
  }

  // Preview locale (développement uniquement) : affiche un modèle fictif.
  // Aucun appel réseau, aucune action au montage, fermeture par Back seulement.
  const activePreview = PREVIEW_CASES.find((entry) => entry.key === previewCase);
  if (activePreview) {
    return (
      <TransactionReviewScreen
        model={activePreview.model}
        onBack={() => setPreviewCase(null)}
      />
    );
  }

  // Multisig ouvert depuis l'inbox : un seul getAccountInfo (loadMultisig),
  // aucune creation, aucune signature, aucune proposition.
  if (openEntry !== null) {
    return (
      <MultisigDetailsScreen
        address={openEntry.address}
        decodedModelFor={(index) =>
          // Uniquement les modeles DEJA decodes : celui de la proposition
          // prioritaire prechargee plus haut. Aucune lecture declenchee ici.
          inboxDecoded !== null && inboxDecoded.model.proposalIndex === index
            ? inboxDecoded.model
            : null
        }
        onBack={() => setOpenEntry(null)}
        vaultName={openEntry.vaultName}
      />
    );
  }

  // Multisig charge manuellement : le meme ecran de detail que ceux de l'inbox.
  // L'adresse vient de la vue deja lue : aucun appel reseau supplementaire ici.
  if (manualDetailsOpen && msig.view !== null) {
    return (
      <MultisigDetailsScreen
        address={msig.view.address}
        onBack={() => setManualDetailsOpen(false)}
      />
    );
  }

  // Inbox des multisigs connus : lecture du registre local uniquement.
  if (inboxOpen) {
    return (
      <MultisigInboxScreen
        onBack={() => setInboxOpen(false)}
        onOpenMultisig={(entry) => setOpenEntry(entry)}
      />
    );
  }

  // Assistant local de creation de vault : ecran dedie, sortie par Cancel.
  if (vaultCreationOpen) {
    return <CreateVaultScreen onCancel={() => setVaultCreationOpen(false)} />;
  }

  // Android : la fenetre n'etant plus redimensionnee par l'IME en edge-to-edge,
  // le KeyboardAvoidingView en mode "padding" est necessaire sur les deux
  // plateformes (aucune hauteur codee en dur).
  return (
    <KeyboardAvoidingView behavior="padding" style={[styles.keyboardAvoider, SAFE_TOP_PADDING]}>
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        ref={scrollViewRef}
        style={styles.scrollView}
      >
      <Text style={styles.badge}>DEVNET</Text>
      <Text style={styles.title}>Pocket Multisig</Text>

      {account ? (
        <View style={styles.card}>
          <Text style={styles.label}>Wallet connecté</Text>
          <Text style={styles.walletLabel}>{walletIdentity?.label ?? 'Wallet without label'}</Text>
          <Text style={styles.address}>{shortenAddress(account.address.toString())}</Text>
          <Text style={styles.fullAddress}>{account.address.toString()}</Text>
          <Text style={styles.hint}>
            Icon supplied by the wallet: {walletIdentity !== null && walletIdentity.iconUri !== null ? 'yes' : 'no'} ·
            label supplied: {walletIdentity !== null && walletIdentity.label !== null ? 'yes' : 'no'}
          </Text>
          {walletIdentity !== null && walletIdentity.iconUri !== null ? (
            <Text selectable style={styles.diagnosticsText}>
              Icon URI: {walletIdentity.iconUri}
            </Text>
          ) : null}
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={onDisconnect}
            style={[styles.button, styles.secondary, busy && styles.disabled]}
          >
            {phase === 'disconnecting' ? (
              <ActivityIndicator color="#101317" />
            ) : (
              <Text style={styles.secondaryText}>Disconnect</Text>
            )}
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Reset the mobile wallet adapter session"
            disabled={busy}
            onPress={() => {
              void onResetWalletSession();
            }}
            style={[styles.button, styles.secondary, busy && styles.disabled]}
          >
            <Text style={styles.secondaryText}>Reset wallet session</Text>
          </Pressable>
          <Text style={styles.hint}>
            Clears the local authorization and revokes the session on the wallet when possible.
            Nothing is signed and no transaction is sent.
          </Text>
          {resetReport !== null ? (
            <Text style={styles.diagnosticsText}>{resetReport}</Text>
          ) : null}
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={onConnect}
          style={[styles.button, busy && styles.disabled]}
        >
          {phase === 'connecting' ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text style={styles.buttonText}>Connect wallet</Text>
          )}
        </Pressable>
      )}

      {phase === 'connecting' ? (
        <Text style={styles.hint}>Ouverture du wallet…</Text>
      ) : null}

      <View style={styles.rpcBox}>
        <Text style={styles.rpcLine}>Network: Devnet</Text>
        <Text style={styles.rpcLine}>
          RPC:{' '}
          <Text
            style={[
              styles.rpcValue,
              rpcStatus === 'online' && styles.rpcOnline,
              rpcStatus === 'offline' && styles.rpcOffline,
            ]}
          >
            {rpcStatus === 'checking' ? 'Checking…' : rpcStatus === 'online' ? 'Online' : 'Offline'}
          </Text>
        </Text>
        {rpcStatus === 'offline' ? (
          <>
            {rpcDetail ? <Text style={styles.rpcDetail}>{rpcDetail}</Text> : null}
            <Pressable accessibilityRole="button" onPress={retryRpc} style={styles.retry}>
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          </>
        ) : null}
      </View>

      {account ? (
        <View onLayout={onMultisigBlockLayout} style={styles.msigBlock}>
          <Text style={styles.msigHeading}>Multisig (lecture seule)</Text>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            editable={msig.status !== 'loading'}
            onBlur={onMultisigInputBlur}
            onChangeText={setMultisigInput}
            onFocus={onMultisigInputFocus}
            placeholder="Multisig address"
            placeholderTextColor="#9ca3af"
            ref={multisigInputRef}
            style={styles.input}
            value={multisigInput}
          />
          <Pressable
            accessibilityRole="button"
            disabled={msig.status === 'loading'}
            onPress={() => msig.load(multisigInput)}
            style={[styles.button, msig.status === 'loading' && styles.disabled]}
          >
            {msig.status === 'loading' ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text style={styles.buttonText}>Load multisig</Text>
            )}
          </Pressable>
          {msig.status === 'loading' ? <Text style={styles.hint}>Lecture…</Text> : null}

          {msig.status === 'error' && msig.error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{msig.error}</Text>
              <Pressable accessibilityRole="button" onPress={msig.retry} style={styles.retry}>
                <Text style={styles.retryText}>Retry</Text>
              </Pressable>
            </View>
          ) : null}

          {msig.status === 'loaded' && msig.view ? (
            <View style={styles.msigResult}>
              <Text style={styles.inboxHeading}>{inboxHeading}</Text>
              <Text style={styles.inboxCount}>{inboxDecisions.length}</Text>

              {/* Tableau de bord du multisig ACTIF : identité, statut du wallet,
                  Main vault, configuration et actions attendues. Aucun label
                  local n'est transmis : tout reste sur l'appareil. */}
              <Text style={styles.fieldLabel}>Active multisig</Text>
              <Text style={styles.fieldValue}>{homeVaultName ?? 'Unnamed multisig'}</Text>
              <Text selectable style={styles.hint}>
                {msig.view.address}
              </Text>

              <Text style={styles.fieldLabel}>Wallet status</Text>
              <Text style={styles.fieldValue}>
                {homeIsMember ? 'My multisig' : 'Observed multisig · Read only'}
              </Text>
              {homeIsMember ? (
                <Text style={styles.hint}>Roles read on-chain: {homeWalletRoles.join(' · ')}</Text>
              ) : (
                <Text style={styles.hint}>
                  This is public on-chain information. Your connected wallet has no permissions in
                  this multisig.
                </Text>
              )}

              {/* Main vault : le SOLDE est l'information principale du bloc, une
                  seule explication, aucune zone vide. */}
              <Text style={styles.fieldLabel}>MAIN VAULT</Text>
              {homeBalanceView.sol !== null ? (
                <Text selectable style={styles.balanceValue}>
                  {homeBalanceView.sol} SOL
                </Text>
              ) : null}
              {homeBalanceView.title === 'Main vault not funded' ? (
                <Text style={styles.balanceNote}>Main vault not funded</Text>
              ) : null}
              {homeBalanceView.title === 'Balance unavailable' ? (
                <Text style={styles.balanceNote}>Balance unavailable</Text>
              ) : null}
              <Text selectable style={styles.hint}>
                {msig.view.vaultAddress}
              </Text>
              <Text style={styles.hint}>
                This account holds the funds controlled by the multisig.
              </Text>
              {homeBalanceView.stale ? <Text style={styles.hint}>stale</Text> : null}
              {homeBalanceView.hint.length > 0 ? (
                <Text style={styles.hint}>{homeBalanceView.hint}</Text>
              ) : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Refresh the Main vault balance"
                disabled={homeBalance?.status === 'loading'}
                onPress={() => {
                  refreshHomeBalance(viewVaultAddress ?? '');
                }}
                style={styles.retry}
              >
                <Text style={styles.retryText}>
                  {homeBalance?.status === 'loading'
                    ? 'Loading vault balance…'
                    : homeBalanceError
                      ? 'Retry balance'
                      : 'Refresh balance'}
                </Text>
              </Pressable>

              {/* Action prioritaire : placée juste après le solde, avant tout
                  détail technique, pour éviter un long scroll. */}
              <Text style={styles.fieldLabel}>Actions required</Text>
              <Text style={styles.hint}>
                {homeNeedsVote} proposal(s) waiting for your vote · {homeReadyToExecute} ready to
                execute
              </Text>
              {priorityIndex !== null ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Review proposal ${priorityIndex}`}
                  onPress={() => {
                    setOpenDecisionIndex(priorityIndex);
                  }}
                  style={[styles.button, styles.secondary, styles.sideButton]}
                >
                  <Text style={styles.secondaryText}>Review proposal #{priorityIndex}</Text>
                </Pressable>
              ) : null}

              <Text style={styles.fieldLabel}>Technical details</Text>
              <Text style={styles.hint}>
                Threshold {msig.view.threshold} of {msig.view.members.length} member(s). Multisig
                configuration: {msig.view.address}
              </Text>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Open this multisig in the shared detail screen"
                onPress={() => setManualDetailsOpen(true)}
                style={[styles.button, styles.secondary, styles.sideButton]}
              >
                <Text style={styles.secondaryText}>Open multisig</Text>
              </Pressable>

              {/* Apprentissage : reouverture et remise a zero, purement locales. */}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Learn about multisig"
                onPress={onboarding.open}
                style={[styles.button, styles.secondary, styles.sideButton]}
              >
                <Text style={styles.secondaryText}>Learn about multisig</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Reset onboarding"
                onPress={() => {
                  void onboarding.reset();
                }}
                style={styles.retry}
              >
                <Text style={styles.retryText}>Reset onboarding</Text>
              </Pressable>
              {onboarding.storageFailed ? (
                <Text style={styles.hint}>
                  Your answers could not be saved on this device: the app keeps working with the
                  default learning mode, and nothing is sent anywhere.
                </Text>
              ) : null}

              {proposals.status === 'loading' ? (
                <Text style={styles.hint}>Lecture…</Text>
              ) : null}

              {/* Relecture en lecture seule : le dernier état lisible est conservé
                  si le réseau échoue, et aucun wallet n'est sollicité. */}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Refresh proposals from the chain"
                disabled={proposals.status === 'loading'}
                onPress={proposals.retry}
                style={[
                  styles.button,
                  styles.secondary,
                  styles.sideButton,
                  proposals.status === 'loading' && styles.disabled,
                ]}
              >
                <Text style={styles.secondaryText}>
                  {proposals.status === 'loading' ? 'Refreshing…' : 'Refresh proposals'}
                </Text>
              </Pressable>

              {proposals.status === 'loaded' && inboxDecisions.length === 0 ? (
                <Text style={styles.hint}>No proposals yet</Text>
              ) : null}

              {inboxDecisions.map((decision) => {
                const model = decodedModelFor(decision.index);
                const summary = summarizeOperation(model);
                const operationLine =
                  summary === null
                    ? inboxDecodeError !== null
                      ? 'Operation details unavailable'
                      : inboxDecoding
                        ? 'Loading operation…'
                        : 'Operation details unavailable'
                    : summary.action;
                const detailLine =
                  summary === null
                    ? 'Open View details'
                    : `${summary.amount} · Devnet · to ${summary.destination}`;
                return (
                  <View key={decision.index} style={styles.decisionCard}>
                    <Text style={styles.decisionAction}>{operationLine}</Text>
                    <Text style={styles.decisionMeta}>{detailLine}</Text>
                    <Text style={styles.decisionMeta}>
                      {decision.approvals} of {decision.threshold} approvals
                    </Text>
                    <Text style={styles.decisionState}>{decision.stateLabel}</Text>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Open proposal ${decision.index} in the shared detail screen`}
                      onPress={() => {
                        setOpenDecisionIndex(decision.index);
                      }}
                      style={styles.retry}
                    >
                      <Text style={styles.proposalAction}>Review proposal</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Open the full transaction review of proposal ${decision.index}`}
                      onPress={() => {
                        void openProposalReview(decision.index);
                      }}
                      style={styles.retry}
                    >
                      <Text style={styles.proposalAction}>
                        {reviewLoading ? 'Loading…' : 'Full review'}
                      </Text>
                    </Pressable>
                  </View>
                );
              })}

              {reviewError !== null ? <Text style={styles.rpcDetail}>{reviewError}</Text> : null}
              {proposals.status === 'loaded' && (proposals.list?.unreadable ?? 0) > 0 ? (
                <Text style={styles.rpcDetail}>
                  {proposals.list?.unreadable} compte(s) illisible(s) ignoré(s)
                </Text>
              ) : null}
              {proposals.status === 'error' && proposals.error ? (
                <View style={styles.errorBox}>
                  <Text style={styles.errorText}>{proposals.error}</Text>
                  <Pressable accessibilityRole="button" onPress={proposals.retry} style={styles.retry}>
                    <Text style={styles.retryText}>Retry</Text>
                  </Pressable>
                </View>
              ) : null}

              {/* Details secondaires : replies par defaut, sans duplication du resume. */}
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: detailsOpen }}
                accessibilityLabel="Toggle multisig details"
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                onPress={() => setDetailsOpen((previous) => !previous)}
                style={styles.detailsToggle}
              >
                <Text style={styles.detailsToggleText}>
                  {detailsOpen ? '▾ Details' : '▸ Details'}
                </Text>
              </Pressable>

              {detailsOpen ? (
                <View style={styles.detailsBody}>
                  <Text style={styles.fieldLabel}>Multisig configuration address</Text>
                  <Text selectable style={styles.fieldValue}>{msig.view.address}</Text>

                  <Text style={styles.fieldLabel}>Vault address (index 0)</Text>
                  <Text selectable style={styles.fieldValue}>{msig.view.vaultAddress}</Text>

                  <Text style={styles.fieldLabel}>Threshold</Text>
                  <Text style={styles.fieldValue}>
                    {msig.view.threshold} / {msig.view.members.length}
                  </Text>

                  <Text style={styles.fieldLabel}>Members ({msig.view.members.length})</Text>
                  {msig.view.members.map((member) => (
                    <Text key={member.address} selectable style={styles.memberLine}>
                      {member.address}
                      {member.roles.length > 0 ? `  ·  ${member.roles.join(' + ')}` : ''}
                    </Text>
                  ))}

                  <Text style={styles.fieldLabel}>Network</Text>
                  <Text style={styles.fieldValue}>Devnet</Text>
                  <Text style={styles.rpcLine}>RPC: {rpcStatus}</Text>
                  {rpcDetail ? <Text style={styles.rpcDetail}>{rpcDetail}</Text> : null}

                  <Pressable
                    accessibilityRole="button"
                    onPress={() => {
                      setMultisigInput('');
                      msig.clear();
                    }}
                    style={styles.retry}
                  >
                    <Text style={styles.retryText}>Clear</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          ) : null}
        </View>
      ) : null}

      {account ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Create a vault"
          onPress={() => setVaultCreationOpen(true)}
          style={[styles.button, styles.secondary, styles.sideButton]}
        >
          <Text style={styles.secondaryText}>Create a vault</Text>
        </Pressable>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open multisig inbox"
        onPress={() => setInboxOpen(true)}
        style={[styles.button, styles.secondary, styles.sideButton]}
      >
        <Text style={styles.secondaryText}>Inbox</Text>
      </Pressable>

      {error || mwaReport !== null ? (
        <View style={styles.errorBox}>
          {error !== null ? <Text style={styles.errorText}>{error}</Text> : null}
          {mwaReport !== null ? (
            <>
              <Text style={styles.diagnosticsTitle}>MWA diagnostics</Text>
              <Text style={styles.diagnosticsText}>Step: {mwaReport.step}</Text>
              <Text style={styles.diagnosticsText}>
                Protocol code: {mwaReport.code ?? 'none returned'}
              </Text>
              <Text style={styles.diagnosticsText}>
                Error type: {mwaReport.name ?? 'not an Error instance'}
              </Text>
              <Text style={styles.diagnosticsText}>Message: {mwaReport.message}</Text>
              {mwaReport.data !== null ? (
                <Text style={styles.diagnosticsText}>Data: {mwaReport.data}</Text>
              ) : null}
              <Text style={styles.diagnosticsText}>{mwaReport.hint}</Text>
            </>
          ) : null}
          {!account ? (
            <Pressable accessibilityRole="button" onPress={onConnect} style={styles.retry}>
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {__DEV__ ? (
        <View style={styles.previewBlock}>
          <Text style={styles.previewHeading}>Development only</Text>
          <Text style={styles.previewHint}>
            Local fixture — not on-chain data
          </Text>
          {PREVIEW_CASES.map((entry) => (
            <Pressable
              key={entry.key}
              accessibilityRole="button"
              onPress={() => setPreviewCase(entry.key)}
              style={styles.previewButton}
            >
              <Text style={styles.previewButtonText}>
                Preview confirmation screen ({entry.label})
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  // Conteneur du KeyboardAvoidingView : occupe tout l'espace disponible.
  keyboardAvoider: {
    flex: 1,
    width: '100%',
  },
  // Le ScrollView remplit ce conteneur ; le centrage reste assure par container.
  scrollView: {
    flex: 1,
    width: '100%',
  },
  container: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
    // Assez d'espace sous le contenu pour que le bouton "Load multisig" et le
    // bouton "Clear" restent atteignables quand le clavier est ouvert.
    paddingBottom: 96,
  },
  inboxHeading: {
    color: '#111827',
    fontSize: 18,
    fontWeight: '800',
    marginTop: 12,
  },
  inboxCount: {
    color: '#6b7280',
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 8,
  },
  decisionCard: {
    alignSelf: 'stretch',
    backgroundColor: '#f9fafb',
    borderColor: '#e5e7eb',
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 8,
    padding: 14,
  },
  decisionAction: {
    color: '#111827',
    fontSize: 17,
    fontWeight: '800',
  },
  decisionMeta: {
    color: '#4b5563',
    fontSize: 13,
    marginTop: 2,
  },
  decisionState: {
    color: '#065f46',
    fontSize: 13,
    fontWeight: '700',
    marginTop: 6,
  },
  detailsToggle: {
    alignItems: 'center',
    borderColor: '#d1d5db',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 16,
    minHeight: 48,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  detailsToggleText: {
    color: '#374151',
    fontSize: 13,
    fontWeight: '700',
  },
  detailsBody: {
    borderColor: '#e5e7eb',
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 8,
    padding: 12,
  },
  proposalRow: {
    alignSelf: 'stretch',
    backgroundColor: '#f9fafb',
    borderColor: '#e5e7eb',
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  proposalAction: {
    color: '#1a56db',
    fontSize: 12,
    fontWeight: '700',
    marginTop: 4,
  },
  previewBlock: {
    alignSelf: 'stretch',
    borderColor: '#e5e7eb',
    borderRadius: 10,
    borderStyle: 'dashed',
    borderWidth: 1,
    marginTop: 32,
    padding: 14,
  },
  previewHeading: {
    color: '#6b7280',
    fontSize: 11,
    textAlign: 'center',
    textTransform: 'uppercase',
  },
  previewHint: {
    color: '#9ca3af',
    fontSize: 11,
    marginBottom: 10,
    marginTop: 2,
    textAlign: 'center',
  },
  previewButton: {
    alignItems: 'center',
    backgroundColor: '#f3f4f6',
    borderRadius: 8,
    marginTop: 6,
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  previewButtonText: {
    color: '#374151',
    fontSize: 13,
    fontWeight: '600',
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
    marginBottom: 24,
  },
  card: {
    alignItems: 'center',
    borderColor: '#e5e7eb',
    borderRadius: 12,
    borderWidth: 1,
    padding: 20,
    width: '100%',
  },
  label: {
    color: '#6b7280',
    fontSize: 12,
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  walletLabel: {
    fontSize: 14,
    marginBottom: 8,
  },
  address: {
    fontFamily: 'monospace',
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 16,
  },
  fullAddress: {
    color: '#6b7280',
    fontFamily: 'monospace',
    fontSize: 11,
    marginBottom: 12,
    textAlign: 'center',
  },
  button: {
    alignItems: 'center',
    backgroundColor: '#1a56db',
    borderRadius: 10,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: 24,
    width: '100%',
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  secondary: {
    backgroundColor: '#f3f4f6',
  },
  // Entrees laterales : assistant de creation de vault et inbox locale.
  sideButton: {
    alignSelf: 'stretch',
    marginTop: 28,
  },
  secondaryText: {
    color: '#101317',
    fontSize: 16,
    fontWeight: '600',
  },
  disabled: {
    opacity: 0.5,
  },
  hint: {
    color: '#6b7280',
    fontSize: 13,
    marginTop: 12,
  },
  rpcBox: {
    alignItems: 'center',
    marginTop: 28,
  },
  rpcLine: {
    color: '#6b7280',
    fontSize: 13,
    marginTop: 2,
  },
  rpcValue: {
    fontWeight: '700',
  },
  rpcOnline: {
    color: '#047857',
  },
  rpcOffline: {
    color: '#b91c1c',
  },
  rpcDetail: {
    color: '#b91c1c',
    fontSize: 12,
    marginTop: 6,
    textAlign: 'center',
  },
  msigBlock: {
    alignSelf: 'stretch',
    marginTop: 28,
  },
  msigHeading: {
    color: '#6b7280',
    fontSize: 12,
    marginBottom: 8,
    textAlign: 'center',
    textTransform: 'uppercase',
  },
  input: {
    borderColor: '#d1d5db',
    borderRadius: 10,
    borderWidth: 1,
    color: '#101317',
    fontSize: 13,
    marginBottom: 12,
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  msigResult: {
    backgroundColor: '#f9fafb',
    borderColor: '#e5e7eb',
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 16,
    padding: 14,
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
  memberLine: {
    color: '#101317',
    fontFamily: 'monospace',
    fontSize: 11,
    marginTop: 4,
  },
  errorBox: {
    backgroundColor: '#fef2f2',
    borderColor: '#fecaca',
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 20,
    padding: 14,
    width: '100%',
  },
  errorText: {
    color: '#991b1b',
    fontSize: 14,
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
  // Diagnostics MWA : valeurs exactes, jamais reformulées.
  diagnosticsTitle: {
    color: '#991b1b',
    fontSize: 13,
    fontWeight: '800',
    marginTop: 8,
  },
  balanceValue: {
    color: '#101317',
    fontSize: 30,
    fontWeight: '800',
    marginTop: 4,
  },
  balanceNote: {
    color: '#7c2d12',
    fontSize: 15,
    fontWeight: '700',
    marginTop: 4,
  },
  diagnosticsText: {
    color: '#7f1d1d',
    fontSize: 12,
    marginTop: 4,
  },
  statusBarSpacer: {
    backgroundColor: '#ffffff',
    height: SAFE_TOP_PADDING.paddingTop,
  },
});