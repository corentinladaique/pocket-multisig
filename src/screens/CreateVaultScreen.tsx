import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useMobileWallet } from '@wallet-ui/react-native-web3js';

import { connection } from '../solana/connection';
import { buildMultisigCreationTransaction, type MultisigTransactionBuildResult } from '../vault/buildMultisigCreation';
import { buildMultisigCreationPlan } from '../vault/multisigCreationPlan';
import {
  LOW_SECURITY_THRESHOLD_CONFIRM,
  LOW_SECURITY_THRESHOLD_DETAIL,
  LOW_SECURITY_THRESHOLD_LABEL,
  TWO_MEMBER_RECOMMENDATION,
  TWO_MEMBER_RECOMMENDATION_DETAIL,
  TWO_MEMBER_RECOMMENDED_THRESHOLD,
  lowSecurityThresholdWarning,
  twoMemberRecommendation,
} from '../vault/thresholdRecommendation';
import { runMultisigCreationPreflight } from '../vault/multisigCreationPreflight';
import {
  simulateMultisigCreation,
  type MultisigCreationSimulationResult,
} from '../vault/simulateMultisigCreation';
import {
  applyFreshBlockhash,
  signAndSendMultisigCreation,
  type MultisigCreationReadBack,
  type MultisigCreationSignSendResult,
} from '../vault/signAndSendMultisigCreation';
import {
  decodeMultisigCreationReadBack,
  validateMultisigCreationReadBack,
  type MultisigCreationExpectation,
} from '../vault/multisigCreationReadBack';
import { useMultisigRegistry } from '../vault/useMultisigRegistry';
import { formatMwaError } from '../wallet/mwaDiagnostics';
import { AddressInput } from '../ui/AddressInput';
import { SAFE_TOP_PADDING } from '../ui/safeAreaPadding';
import {
  buildOperationReport,
  classifyOperationFailure,
  classifyOperationResult,
  describeAttemptOutcome,
  evaluateSignatureEvidence,
  isTemporaryNetworkFailure,
  type OperationReport,
} from '../wallet/operationState';
import { confirmSignature } from '../solana/confirmSignature';
import type { SignatureConfirmationStatus } from '../wallet/operationState';
import { signingStateTitle } from '../wallet/signingWindow';
import {
  deriveVaultVisibleState,
  VAULT_VISIBLE_LABELS,
} from '../wallet/vaultCreationState';
import { lamportsToSolDisplay } from '../wallet/vaultBalance';
import {
  DEVNET_SOL_DISCLAIMER,
  formatPriceUpdatedAt,
  formatUsdEstimate,
  USD_ESTIMATE_UNAVAILABLE,
  type SolPrice,
} from '../wallet/fiatEstimate';
import {
  decomposeCreationCost,
  type CreationCostBreakdown,
} from '../vault/multisigCreationCost';
import * as multisig from '@sqds/multisig';
import { PublicKey } from '@solana/web3.js';
import {
  buildVaultCreationRequest,
  createEmptyDraft,
  createMember,
  evaluateDraft,
  isDraftReady,
  isValidSolanaAddress,
  minMembersFor,
  SETUP_PRESETS,
  shortenMemberAddress,
  type SetupType,
  type VaultDraftInput,
  type VaultMemberDraft,
} from '../vault/vaultDraft';

/**
 * Assistant LOCAL de configuration d'un vault Squads personnel.
 *
 * Aucun RPC, aucune signature, aucune API de creation Squads, aucune
 * transaction. Le brouillon ne contient que des adresses publiques et des
 * labels : jamais de cle privee, de seed phrase ou de PIN.
 */

const STEP_COUNT = 5;
// Marge de confort au-dessus du clavier (aucune dimension d'ecran codee).
const FIELD_KEYBOARD_MARGIN = 24;

type MeasurableInput = TextInput & {
  measureInWindow?: (
    callback: (x: number, y: number, width: number, height: number) => void,
  ) => void;
};

