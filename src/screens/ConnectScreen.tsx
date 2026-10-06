import { useCallback, useEffect, useRef, useState } from 'react';
import { SAFE_TOP_PADDING } from '../ui/safeAreaPadding';
import {
  AppState,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Image,
  Text,
  TextInput,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
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
import { filterProposals } from '../squads/proposalFilters';
import { TransactionReviewScreen } from './TransactionReviewScreen';
import { CreateVaultScreen } from './CreateVaultScreen';
import { MultisigDetailsScreen } from './MultisigDetailsScreen';
import { MultisigInboxScreen } from './MultisigInboxScreen';
import { OnboardingScreen } from './OnboardingScreen';
import { ReceiveScreen } from './ReceiveScreen';
import { ProposalListBody } from './ProposalListScreen';
import { AddressInput } from '../ui/AddressInput';
import { useOnboarding } from '../onboarding/useOnboarding';
import { useMultisigRegistry } from '../vault/useMultisigRegistry';
import { describeVaultBalance, type BalanceStatus } from '../wallet/vaultBalance';
import { Accelerometer } from 'expo-sensors';
import { consumeShake } from '../ui/shake';
import { ProposalDetailsScreen } from './ProposalDetailsScreen';
import { buildReviewPreviews } from '../solana/decodeTransactionMessage';
import type { DecodeStatus } from '../types/transactionReview';
import { COPIED_MESSAGE, COPY_FAILED_MESSAGE, copyToClipboard } from '../ui/clipboard';
import { CardsMark } from '../ui/v2/CardsMark';
import { LaunchSplash } from '../ui/v2/LaunchSplash';
import { colors, radii, spacing, typography } from '../ui/theme';
import {
  Card,
  DevnetPill,
  InfoBox,
  InfoText,
  ListRow,
  PillButton,
} from '../ui/v2/primitives';
import { TabBar, type TabKey } from '../ui/v2/TabBar';

// Marge conservee entre le haut du bloc multisig (label + champ + bouton Load
// multisig) et le haut de la zone visible : uniquement une valeur de confort,
// aucune dimension d'ecran codee en dur.
const MULTISIG_KEYBOARD_MARGIN = 24;

// Largeur MINIMALE du composant pour disposer [champ + Paste] et [Load] cote a
// cote. En dessous, on bascule sur la version compacte sur deux lignes. Le
// constat vient de la largeur REELLE du composant (onLayout) : jamais d'une
// detection de modele d'appareil ni d'une dimension d'ecran codee en dur.
const MULTISIG_LOADER_ROW_MIN_WIDTH = 320;

// Jeux de preview construits localement par le décodeur pur (aucun RPC,
// aucune signature). Voir src/solana/decodeTransactionMessage.ts.
const PREVIEW_CASES = buildReviewPreviews();

type Phase = 'idle' | 'connecting' | 'disconnecting';

function shortenAddress(address: string): string {
  return address.length <= 10 ? address : `${address.slice(0, 4)}…${address.slice(-4)}`;
}

/**
 * Duree MINIMALE d'affichage de l'ecran d'attente du wallet (le calque menthe).
 *
 * Pourquoi : la visibilite du calque depend de `phase === 'connecting'`, et
 * `phase` retombe a `'idle'` des que `connect()` se conclut. A la DEUXIEME
 * tentative (apres une annulation), `connect()` se conclut parfois si vite que
 * React groupe les deux `setPhase` dans un SEUL rendu : le calque n'est alors
 * jamais peint, et l'utilisateur croit qu'il ne revient pas. Une duree plancher
 * garantit qu'il est vu — sans toucher a l'appel `connect()` lui-meme.
 */
const CONNECTING_SPLASH_MIN_MS = 450;

/**
 * Cadre de la marque de l'ecran d'attente (dp). L'asset `brand-splash-cards.png`
 * a son dessin sur environ 54 % de la toile : 480 donne un eventail d'environ
 * 260 dp de large, entierement visible.
 */
const CONNECTING_MARK_DP = 480;

/** Profil X de l'auteur, affiche dans l'onglet Account (aucun appel reseau). */
const X_PROFILE_URL = 'https://x.com/Corentin_Lad';

/**
 * Attend la frame suivante. Sert a garantir qu'un rendu est bien PEINT avant
 * de poursuivre : quand l'invite du wallet prend le focus, Android cesse de
 * redessiner notre app, donc un changement d'etat pas encore peint ne sera
 * jamais vu.
 */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

/**
 * Traduit l'erreur brute remontée par Mobile Wallet Adapter en message lisible.
 * Un refus de l'utilisateur n'est jamais présenté comme une erreur technique
 * (SECURITY.md §6).
 *
 * Ces messages sont RENDUS à l'écran : ils sont donc en ANGLAIS, comme le reste
 * de l'interface. Les commentaires du fichier restent en français (style maison),
 * mais jamais le texte visible.
 */
function toReadableError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  if (/reject|cancel|denied|declin|refus/i.test(raw)) {
    return 'Connection declined in the wallet. No authorization was granted.';
  }
  if (/no wallet|no activity|not found|not installed|unable to (find|open)/i.test(raw)) {
    return 'No Mobile Wallet Adapter wallet was found on this device.';
  }
  return `Connection failed: ${raw}`;
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
  // Jeton d'actualisation EXPLICITE de la liste des propositions. Sans lui,
  // cette liste ne pouvait JAMAIS etre relue (aucun 4e argument) : une
  // proposition executee restait dans To do jusqu'a un demontage. Lecture seule.
  const [proposalsNonce, setProposalsNonce] = useState(0);
  const proposalsRefreshRef = useRef(false);
  const refreshProposalsReadOnly = useCallback(() => {
    // Aucun chevauchement : tant que la lecture precedente n'a pas rendu la
    // main (statut revenue a autre chose que « loading »), on ne relance rien.
    if (proposalsRefreshRef.current) return;
    proposalsRefreshRef.current = true;
    setProposalsNonce((previous) => previous + 1);
  }, []);
  const proposals = useProposals(
    msig.view?.address ?? null,
    msig.view?.transactionIndex ?? 0,
    msig.view?.staleTransactionIndex ?? 0,
    proposalsNonce,
  );
  // La lecture est terminee : le verrou anti-chevauchement est relache.
  useEffect(() => {
    if (proposals.status !== 'loading') proposalsRefreshRef.current = false;
  }, [proposals.status]);
  // Retour au premier plan (le wallet prend puis rend le focus) : relecture
  // LECTURE SEULE de la liste. Aucun wallet, aucune signature, aucun envoi.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') refreshProposalsReadOnly();
    });
    return () => subscription.remove();
  }, [refreshProposalsReadOnly]);
  const [multisigInput, setMultisigInput] = useState('');
  const [previewCase, setPreviewCase] = useState<DecodeStatus | null>(null);
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
  // Rideau de lancement : le splash natif est un drawable STATIQUE, il ne peut
  // rien animer. On le prolonge dès que le bundle est prêt par l'ouverture de
  // l'éventail, puis le rideau s'efface sur l'écran. Vit ici et non dans
  // `App.tsx`, qui est un fichier protege (test « aucun invariant metier
  // modifie », ui-v2-group4).
  const [launching, setLaunching] = useState(true);
  const finishLaunch = useCallback(() => setLaunching(false), []);
  // Position verticale reelle du bloc multisig (label + champ + bouton Load
  // multisig), mesuree dans le repere du contenu scrollable.
  const multisigBlockYRef = useRef<number | null>(null);
  // Le champ est-il actuellement focus ? Le clavier peut s'ouvrir pour une
  // autre raison : on ne remonte l'ecran que si la saisie multisig est active.
  const multisigFocusedRef = useRef(false);

  const onMultisigBlockLayout = useCallback((event: LayoutChangeEvent) => {
    multisigBlockYRef.current = event.nativeEvent.layout.y;
  }, []);

  // Largeur REELLE du bloc « Add existing multisig », mesuree par onLayout : elle
  // decide de la disposition (cote a cote ou compacte) sans jamais detecter le
  // modele d'appareil. Valeur purement locale a la session de rendu.
  const [loaderWidth, setLoaderWidth] = useState(0);
  const onLoaderLayout = useCallback((event: LayoutChangeEvent) => {
    setLoaderWidth(event.nativeEvent.layout.width);
  }, []);
  const loaderWide = loaderWidth >= MULTISIG_LOADER_ROW_MIN_WIDTH;

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

  // Modele deja en memoire pour un index donne : seule la proposition
  // prioritaires prechargee fournit un modele. Aucun appel reseau ici.
  const decodedModelFor = (index: number): TransactionReviewModel | null => {
    if (inboxDecoded !== null && inboxDecoded.model.proposalIndex === index) return inboxDecoded.model;
    return null;
  };
  const [phase, setPhase] = useState<Phase>('idle');
  // Onglet actif de la barre de navigation V2. État LOCAL de rendu : ne
  // persiste rien, ne déclenche aucun RPC, ne sollicite jamais le wallet.
  const [tab, setTab] = useState<TabKey>('vault');
  // L'onglet revient TOUJOURS sur Vault dès qu'un wallet est connecté. Sans ça,
  // se déconnecter depuis Account (seul endroit d'où on peut le faire) y
  // ramenait à la reconnexion, puisque `tab` est un état local qui survit à la
  // déconnexion — alors que la barre d'onglets n'est rendue que connecté.
  // La condition `!== null` évite de faire sauter l'écran pendant la
  // déconnexion elle-même ; la clé est `walletAddress` (une chaîne, stable tant
  // que le wallet ne change pas), et non l'objet `account`.
  useEffect(() => {
    if (walletAddress !== null) {
      setTab('vault');
    }
  }, [walletAddress]);
  const [error, setError] = useState<string | null>(null);
  // Diagnostics MWA : étape, code et message exacts, jamais reformulés.
  const [mwaReport, setMwaReport] = useState<MwaErrorReport | null>(null);
  const [resetReport, setResetReport] = useState<string | null>(null);

  const onConnect = useCallback(async () => {
    setError(null);
    setMwaReport(null);
    setResetReport(null);
    setPhase('connecting');
    // Le calque doit etre PEINT avant que le wallet ne s'ouvre : des que son
    // invite prend le focus, Android cesse de redessiner notre app, et un
    // changement d'etat pas encore peint ne sera JAMAIS vu (les cartes
    // n'apparaissaient qu'une fois sur trois). Deux frames : celle qui peint,
    // puis la suivante, pour etre sur d'etre passe apres.
    await nextFrame();
    await nextFrame();
    const startedAt = Date.now();
    try {
      await connect();
    } catch (caught: unknown) {
      setError(toReadableError(caught));
      setMwaReport(describeMwaError(caught, 'authorize'));
    } finally {
      // Le calque est deja rendu : on lui garantit une duree MINIMALE avant de
      // repasser a `idle`, sinon un `connect()` qui se conclut instantanement le
      // retirerait dans le meme rendu (voir CONNECTING_SPLASH_MIN_MS).
      const remaining = CONNECTING_SPLASH_MIN_MS - (Date.now() - startedAt);
      if (remaining > 0) {
        await new Promise((resolve) => setTimeout(resolve, remaining));
      }
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

  /**
   * Point d'entrée UNIQUE de chargement manuel d'un multisig, partagé par le
   * bouton de chargement ET la touche Entrée du clavier (onSubmitEditing).
   *
   * - réutilise la validation locale existante de `msig.load` (saisie vide ou
   *   invalide → aucun RPC, l'erreur est posée par le hook) ;
   * - réutilise l'état `loading` existant ;
   * - empêche tout appel concurrent : un tap/Entrée pendant le chargement est ignoré ;
   * - n'ajoute aucun RPC, aucun wallet, aucune transaction.
   */
  const onLoadMultisig = useCallback(() => {
    if (msig.status === 'loading') return;
    msig.load(multisigInput);
  }, [msig, multisigInput]);

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
  // La section « More » n'existe QUE quand un vault est chargé (sans vault, la
  // carte d'etat vide porte deja Create a vault / Add existing multisig) : elle
  // ne s'ouvre donc plus d'office.
  const manageExpanded = moreOpen;

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
  // Confidentialite du solde : etat LOCAL de session uniquement (jamais
  // persiste). Masquer n'affecte QUE l'affichage : la valeur reelle reste
  // intacte, aucune incidence sur Max, les propositions ou les calculs.
  const [balanceHidden, setBalanceHidden] = useState(false);
  /**
   * SECOUAGE -> masquage du solde.
   *
   * Le capteur n'est branche QUE tant que le solde est visible : une fois
   * masque, l'abonnement est retire (plus aucune mesure, et le geste n'a plus
   * rien a faire). Conforme a la demande : le secouage ne fait que MASQUER,
   * c'est le bouton « Show balance » qui remontre. L'etat reste local a la
   * session, jamais persiste. Un appareil sans accelerometre n'est pas une
   * erreur : la fonctionnalite est simplement absente.
   */
  const shakeStateRef = useRef({ lastTriggerMs: 0 });
  // Le capteur ne doit etre arme QUE si un vault est charge : sans vault, il n'y
  // a aucun montant a masquer, et pendant le chargement (on manipule l'appareil)
  // une secousse masquait le solde sans que l'utilisateur l'ait demande.
  const hasLoadedVault = msig.view !== null;
  useEffect(() => {
    if (balanceHidden || !hasLoadedVault) return undefined;
    let subscription: { remove: () => void } | null = null;
    try {
      Accelerometer.setUpdateInterval(120);
      subscription = Accelerometer.addListener((sample) => {
        if (consumeShake(shakeStateRef.current, sample, Date.now()).triggered) {
          setBalanceHidden(true);
        }
      });
    } catch {
      return undefined;
    }
    return () => subscription?.remove();
  }, [balanceHidden, hasLoadedVault]);
  /**
   * Le solde doit etre VISIBLE des qu'un multisig est charge : demande explicite
   * de Corentin. Sans ce reset, une secousse detectee pendant la manipulation de
   * l'appareil au chargement masquait le montant a son insu, et il fallait taper
   * « Show balance » pour le revoir.
   */
  const lastLoadedAddressRef = useRef<string | null>(null);
  useEffect(() => {
    const loadedAddress = msig.view?.address ?? null;
    if (loadedAddress !== null && loadedAddress !== lastLoadedAddressRef.current) {
      lastLoadedAddressRef.current = loadedAddress;
      setBalanceHidden(false);
    }
  }, [msig.view]);

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

  /**
   * Tirer vers le bas = relire ce que la page Vault affiche DEJA : le solde
   * on-chain et les propositions. Reutilise les DEUX handlers existants (les
   * memes que les liens « Reload balance » et « Refresh ») : aucune logique
   * nouvelle, aucun appel supplementaire invente.
   *
   * CE HOOK DOIT RESTER AVANT TOUS LES `return` ANTICIPES du composant (Inbox,
   * creation de vault, vue detaillee). Place apres eux, React voyait un nombre
   * de hooks different selon l'ecran et l'application CRASHAIT des l'ouverture
   * de l'Inbox. Regle des Hooks : jamais de hook apres un retour conditionnel.
   */
  const onPullToRefresh = useCallback(() => {
    if (viewVaultAddress) {
      refreshHomeBalance(viewVaultAddress);
    }
    proposals.retry();
  }, [proposals, refreshHomeBalance, viewVaultAddress]);

  // Etat du spinner : derive de l'etat REEL des deux lectures, jamais simule.
  const pullingToRefresh = homeBalance?.status === 'loading' || proposals.status === 'loading';

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

  // Droit d'exécution RÉELLEMENT lu on-chain pour le wallet connecté.
  const homeWalletCanExecute =
    view !== null &&
    walletAddress !== null &&
    view.members.some(
      (member) => member.address === walletAddress && member.roles.includes('Execute'),
    );

  // TO DO — uniquement les actions RÉELLEMENT disponibles pour ce wallet,
  // classées par les fonctions PURES de `proposalFilters` (aucune seconde
  // logique maison) :
  //   Active + wallet peut voter + pas déjà approuvée → « Needs your approval » ;
  //   Approved + wallet peut exécuter                 → « Ready to execute ».
  // Ordre d'affichage : « Ready to execute » d'abord, puis « Needs your approval ».
  const proposalFilterInputs = (proposals.list?.proposals ?? []).map((proposal) => ({
    index: proposal.index,
    status: proposal.status,
    approvals: proposal.approvals,
    threshold: msig.view?.threshold ?? 0,
    approvedAddresses: proposal.approvedAddresses,
    walletAddress,
    walletCanApprove,
    walletCanExecute: homeWalletCanExecute,
  }));
  const todoInputs = filterProposals(proposalFilterInputs, 'todo');
  const inboxDecisions = [
    ...todoInputs.filter((input) => input.status === 'Approved'),
    ...todoInputs.filter((input) => input.status === 'Active'),
  ].map((input) =>
    computeProposalDecision({
      index: input.index,
      status: input.status,
      approvedAddresses: input.approvedAddresses,
      threshold: input.threshold,
      walletAddress,
      walletCanApprove: input.walletCanApprove,
    }),
  );

  // Onglet Proposals : la liste elle-même vient du CORPS partagé
  // (`ProposalListBody`), alimenté par `proposals` — DÉJÀ lu par cet écran. Les
  // filtres et leurs compteurs restent les fonctions PURES de `proposalFilters`,
  // donc aucune divergence possible avec l'écran Vault, et AUCUNE double lecture.
  const priorityIndex = inboxDecisions[0]?.index ?? null;

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
          onBack={() => {
            // Retour depuis le detail : relecture de la liste, sinon une
            // proposition executee resterait affichee dans To do.
            setOpenDecisionIndex(null);
            refreshProposalsReadOnly();
          }}
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

  /**
   * Bloc de chargement manuel d'un multisig, EXTRAIT ici pour n'exister qu'une
   * seule fois dans le fichier : il est rendu soit dans la carte d'etat vide
   * (aucun vault charge), soit dans la section « More » (un vault est deja
   * charge). Aucune logique nouvelle : handlers et etats existants uniquement.
   */
  const multisigLoaderBlock = (
    <View onLayout={onLoaderLayout} style={styles.loaderBlock}>
      <View style={loaderWide ? styles.loaderRow : styles.loaderColumn}>
        <View style={styles.loaderField}>
          <AddressInput
            disabled={msig.status === 'loading'}
            inputRef={multisigInputRef}
            label="Multisig address"
            onBlur={onMultisigInputBlur}
            onChangeText={setMultisigInput}
            onFocus={onMultisigInputFocus}
            onSubmitEditing={onLoadMultisig}
            placeholder="Multisig address"
            returnKeyType="go"
            value={multisigInput}
          />
        </View>
        {loaderWide ? (
          <View style={styles.loaderButtonSlot}>
            <PillButton
              accessibilityLabel="Load multisig"
              busy={msig.status === 'loading'}
              disabled={msig.status === 'loading'}
              label="Load"
              onPress={onLoadMultisig}
              variant="primary"
            />
          </View>
        ) : null}
      </View>
      {loaderWide ? null : (
        <PillButton
          accessibilityLabel="Load multisig"
          busy={msig.status === 'loading'}
          disabled={msig.status === 'loading'}
          label="Load multisig"
          onPress={onLoadMultisig}
          variant="primary"
        />
      )}
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
      {/* « Close this vault » (et non « Clear ») : ce controle ne CHANGE pas de
          multisig, il DECHARGE celui en cours (champ vide + vue liberee) et
          ramene a l'etat vide. Pour changer de vault, le chemin est
          « Add existing multisig » ou l'Inbox, qui liste le registre local. */}
      {view !== null ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close this vault"
          onPress={() => {
            setMultisigInput('');
            msig.clear();
          }}
          style={styles.retry}
        >
          <Text style={styles.retryTextV2}>Close this vault</Text>
        </Pressable>
      ) : null}
    </View>
  );

  // Android : la fenetre n'etant plus redimensionnee par l'IME en edge-to-edge,
  // le KeyboardAvoidingView en mode "padding" est necessaire sur les deux
  // plateformes (aucune hauteur codee en dur).
  return (
    <>
    <KeyboardAvoidingView behavior="padding" style={[styles.keyboardAvoider, SAFE_TOP_PADDING]}>
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        ref={scrollViewRef}
        refreshControl={
          <RefreshControl
            colors={[colors.text]}
            onRefresh={onPullToRefresh}
            progressBackgroundColor={colors.surface}
            refreshing={pullingToRefresh}
            tintColor={colors.textSecondary}
          />
        }
        style={styles.scrollView}
      >
      {/* Le carre menthe « ◈ » est retire : un faux logo dont personne ne
          comprenait le sens. Il ne reste que la pastille reseau, alignee a droite. */}
      <View style={styles.headerRow}>
        {/* Inbox = selecteur GLOBAL de multisig : en haut a gauche, face au badge
            Devnet. Il remplace les DEUX entrees dispersees (carte d'etat vide et
            section « More »), supprimees dans le meme mouvement.
            Visible seulement connecte, comme la barre d'onglets. */}
        {account === undefined ? null : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open multisig inbox"
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            onPress={() => setInboxOpen(true)}
            style={({ pressed }) => [
              styles.inlineAction,
              styles.headerInbox,
              pressed && styles.inlineActionPressed,
            ]}
          >
            <Ionicons color={colors.mint} name="mail-outline" size={22} />
          </Pressable>
        )}
        {/* Wallet : ADRESSE TRONQUEE + bouton copie, AU CENTRE de l'en-tete
            (demande explicite). `flex: 1` + `justifyContent: 'center'` le
            recentrent entre l'enveloppe (a gauche) et le badge Devnet (a
            droite), qui sont des elements de largeur fixe. */}
        {account === undefined ? null : (
          <View style={styles.headerWallet}>
            <Text numberOfLines={1} style={styles.headerWalletAddress}>
              {shortenAddress(account.address.toString())}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Copy the wallet address"
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              onPress={onCopyWallet}
              style={({ pressed }) => [styles.inlineAction, pressed && styles.inlineActionPressed]}
            >
              <Ionicons color={colors.textSecondary} name="copy-outline" size={15} />
            </Pressable>
          </View>
        )}
        <DevnetPill />
      </View>

      {account === undefined ? (
        <>
          {/* Marque animée : même cycle que le SVG de marque (ouverture,
              maintien, fermeture, maintien — 3,6 s). Mode tuile : les cartes
              sont sombres et disparaîtraient sur le fond de l'app. */}
          <CardsMark loop size={132} style={styles.brandMark} tile />
          <Text style={styles.heroTitle}>Multisig</Text>
          <Text style={styles.heroTagline}>
            Shared vaults on Solana.{'\n'}Everyone signs, nobody trusts alone.
          </Text>

          <View style={styles.valueList}>
            {/* Vraies icônes : le carré « ◈ », le « ✓ » et le « ❖ » d'avant ne
                voulaient rien dire. Le coffre reprend la marque de l'app. */}
            <ListRow
              glyphNode={<MaterialCommunityIcons color={colors.mint} name="safe" size={22} />}
              title="Create a shared vault"
              subtitle="2 or more signers"
            />
            <ListRow
              glyphNode={
                <Ionicons color={colors.mint} name="checkmark-done-outline" size={22} />
              }
              title="Propose, approve, execute"
              subtitle="Each step signed in your wallet"
            />
            <ListRow
              glyphNode={<Ionicons color={colors.mint} name="lock-closed-outline" size={22} />}
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
          {/* Note Devnet : REMISE a cote du bouton Connect. C'est un avertissement
              sur l'ACTION de connexion — donc il vit la ou l'action se fait, a
              cote de ce qui peut paraitre risque. */}
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

      {/* Onglet Vault : le contenu du Home V2, strictement INCHANGÉ. */}
      {account === undefined || tab !== 'vault' ? null : (
        <View
          onLayout={onMultisigBlockLayout}
          style={view === null && !addMultisigOpen ? styles.homeBodyEmpty : styles.homeBody}
        >
          {/* ÉTAT SANS MULTISIG : la carte porte les DEUX seules actions utiles,
              avec `Create a vault` en principal. Auparavant, six boutons de poids
              égal se disputaient l'écran ; les actions de gestion (Learn,
              Disconnect, Reset) vivent désormais dans l'onglet Account, et
              « Your wallet » aussi. */}
          {view === null ? (
            <Card elevated style={styles.vaultCard}>
              <Text style={styles.vaultName}>No multisig loaded</Text>
              <Text style={styles.vaultCopy}>
                Create a vault, or load one you are a signer of, to see its balance and actions.
              </Text>
              <View style={styles.manageBody}>
                <PillButton
                  accessibilityLabel="Create a vault"
                  label="Create a vault"
                  onPress={() => setVaultCreationOpen(true)}
                />
                <PillButton
                  accessibilityLabel="Add an existing multisig"
                  disabled={msig.status === 'loading'}
                  label="Add existing multisig"
                  onPress={() => setAddMultisigOpen((previous) => !previous)}
                  variant="secondary"
                />
              </View>
              {addMultisigOpen ? multisigLoaderBlock : null}
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
              <View style={styles.balanceRow}>
                <Text selectable style={styles.balanceValue}>
                  {balanceHidden
                    ? '•••••• SOL'
                    : homeBalanceView.sol !== null
                      ? `${homeBalanceView.sol} SOL`
                      : '0 SOL'}
                </Text>
                {/* Confidentialite du solde : etat LOCAL de session, aucune
                    persistance, aucune modification de la valeur reelle ni des
                    calculs (Max / propositions). */}
                {/* OEIL au lieu du texte (demande explicite) : plus commun, et ca
                    debarrasse la carte d'un lien texte de plus. L'etiquette
                    INVISIBLE reste : une icone seule ne se lit pas a voix haute. */}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={balanceHidden ? 'Show balance' : 'Hide balance'}
                  accessibilityState={{ selected: balanceHidden }}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  onPress={() => setBalanceHidden((previous) => !previous)}
                  style={({ pressed }) => [styles.inlineAction, pressed && styles.inlineActionPressed]}
                >
                  <Ionicons
                    color={colors.textSecondary}
                    name={balanceHidden ? 'eye-off-outline' : 'eye-outline'}
                    size={20}
                  />
                </Pressable>
              </View>
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
                {/* Le ROLE, pas un nom : « My multisig » se lisait comme un
                    second nom du vault (Claude : « Test3 et My multisig donnent
                    deux noms pour le meme vault »). Le nom est deja au-dessus,
                    en gros. Ici on dit ce que TU es pour ce vault. */}
                {homeIsMember ? 'You are a signer' : 'Observed multisig · Read only'}
              </Text>
              {!homeIsMember ? (
                <Text style={styles.vaultCopySmall}>This is public on-chain information.</Text>
              ) : null}
              <View style={styles.vaultAddressRow}>
                <Text selectable style={styles.vaultAddressText}>
                  {shortenAddress(view.vaultAddress)}
                </Text>
                {/* Plus de lien « Reload balance » au quotidien : la relecture du
                    solde passe par la fleche circulaire de « To do » (et par le
                    geste de traction), qui relisent LES DEUX. Il ne reste ici
                    qu'un « Retry » en cas d'echec de lecture — la seule situation
                    ou une action dediee est reellement utile. */}
                {homeBalanceError ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Retry reading the Main vault balance"
                    disabled={homeBalance?.status === 'loading'}
                    onPress={() => {
                      refreshHomeBalance(viewVaultAddress ?? '');
                    }}
                    style={({ pressed }) => [
                      styles.inlineAction,
                      pressed && styles.inlineActionPressed,
                    ]}
                  >
                    <Text style={styles.inlineActionText}>Retry</Text>
                  </Pressable>
                ) : null}
              </View>
              {/* Objectif B : action secondaire vers l'UNIQUE vue detaillee
                  (MultisigDetailsScreen V2), meme handler que le chemin Inbox.
                  Porte desormais le repere d'accessibilite de la vue detaillee,
                  depuis le retrait de la tuile « Signers ». */}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Open this multisig in the shared detail screen"
                onPress={() => setManualDetailsOpen(true)}
                style={({ pressed }) => [
                  styles.inlineAction,
                  pressed && styles.inlineActionPressed,
                ]}
              >
                <Text style={styles.inlineActionText}>View vault details ›</Text>
              </Pressable>
            </Card>
          )}

          {/* ACTIONS PRINCIPALES — uniquement quand un vault est chargé. */}
          {view === null ? null : (
            <View style={styles.actionRow}>
              <HomeAction glyph="↓" label="Receive" onPress={() => setReceiveOpen(true)} />
              <HomeAction glyph="↗" label="Propose" onPress={() => setManualDetailsOpen(true)} />
              {/* Tuile « Signers » RETIREE (decision produit de Corentin) : elle
                  menait au MEME ecran que « View vault details », qui porte
                  desormais le repere d'accessibilite de la vue detaillee. */}
            </View>
          )}

          {/* TO DO — propositions réellement actionnables, compactes, max 3. */}
          {view === null ? null : (
            <>
              <View style={styles.sectionRow}>
                <Text style={styles.sectionTitle}>To do</Text>
                {/* FLECHE CIRCULAIRE (choix « C ») : elle fait EXACTEMENT ce que
                    fait le geste de traction — solde ET propositions — et
                    remplace les deux liens texte. Le geste reste un raccourci,
                    jamais une obligation : sans lui, l'action reste visible. */}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Refresh balance and proposals"
                  disabled={pullingToRefresh}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  onPress={onPullToRefresh}
                  style={({ pressed }) => [
                    styles.inlineAction,
                    pressed && styles.inlineActionPressed,
                  ]}
                >
                  <Ionicons
                    color={pullingToRefresh ? colors.textSecondary : colors.mint}
                    name="refresh-outline"
                    size={20}
                  />
                </Pressable>
              </View>
              {/* Compteurs derives des propositions deja lues (donnee conservee) :
                  rendus uniquement s'ils sont non nuls, sans identifiant technique. */}
              {homeNeedsVote + homeReadyToExecute > 0 ? (
                <Text style={styles.vaultCopySmall}>
                  {homeNeedsVote} waiting for your vote · {homeReadyToExecute} ready to execute
                </Text>
              ) : null}
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
              {/* Plus de 3 actions : lien vers la liste complete des propositions,
                  via le handler de navigation EXISTANT (Vault Details → Proposals).
                  Aucune nouvelle route n'est creee. */}
              {inboxDecisions.length > 3 ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="View all proposals"
                  onPress={() => setManualDetailsOpen(true)}
                  style={({ pressed }) => [
                    styles.inlineAction,
                    styles.viewAllAction,
                    pressed && styles.inlineActionPressed,
                  ]}
                >
                  <Text style={styles.inlineActionText}>View all proposals</Text>
                </Pressable>
              ) : null}
              {proposals.status === 'error' && proposals.error ? (
                <InfoBox glyph="⚠" style={styles.errorBoxV2} tone="error">
                  <InfoText tone="error">{proposals.error}</InfoText>
                </InfoBox>
              ) : null}
            </>
          )}

          {/* « YOUR WALLET » A ETE RETIRE du Home : le portefeuille n'a rien a
              faire AVANT l'action principale, et l'information vit deja dans
              l'onglet Account (nom, adresse courte, copie). */}

          {/* MORE — gestion repliée, UNIQUEMENT quand un vault est chargé : sans
              vault, la carte d'état vide porte déjà les deux actions utiles.
              Elle ne garde que le chargement d'un AUTRE multisig et l'accès à
              l'Inbox. Learn, Disconnect et Reset wallet session vivent désormais
              dans l'onglet Account. */}
          {view === null ? null : (
            <>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: manageExpanded }}
                accessibilityLabel="Toggle more actions"
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                onPress={() => setMoreOpen((previous) => !previous)}
                style={styles.detailsToggle}
              >
                <Text style={styles.detailsToggleText}>
                  {manageExpanded ? '▾ More' : '▸ More'}
                </Text>
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
                  {addMultisigOpen ? multisigLoaderBlock : null}
                </View>
              ) : null}
            </>
          )}

          {/* Hotfix de coherence : le bloc technique complet du Home est
              SUPPRIME. Les identifiants complets (Main vault, configuration,
              Config authority, Rent collector, Program ID) vivent
              exclusivement dans Vault Details → Advanced details. */}
        </View>
      )}

      {/* Onglets Proposals / Account : rendus À LA PLACE du Home.
          Aucune logique nouvelle — les actions d'Account réutilisent les
          handlers EXISTANTS du Home (copie, déconnexion, guide). */}
      {account === undefined || tab === 'vault' ? null : (
        <View style={styles.homeBody}>
          <Text style={styles.tabTitle}>
            {tab === 'proposals' ? 'Proposals' : 'Account'}
          </Text>

          {tab === 'proposals' ? (
            /* MÊME corps que l'écran Vault : rien n'est relu ici, tout vient de
               `proposals`, déjà lu par cet écran (aucune double lecture). */
            <ProposalListBody
              busy={proposals.status === 'loading'}
              decodedModelFor={decodedModelFor}
              onOpenProposal={(proposal) => setOpenDecisionIndex(proposal.index)}
              proposals={proposals}
              threshold={msig.view?.threshold ?? 0}
              walletAddress={walletAddress}
              walletCanApprove={walletCanApprove}
              walletCanExecute={homeWalletCanExecute}
            />
          ) : null}

          {tab === 'account' ? (
            <>
              {/* Le wallet, en petit : libellé + adresse courte + copie discrète
                  sur la MÊME ligne (handlers existants). */}
              <View style={styles.accountWallet}>
                <View style={styles.walletRowBody}>
                  <Text style={styles.accountWalletLabel}>
                    {walletIdentity?.label ?? 'Wallet without label'}
                  </Text>
                  <Text numberOfLines={1} style={styles.accountWalletAddress}>
                    {shortenAddress(account.address.toString())}
                  </Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Copy the wallet address"
                  onPress={onCopyWallet}
                  style={({ pressed }) => [
                    styles.inlineAction,
                    pressed && styles.inlineActionPressed,
                  ]}
                >
                  <Text style={styles.inlineActionText}>Copy</Text>
                </Pressable>
              </View>
              {walletCopyFeedback !== null ? (
                <Text style={styles.copyFeedback}>{walletCopyFeedback}</Text>
              ) : null}

              <ListRow title="Network" subtitle="Devnet · nothing real is at stake" />
              <ListRow
                accessibilityLabel="Learn how multisig works"
                onPress={onboarding.open}
                subtitle="What a shared vault is, and how approvals work"
                title="Learn how multisig works"
              />
              <ListRow title="About" subtitle="Multisig" />
              <ListRow
                accessibilityLabel="Open the X profile of the app"
                onPress={() => {
                  // Presentation seule : on ouvre le navigateur. Un echec
                  // (aucune app capable d'ouvrir un lien) ne change rien ici.
                  void Linking.openURL(X_PROFILE_URL).catch(() => undefined);
                }}
                subtitle="@Corentin_Lad"
                title="X"
              />
              {onboarding.storageFailed ? (
                <Text style={styles.vaultCopySmall}>
                  Your answers could not be saved on this device: the app keeps working with the
                  default learning mode, and nothing is sent anywhere.
                </Text>
              ) : null}

              {/* Seule action principale de l'onglet : se déconnecter. */}
              <View style={styles.accountActions}>
                <PillButton
                  accessibilityLabel="Disconnect the wallet"
                  busy={phase === 'disconnecting'}
                  disabled={busy}
                  label="Disconnect wallet"
                  onPress={onDisconnect}
                  variant="danger"
                />
              </View>

              {/* Session MWA : action TECHNIQUE, déplacée du Home vers Account. */}
              <View style={styles.accountActions}>
                <PillButton
                  accessibilityLabel="Reset the mobile wallet adapter session"
                  disabled={busy}
                  label="Reset wallet session"
                  onPress={() => {
                    void onResetWalletSession();
                  }}
                  variant="ghost"
                />
              </View>
              <Text style={styles.vaultCopySmall}>
                Clears the local authorization and revokes the session on the wallet when possible.
                Nothing is signed and no transaction is sent.
              </Text>
              {resetReport !== null ? (
                <Text style={styles.vaultCopySmall}>{resetReport}</Text>
              ) : null}
            </>
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
      {/* Barre d'onglets : visible une fois le wallet connecté. Elle ne fait
          que changer l'onglet ACTIF — aucun handler métier n'est appelé ici. */}
      {account === undefined ? null : <TabBar active={tab} onSelect={setTab} />}
    </KeyboardAvoidingView>
    {launching ? <LaunchSplash onDone={finishLaunch} /> : null}
    {/* ECRAN D'ATTENTE DU WALLET — idee de Corentin, et c'est la bonne : quand
        l'invite du wallet prend le focus, Android cesse de redessiner notre app,
        donc l'ecran reste FIGE. On ne peut pas empecher le gel, mais on peut
        CHOISIR ce qui reste a l'ecran : les cartes en eventail, plein ecran, sur
        fond noir. L'utilisateur voit un etat VOULU au lieu d'une animation
        coupee en plein mouvement.
        Monte EN PERMANENCE (invisible hors connexion, `pointerEvents: 'none'`) :
        un bitmap n'est decode qu'a la taille ou il est RENDU, donc le demonter
        entre deux tentatives obligeait a le redecoder, et sur un aller-retour
        (annuler puis reconnecter) l'ouverture du wallet se conclut en quelques
        centaines de ms — plus vite que le decodage. Resultat : l'image manquait
        une fois
        sur deux. Monte en continu, elle est deja peinte quand le calque devient
        visible.
        Rendu EN DERNIER, donc au-dessus de tout le contenu. */}
    <View
      pointerEvents={phase === 'connecting' ? 'auto' : 'none'}
      style={[
        styles.connectingSplash,
        phase === 'connecting' ? null : styles.connectingSplashIdle,
      ]}
    >
      {/* LES CARTES EN EVENTAIL, seules : ni tuile, ni fond d'icone, ni
          habillage d'application. L'asset `brand-splash-cards.png` derive du
          logo (`foregroundImage`) avec la carte AVANT noircie (#102028 ->
          #03080A) ; les cartes teal et les accents mint sont intacts.
          On n'anime RIEN : une marque animee se figeait sur sa toute premiere
          frame des que le panneau du wallet prenait le focus. */}
      <View style={styles.connectingSplashTop}>
        <Image
          accessibilityIgnoresInvertColors
          resizeMode="contain"
          source={require('../../assets/brand-splash-cards.png')}
          style={styles.connectingSplashMark}
        />
      </View>
      {/* Reserve la hauteur de la feuille « Open with Wallet » d'Android :
          sans elle les cartes sont centrees, et la feuille coupe leur bas. */}
      <View style={styles.connectingSplashSheetSpace} />
    </View>
    </>
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
  balanceRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  balanceValue: {
    color: colors.text,
    flex: 1,
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
    justifyContent: 'flex-end',
    marginBottom: spacing.lg,
  },
  // Enveloppe Inbox, en haut a gauche. `marginRight: 'auto'` la pousse a GAUCHE
  // dans la rangee, sans toucher au `justifyContent: 'flex-end'` qui garde le
  // badge Devnet a droite : deux enfants, un a chaque bout, sans nouveau layout.
  headerInbox: {
    marginRight: 'auto',
    paddingVertical: spacing.xs,
  },
  // Wallet de l'en-tete : centre entre l'enveloppe et le badge Devnet.
  headerWallet: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
  },
  headerWalletAddress: {
    color: colors.textSecondary,
    fontFamily: 'monospace',
    fontSize: typography.micro,
  },
  // Ecran d'attente pendant l'ouverture du wallet : plein ecran, fond NOIR
  // (demande explicite), les cartes centrees. C'est CE rendu qui reste fige
  // pendant que l'invite du wallet a le focus (Android ne redessine plus l'app).
  connectingSplash: {
    backgroundColor: '#000000',
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  // Hors connexion : le calque reste monte (pour que son bitmap reste decode a
  // la bonne taille) mais totalement invisible, et il ne capte aucun toucher
  // (`pointerEvents: 'none'` cote JSX).
  connectingSplashIdle: {
    opacity: 0,
  },
  // Les cartes sont centrees dans la partie HAUTE de l'ecran : la feuille
  // « Open with Wallet » d'Android occupe le bas et coupait l'eventail. Le
  // partage est PROPORTIONNEL (60 / 40), donc identique sur tout ecran, et il
  // n'ajoute aucun element hors flux. Pour monter ou descendre les cartes, il
  // suffit de deplacer ce rapport (ex. 65 / 35 les remonte).
  connectingSplashTop: {
    alignItems: 'center',
    flex: 60,
    justifyContent: 'center',
  },
  connectingSplashSheetSpace: {
    flex: 40,
  },
  // Les cartes en eventail, seules : aucun habillage autour.
  connectingSplashMark: {
    height: CONNECTING_MARK_DP,
    width: CONNECTING_MARK_DP,
  },
  // Filtres de l'onglet Proposals : pastilles. L'actif est BLANC a texte sombre,
  // comme la pastille de l'onglet actif de la barre du bas.
  filterRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
    marginTop: spacing.xs,
  },
  filterChip: {
    backgroundColor: colors.surfaceElevated,
    borderColor: colors.divider,
    borderRadius: radii.button,
    borderWidth: 1,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  filterChipActive: {
    backgroundColor: colors.text,
    borderColor: colors.text,
  },
  filterChipText: {
    color: colors.textSecondary,
    fontSize: typography.bodySmall,
    fontWeight: '700',
  },
  filterChipTextActive: {
    color: colors.onLight,
  },
  brandMark: {
    alignSelf: 'center',
    marginBottom: spacing.lg,
    marginTop: spacing.lg,
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
  // Etat VIDE (aucun vault, champ de chargement FERME) : le contenu est recentre
  // dans la hauteur disponible, au lieu de rester colle en haut avec 60 % d'ecran
  // noir en dessous. Retour direct de Corentin sur capture.
  // JAMAIS applique quand le champ de chargement est ouvert : la mesure
  // `onMultisigBlockLayout` (position du champ, pour le remonter sous le clavier)
  // doit rester exacte.
  homeBodyEmpty: {
    alignSelf: 'stretch',
    flex: 1,
    justifyContent: 'center',
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
  // Disposition cote a cote [champ + Paste] [Load] (largeur suffisante).
  loaderRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  // Disposition compacte sur deux lignes (largeur etroite) : le champ prend
  // toute la largeur, Load multisig passe dessous en pleine largeur.
  loaderColumn: {
    width: '100%',
  },
  // Bloc texte du champ : occupe l'espace restant, ne deborde jamais (flexShrink).
  loaderField: {
    flex: 1,
    flexShrink: 1,
  },
  // Aligne le bouton Load sur la ZONE DE SAISIE, pas sur le haut du bloc.
  // AddressInput ajoute son propre `marginTop` (spacing.md = 12), puis la hauteur
  // de son libellé (~18 pour typography.secondary), puis le `marginTop` de son
  // champ (spacing.sm = 8). Soit 38. Vérifié par MESURE sur une capture réelle :
  // avec spacing.xxl (32) le bouton sortait 5,6 dp trop haut.
  loaderButtonSlot: {
    marginTop: 38,
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
  // Lien « View all proposals » : simple action inline alignee a gauche.
  viewAllAction: {
    alignSelf: 'flex-start',
    marginTop: spacing.sm,
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

  // --- Navigation V2 : onglets Proposals / Activity / Account ---------------
  tabTitle: {
    color: colors.text,
    fontSize: typography.screenTitle,
    fontWeight: '800',
    marginTop: spacing.sm,
  },
  tabEmpty: {
    color: colors.textMuted,
    fontSize: typography.bodySmall,
    lineHeight: 21,
    marginTop: spacing.lg,
  },
  // Ligne wallet de l'onglet Account : compacte, sur une seule ligne.
  accountWallet: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.divider,
    borderRadius: radii.field,
    borderWidth: 1,
    flexDirection: 'row',
    marginTop: spacing.lg,
    minHeight: 56,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  accountWalletLabel: {
    color: colors.text,
    fontSize: typography.body,
    fontWeight: '700',
  },
  accountWalletAddress: {
    color: colors.textSecondary,
    fontFamily: 'monospace',
    fontSize: typography.bodySmall,
    marginTop: 2,
  },
  accountActions: {
    marginTop: spacing.xl,
  },
});