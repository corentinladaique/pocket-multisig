import { useCallback, useEffect, useRef, useState } from 'react';
import { SAFE_TOP_PADDING } from '../ui/safeAreaPadding';
import {
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
import { computeProposalDecision, summarizeOperation, loadProposalReview,
  useProposals,
  type ProposalReviewResult, } from '../squads/proposals';
import { TransactionReviewScreen } from './TransactionReviewScreen';
import { CreateVaultScreen } from './CreateVaultScreen';
import { MultisigDetailsScreen } from './MultisigDetailsScreen';
import { MultisigInboxScreen } from './MultisigInboxScreen';
import { OnboardingScreen } from './OnboardingScreen';
import { ReceiveScreen } from './ReceiveScreen';
import { AddressInput } from '../ui/AddressInput';
import { useOnboarding } from '../onboarding/useOnboarding';
import { useMultisigRegistry } from '../vault/useMultisigRegistry';
import { describeVaultBalance, type BalanceStatus } from '../wallet/vaultBalance';
import { ProposalDetailsScreen } from './ProposalDetailsScreen';
import { buildReviewPreviews } from '../solana/decodeTransactionMessage';
import type { DecodeStatus } from '../types/transactionReview';
import { COPIED_MESSAGE, COPY_FAILED_MESSAGE, copyToClipboard } from '../ui/clipboard';
import { colors, radii, spacing, typography } from '../ui/theme';
import {
  Card,
  DevnetPill,
  InfoBox,
  InfoText,
  ListRow,
  PillButton,
} from '../ui/v2/primitives';

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

/** Tuile d'action principale du Home V2 (Receive / Propose / Signers). Présentation seule. */
function HomeAction({
  accessibilityLabel,
  glyph,
  label,
  onPress,
}: {
  accessibilityLabel?: string;
  glyph: string;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={onPress}
      style={({ pressed }) => [styles.actionTile, pressed && styles.actionTilePressed]}
    >
      <Text style={styles.actionGlyph}>{glyph}</Text>
      <Text style={styles.actionLabel}>{label}</Text>
    </Pressable>
  );
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
  const [detailsOpen, setDetailsOpen] = useState(false);
  // Section « More » (actions de gestion) : repliée par défaut, ouverte si aucun vault.
  const [moreOpen, setMoreOpen] = useState(false);
  // Vue Receive SOL (Groupe 1) : informative, lecture seule.
  const [receiveOpen, setReceiveOpen] = useState(false);
  // Loader manuel d'un multisig existant : replié par défaut (secondaire).
  const [addMultisigOpen, setAddMultisigOpen] = useState(false);
  // Retour de copie de l'adresse du wallet.
  const [walletCopyFeedback, setWalletCopyFeedback] = useState<string | null>(null);
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

  // Modele deja en memoire pour un index donne : seule la proposition
  // prioritaires prechargee fournit un modele. Aucun appel reseau ici.
  const decodedModelFor = (index: number): TransactionReviewModel | null => {
    if (inboxDecoded !== null && inboxDecoded.model.proposalIndex === index) return inboxDecoded.model;
    return null;
  };
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

  /**
   * Copie de l'adresse du wallet connecté. Réutilise le mécanisme presse-papiers
   * existant (module Clipboard du coeur RN, cf. src/ui/clipboard.ts). Aucun
   * wallet, aucun RPC : simple écriture locale avec retour utilisateur.
   */
  const onCopyWallet = useCallback(() => {
    if (account === undefined) return;
    setWalletCopyFeedback(
      copyToClipboard(account.address.toString()) ? COPIED_MESSAGE : COPY_FAILED_MESSAGE,
    );
  }, [account]);

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
  // La section « More » s'ouvre d'office tant qu'aucun vault n'est chargé :
  // Create a vault / Add existing multisig restent découvrables dans l'état vide.
  const manageExpanded = view === null || moreOpen;

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

  // Receive SOL (Groupe 1) : vue informative. N'ouvre aucun wallet, ne prépare
  // aucune transaction, ne fait aucun RPC. L'adresse vient de msig.view
  // (Main vault PDA index 0, déjà dérivée) — jamais d'une valeur inventée.
  if (receiveOpen) {
    return <ReceiveScreen address={viewVaultAddress} onBack={() => setReceiveOpen(false)} />;
  }

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

  // Assistant local de creation de vault : ecran dedie. Apres un succes verifie
  // on sort vers l'inbox ou directement sur le vault cree.
  if (vaultCreationOpen) {
    return (
      <CreateVaultScreen
        onCancel={() => setVaultCreationOpen(false)}
        onGoToInbox={() => {
          setVaultCreationOpen(false);
          setInboxOpen(true);
        }}
        onOpenVault={(vault) => {
          setVaultCreationOpen(false);
          setOpenEntry({
            address: vault.address,
            addedAt: new Date().toISOString(),
            memberLabels: {},
            source: 'created',
            vaultName: vault.vaultName,
          });
        }}
      />
    );
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
      <View style={styles.headerRow}>
        <View style={styles.logoTile}>
          <Text style={styles.logoGlyph}>◈</Text>
        </View>
        <DevnetPill />
      </View>

      {account === undefined ? (
        <>
          <Text style={styles.heroTitle}>Pocket Multisig</Text>
          <Text style={styles.heroTagline}>
            Shared vaults on Solana.{'\n'}Everyone signs, nobody trusts alone.
          </Text>

          <View style={styles.valueList}>
            <ListRow glyph="◈" title="Create a shared vault" subtitle="2 or more signers" />
            <ListRow
              glyph="✓"
              title="Propose, approve, execute"
              subtitle="Each step signed in your wallet"
            />
            <ListRow
              glyph="❖"
              title="Keys stay in your wallet"
              subtitle="Seed Vault, Solflare, Ledger"
            />
          </View>

          <PillButton
            accessibilityLabel="Connect wallet"
            busy={phase === 'connecting'}
            disabled={busy}
            label="Connect wallet"
            onPress={onConnect}
          />
          <Text style={styles.footerNote}>Devnet · nothing real is at stake</Text>
          {phase === 'connecting' ? (
            <Text style={styles.footerNote}>Opening the wallet…</Text>
          ) : null}
          {error !== null ? (
            <InfoBox glyph="⚠" style={styles.errorBoxV2} tone="error">
              <InfoText tone="error">{error}</InfoText>
            </InfoBox>
          ) : null}
          {error !== null || (__DEV__ && mwaReport !== null) ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Retry connecting the wallet"
              onPress={onConnect}
              style={styles.retry}
            >
              <Text style={styles.retryTextV2}>Retry</Text>
            </Pressable>
          ) : null}
          {__DEV__ && mwaReport !== null ? (
            <View style={styles.devBlock}>
              <Text style={styles.devText}>MWA diagnostics</Text>
              <Text style={styles.devText}>Step: {mwaReport.step}</Text>
              <Text style={styles.devText}>
                Protocol code: {mwaReport.code ?? 'none returned'}
              </Text>
              <Text style={styles.devText}>
                Error type: {mwaReport.name ?? 'not an Error instance'}
              </Text>
              <Text style={styles.devText}>Message: {mwaReport.message}</Text>
              {mwaReport.data !== null ? (
                <Text style={styles.devText}>Data: {mwaReport.data}</Text>
              ) : null}
              <Text style={styles.devText}>{mwaReport.hint}</Text>
            </View>
          ) : null}
        </>
      ) : null}

      {/* Apprentissage : visible SANS wallet (écran déconnecté). Une fois
          connecté, l'accès Learn vit dans la section « More » du Home. */}
      {account === undefined ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Learn how multisig works"
          onPress={onboarding.open}
          style={({ pressed }) => [styles.learnSurface, pressed && styles.learnSurfacePressed]}
        >
          <Text style={styles.learnSurfaceText}>Learn how multisig works</Text>
        </Pressable>
      ) : null}

      {/* Diagnostics réseau : DEV uniquement. En release, aucun niveau RPC au
          premier niveau des écrans V2. */}
      {__DEV__ ? (
        <View style={styles.devBlock}>
          <Text style={styles.devText}>
            Network: Devnet · RPC: {rpcStatus}
          </Text>
          {rpcDetail !== null ? <Text style={styles.devText}>{rpcDetail}</Text> : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Retry the RPC health check"
            onPress={retryRpc}
            style={styles.retry}
          >
            <Text style={styles.retryTextV2}>Retry</Text>
          </Pressable>
        </View>
      ) : null}

      {account === undefined ? null : (
        <View onLayout={onMultisigBlockLayout} style={styles.homeBody}>
          {/* ÉTAT SANS MULTISIG : message clair, aucune action indisponible. */}
          {view === null ? (
            <Card elevated style={styles.vaultCard}>
              <Text style={styles.vaultName}>No multisig loaded</Text>
              <Text style={styles.vaultCopy}>
                Add an existing multisig, or create a vault, to see its balance and actions.
              </Text>
            </Card>
          ) : (
            <Card elevated style={styles.vaultCard}>
              <View style={styles.vaultCardTop}>
                <Text style={styles.vaultName}>{homeVaultName ?? 'Main vault'}</Text>
                <View style={styles.memberBadge}>
                  <Text style={styles.memberBadgeText}>
                    {`MULTISIG · ${view.threshold} OF ${view.members.length}`}
                  </Text>
                </View>
              </View>
              <Text selectable style={styles.balanceValue}>
                {homeBalanceView.sol !== null ? `${homeBalanceView.sol} SOL` : '0 SOL'}
              </Text>
              {homeBalanceView.title === 'Main vault not funded' ? (
                <Text style={styles.balanceNote}>Main vault not funded</Text>
              ) : null}
              {homeBalanceView.title === 'Balance unavailable' ? (
                <Text style={styles.balanceNote}>Balance unavailable</Text>
              ) : null}
              {homeBalanceView.hint.length > 0 ? (
                <Text style={styles.vaultCopySmall}>{homeBalanceView.hint}</Text>
              ) : null}
              {homeBalanceView.stale ? (
                <Text style={styles.vaultCopySmall}>stale</Text>
              ) : null}
              <Text style={styles.vaultCopySmall}>
                {homeIsMember ? 'My multisig' : 'Observed multisig · Read only'}
              </Text>
              <View style={styles.vaultAddressRow}>
                <Text selectable style={styles.vaultAddressText}>
                  {shortenAddress(view.vaultAddress)}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Refresh the Main vault balance"
                  disabled={homeBalance?.status === 'loading'}
                  onPress={() => {
                    refreshHomeBalance(viewVaultAddress ?? '');
                  }}
                  style={({ pressed }) => [
                    styles.inlineAction,
                    pressed && styles.inlineActionPressed,
                  ]}
                >
                  <Text style={styles.inlineActionText}>
                    {homeBalance?.status === 'loading'
                      ? 'Loading…'
                      : homeBalanceError
                        ? 'Retry'
                        : 'Refresh'}
                  </Text>
                </Pressable>
              </View>
            </Card>
          )}

          {/* ACTIONS PRINCIPALES — uniquement quand un vault est chargé. */}
          {view === null ? null : (
            <View style={styles.actionRow}>
              <HomeAction glyph="↓" label="Receive" onPress={() => setReceiveOpen(true)} />
              <HomeAction glyph="↗" label="Propose" onPress={() => setManualDetailsOpen(true)} />
              <HomeAction
                accessibilityLabel="Open this multisig in the shared detail screen"
                glyph="◎"
                label="Signers"
                onPress={() => setManualDetailsOpen(true)}
              />
            </View>
          )}

          {/* TO DO — propositions réellement actionnables, compactes, max 3. */}
          {view === null ? null : (
            <>
              <View style={styles.sectionRow}>
                <Text style={styles.sectionTitle}>To do</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Refresh proposals from the chain"
                  disabled={proposals.status === 'loading'}
                  onPress={proposals.retry}
                  style={({ pressed }) => [
                    styles.inlineAction,
                    pressed && styles.inlineActionPressed,
                  ]}
                >
                  <Text style={styles.inlineActionText}>
                    {proposals.status === 'loading' ? 'Refreshing…' : 'Refresh'}
                  </Text>
                </Pressable>
              </View>
              {proposals.status === 'loading' ? (
                <Text style={styles.vaultCopySmall}>Reading…</Text>
              ) : null}
              {inboxDecisions.length === 0 && proposals.status === 'loaded' ? (
                <Text style={styles.emptyNote}>Nothing waiting</Text>
              ) : null}
              {inboxDecisions.slice(0, 3).map((decision) => {
                const model = decodedModelFor(decision.index);
                const summary = summarizeOperation(model);
                return (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Open proposal ${decision.index} in the shared detail screen`}
                    key={decision.index}
                    onPress={() => {
                      setOpenDecisionIndex(decision.index);
                    }}
                    style={({ pressed }) => [styles.todoRow, pressed && styles.todoRowPressed]}
                  >
                    <Text style={styles.todoIndex}>{`#${decision.index}`}</Text>
                    <View style={styles.todoBody}>
                      <Text style={styles.todoTitle}>
                        {summary === null ? 'Proposal' : summary.action}
                      </Text>
                      <Text style={styles.todoMeta}>
                        {summary === null
                          ? inboxDecodeError !== null
                            ? 'Operation details unavailable'
                            : inboxDecoding
                              ? 'Loading operation…'
                              : `${decision.stateLabel} · ${decision.approvals} of ${decision.threshold} approvals`
                          : `${summary.amount} · ${decision.stateLabel} · ${decision.approvals} of ${decision.threshold} approvals`}
                      </Text>
                    </View>
                    <Text style={styles.todoChevron}>›</Text>
                  </Pressable>
                );
              })}
              {proposals.status === 'error' && proposals.error ? (
                <InfoBox glyph="⚠" style={styles.errorBoxV2} tone="error">
                  <InfoText tone="error">{proposals.error}</InfoText>
                </InfoBox>
              ) : null}
            </>
          )}

          {/* YOUR WALLET — ligne compacte. */}
          <Text style={styles.sectionTitle}>Your wallet</Text>
          <View style={styles.walletRow}>
            <View style={styles.walletRowBody}>
              <Text style={styles.walletLabel}>
                {walletIdentity?.label ?? 'Wallet without label'}
              </Text>
              <Text style={styles.walletAddress}>{shortenAddress(account.address.toString())}</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Copy the wallet address"
              onPress={onCopyWallet}
              style={({ pressed }) => [styles.inlineAction, pressed && styles.inlineActionPressed]}
            >
              <Text style={styles.inlineActionText}>Copy</Text>
            </Pressable>
          </View>
          {walletCopyFeedback !== null ? (
            <Text style={styles.copyFeedback}>{walletCopyFeedback}</Text>
          ) : null}

          {/* MORE — gestion repliée ; ouverte d'office si AUCUN vault chargé
              (Create a vault et Add existing multisig restent découvrables). */}
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: manageExpanded }}
            accessibilityLabel="Toggle more actions"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            onPress={() => setMoreOpen((previous) => !previous)}
            style={styles.detailsToggle}
          >
            <Text style={styles.detailsToggleText}>{manageExpanded ? '▾ More' : '▸ More'}</Text>
          </Pressable>
          {manageExpanded ? (
            <View style={styles.manageBody}>
              <PillButton
                accessibilityLabel="Add an existing multisig"
                disabled={msig.status === 'loading'}
                label="Add existing multisig"
                onPress={() => setAddMultisigOpen((previous) => !previous)}
                variant="secondary"
              />
              {addMultisigOpen ? (
                <View style={styles.loaderBlock}>
                  <AddressInput
                    disabled={msig.status === 'loading'}
                    inputRef={multisigInputRef}
                    label="Multisig address"
                    onBlur={onMultisigInputBlur}
                    onChangeText={setMultisigInput}
                    onFocus={onMultisigInputFocus}
                    placeholder="Multisig address"
                    value={multisigInput}
                  />
                  <PillButton
                    accessibilityLabel="Load multisig"
                    busy={msig.status === 'loading'}
                    disabled={msig.status === 'loading'}
                    label="Load multisig"
                    onPress={() => msig.load(multisigInput)}
                    variant="primary"
                  />
                  {msig.status === 'loading' ? (
                    <Text style={styles.vaultCopySmall}>Lecture…</Text>
                  ) : null}
                  {msig.status === 'error' && msig.error ? (
                    <InfoBox glyph="⚠" style={styles.errorBoxV2} tone="error">
                      <InfoText tone="error">{msig.error}</InfoText>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Retry loading the multisig"
                        onPress={msig.retry}
                        style={styles.retry}
                      >
                        <Text style={styles.retryTextV2}>Retry</Text>
                      </Pressable>
                    </InfoBox>
                  ) : null}
                  {view !== null ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Clear the loaded multisig"
                      onPress={() => {
                        setMultisigInput('');
                        msig.clear();
                      }}
                      style={styles.retry}
                    >
                      <Text style={styles.retryTextV2}>Clear</Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : null}
              <PillButton
                accessibilityLabel="Create a vault"
                label="Create a vault"
                onPress={() => setVaultCreationOpen(true)}
                variant="secondary"
              />
              <PillButton
                accessibilityLabel="Open multisig inbox"
                label="Inbox"
                onPress={() => setInboxOpen(true)}
                variant="secondary"
              />
              <PillButton
                accessibilityLabel="Open the multisig learning guide"
                label="Learn"
                onPress={onboarding.open}
                variant="secondary"
              />
              <PillButton
                accessibilityLabel="Disconnect the wallet"
                busy={phase === 'disconnecting'}
                disabled={busy}
                label="Disconnect"
                onPress={onDisconnect}
                variant="ghost"
              />
              <PillButton
                accessibilityLabel="Reset the mobile wallet adapter session"
                disabled={busy}
                label="Reset wallet session"
                onPress={() => {
                  void onResetWalletSession();
                }}
                variant="ghost"
              />
              <Text style={styles.vaultCopySmall}>
                Clears the local authorization and revokes the session on the wallet when possible.
                Nothing is signed and no transaction is sent.
              </Text>
              {resetReport !== null ? (
                <Text style={styles.vaultCopySmall}>{resetReport}</Text>
              ) : null}
              {onboarding.storageFailed ? (
                <Text style={styles.vaultCopySmall}>
                  Your answers could not be saved on this device: the app keeps working with the
                  default learning mode, and nothing is sent anywhere.
                </Text>
              ) : null}
            </View>
          ) : null}

          {/* DETAILS TECHNIQUES — repliés, hors du premier niveau. */}
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: detailsOpen }}
            accessibilityLabel="Toggle technical details"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            onPress={() => setDetailsOpen((previous) => !previous)}
            style={styles.detailsToggle}
          >
            <Text style={styles.detailsToggleText}>
              {detailsOpen ? '▾ Technical details' : '▸ Technical details'}
            </Text>
          </Pressable>
          {detailsOpen && view !== null ? (
            <View style={styles.detailsBody}>
              <Text style={styles.fieldLabel}>Multisig configuration address</Text>
              <Text selectable style={styles.fieldValue}>
                {view.address}
              </Text>
              <Text style={styles.fieldLabel}>Vault address (index 0)</Text>
              <Text selectable style={styles.fieldValue}>
                {view.vaultAddress}
              </Text>
              <Text style={styles.fieldLabel}>Threshold</Text>
              <Text style={styles.fieldValue}>
                {view.threshold} / {view.members.length}
              </Text>
              <Text style={styles.fieldLabel}>Members ({view.members.length})</Text>
              {view.members.map((member) => (
                <Text key={member.address} selectable style={styles.memberLine}>
                  {member.address}
                  {member.roles.length > 0 ? `  ·  ${member.roles.join(' + ')}` : ''}
                </Text>
              ))}
              <Text style={styles.fieldLabel}>Waiting for your vote</Text>
              <Text style={styles.fieldValue}>
                {homeNeedsVote} proposal(s) · {homeReadyToExecute} ready to execute
              </Text>
              <Text style={styles.fieldLabel}>Network</Text>
              <Text style={styles.fieldValue}>Devnet</Text>
              <Text style={styles.fieldValue}>RPC: {rpcStatus}</Text>
              {!homeIsMember ? (
                <Text style={styles.hint}>
                  This is public on-chain information. Your connected wallet has no permissions in
                  this multisig.
                </Text>
              ) : null}
            </View>
          ) : null}
        </View>
      )}

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
    backgroundColor: colors.background,
    flex: 1,
    width: '100%',
  },
  // Le ScrollView remplit ce conteneur ; le centrage reste assure par container.
  scrollView: {
    backgroundColor: colors.background,
    flex: 1,
    width: '100%',
  },
  container: {
    alignItems: 'stretch',
    backgroundColor: colors.background,
    flexGrow: 1,
    justifyContent: 'flex-start',
    padding: spacing.lg,
    paddingBottom: spacing.xxl * 2,
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
    borderColor: colors.divider,
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
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '700',
  },
  detailsBody: {
    borderColor: colors.divider,
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
    color: colors.text,
    fontSize: typography.body,
    fontWeight: '700',
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
    borderColor: '#cbd5e1',
    borderWidth: 1,
  },
  // Etat appuye : retroaction visuelle distincte de l'etat disabled (opacite).
  secondaryPressed: {
    backgroundColor: '#e5e7eb',
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
    color: colors.textMuted,
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
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 12,
    textTransform: 'uppercase',
  },
  fieldValue: {
    color: colors.text,
    fontFamily: 'monospace',
    fontSize: 12,
    marginTop: 2,
  },
  memberLine: {
    color: colors.textSecondary,
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
    color: colors.text,
    fontSize: 40,
    fontWeight: '800',
    marginTop: 4,
  },
  balanceNote: {
    color: colors.warning,
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
  // Surface unique d'apprentissage : un seul contenant cliquable, style
  // secondaire explicite (bordure + libelle bleu), pas d'imbrication.
  learnSurface: {
    alignItems: 'center',
    alignSelf: 'stretch',
    backgroundColor: colors.surfaceElevated,
    borderColor: colors.divider,
    borderRadius: radii.button,
    borderWidth: 1,
    justifyContent: 'center',
    marginTop: 16,
    minHeight: 52,
    paddingHorizontal: 24,
  },
  learnSurfacePressed: {
    backgroundColor: colors.surface,
  },
  learnSurfaceText: {
    color: colors.mint,
    fontSize: 16,
    fontWeight: '600',
  },

  // --- UI V2 « Seeker style » ------------------------------------------------
  headerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.lg,
  },
  logoTile: {
    alignItems: 'center',
    backgroundColor: colors.mint,
    borderRadius: radii.field,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  logoGlyph: {
    color: colors.petrolDeep,
    fontSize: 22,
  },
  heroTitle: {
    color: colors.text,
    fontSize: typography.screenTitle,
    fontWeight: '800',
    marginTop: spacing.sm,
  },
  heroTagline: {
    color: colors.textSecondary,
    fontSize: typography.body,
    lineHeight: 22,
    marginTop: spacing.sm,
  },
  valueList: {
    marginTop: spacing.xl,
  },
  footerNote: {
    color: colors.textMuted,
    fontSize: typography.caption,
    marginTop: spacing.md,
    textAlign: 'center',
  },
  errorBoxV2: {
    marginTop: spacing.lg,
  },
  retryTextV2: {
    color: colors.mint,
    fontSize: typography.bodySmall,
    fontWeight: '700',
  },
  devBlock: {
    borderColor: colors.divider,
    borderRadius: radii.field,
    borderStyle: 'dashed',
    borderWidth: 1,
    marginTop: spacing.lg,
    padding: spacing.md,
  },
  devText: {
    color: colors.textMuted,
    fontSize: typography.micro,
    marginTop: 2,
  },
  homeBody: {
    alignSelf: 'stretch',
    marginTop: spacing.lg,
  },
  vaultCard: {
    marginTop: spacing.sm,
  },
  vaultCardTop: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  vaultName: {
    color: colors.text,
    flexShrink: 1,
    fontSize: typography.sectionTitle,
    fontWeight: '800',
    marginRight: spacing.sm,
  },
  memberBadge: {
    backgroundColor: colors.successSoft,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  memberBadgeText: {
    color: colors.success,
    fontSize: typography.micro,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  vaultCopy: {
    color: colors.textSecondary,
    fontSize: typography.bodySmall,
    marginTop: spacing.sm,
  },
  vaultCopySmall: {
    color: colors.textMuted,
    fontSize: typography.secondary,
    marginTop: spacing.sm,
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.lg,
  },
  actionTile: {
    alignItems: 'center',
    backgroundColor: colors.surfaceElevated,
    borderColor: colors.divider,
    borderRadius: radii.card,
    borderWidth: 1,
    flex: 1,
    justifyContent: 'center',
    marginHorizontal: spacing.xs,
    minHeight: 84,
    paddingVertical: spacing.md,
  },
  actionTilePressed: {
    backgroundColor: colors.surface,
  },
  actionGlyph: {
    color: colors.mint,
    fontSize: 22,
  },
  actionLabel: {
    color: colors.text,
    fontSize: typography.secondary,
    fontWeight: '700',
    marginTop: spacing.xs,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: typography.sectionTitle,
    fontWeight: '800',
    marginTop: spacing.xl,
  },
  emptyNote: {
    color: colors.textMuted,
    fontSize: typography.bodySmall,
    marginTop: spacing.md,
  },
  todoCard: {
    marginTop: spacing.md,
    paddingVertical: spacing.sm,
  },
  walletCard: {
    marginTop: spacing.md,
  },
  walletAddress: {
    color: colors.text,
    fontFamily: 'monospace',
    fontSize: typography.body,
    marginBottom: spacing.lg,
    marginTop: spacing.xs,
  },
  copyFeedback: {
    color: colors.success,
    fontSize: typography.secondary,
    marginTop: spacing.sm,
  },
  secondaryStack: {
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  loaderBlock: {
    marginTop: spacing.md,
  },
  manageBody: {
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  vaultAddressRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  vaultAddressText: {
    color: colors.textSecondary,
    flexShrink: 1,
    fontFamily: 'monospace',
    fontSize: typography.bodySmall,
  },
  inlineAction: {
    borderRadius: radii.pill,
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
  sectionRow: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  todoRow: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.divider,
    borderRadius: radii.field,
    borderWidth: 1,
    flexDirection: 'row',
    marginTop: spacing.sm,
    minHeight: 56,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  todoRowPressed: {
    backgroundColor: colors.surfaceElevated,
  },
  todoIndex: {
    color: colors.mint,
    fontFamily: 'monospace',
    fontSize: typography.bodySmall,
    fontWeight: '700',
    marginRight: spacing.md,
  },
  todoBody: {
    flex: 1,
  },
  todoTitle: {
    color: colors.text,
    fontSize: typography.bodySmall,
    fontWeight: '700',
  },
  todoMeta: {
    color: colors.textSecondary,
    fontSize: typography.secondary,
    marginTop: 2,
  },
  todoChevron: {
    color: colors.textMuted,
    fontSize: 22,
    marginLeft: spacing.sm,
  },
  walletRow: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.divider,
    borderRadius: radii.field,
    borderWidth: 1,
    flexDirection: 'row',
    marginTop: spacing.sm,
    minHeight: 56,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  walletRowBody: {
    flex: 1,
  },
});