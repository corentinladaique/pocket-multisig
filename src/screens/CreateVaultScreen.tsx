import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
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
import { runMultisigCreationPreflight } from '../vault/multisigCreationPreflight';
import {
  simulateMultisigCreation,
  type MultisigCreationSimulationResult,
} from '../vault/simulateMultisigCreation';
import {
  applyFreshBlockhash,
  signAndSendMultisigCreation,
  type MultisigCreationSignSendResult,
} from '../vault/signAndSendMultisigCreation';
import { useMultisigRegistry } from '../vault/useMultisigRegistry';
import { formatMwaError } from '../wallet/mwaDiagnostics';
import {
  buildOperationReport,
  classifyOperationFailure,
  classifyOperationResult,
  describeAttemptOutcome,
  type OperationReport,
} from '../wallet/operationState';
import { confirmSignature } from '../solana/confirmSignature';
import type { SignatureConfirmationStatus } from '../wallet/operationState';
import { describeWalletIdentity } from '../wallet/mwaDiagnostics';
import * as multisig from '@sqds/multisig';
import { PublicKey } from '@solana/web3.js';
import { VaultPreviewScreen } from './VaultPreviewScreen';
import { VaultTransactionPreviewScreen } from './VaultTransactionPreviewScreen';
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

export function CreateVaultScreen({ onCancel }: { onCancel: () => void }) {
  const { account, connect, signAndSendTransactions } = useMobileWallet();
  // Registre local des multisigs connus (stockage seul, aucun RPC).
  const registry = useMultisigRegistry();

  const [step, setStep] = useState(1);
  const [vaultName, setVaultName] = useState('');
  const [setupType, setSetupType] = useState<SetupType | null>(null);
  const [members, setMembers] = useState<VaultMemberDraft[]>([]);
  const [threshold, setThreshold] = useState(1);

  const [pendingAddress, setPendingAddress] = useState('');
  const [pendingLabel, setPendingLabel] = useState('');
  const [pendingError, setPendingError] = useState<string | null>(null);

  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  // Preview de transaction (lecture seule) : etage supplementaire du flux
  // Review -> Preview -> Transaction Preview -> Back.
  const [transactionPreviewOpen, setTransactionPreviewOpen] = useState(false);

  // Preview de creation (lecture seule) : Review -> Preview -> Back.
  const [previewOpen, setPreviewOpen] = useState(false);

  // --- Creation reelle (devnet) : etat du flux d'envoi. Aucune execution
  // automatique : tout part d'un tap, puis d'une confirmation explicite.
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createResult, setCreateResult] = useState<MultisigCreationSignSendResult | null>(null);
  const [simulatedCost, setSimulatedCost] = useState<number | null>(null);
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
  // Verdict unique de l'UI : sans signature, jamais de libellé « Sent ».
  const attemptOutcome =
    createResult === null
      ? null
      : describeAttemptOutcome({
          confirmed: createResult.confirmed === true,
          evidence: checkEvidence,
          signature: createResult.signature,
          verified: createResult.verified,
        });

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

  const walletAddress = account === undefined ? null : account.address.toString();
  // Label réellement fourni par le wallet lors de l'autorisation : affiché tel
  // quel dans les diagnostics, jamais complété par une valeur inventée.
  const walletLabel =
    account === undefined
      ? null
      : describeWalletIdentity({
          address: account.address.toString(),
          icon: account.icon,
          label: account.label,
        }).label;
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
          expectation: {
            threshold: plan.threshold,
            memberCount: plan.members.length,
            configAuthority: plan.configAuthority,
          },
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
   * Relecture seule après qu'une signature a existé : confirmation de la
   * transaction puis comparaison du compte métier. Ne prépare rien, ne signe
   * rien, n'envoie rien — c'est le seul geste autorisé tant que la
   * transaction peut encore aboutir.
   */
  const onCheckTransactionAgain = useCallback(async () => {
    const signature = createResult?.signature ?? null;
    const address = createResult?.readBack?.address ?? null;
    if (signature === null) {
      setCheckReport('No signature exists: nothing was sent, nothing to check.');
      return;
    }
    setChecking(true);
    setCheckReport(null);
    try {
      const confirmation = await confirmSignature({ connection, signature });
      // Hauteur de bloc relue : c'est elle, avec lastValidBlockHeight, qui
      // décide si une nouvelle tentative est permise après signature.
      let currentBlockHeight: number | null = null;
      try {
        currentBlockHeight = await connection.getBlockHeight('confirmed');
      } catch {
        currentBlockHeight = null;
      }
      setCheckEvidence({
        blockHeight: currentBlockHeight,
        lastValidBlockHeight: createResult?.lastValidBlockHeight ?? null,
        status: confirmation.status,
      });
      const lines = [`Confirmation: ${confirmation.status}`];
      let readBackVerified = false;
      if (address !== null) {
        const info = await connection.getAccountInfo(new PublicKey(address), 'confirmed');
        if (info === null) {
          lines.push('Multisig account: not found yet');
        } else {
          const [decoded] = multisig.accounts.Multisig.fromAccountInfo(info);
          const sameThreshold = decoded.threshold === plan.threshold;
          const sameMemberCount = decoded.members.length === plan.members.length;
          readBackVerified = sameThreshold && sameMemberCount;
          lines.push(
            `Multisig account: present, owner ${info.owner.toString()}, threshold ${
              decoded.threshold
            }, ${decoded.members.length} member(s)`,
          );
          if (!readBackVerified) {
            lines.push('Read-back does not match the expected configuration.');
          }
        }
      }
      setCheckReport(lines.join(' · '));
      const evidence = {
        confirmed: confirmation.status === 'confirmed',
        readBackVerified,
        signatureObtained: true,
      };
      setOperationReport(
        buildOperationReport({ evidence, state: classifyOperationResult(evidence) }),
      );
    } catch (caught: unknown) {
      setCheckReport(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setChecking(false);
    }
  }, [connection, createResult, plan]);

  const onCreateOnDevnet = useCallback(() => {
    const creator = walletAddress;
    if (creator === null || creating || sendAttemptedRef.current) return;
    setCreating(true);
    setCreateError(null);
    setCreateResult(null);
    void (async () => {
      try {
        const prepared = await prepareCreation(creator);
        const charged =
          prepared.simulation.creatorBalanceDelta === null
            ? null
            : Math.abs(prepared.simulation.creatorBalanceDelta);
        setSimulatedCost(charged);
        setCreating(false);
        Alert.alert(
          'Create this multisig on Devnet?',
          [
            `Threshold: ${plan.threshold} of ${plan.members.length} members`,
            `Estimated cost: ${charged === null ? 'unknown' : `${charged} lamports`} (rent + network fee)`,
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
    // La preview gere elle-meme le retour vers Review : on ne double pas le
    // listener tant qu'elle est affichee.
    if (previewOpen) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (step > 1) {
        setStep((previous) => Math.max(previous - 1, 1));
        return true;
      }
      requestDiscard();
      return true;
    });
    return () => subscription.remove();
  }, [previewOpen, requestDiscard, step]);

  const requiredMembers = minMembersFor(setupType ?? 'custom');

  const canContinue =
    step === 1
      ? setupType !== null
      : step === 2
        ? members.length >= requiredMembers
        : step === 3
          ? threshold >= 1 && threshold <= members.length
          : step === 4
            ? draft.validationErrors.length === 0
            : true;

  // Preview de transaction : ecran lecture seule, sans construction Squads.
  if (transactionPreviewOpen) {
    return (
      <VaultTransactionPreviewScreen
        canCreate={
          walletAddress !== null &&
          plan.readyForInstructionBuild &&
          (createResult === null || attemptOutcome?.allowNewAttempt === true) &&
          !creating
        }
        checkReport={checkReport}
        checking={checking}
        createError={createError}
        createResult={createResult}
        creating={creating}
        onBack={() => setTransactionPreviewOpen(false)}
        onCheckTransactionAgain={() => {
          void onCheckTransactionAgain();
        }}
        onCreateOnDevnet={onCreateOnDevnet}
        onReconnectWallet={() => {
          void onReconnectWallet();
        }}
        operationReport={operationReport}
        payer={walletAddress}
        request={request}
        simulatedCostLamports={simulatedCost}
        walletLabel={walletLabel}
      />
    );
  }

  // Preview de creation : ecran lecture seule derive de la demande locale.
  // Aucun appel reseau, aucune signature, aucune creation.
  if (previewOpen) {
    return (
      <VaultPreviewScreen
        onBack={() => setPreviewOpen(false)}
        onOpenTransactionPreview={() => setTransactionPreviewOpen(true)}
        request={request}
      />
    );
  }

  return (
    <KeyboardAvoidingView behavior="padding" style={styles.keyboardAvoider}>
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
            <Text style={styles.retryText}>Cancel and back to inbox</Text>
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

            <Text style={styles.fieldLabel}>Vault name</Text>
            <TextInput
              autoCapitalize="words"
              onChangeText={setVaultName}
              onBlur={onFieldBlur}
              onFocus={onFieldFocus('vaultName')}
              placeholder="Personal vault"
              placeholderTextColor="#9ca3af"
              ref={registerField('vaultName')}
              style={styles.input}
              value={vaultName}
            />
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

            <Text style={styles.fieldLabel}>Public address</Text>
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={setPendingAddress}
              onBlur={onFieldBlur}
              onFocus={onFieldFocus('pendingAddress')}
              placeholder="Solana public address"
              placeholderTextColor="#9ca3af"
              ref={registerField('pendingAddress')}
              style={styles.input}
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
                    onPress={() => setThreshold(value)}
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

            <Text style={styles.fieldLabel}>Vault name</Text>
            <Text style={styles.fieldValue}>
              {vaultName.trim().length > 0 ? vaultName.trim() : 'Untitled vault'}
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

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Preview creation"
              onPress={() => setPreviewOpen(true)}
              style={[styles.button, styles.secondary]}
            >
              <Text style={styles.secondaryText}>Preview</Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: true }}
              disabled
              style={[styles.button, styles.disabled]}
            >
              <Text style={styles.buttonText}>Create on Devnet — not available yet</Text>
            </Pressable>

            <Text style={styles.hint}>
              Nothing is sent on-chain in this phase: no RPC call, no signature.
            </Text>
          </View>
        ) : null}

        <View style={styles.navRow}>
          {step > 1 ? (
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
    paddingBottom: 96,
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