export function CreateVaultScreen({
  onCancel,
  onGoToInbox,
  onOpenVault,
}: {
  onCancel: () => void;
  /** Sortie vers l'inbox des multisigs connus (apres succes). */
  onGoToInbox: () => void;
  /** Ouvre le vault cree, a partir de son adresse deja verifiee on-chain. */
  onOpenVault: (vault: { address: string; vaultName: string }) => void;
}) {
  const { account, connect, signAndSendTransactions } = useMobileWallet();
  // Registre local des multisigs connus (stockage seul, aucun RPC).
  const registry = useMultisigRegistry();

  const [step, setStep] = useState(1);
  const [vaultName, setVaultName] = useState('');
  /** Le champ nom a-t-il ete touche ? Aucune erreur agressive avant interaction. */
  const [nameTouched, setNameTouched] = useState(false);
  const [setupType, setSetupType] = useState<SetupType | null>(null);
  const [members, setMembers] = useState<VaultMemberDraft[]>([]);
  const [threshold, setThreshold] = useState(1);
  // L'utilisateur a-t-il choisi le threshold explicitement ? Si non, deux
  // membres obtiennent le defaut recommande (2 of 2) sans jamais ecraser un
  // choix explicite (y compris 1 of 2).
  const [thresholdTouched, setThresholdTouched] = useState(false);

  const [pendingAddress, setPendingAddress] = useState('');
  const [pendingLabel, setPendingLabel] = useState('');
  const [pendingError, setPendingError] = useState<string | null>(null);

  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  // Section repliable des diagnostics sur Step 5 : ouverte uniquement par un
  // tap explicite, jamais une etape obligatoire du parcours.
  const [troubleshootingOpen, setTroubleshootingOpen] = useState(false);

  // --- Creation reelle (devnet) : etat du flux d'envoi. Aucune execution
  // automatique : tout part d'un tap, puis d'une confirmation explicite.
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createResult, setCreateResult] = useState<MultisigCreationSignSendResult | null>(null);
  // Cout estime de creation, issu EXCLUSIVEMENT de la simulation locale deja
  // calculee (aucune lecture RPC ajoutee). Unites internes en lamports ; jamais
  // affichees a l'utilisateur. La decomposition rent/frais n'est renseignee que
  // si elle est fiable (voir decomposeCreationCost).
  const [creationCost, setCreationCost] = useState<CreationCostBreakdown | null>(null);
  // Prix SOL/USD : AUCUNE source fiable branchee pour l'instant (pas de package,
  // pas de secret, pas de valeur codee en dur). L'interface est prete : il suffit
  // de renseigner ce prix plus tard, sans toucher au reste.
  const solPrice = null as SolPrice | null;
  // Verrou de tentative : jamais deux envois en parallele, jamais deux envois
  // apres une signature obtenue.
  const sendAttemptedRef = useRef(false);
  // Machine d'état : ce qui s'est réellement passé, et ce qui reste permis.
  const [operationReport, setOperationReport] = useState<OperationReport | null>(null);
  const [checkReport, setCheckReport] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  // Preuve relue sur la chaîne lors du dernier « Check transaction again » :
  // seule source capable d'autoriser une nouvelle tentative APRÈS signature.
  const [checkEvidence, setCheckEvidence] = useState<{
    status: SignatureConfirmationStatus;
    blockHeight: number | null;
    lastValidBlockHeight: number | null;
  } | null>(null);
  // Adresse multisig ATTENDUE, derivee PENDANT la tentative signee et conservee
  // jusqu'au verdict final. Check transaction again ne rederive jamais de cle et
  // n'utilise que cette adresse.
  const [expectedMultisigPda, setExpectedMultisigPda] = useState<string | null>(null);
  // Erreur technique BRUTE du dernier recheck : reservee a Troubleshooting
  // details, jamais concatenee dans le message utilisateur principal.
  const [checkError, setCheckError] = useState<string | null>(null);
  // Configure relue mais NON conforme (owner/threshold/membre/permissions…) :
  // echec DETERMINISTE, jamais presente comme une simple indisponibilite reseau.
  const [verificationMismatch, setVerificationMismatch] = useState(false);
  // Verdict unique de l'UI : sans signature, jamais de libellé « Sent ».
  const attemptOutcome =
    createResult === null
      ? null
      : describeAttemptOutcome({
          confirmed: createResult.confirmed === true,
          evidence: checkEvidence,
          // Réseau injoignable : temporaire, la signature reste valable.
          networkFailure: isTemporaryNetworkFailure(createResult.errorMessage ?? ''),
          signature: createResult.signature,
          verified: createResult.verified,
        });

  // --- Etats utiles portes sur Step 5 (ex-ecran de transaction) : tout est
  // derive de l'etat existant, aucun nouvel envoi ni reconstruction.
  const hasCreateResult = createResult !== null;
  const signatureObtained = createResult !== null && createResult.signature !== null;
  const createdAndVerified = createResult?.verified === true;
  const nothingWasSent = hasCreateResult && !signatureObtained;
  const signedPending = hasCreateResult && signatureObtained && !createdAndVerified;
  // « Prepare again » n'apparait que si la machine d'etat autorise une nouvelle
  // tentative : jamais apres une signature non revoquee.
  const needsPrepareAgain = hasCreateResult && attemptOutcome?.allowNewAttempt === true;
  // Statut de confirmation affichable : preuve relue si presente, sinon
  // deduction prudente (jamais « confirmed » sans preuve explicite).
  const signatureStatus: SignatureConfirmationStatus =
    checkEvidence?.status ?? (createResult?.confirmed === true ? 'confirmed' : 'pending');
  // Confirmation : preuve la plus avancee disponible (jamais de regression).
  const transactionConfirmed =
    createResult?.confirmed === true || checkEvidence?.status === 'confirmed';
  // Relecture impossible POUR UNE RAISON RESEAU (temporaire) : le read-back
  // initial peut avoir echoue sur UnknownHostException avant confirmation.
  const isTemporaryVerificationFailure =
    isTemporaryNetworkFailure(checkError ?? '') ||
    isTemporaryNetworkFailure(createResult?.errorMessage ?? '') ||
    isTemporaryNetworkFailure((createResult?.validationErrors ?? []).join(' '));
  // Etat visible UNIQUE, derive des preuves les plus avancees : confirmed ne
  // redevient jamais « confirmation pending ».
  const vaultVisibleState = deriveVaultVisibleState({
    confirmed: transactionConfirmed,
    creating,
    hasAttempt: hasCreateResult,
    networkFailure: isTemporaryVerificationFailure,
    signatureObtained,
    verificationMismatch,
    verified: createdAndVerified,
  });
  // Verdict de preuve : seule source capable d'autoriser une nouvelle tentative
  // APRES une signature deja obtenue.
  const signatureVerdict = signedPending
    ? evaluateSignatureEvidence({
        blockHeight: checkEvidence?.blockHeight ?? null,
        lastValidBlockHeight: createResult?.lastValidBlockHeight ?? null,
        status: signatureStatus,
      })
    : null;
  // Adresse du vault principal (PDA index 0) derivee UNIQUEMENT de l'adresse
  // VERIFIEE (read-back conforme), index 0 : aucune addresse de navigation,
  // aucune derivation avant verification.
  const mainVaultAddress = (() => {
    if (!createdAndVerified) return null;
    const address = createResult?.readBack?.address ?? null;
    if (address === null) return null;
    try {
      const [vaultPda] = multisig.getVaultPda({ index: 0, multisigPda: new PublicKey(address) });
      return vaultPda.toBase58();
    } catch {
      return null;
    }
  })();
  // Diagnostics disponibles : la section repliable n'apparait que s'il existe au
  // moins une information technique, jamais vide.
  const mwaReport = operationReport?.mwa ?? null;
  const signingStateLabel =
    createResult?.signingState === undefined ? null : signingStateTitle(createResult.signingState);
  const technicalErrors: string[] = [];
  if (createResult?.errorMessage != null) technicalErrors.push(createResult.errorMessage);
  for (const message of createResult?.validationErrors ?? []) technicalErrors.push(message);
  if (checkError !== null && !technicalErrors.includes(checkError)) technicalErrors.push(checkError);
  const hasDiagnostics =
    technicalErrors.length > 0 ||
    mwaReport !== null ||
    signingStateLabel !== null ||
    checkEvidence !== null;

  // --- Affichage du cout : TOUJOURS en SOL (jamais de lamports a l'ecran). ---
  const costTotalSol = creationCost === null ? null : lamportsToSolDisplay(creationCost.totalLamports);
  const costRentSol =
    creationCost === null || creationCost.rentLamports === null
      ? null
      : lamportsToSolDisplay(creationCost.rentLamports);
  const costFeeSol =
    creationCost === null || creationCost.feeLamports === null
      ? null
      : lamportsToSolDisplay(creationCost.feeLamports);
  const costBreakdownAvailable = costRentSol !== null && costFeeSol !== null;
  const usdEstimate =
    creationCost === null ? null : formatUsdEstimate({ lamports: creationCost.totalLamports, price: solPrice });
  const priceUpdatedAt = solPrice === null ? null : formatPriceUpdatedAt(solPrice.fetchedAt);

  const memberCounter = useRef(0);

  // Suppression d'un signer : realigne le threshold sur le nombre de membres
  // restant pour ne jamais afficher un seuil inatteignable.
  useEffect(() => {
    setThreshold((current) => {
      const max = Math.max(members.length, 1);
      return current > max ? max : current;
    });
  }, [members.length]);

  const draftInput = useMemo<VaultDraftInput>(
    () => ({ ...createEmptyDraft(), vaultName, setupType: setupType ?? 'custom', members, threshold }),
    [members, setupType, threshold, vaultName],
  );
  const draft = useMemo(() => evaluateDraft(draftInput), [draftInput]);
  const ready = isDraftReady(draft);
  // Demande locale de creation : purement derivee du draft, utilisee pour le
  // recapitulatif de l'etape Review. Aucun appel reseau.
  const request = useMemo(() => buildVaultCreationRequest(draft), [draft]);
  // Plan technique : purement local (aucun RPC, aucune API Squads executee).
  const plan = useMemo(() => buildMultisigCreationPlan(request), [request]);

  // Pour exactement deux membres, 2 of 2 est le defaut RECOMMANDE — sauf choix
  // explicite de l'utilisateur, qui n'est jamais ecrase.
  useEffect(() => {
    if (
      !thresholdTouched &&
      members.length === TWO_MEMBER_RECOMMENDED_THRESHOLD &&
      threshold !== TWO_MEMBER_RECOMMENDED_THRESHOLD
    ) {
      setThreshold(TWO_MEMBER_RECOMMENDED_THRESHOLD);
    }
  }, [members.length, threshold, thresholdTouched]);

  // Valeurs attendues on-chain, préparées AVANT signature : utilisées à
  // l'identique par le read-back initial ET par « Check transaction again ».
  const creationExpectation = useMemo<MultisigCreationExpectation>(
    () => ({
      configAuthority: plan.configAuthority,
      memberCount: plan.members.length,
      members: plan.members.map((member) => ({
        key: member.key,
        permissions: member.permissions,
      })),
      rentCollector: plan.rentCollector,
      threshold: plan.threshold,
      timeLock: plan.timeLock,
    }),
    [plan],
  );

  const walletAddress = account === undefined ? null : account.address.toString();
  const walletAlreadyMember =
    walletAddress !== null && members.some((member) => member.publicKey === walletAddress);

  // --- Clavier : meme mecanisme que l'ecran principal (evenement reel +
  // position mesuree). En edge-to-edge la fenetre n'est plus redimensionnee
  // par l'IME, le KeyboardAvoidingView "padding" fait le travail.
  const scrollViewRef = useRef<ScrollView>(null);
  const scrollOffsetRef = useRef(0);
  const fieldRefs = useRef<Record<string, TextInput | null>>({});
  const focusedFieldRef = useRef<string | null>(null);

  const registerField = useCallback(
    (key: string) => (instance: TextInput | null) => {
      fieldRefs.current[key] = instance;
    },
    [],
  );

  const onFieldFocus = useCallback(
    (key: string) => () => {
      focusedFieldRef.current = key;
    },
    [],
  );

  const onFieldBlur = useCallback(() => {
    focusedFieldRef.current = null;
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const subscription = Keyboard.addListener('keyboardDidShow', () => {
      const key = focusedFieldRef.current;
      const scroller = scrollViewRef.current;
      const field = key === null ? null : (fieldRefs.current[key] as MeasurableInput | null);
      if (key === null || scroller === null || field === null || field === undefined) return;
      // measureInWindow n'est pas expose par les types publics de ScrollView.
      const measurableScroller = scroller as unknown as MeasurableInput;
      measurableScroller.measureInWindow?.((_viewX, viewY) => {
        field.measureInWindow?.((_fieldX, fieldY) => {
          const targetY = Math.max(
            scrollOffsetRef.current + fieldY - viewY - FIELD_KEYBOARD_MARGIN,
            0,
          );
          if (__DEV__) {
            console.log('[vault] keyboardDidShow ; champ =', key, '; scrollTo.y =', targetY);
          }
          scroller.scrollTo({ animated: true, y: targetY });
        });
      });
    });
    return () => subscription.remove();
  }, []);

  // --- Actions du brouillon (aucun appel reseau).
  const chooseSetup = useCallback((type: SetupType, presetThreshold: number) => {
    setSetupType(type);
    setThreshold(presetThreshold);
    // Choix explicite de l'utilisateur : le defaut recommande ne l'ecrase jamais.
    setThresholdTouched(true);
  }, []);

  const addConnectedWallet = useCallback(() => {
    if (walletAddress === null) return;
    memberCounter.current += 1;
    const label = account?.label ?? 'Seeker wallet';
    setMembers((previous) => [
      ...previous,
      createMember({
        index: memberCounter.current,
        label,
        publicKey: walletAddress,
      }),
    ]);
  }, [account?.label, walletAddress]);

  const addPendingMember = useCallback(() => {
    const address = pendingAddress.trim();
    const label = pendingLabel.trim().length > 0 ? pendingLabel.trim() : 'Unlabelled signer';
    if (!isValidSolanaAddress(address)) {
      setPendingError('Invalid Solana public address.');
      return;
    }
    if (members.some((member) => member.publicKey === address)) {
      setPendingError('This public address is already a member.');
      return;
    }
    memberCounter.current += 1;
    setMembers((previous) => [
      ...previous,
      createMember({ index: memberCounter.current, label, publicKey: address }),
    ]);
    setPendingAddress('');
    setPendingLabel('');
    setPendingError(null);
  }, [members, pendingAddress, pendingLabel]);

  const removeMember = useCallback((id: string) => {
    setMembers((previous) => previous.filter((member) => member.id !== id));
    setRenameId((current) => (current === id ? null : current));
  }, []);

  const startRename = useCallback((member: VaultMemberDraft) => {
    setRenameId(member.id);
    setRenameValue(member.label);
  }, []);

  const commitRename = useCallback(() => {
    const id = renameId;
    if (id === null) return;
    const label = renameValue.trim();
    setMembers((previous) =>
      previous.map((member) =>
        member.id === id ? { ...member, label: label.length > 0 ? label : member.label } : member,
      ),
    );
    setRenameId(null);
  }, [renameId, renameValue]);

  const onScroll = useCallback((event: { nativeEvent: { contentOffset: { y: number } } }) => {
    scrollOffsetRef.current = event.nativeEvent.contentOffset.y;
  }, []);

  /**
   * Sequence technique AVANT confirmation : un seul build conserve (meme clé
   * ephemere du debut a la fin), treasury lu on-chain, puis simulation. Renvoie
   * exactement l'instance de transaction qui sera signee et envoyee.
   */
  const prepareCreation = useCallback(
    async (creator: string): Promise<{
      build: MultisigTransactionBuildResult;
      simulation: MultisigCreationSimulationResult;
    }> => {
      const firstBuild = buildMultisigCreationTransaction({ plan, creator, treasury: null });
      const preflight = await runMultisigCreationPreflight({
        connection,
        creator,
        createKey: firstBuild.createKeyPublicKey,
        plan,
      });
      if (preflight.treasury === null) {
        throw new Error(
          `Préflight impossible : ${preflight.validationErrors.join(' ') || 'treasury indisponible.'}`,
        );
      }
      const build = buildMultisigCreationTransaction({
        plan,
        creator,
        treasury: preflight.treasury,
      });
      if (build.transaction === null) {
        throw new Error(`Construction impossible : ${build.validationErrors.join(' ')}`);
      }
      // Blockhash explicite AVANT toute simulation : sans lui, web3.js injecte
      // un blockhash issu du cache de Connection, qui peut etre inconnu de la
      // grappe (BlockhashNotFound).
      await applyFreshBlockhash(connection, build.transaction);
      const simulation = await simulateMultisigCreation({
        connection,
        transaction: build.transaction,
        multisigPda: build.multisigPda,
        creator,
      });
      if (simulation.err !== null || !simulation.readyToSign) {
        throw new Error(
          `Simulation refusée : ${
            simulation.validationErrors.join(' ') || JSON.stringify(simulation.err)
          }`,
        );
      }
      return { build, simulation };
    },
    [plan],
  );

  /**
   * Envoi effectif, apres confirmation explicite. Simule une derniere fois la
   * MEME instance (fraicheur), puis signe avec la clé éphémère et envoie via
   * le wallet, puis relit le multisig.
   */
  const confirmAndSend = useCallback(
    async (
      prepared: { build: MultisigTransactionBuildResult; simulation: MultisigCreationSimulationResult },
      creator: string,
    ) => {
      const transaction = prepared.build.transaction;
      if (transaction === null || sendAttemptedRef.current) return;
      sendAttemptedRef.current = true;
      // Adresse ATTENDUE de cette tentative signee : conservee jusqu'au verdict
      // final, y compris si la relecture initiale echoue (reseau).
      setExpectedMultisigPda(prepared.build.multisigPda);
      setCreating(true);
      setCreateError(null);
      let signature: string | null = null;
      try {
        // Blockhash frais unique, pose AVANT la simulation finale et reutilise
        // tel quel pour partialSign puis pour l'envoi MWA.
        const blockhash = await applyFreshBlockhash(connection, transaction);
        const fresh = await simulateMultisigCreation({
          connection,
          transaction,
          multisigPda: prepared.build.multisigPda,
          creator,
        });
        if (fresh.err !== null || !fresh.readyToSign) {
          throw new Error(
            `Simulation refusée avant envoi : ${
              fresh.validationErrors.join(' ') || JSON.stringify(fresh.err)
            }`,
          );
        }
        const result = await signAndSendMultisigCreation({
          connection,
          transaction,
          ephemeralCreateKey: prepared.build.ephemeralCreateKey,
          signAndSendTransactions,
          multisigPda: prepared.build.multisigPda,
          expectation: creationExpectation,
          blockhash,
        });
        signature = result.signature;
        setCreateResult(result);
        if (!result.verified) {
          setCreateError(
            result.errorMessage !== null
              ? // Échec côté wallet : étape, code et message conservés tels quels.
                formatMwaError({
                  code: result.errorCode ?? null,
                  message: result.errorMessage,
                  step: 'signAndSendTransactions',
                })
              : result.validationErrors.join(' '),
          );
          // Machine d'état : signature obtenue ou non déterminent seuls la suite.
          setOperationReport(
            buildOperationReport({
              evidence: {
                confirmed: result.confirmed === true,
                readBackVerified: result.verified,
                signatureObtained: result.signature !== null,
              },
              state: classifyOperationResult({
                confirmed: result.confirmed === true,
                readBackVerified: result.verified,
                signatureObtained: result.signature !== null,
              }),
            }),
          );
        } else if (result.readBack !== null) {
          setOperationReport(
            buildOperationReport({
              evidence: { confirmed: true, readBackVerified: true, signatureObtained: true },
              state: 'operation-created-and-verified',
            }),
          );
          // Creation verifiee on-chain : on conserve localement de quoi la
          // retrouver (adresse, nom local, labels). Aucun secret n'est ecrit.
          const memberLabels: Record<string, string> = {};
          for (const member of plan.members) {
            if (member.label.length > 0) memberLabels[member.key] = member.label;
          }
          const saved = await registry.add({
            address: result.readBack.address,
            vaultName,
            memberLabels,
            source: 'created',
          });
          if (saved.entry === null) {
            setCreateError(
              `Multisig created and verified, but the local record could not be saved: ${
                saved.errors.join(' ') || 'unknown storage error'
              }`,
            );
          }
        }
      } catch (caught: unknown) {
        setCreateError(caught instanceof Error ? caught.message : String(caught));
        // Échec hors des modules d'envoi : classé ici, sans jamais conclure
        // à un succès (CancellationException = interruption de session).
        const state = classifyOperationFailure({
          caught,
          step: 'signAndSendTransactions',
        });
        setOperationReport(buildOperationReport({ caught, state, step: 'signAndSendTransactions' }));
      } finally {
        // Aucune signature obtenue -> la tentative n'a rien produit : on
        // reautorise un essai. Sinon, plus aucun envoi automatique.
        if (signature === null) sendAttemptedRef.current = false;
        setCreating(false);
      }
    },
    [plan, registry, signAndSendTransactions],
  );

  /**
   * Reconnexion wallet uniquement : aucune préparation, aucune signature.
   * Utile après une interruption de session ou un refus d'autorisation.
   */
  const onReconnectWallet = useCallback(async () => {
    setCheckReport(null);
    setCreateError(null);
    try {
      await connect();
    } catch (caught: unknown) {
      const state = classifyOperationFailure({ caught, step: 'authorize' });
      setOperationReport(buildOperationReport({ caught, state, step: 'authorize' }));
    }
  }, [connect]);

  /**
   * Relecture SEULE apres qu'une signature a existe : confirmation de la
   * transaction puis relecture du compte multisig ATTENDU (derive pendant la
   * tentative signee). Ne prepare rien, ne signe rien, ne renvoie rien et
   * n'ouvre aucun wallet : uniquement des lectures RPC.
   */
  const onCheckTransactionAgain = useCallback(async () => {
    const signature = createResult?.signature ?? null;
    if (signature === null) {
      setCheckReport('No signature exists: nothing was sent, nothing to check.');
      return;
    }
    // Une seule relecture a la fois : ignore les taps simultanes.
    if (checking) return;
    setChecking(true);
    setCheckReport('Checking transaction…');
    setCheckError(null);
    // Adresse ATTENDUE de la tentative signee : jamais rederivee, jamais une
    // nouvelle cle.
    const expectedPda = expectedMultisigPda ?? createResult?.readBack?.address ?? null;
    try {
      const confirmation = await confirmSignature({ connection, signature });
      // Hauteur de bloc relue : c'est elle, avec lastValidBlockHeight, qui
      // decide si une nouvelle tentative est permise apres signature.
      let currentBlockHeight: number | null = null;
      try {
        currentBlockHeight = await connection.getBlockHeight('confirmed');
      } catch {
        currentBlockHeight = null;
      }
      const confirmed = confirmation.status === 'confirmed';
      setCheckEvidence({
        blockHeight: currentBlockHeight,
        lastValidBlockHeight: createResult?.lastValidBlockHeight ?? null,
        status: confirmation.status,
      });

      // Relecture du compte multisig ATTENDU (lecture seule). Le verdict est
      // rendu par la MEME fonction pure que le read-back initial : owner,
      // configAuthority, threshold, membres, permissions, timeLock, rentCollector.
      let readBack: MultisigCreationReadBack | null = null;
      let readBackError: string | null = null;
      let mismatchDeterministic = false;
      if (confirmed && expectedPda !== null) {
        try {
          const info = await connection.getAccountInfo(new PublicKey(expectedPda), 'confirmed');
          if (info === null) {
            readBackError = 'ReadBackMissing: the multisig account is not readable yet.';
          } else {
            const decoded = decodeMultisigCreationReadBack(info, expectedPda);
            const validation = validateMultisigCreationReadBack({
              expectedAddress: expectedPda,
              expectation: creationExpectation,
              readBack: decoded,
            });
            if (validation.verified) {
              readBack = validation.readBack;
            } else {
              readBackError = validation.errors.join(' ');
              // Mismatch DETERMINISTE (owner/threshold/membre/permissions…) :
              // jamais classe comme une simple panne reseau.
              mismatchDeterministic = validation.errors.every(
                (error) => !isTemporaryNetworkFailure(error),
              );
            }
          }
        } catch (caught: unknown) {
          const detail = caught instanceof Error ? caught.message : String(caught);
          readBackError = `ReadBackDecodeFailed: ${detail}`;
          mismatchDeterministic = !isTemporaryNetworkFailure(detail);
        }
      }

      if (readBack !== null) {
        // Trois preuves reunies : signature, confirmation, read-back coherent.
        // Aucun envoi, aucune signature : on ne fait que completer le resultat.
        setCreateResult((previous) =>
          previous === null
            ? previous
            : {
                ...previous,
                confirmed: true,
                errorCode: null,
                errorMessage: null,
                readBack,
                signingState: 'confirmed',
                verified: true,
              },
        );
        setCreateError(null);
        setCheckError(null);
        setVerificationMismatch(false);
        setCheckReport('Vault created and verified.');
        setOperationReport(
          buildOperationReport({
            evidence: { confirmed: true, readBackVerified: true, signatureObtained: true },
            state: 'operation-created-and-verified',
          }),
        );
        // Meme effet local que l'envoi initial : retrouver le vault plus tard.
        const memberLabels: Record<string, string> = {};
        for (const member of plan.members) {
          if (member.label.length > 0) memberLabels[member.key] = member.label;
        }
        await registry.add({
          address: readBack.address,
          memberLabels,
          source: 'created',
          vaultName,
        });
        return;
      }

      if (confirmed) {
        if (readBackError !== null) setCheckError(readBackError);
        setVerificationMismatch(mismatchDeterministic);
        setCheckReport(
          mismatchDeterministic
            ? 'Verification mismatch: the on-chain configuration does not match the configuration you reviewed.'
            : readBackError !== null && isTemporaryNetworkFailure(readBackError)
              ? 'Transaction confirmed. Vault verification is temporarily unavailable.'
              : 'Transaction confirmed. Vault details are not readable yet.',
        );
        setOperationReport(
          buildOperationReport({
            evidence: { confirmed: true, readBackVerified: false, signatureObtained: true },
            state: 'transaction-confirmed-readback-failed',
          }),
        );
        return;
      }

      // Pas encore confirmee : lecture seule, aucune preuve n'avance.
      setCheckReport('Still not confirmed on-chain. Check transaction again later.');
      setOperationReport(
        buildOperationReport({
          evidence: { confirmed: false, readBackVerified: false, signatureObtained: true },
          state: 'signature-obtained-confirmation-pending',
        }),
      );
    } catch (caught: unknown) {
      // Erreur RPC/reseau : conservee pour Troubleshooting details, jamais
      // concatenee dans le message principal. Signature et bouton conserves.
      const detail = caught instanceof Error ? caught.message : String(caught);
      setCheckError(detail);
      setCheckReport(
        isTemporaryNetworkFailure(detail)
          ? 'Transaction confirmed. Vault verification is temporarily unavailable.'
          : 'Transaction verification failed: see troubleshooting details.',
      );
    } finally {
      setChecking(false);
    }
  }, [checking, connection, createResult, creationExpectation, expectedMultisigPda, plan, registry, vaultName]);

  const onCreateOnDevnet = useCallback(() => {
    const creator = walletAddress;
    if (creator === null || creating || sendAttemptedRef.current) return;
    setCreating(true);
    setCreateError(null);
    setCreateResult(null);
    // Nouvelle tentative : aucun vestige de la precedente (adresse attendue,
    // preuve relue, erreur technique du recheck).
    setExpectedMultisigPda(null);
    setCheckEvidence(null);
    setCheckReport(null);
    setCheckError(null);
    setVerificationMismatch(false);
    setCreationCost(null);
    void (async () => {
      try {
        const prepared = await prepareCreation(creator);
        const charged =
          prepared.simulation.creatorBalanceDelta === null
            ? null
            : Math.abs(prepared.simulation.creatorBalanceDelta);
        // Decomposition NON inventee : le rent vient des lamports reellement
        // alloues au compte multisig simule ; les frais reseau sont le reste,
        // payes par le wallet createur (fee payer).
        setCreationCost(
          decomposeCreationCost({
            rentLamports: prepared.simulation.multisigRentLamports,
            totalLamports: charged,
          }),
        );
        setCreating(false);
        Alert.alert(
          'Create this multisig on Devnet?',
          [
            `Threshold: ${plan.threshold} of ${plan.members.length} members`,
            `Estimated cost: ${charged === null ? 'unknown' : lamportsToSolDisplay(charged)} (rent + network fee)`,
            `Payer wallet: ${creator}`,
            '',
            'You sign ONCE as creator. The other members are not asked to approve.',
            'The configuration will be frozen: no admin authority.',
            'Nothing is sent until you tap Create.',
          ].join('\n'),
          [
            { onPress: () => setCreating(false), style: 'cancel', text: 'Cancel' },
            {
              onPress: () => {
                void confirmAndSend(prepared, creator);
              },
              text: 'Create',
            },
          ],
          { cancelable: true, onDismiss: () => setCreating(false) },
        );
      } catch (caught: unknown) {
        setCreateError(caught instanceof Error ? caught.message : String(caught));
        setCreating(false);
      }
    })();
  }, [confirmAndSend, creating, plan, prepareCreation, walletAddress]);

  const goBack = useCallback(() => {
    setStep((previous) => Math.max(previous - 1, 1));
  }, []);

  const goNext = useCallback(() => {
    setStep((previous) => Math.min(previous + 1, STEP_COUNT));
  }, []);

  // Retour systeme Android (bouton physique ET geste, tous deux routes vers
  // onBackPressed) : etape precedente tant qu'il en reste, sinon confirmation
  // d'abandon. Remonter d'une etape ne perd aucune donnee saisie.
  const onCancelRef = useRef(onCancel);
  useEffect(() => {
    onCancelRef.current = onCancel;
  }, [onCancel]);

  const requestDiscard = useCallback(() => {
    Alert.alert('Discard vault setup?', 'Your current setup will be lost.', [
      { style: 'cancel', text: 'Continue editing' },
      { onPress: () => onCancelRef.current(), style: 'destructive', text: 'Discard' },
    ]);
  }, []);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      // Apres un succes verifie : le retour systeme sort vers l'inbox, jamais
      // vers le wizard (aucun second envoi possible).
      if (createdAndVerified) {
        onGoToInbox();
        return true;
      }
      if (step > 1) {
        setStep((previous) => Math.max(previous - 1, 1));
        return true;
      }
      requestDiscard();
      return true;
    });
    return () => subscription.remove();
  }, [createdAndVerified, onGoToInbox, requestDiscard, step]);

  const requiredMembers = minMembersFor(setupType ?? 'custom');

  const canContinue =
    step === 1
      ? // Nom OBLIGATOIRE des Vault setup : le placeholder n'est jamais une
        // valeur, et des espaces seuls ne comptent pas comme un nom.
        setupType !== null && vaultName.trim().length > 0
      : step === 2
        ? members.length >= requiredMembers
        : step === 3
          ? threshold >= 1 && threshold <= members.length
          : step === 4
            ? draft.validationErrors.length === 0
            : true;

  /** Meme condition que le CTA de Step 5 : verdict unique de preparation. */
  const canCreate =
    walletAddress !== null &&
    plan.readyForInstructionBuild &&
    (createResult === null || attemptOutcome?.allowNewAttempt === true) &&
    !creating;

  /** Raison utilisateur affichee a cote du CTA (jamais un libelle mort). */
  const createBlockedReason =
    walletAddress === null
      ? { action: 'Connect your wallet', message: 'Connect the wallet that will create this multisig.' }
      : !request.readyForCreation
        ? { action: 'Add members and set the threshold', message: 'Complete the member configuration.' }
        : request.vaultName.trim().length === 0
          ? { action: 'Back to vault setup', message: 'Enter a vault name to continue.' }
          : plan.validationErrors.length > 0
            ? { action: 'Fix the members and the threshold', message: 'Preflight failed.' }
            : {
                action: 'Run the checks again',
                message: creating ? 'Preparing creation…' : 'Ready to create on Devnet.',
              };
  /**
   * Verdict de preparation : la MEME condition que le bouton, avec une raison
   * utilisateur. Aucune validation n'est assouplie. Partage entre Step 5 et
   * l'ecran technique facultatif.
   */
  const createReadiness = (() => {
    if (walletAddress === null) {
      return {
        ready: false,
        reasonCode: 'no-creator-wallet',
        recommendedAction: 'Connect your wallet',
        userMessage: 'Connect your wallet to create this multisig.',
      };
    }
    if (plan.validationErrors.length > 0) {
      return {
        ready: false,
        reasonCode: 'invalid-draft',
        recommendedAction: 'Fix the members and the threshold',
        userMessage: 'Fix the validation errors above.',
      };
    }
    if (!request.readyForCreation) {
      return {
        ready: false,
        reasonCode: 'draft-incomplete',
        recommendedAction: 'Add members and set the threshold',
        userMessage: 'Complete the member configuration.',
      };
    }
    if (request.vaultName.trim().length === 0) {
      return {
        ready: false,
        reasonCode: 'missing-vault-name',
        recommendedAction: 'Back to vault setup',
        userMessage: 'Enter a vault name to create this multisig.',
      };
    }
    if (!plan.readyForInstructionBuild) {
      return {
        ready: false,
        reasonCode: 'plan-not-ready',
        recommendedAction: 'Run the checks again',
        userMessage: 'Run the readiness checks before creating.',
      };
    }
    return {
      ready: true,
      reasonCode: 'ready',
      recommendedAction: 'Create on Devnet',
      userMessage: 'Ready to create on Devnet.',
    };
  })();

  return (
    <KeyboardAvoidingView behavior="padding" style={[styles.keyboardAvoider, SAFE_TOP_PADDING]}>
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        onScroll={onScroll}
        ref={scrollViewRef}
        scrollEventThrottle={16}
        style={styles.scrollView}
      >
        <View style={styles.headerRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cancel vault creation"
            hitSlop={{ bottom: 8, left: 8, right: 8, top: 8 }}
            onPress={requestDiscard}
            style={styles.headerCancel}
          >
            <Text style={styles.retryText}>Discard vault setup</Text>
          </Pressable>
        </View>

        <Text style={styles.badge}>DEVNET</Text>
        <Text style={styles.title}>Create a vault</Text>
        <Text style={styles.stepBar}>Step {step} of {STEP_COUNT}</Text>

        {step === 1 ? (
          <View style={styles.block}>
            <Text style={styles.blockTitle}>Choose your setup</Text>
            {SETUP_PRESETS.map((preset) => (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: setupType === preset.type }}
                key={preset.type}
                onPress={() => chooseSetup(preset.type, preset.threshold)}
                style={[styles.option, setupType === preset.type && styles.optionSelected]}
              >
                <Text style={styles.optionTitle}>{preset.title}</Text>
                <Text style={styles.optionDetail}>{preset.detail}</Text>
              </Pressable>
            ))}

            <Text style={styles.fieldLabel}>Vault name *</Text>
            <TextInput
              autoCapitalize="words"
              onChangeText={setVaultName}
              onBlur={() => {
                setNameTouched(true);
                onFieldBlur();
              }}
              onFocus={onFieldFocus('vaultName')}
              placeholder="Personal savings vault"
              placeholderTextColor="#9ca3af"
              ref={registerField('vaultName')}
              style={styles.input}
              value={vaultName}
            />
            {/* Nom OBLIGATOIRE : le placeholder ne devient jamais la valeur. */}
            <Text style={styles.errorText}>
              Vault name * — Required. Enter a name for this vault.
            </Text>
            {vaultName.trim().length === 0 && nameTouched ? (
              <Text style={styles.errorText}>Enter a vault name to continue.</Text>
            ) : null}
          </View>
        ) : null}

        {step === 2 ? (
          <View style={styles.block}>
            <Text style={styles.blockTitle}>Add signers</Text>

            {walletAddress !== null ? (
              walletAlreadyMember ? (
                <Text style={styles.hint}>Your connected wallet is already a signer.</Text>
              ) : (
                <Pressable
                  accessibilityRole="button"
                  onPress={addConnectedWallet}
                  style={[styles.button, styles.secondary]}
                >
                  <Text style={styles.secondaryText}>
                    Add connected wallet ({shortenMemberAddress(walletAddress)})
                  </Text>
                </Pressable>
              )
            ) : (
              <Text style={styles.hint}>
                No wallet connected: add signers manually below.
              </Text>
            )}

            {/* Adresse du membre en cours d'ajout : le collage remplit le champ
                UNIQUEMENT. Aucun membre ajoute, aucun role selectionne. */}
            <AddressInput
              inputRef={registerField('pendingAddress')}
              label="Public address"
              onBlur={onFieldBlur}
              onChangeText={setPendingAddress}
              onFocus={onFieldFocus('pendingAddress')}
              placeholder="Solana public address"
              testID="member-pending-address"
              value={pendingAddress}
            />

            <Text style={styles.fieldLabel}>Label</Text>
            <TextInput
              autoCapitalize="words"
              onChangeText={setPendingLabel}
              onBlur={onFieldBlur}
              onFocus={onFieldFocus('pendingLabel')}
              placeholder="Ledger at home"
              placeholderTextColor="#9ca3af"
              ref={registerField('pendingLabel')}
              style={styles.input}
              value={pendingLabel}
            />

            <Pressable
              accessibilityRole="button"
              onPress={addPendingMember}
              style={[styles.button, styles.secondary]}
            >
              <Text style={styles.secondaryText}>Add signer</Text>
            </Pressable>

            {pendingError !== null ? <Text style={styles.errorText}>{pendingError}</Text> : null}

            <Text style={styles.blockTitle}>
              Signers ({members.length} of {requiredMembers} required)
            </Text>
            {members.length < requiredMembers ? (
              <Text style={styles.warningText}>
                {setupType === 'recommended'
                  ? 'Recommended setup requires 3 signers.'
                  : `At least ${requiredMembers} signers are required.`}
              </Text>
            ) : null}
            {members.map((member) => (
              <View key={member.id} style={styles.memberRow}>
                {renameId === member.id ? (
                  <View style={styles.renameBlock}>
                    <TextInput
                      autoCapitalize="words"
                      onChangeText={setRenameValue}
                      onBlur={onFieldBlur}
                      onFocus={onFieldFocus(`rename-${member.id}`)}
                      ref={registerField(`rename-${member.id}`)}
                      style={styles.input}
                      value={renameValue}
                    />
                    <Pressable accessibilityRole="button" onPress={commitRename} style={styles.retry}>
                      <Text style={styles.retryText}>Save label</Text>
                    </Pressable>
                  </View>
                ) : (
                  <>
                    <Text style={styles.memberLabel}>{member.label}</Text>
                    <Text style={styles.memberAddress}>
                      {shortenMemberAddress(member.publicKey)}
                    </Text>
                    <View style={styles.memberActions}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Rename ${member.label}`}
                        onPress={() => startRename(member)}
                        style={styles.retry}
                      >
                        <Text style={styles.retryText}>Rename</Text>
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Remove ${member.label}`}
                        onPress={() => removeMember(member.id)}
                        style={styles.retry}
                      >
                        <Text style={styles.retryText}>Remove</Text>
                      </Pressable>
                    </View>
                  </>
                )}
              </View>
            ))}

            {draft.validationErrors.length > 0 ? (
              <View style={styles.errorBox}>
                {draft.validationErrors.map((message) => (
                  <Text key={message} style={styles.errorText}>{message}</Text>
                ))}
              </View>
            ) : null}
          </View>
        ) : null}

        {step === 3 ? (
          <View style={styles.block}>
            <Text style={styles.blockTitle}>Threshold</Text>
            <Text style={styles.hint}>
              How many signers must approve before anything can move?
            </Text>
            {members.length === 0 ? (
              <Text style={styles.hint}>Add signers first.</Text>
            ) : (
              <View style={styles.kindRow}>
                {Array.from({ length: members.length }, (_entry, index) => index + 1).map((value) => (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ selected: threshold === value }}
                    key={value}
                    onPress={() => {
                      setThreshold(value);
                      setThresholdTouched(true);
                    }}
                    style={[styles.kindChip, threshold === value && styles.kindChipSelected]}
                  >
                    <Text style={styles.kindChipText}>{value}</Text>
                  </Pressable>
                ))}
              </View>
            )}
            <Text style={styles.fieldValue}>
              {threshold} of {members.length} approvals required.
            </Text>
            {twoMemberRecommendation(members.length) !== null ? (
              <>
                <Text style={styles.fieldValue}>{TWO_MEMBER_RECOMMENDATION}</Text>
                <Text style={styles.hint}>{TWO_MEMBER_RECOMMENDATION_DETAIL}</Text>
              </>
            ) : null}
            {lowSecurityThresholdWarning(members.length, threshold) !== null ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{LOW_SECURITY_THRESHOLD_LABEL}</Text>
                <Text style={styles.hint}>{LOW_SECURITY_THRESHOLD_DETAIL}</Text>
                <Text style={styles.hint}>
                  To continue with this setting, confirm explicitly: "
                  {LOW_SECURITY_THRESHOLD_CONFIRM}".
                </Text>
              </View>
            ) : null}
            <Text style={styles.hint}>
              Example: 2 of 3 means any two signers can approve, so one lost signer is
              survivable. 2 of 2 is stricter: both signers are always needed.
            </Text>
          </View>
        ) : null}

        {step === 4 ? (
          <View style={styles.block}>
            <Text style={styles.blockTitle}>Security check</Text>

            <Text style={styles.checkLine}>
              {draft.validationErrors.length === 0 ? '✓ ' : '✗ '}
              Public addresses valid, no duplicates
            </Text>
            <Text style={styles.checkLine}>
              {members.length >= 2 ? '✓ ' : '✗ '}
              At least two members ({members.length})
            </Text>
            <Text style={styles.checkLine}>
              {threshold >= 1 && threshold <= members.length ? '✓ ' : '✗ '}
              Threshold {threshold} within 1..{members.length}
            </Text>

            {draft.validationErrors.map((message) => (
              <Text key={message} style={styles.errorText}>{message}</Text>
            ))}
            {draft.validationWarnings.map((message) => (
              <Text key={message} style={styles.warningText}>{message}</Text>
            ))}

            <View style={styles.noticeBox}>
              <Text style={styles.noticeText}>
                Verify every hardware wallet address on the device itself.
              </Text>
              <Text style={styles.noticeText}>
                Pocket Multisig never asks for recovery phrases or private keys.
              </Text>
            </View>
          </View>
        ) : null}

        {step === 5 ? (
          <View style={styles.block}>
            <Text style={styles.blockTitle}>Review</Text>

            {!createdAndVerified ? (
              <>
              <Text style={styles.fieldLabel}>Vault name *</Text>
              <Text style={styles.fieldValue}>
                {vaultName.trim().length > 0 ? vaultName.trim() : 'Vault name required'}
              </Text>

              <Text style={styles.fieldLabel}>Members ({members.length})</Text>
              {members.map((member) => (
                <View key={member.id} style={styles.reviewMember}>
                  <Text style={styles.memberLabel}>
                    {member.label}
                  </Text>
                  <Text selectable style={styles.fieldValue}>{member.publicKey}</Text>
                </View>
              ))}

              <Text style={styles.fieldLabel}>Threshold</Text>
              <Text style={styles.fieldValue}>
                {threshold} of {members.length}
              </Text>

              <Text style={styles.fieldLabel}>Planned permissions</Text>
              <Text style={styles.fieldValue}>
                Permissions will be configured during creation.
              </Text>

              <Text style={styles.fieldLabel}>Network</Text>
              <Text style={styles.fieldValue}>Devnet</Text>

              {/* Objet local derive (aucun RPC, aucune signature) : meme source de
                  verite que la future demande de creation Devnet. */}
              <Text style={styles.fieldLabel}>Creation summary</Text>
              <View style={styles.summaryBox}>
                <Text style={styles.fieldValue}>Members: {request.memberCount}</Text>
                <Text style={styles.fieldValue}>
                  Threshold: {request.threshold} of {request.memberCount}
                </Text>
                <Text style={styles.fieldValue}>Network: Devnet</Text>
                <Text style={request.readyForCreation ? styles.statusReady : styles.warningText}>
                  State: {request.readyForCreation ? 'Ready' : 'Not Ready'}
                </Text>
              </View>

              <Text style={styles.fieldLabel}>Status</Text>
              <Text style={ready ? styles.statusReady : styles.warningText}>
                {ready ? 'Ready to create' : 'Not ready yet — see below'}
              </Text>

              {/* Erreurs bloquantes et avertissements rappeles ici : la revue doit
                  rester lisible sans revenir a l'etape Security check. */}
              {draft.validationErrors.length > 0 ? (
                <View style={styles.errorBox}>
                  {draft.validationErrors.map((message) => (
                    <Text key={message} style={styles.errorText}>{message}</Text>
                  ))}
                </View>
              ) : null}

              {draft.validationWarnings.length > 0 ? (
                <View style={styles.noticeBox}>
                  {draft.validationWarnings.map((message) => (
                    <Text key={message} style={styles.warningText}>{message}</Text>
                  ))}
                </View>
              ) : null}

              {/* Cout estime : TOUJOURS en SOL (jamais de lamports a l'ecran).
                  Total issu de la simulation reelle ; decomposition rent/frais
                  uniquement quand les deux composantes sont disponibles. */}
              {creationCost !== null && costTotalSol !== null && vaultVisibleState !== 'awaiting-wallet' ? (
                <View style={styles.summaryBox}>
                  <Text style={styles.fieldLabel}>Estimated creation cost</Text>
                  <Text style={styles.fieldValue}>{costTotalSol}</Text>

                  {costBreakdownAvailable ? (
                    <>
                      <Text style={styles.fieldLabel}>Includes</Text>
                      <Text style={styles.fieldValue}>• Account creation / rent: {costRentSol}</Text>
                      <Text style={styles.fieldValue}>• Network fee: {costFeeSol}</Text>
                      <Text style={styles.hint}>Network fee paid by your connected wallet.</Text>
                    </>
                  ) : (
                    <Text style={styles.hint}>Cost breakdown unavailable</Text>
                  )}

                  <Text style={styles.hint}>Final cost may vary slightly before signing.</Text>

                  {usdEstimate !== null ? (
                    <>
                      <Text style={styles.fieldValue}>{usdEstimate}</Text>
                      {priceUpdatedAt !== null ? (
                        <Text style={styles.hint}>
                          Indicative mainnet SOL value — {priceUpdatedAt}
                        </Text>
                      ) : null}
                    </>
                  ) : (
                    <Text style={styles.hint}>{USD_ESTIMATE_UNAVAILABLE}</Text>
                  )}

                  <Text style={styles.hint}>{DEVNET_SOL_DISCLAIMER}</Text>
                </View>
              ) : null}

              {/* ETAT 1 — avant tentative : verdict de preparation
                  (createReadiness) + recapitulatif deja affiche ci-dessus.
                  Masque pendant la creation (ETAT 2) et apres succes. */}
              {vaultVisibleState !== 'awaiting-wallet' ? (
                <View style={styles.noticeBox}>
                  <Text style={canCreate ? styles.statusReady : styles.warningText}>
                    {createReadiness.userMessage}
                  </Text>
                  {!canCreate ? (
                    <Text style={styles.warningText}>{createReadiness.recommendedAction}</Text>
                  ) : null}
                  {!canCreate ? (
                    <Text style={styles.warningText}>{createBlockedReason.message}</Text>
                  ) : null}
                  {!canCreate ? (
                    <Text style={styles.warningText}>{createBlockedReason.action}</Text>
                  ) : null}
                </View>
              ) : null}

              {/* ETAT 2 — creation en cours : progression uniquement. */}
              {vaultVisibleState === 'awaiting-wallet' ? (
                <Text style={styles.hint}>Preparing creation…</Text>
              ) : null}

              {/* CTA PRINCIPAL UNIQUE (ETAT 1 et ETAT 3) : meme handler que
                  l'ancien ecran de transaction. Le libelle bascule sur « Prepare
                  again » seulement si la machine d'etat autorise une nouvelle
                  tentative. JAMAIS rendu pendant la creation (ETAT 2), des qu'une
                  signature existe (ETAT 4) ou apres succes (ETAT 5). */}
              {!signatureObtained && vaultVisibleState !== 'awaiting-wallet' ? (
                <>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ busy: creating, disabled: !canCreate || creating }}
                    disabled={!canCreate || creating}
                    onPress={onCreateOnDevnet}
                    style={[styles.button, (!canCreate || creating) && styles.disabled]}
                  >
                    {creating ? (
                      <ActivityIndicator color="#ffffff" />
                    ) : (
                      <Text style={styles.buttonText}>
                        {needsPrepareAgain ? 'Prepare again' : 'Prepare and create on Devnet'}
                      </Text>
                    )}
                  </Pressable>

                  <Text style={styles.hint}>
                    Nothing is sent on-chain before the final confirmation.
                  </Text>
                </>
              ) : null}

              {/* ETAT B — echec AVANT signature : rien n'a ete envoye. Les details
                  techniques sont dans Troubleshooting details, pas ici. Le flux de
                  nouvelle tentative reste le CTA unique ci-dessus. */}
              {nothingWasSent ? (
                <View style={styles.errorBox}>
                  <Text style={styles.errorText}>Nothing was sent.</Text>
                  {createError !== null ? (
                    <Text style={styles.errorText}>{createError}</Text>
                  ) : null}
                  {operationReport !== null ? (
                    <Text style={styles.hint}>{operationReport.title}</Text>
                  ) : null}
                  <Text style={styles.hint}>
                    {needsPrepareAgain
                      ? 'Prepare again is available: no signature was obtained.'
                      : 'A new attempt is not available right now.'}
                  </Text>
                </View>
              ) : null}

              {/* ETAT C — signature obtenue, PAS encore confirmee. Un seul libelle,
                  derive des preuves : jamais de contradiction avec le statut. */}
              {vaultVisibleState === 'signed-pending-confirmation' ? (
                <View style={styles.errorBox}>
                  <Text style={styles.errorText}>
                    {VAULT_VISIBLE_LABELS['signed-pending-confirmation']}
                  </Text>
                  <Text selectable style={styles.fieldValue}>
                    Signature: {createResult?.signature}
                  </Text>
                  <Text style={styles.hint}>Confirmation: {signatureStatus}</Text>
                  <Text style={styles.hint}>Vault verification: pending</Text>
                  {checkReport !== null ? <Text style={styles.hint}>{checkReport}</Text> : null}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ busy: checking, disabled: checking }}
                    disabled={checking}
                    onPress={() => {
                      void onCheckTransactionAgain();
                    }}
                    style={[styles.button, styles.secondary]}
                  >
                    {checking ? (
                      <ActivityIndicator color="#101317" />
                    ) : (
                      <Text style={styles.secondaryText}>Check transaction again</Text>
                    )}
                  </Pressable>
                  {signatureVerdict?.retryAllowed !== true ? (
                    <Text style={styles.hint}>
                      A signature already exists: no second send is allowed until the transaction is
                      proven absent, expired or failed.
                    </Text>
                  ) : null}
                </View>
              ) : null}

              {/* ETAT D — transaction CONFIRMEE mais read-back pas encore disponible.
                  Bloc principal NEUTRE : rien a renvoyer, la signature est valide. Le
                  rouge est reserve a un echec definitivement prouve. */}
              {vaultVisibleState === 'confirmed-pending-readback' ||
              vaultVisibleState === 'confirmed-readback-temporarily-unavailable' ? (
                <View style={styles.noticeBox}>
                  <Text style={styles.infoHeading}>Transaction confirmed</Text>
                  <Text style={styles.noticeText}>
                    {vaultVisibleState === 'confirmed-readback-temporarily-unavailable'
                      ? 'The vault details could not be loaded because the network connection was unavailable.'
                      : 'The vault details are not readable yet.'}
                  </Text>
                  <Text style={styles.noticeText}>Nothing needs to be sent again.</Text>
                  <Text selectable style={styles.fieldValue}>
                    Signature: {createResult?.signature}
                  </Text>
                  <Text style={styles.hint}>Confirmation: {signatureStatus}</Text>
                  <Text style={styles.hint}>Vault verification: pending</Text>
                  {checkReport !== null ? <Text style={styles.hint}>{checkReport}</Text> : null}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ busy: checking, disabled: checking }}
                    disabled={checking}
                    onPress={() => {
                      void onCheckTransactionAgain();
                    }}
                    style={[styles.button, styles.secondary]}
                  >
                    {checking ? (
                      <ActivityIndicator color="#101317" />
                    ) : (
                      <Text style={styles.secondaryText}>Check transaction again</Text>
                    )}
                  </Pressable>
                  {operationReport?.actions.allowReconnect === true ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Reconnect wallet"
                      onPress={() => {
                        void onReconnectWallet();
                      }}
                      style={[styles.button, styles.secondary]}
                    >
                      <Text style={styles.secondaryText}>Reconnect wallet</Text>
                    </Pressable>
                  ) : null}
                  <Text style={styles.hint}>
                    A signature already exists: no second send is allowed until the transaction is
                    proven absent, expired or failed.
                  </Text>
                </View>
              ) : null}
              </>
            ) : null}

            {/* ETAT D — succes : creation confirmee ET multisig relu/verifie. */}
            {createdAndVerified ? (
              <View style={styles.successBox}>
                <Text style={styles.successText}>Vault created and verified.</Text>
                <Text style={styles.fieldLabel}>Multisig configuration address</Text>
                <Text selectable style={styles.fieldValue}>
                  {createResult?.readBack?.address}
                </Text>
                <Text style={styles.fieldLabel}>Main vault address</Text>
                <Text selectable style={styles.fieldValue}>
                  {mainVaultAddress ?? 'unavailable'}
                </Text>
                <Text style={styles.fieldLabel}>Signature</Text>
                <Text selectable style={styles.fieldValue}>{createResult?.signature}</Text>
                <Text style={styles.fieldLabel}>Threshold</Text>
                <Text style={styles.fieldValue}>
                  {createResult?.readBack?.threshold} of {createResult?.readBack?.memberCount}
                </Text>
                <Text style={styles.fieldLabel}>Members</Text>
                <Text style={styles.fieldValue}>{createResult?.readBack?.memberCount}</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Open the created vault"
                  onPress={() => {
                    const address = createResult?.readBack?.address ?? null;
                    if (address !== null) onOpenVault({ address, vaultName });
                  }}
                  style={[styles.button, styles.secondary]}
                >
                  <Text style={styles.secondaryText}>Open vault</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Go to inbox"
                  onPress={onGoToInbox}
                  style={[styles.button, styles.secondary]}
                >
                  <Text style={styles.secondaryText}>Go to Inbox</Text>
                </Pressable>
              </View>
            ) : null}

            {/* ETAT E — transaction CONFIRMEE mais configuration NON conforme
                (owner/threshold/membre/permissions…). Echec DETERMINISTE : aucun
                second envoi, aucune ouverture de wallet, aucun Prepare again. */}
            {vaultVisibleState === 'confirmed-verification-mismatch' ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>Transaction confirmed</Text>
                <Text style={styles.errorText}>
                  The multisig account could not be verified against the configuration you
                  reviewed.
                </Text>
                <Text style={styles.errorText}>Nothing needs to be sent again.</Text>
                <Text selectable style={styles.fieldValue}>
                  Signature: {createResult?.signature}
                </Text>
                <Text style={styles.hint}>Confirmation: {signatureStatus}</Text>
                <Text style={styles.hint}>Vault verification: failed</Text>
                <Text style={styles.errorText}>Verification mismatch</Text>
                <Text style={styles.hint}>
                  The exact differences are in Troubleshooting details. No second send is allowed
                  while a confirmed signature exists.
                </Text>
              </View>
            ) : null}

            {/* TROUBLESHOOTING DETAILS — repliable, affiche uniquement si au
                moins un diagnostic existe. Jamais une etape obligatoire. */}
            {hasDiagnostics ? (
              <View style={styles.block}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Troubleshooting details"
                  onPress={() => setTroubleshootingOpen((open) => !open)}
                  style={[styles.button, styles.secondary]}
                >
                  <Text style={styles.secondaryText}>Troubleshooting details</Text>
                </Pressable>
                {/* Ferme par defaut : les details techniques ne sont jamais
                    imposes a l'utilisateur. Erreurs RPC completes, MWA, block
                    heights. */}
                {troubleshootingOpen ? (
                  <View style={styles.noticeBox}>
                    {technicalErrors.map((message, index) => (
                      <Text key={`detail-${index}`} selectable style={styles.hint}>
                        {message}
                      </Text>
                    ))}
                    {mwaReport !== null ? (
                      <>
                        <Text style={styles.hint}>MWA step: {mwaReport.step}</Text>
                        <Text style={styles.hint}>
                          MWA code: {mwaReport.code ?? 'none returned'}
                        </Text>
                        <Text style={styles.hint}>MWA message: {mwaReport.message}</Text>
                      </>
                    ) : null}
                    {signingStateLabel !== null ? (
                      <Text style={styles.hint}>Signing state: {signingStateLabel}</Text>
                    ) : null}
                    {checkEvidence !== null ? (
                      <Text style={styles.hint}>
                        Blockhash: height {checkEvidence.blockHeight ?? 'unknown'} · last valid{' '}
                        {checkEvidence.lastValidBlockHeight ?? 'unknown'}
                      </Text>
                    ) : null}
                    {checkReport !== null ? (
                      <Text style={styles.hint}>Last recheck: {checkReport}</Text>
                    ) : null}
                  </View>
                ) : null}
              </View>
            ) : null}
          </View>
        ) : null}

        <View style={styles.navRow}>
          {step > 1 && !createdAndVerified ? (
            <Pressable
              accessibilityRole="button"
              onPress={goBack}
              style={[styles.navButton, styles.secondary]}
            >
              <Text style={styles.secondaryText}>Back</Text>
            </Pressable>
          ) : null}
          {step < STEP_COUNT ? (
            <Pressable
              accessibilityRole="button"
              disabled={!canContinue}
              onPress={goNext}
              style={[styles.navButton, !canContinue && styles.disabled]}
            >
              <Text style={styles.buttonText}>Continue</Text>
            </Pressable>
          ) : null}
        </View>
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
    // Meme marge basse que la preview : le dernier bloc du wizard reste
    // atteignable au scroll.
    paddingBottom: 160,
  },
  // En-tete du wizard : Cancel reste accessible sans scroller.
  headerRow: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    justifyContent: 'flex-start',
  },
  headerCancel: {
    paddingVertical: 8,
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
    marginBottom: 4,
  },
  stepBar: {
    color: '#6b7280',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 20,
    textTransform: 'uppercase',
  },
  block: {
    alignSelf: 'stretch',
  },
  blockTitle: {
    color: '#111827',
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 8,
    marginTop: 16,
  },
  option: {
    backgroundColor: '#f9fafb',
    borderColor: '#e5e7eb',
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 8,
    padding: 14,
  },
  optionSelected: {
    borderColor: '#1a56db',
    borderWidth: 2,
  },
  optionTitle: {
    color: '#111827',
    fontSize: 15,
    fontWeight: '800',
  },
  optionDetail: {
    color: '#4b5563',
    fontSize: 13,
    marginTop: 2,
  },
  fieldLabel: {
    color: '#6b7280',
    fontSize: 11,
    marginTop: 12,
    textTransform: 'uppercase',
  },
  fieldValue: {
    color: '#101317',
    fontSize: 13,
    marginTop: 2,
  },
  summaryBox: {
    backgroundColor: '#f9fafb',
    borderColor: '#e5e7eb',
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 6,
    padding: 12,
  },
  input: {
    borderColor: '#d1d5db',
    borderRadius: 10,
    borderWidth: 1,
    color: '#101317',
    fontSize: 13,
    marginTop: 6,
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  kindRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  kindChip: {
    alignItems: 'center',
    borderColor: '#d1d5db',
    borderRadius: 999,
    borderWidth: 1,
    minHeight: 40,
    minWidth: 64,
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  kindChipSelected: {
    backgroundColor: '#e8f0fe',
    borderColor: '#1a56db',
  },
  kindChipText: {
    color: '#111827',
    fontSize: 13,
    fontWeight: '700',
  },
  button: {
    alignItems: 'center',
    backgroundColor: '#1a56db',
    borderRadius: 10,
    justifyContent: 'center',
    marginTop: 12,
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
  secondary: {
    backgroundColor: '#f3f4f6',
    borderColor: '#d1d5db',
    borderWidth: 1,
  },
  secondaryText: {
    color: '#101317',
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'center',
  },
  disabled: {
    opacity: 0.5,
  },
  navRow: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    gap: 12,
    marginTop: 24,
  },
  navButton: {
    alignItems: 'center',
    backgroundColor: '#1a56db',
    borderRadius: 10,
    flex: 1,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: 16,
  },
  hint: {
    color: '#6b7280',
    fontSize: 13,
    marginTop: 8,
  },
  memberRow: {
    alignSelf: 'stretch',
    backgroundColor: '#f9fafb',
    borderColor: '#e5e7eb',
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 8,
    padding: 12,
  },
  memberLabel: {
    color: '#111827',
    fontSize: 14,
    fontWeight: '700',
  },
  memberAddress: {
    color: '#4b5563',
    fontFamily: 'monospace',
    fontSize: 12,
    marginTop: 2,
  },
  memberActions: {
    flexDirection: 'row',
    gap: 16,
  },
  renameBlock: {
    alignSelf: 'stretch',
  },
  reviewMember: {
    borderTopColor: '#e5e7eb',
    borderTopWidth: 1,
    marginTop: 8,
    paddingTop: 8,
  },
  checkLine: {
    color: '#111827',
    fontSize: 14,
    marginTop: 6,
  },
  noticeBox: {
    backgroundColor: '#eef2ff',
    borderColor: '#c7d2fe',
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 16,
    padding: 12,
  },
  noticeText: {
    color: '#312e81',
    fontSize: 13,
    marginTop: 4,
  },
  infoHeading: {
    color: '#1e3a8a',
    fontSize: 15,
    fontWeight: '800',
    marginBottom: 2,
  },
  errorBox: {
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
    marginTop: 4,
  },
  successBox: {
    backgroundColor: '#ecfdf5',
    borderColor: '#a7f3d0',
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 16,
    padding: 12,
  },
  successText: {
    color: '#065f46',
    fontSize: 13,
    fontWeight: '800',
  },
  warningText: {
    color: '#92400e',
    fontSize: 13,
    marginTop: 4,
  },
  statusReady: {
    color: '#065f46',
    fontSize: 14,
    fontWeight: '800',
    marginTop: 2,
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