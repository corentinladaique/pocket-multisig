import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { PublicKey } from '@solana/web3.js';
import { useMobileWallet } from '@wallet-ui/react-native-web3js';

import { connection } from '../solana/connection';
import {
  buildProposalCreation,
  PROPOSAL_CREATION_EXPLAINERS,
} from '../squads/buildProposalCreation';
import {
  hasInvalidDestinationError,
  INVALID_DESTINATION_MESSAGE,
  proposalCreationErrorMessage,
} from '../ui/proposalCreationMessages';
import {
  runProposalCreationPreflight,
  type ProposalCreationPreflightResult,
} from '../squads/proposalCreationPreflight';
import {
  signAndSendProposalCreation,
  type ProposalCreationSignSendResult,
} from '../squads/signAndSendProposalCreation';
import {
  simulateProposalCreation,
  type ProposalCreationSimulationResult,
} from '../squads/simulateProposalCreation';
import { formatMwaError } from '../wallet/mwaDiagnostics';
import { buildOperationReport, classifyOperationResult, describeAttemptOutcome, isTemporaryNetworkFailure } from '../wallet/operationState';
import { signingStateTitle } from '../wallet/signingWindow';
import { AddressInput } from '../ui/AddressInput';
import { SAFE_TOP_PADDING } from '../ui/safeAreaPadding';
import { colors, radii, spacing, typography } from '../ui/theme';
import { Card, DevnetPill, InfoBox, InfoText, PillButton } from '../ui/v2/primitives';
import {
  computeMaxTransfer,
  isMaxSnapshotCurrent,
  maxSnapshotFrom,
  type MaxSnapshot,
  type MaxTransferPlan,
} from '../vault/maxTransfer';
import {
  formatSolAmount,
  lamportsToSolText,
  parseSolToLamports,
  SOL_AMOUNT_MESSAGES,
} from '../vault/solAmount';

/**
 * Creation d'une proposition de transfert SOL, de bout en bout.
 *
 * Pipeline : saisie → build local → preflight local (après lecture du solde du
 * vault) → simulation (aucune signature, aucun envoi) → revue locale →
 * double confirmation → signature et envoi par le wallet → relecture.
 *
 * Aucun Reject, aucun batch, aucune Address Lookup Table : seulement un
 * transfert SOL simple. Rien n'est envoye sans les trois portes du pipeline
 * (build, preflight, simulation) et sans double confirmation explicite.
 *
 * UI : theme sombre « Seeker style » (UI V2). Seule la présentation a changé :
 * handlers, machine d'état, parsing SOL<->lamports, buffer Max, validation,
 * Paste, runPipeline, préflight, simulation et déclenchement EXPLICITE du wallet
 * sont inchangés.
 */

const LAMPORTS_PER_SOL = 1_000_000_000;

function formatSol(lamports: number): string {
  return `${(lamports / LAMPORTS_PER_SOL).toFixed(9)} SOL`;
}

/**
 * Erreur de préflight « solde du vault insuffisant » : DÉTECTION seule du message
 * BRUT produit par le module de préflight (jamais modifié). Les valeurs sont
 * converties à l'affichage avec `formatSolAmount` (fonction existante) ; le nom
 * technique et les lamports bruts restent confinés à « Troubleshooting details ».
 */
const INSUFFICIENT_VAULT_BALANCE_PATTERN =
  /InsufficientVaultBalance:\s*(\d+)\s*lamports requested,\s*vault holds\s*(\d+)\./;

type InsufficientVaultBalanceDetails = {
  requestedLamports: number;
  availableLamports: number;
  missingLamports: number;
};

function parseInsufficientVaultBalance(
  message: string,
): InsufficientVaultBalanceDetails | null {
  const match = INSUFFICIENT_VAULT_BALANCE_PATTERN.exec(message);
  if (match === null) return null;
  const requestedLamports = Number(match[1]);
  const availableLamports = Number(match[2]);
  if (!Number.isSafeInteger(requestedLamports) || !Number.isSafeInteger(availableLamports)) {
    return null;
  }
  return {
    requestedLamports,
    availableLamports,
    missingLamports: Math.max(0, requestedLamports - availableLamports),
  };
}

type PipelineState =
  | { status: 'idle' }
  | { status: 'working' }
  | { status: 'ready' }
  | { status: 'error'; message: string };

export function NewProposalScreen({
  address,
  members,
  onBack,
  onCreatedVerified,
  onDone,
  onOpenCreatedProposal,
  transactionIndex,
  vaultAddress,
}: {
  /** Adresse du multisig (PAS le vault). */
  address: string;
  /** Membres et rôles, lus par l'écran appelant (aucune lecture ici). */
  members: readonly { address: string; roles: readonly string[] }[];
  onBack: () => void;
  /**
   * Appelé UNE fois après une création VÉRIFIÉE (signature + confirmation +
   * read-back) : le parent relit le multisig et la liste. Renvoie `true` si
   * l'actualisation a réussi. Lecture seule, aucun wallet.
   */
  onCreatedVerified?: () => Promise<boolean>;
  /** Appelé après une création vérifiée, pour revenir à la liste. */
  onDone: () => void;
  /** Ouvre la proposition créée (index on-chain relu par le parent). */
  onOpenCreatedProposal?: (index: number) => void;
  transactionIndex: number;
  vaultAddress: string;
}) {
  const { account, signAndSendTransactions } = useMobileWallet();
  const creator = account === undefined ? '' : account.address.toString();

  const [destination, setDestination] = useState('');
  /** Montant saisi par l'utilisateur en SOL (jamais en lamports). */
  const [solText, setSolText] = useState('');
  /** Buffer EXPLICITE choisi par l'utilisateur, en SOL : jamais une réserve cachée. */
  const [bufferText, setBufferText] = useState('');
  const [maxPlan, setMaxPlan] = useState<MaxTransferPlan | null>(null);
  /**
   * Instantané du calcul Max : le résumé et son avertissement ne s'affichent que
   * si montant, destination, buffer ET solde de référence correspondent encore.
   */
  const [maxSnapshot, setMaxSnapshot] = useState<MaxSnapshot | null>(null);
  /**
   * Une tentative EXPLICITE (Prepare / Preview / Create) a-t-elle eu lieu ?
   * Tant que non, aucune erreur de montant n'est affichee : coller une adresse
   * ne doit jamais ressembler a une erreur de saisie.
   */
  const [amountAttempted, setAmountAttempted] = useState(false);
  const [memo, setMemo] = useState('');

  const [pipeline, setPipeline] = useState<PipelineState>({ status: 'idle' });
  const [preflight, setPreflight] = useState<ProposalCreationPreflightResult | null>(null);
  const [simulation, setSimulation] = useState<ProposalCreationSimulationResult | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createResult, setCreateResult] = useState<ProposalCreationSignSendResult | null>(null);
  const sendAttemptedRef = useRef(false);
  /** Suivi de l'actualisation post-création (une seule, on-chain). */
  const [postCreate, setPostCreate] = useState<'idle' | 'refreshing' | 'done' | 'failed'>('idle');
  /** Section technique repliable, FERMÉE par défaut. */
  const [advancedOpen, setAdvancedOpen] = useState(false);
  /** Sous-repli « Simulation logs », FERMÉ par défaut (second niveau). */
  const [simulationLogsOpen, setSimulationLogsOpen] = useState(false);
  /** Diagnostic brut d'une erreur de préflight, FERMÉ par défaut. */
  const [troubleshootingOpen, setTroubleshootingOpen] = useState(false);
  /** Section explicative repliable, FERMÉE par défaut. */
  const [howItWorksOpen, setHowItWorksOpen] = useState(false);
  /** Section « More options » repliable, FERMÉE par défaut (buffer + Max). */
  const [moreOptionsOpen, setMoreOptionsOpen] = useState(false);
  // Verdict unique de l'UI : sans signature, jamais de libellé « Sent ».
  const attemptOutcome =
    createResult === null
      ? null
      : describeAttemptOutcome({
          confirmed: createResult.confirmed === true,
          // Preuve disponible sans nouvelle lecture : hauteur inconnue, donc
          // aucun déverrouillage après signature (règle B).
          evidence: {
            blockHeight: null,
            lastValidBlockHeight: createResult.lastValidBlockHeight ?? null,
            status: createResult.confirmationStatus ?? 'notFound',
          },
          networkFailure: isTemporaryNetworkFailure(createResult.errorMessage ?? ''),
          signature: createResult.signature,
          verified: createResult.verified,
        });

  // Saisie en SOL, convertie EXACTEMENT en lamports (arithmetique entiere,
  // 9 decimales max). Toute forme invalide produit NaN : le builder refuse et
  // l'ecran affiche un message en SOL explicite.
  const parsedSol = parseSolToLamports(solText);
  const lamports = parsedSol.ok ? parsedSol.lamports : Number.NaN;

  const build = useMemo(
    () =>
      buildProposalCreation({
        creator,
        destination,
        lamports,
        memo,
        multisigPda: address,
        transactionIndex,
      }),
    [address, creator, destination, lamports, memo, transactionIndex],
  );

  // Explications « comment ça marche » : information pure (aucune validation),
  // regroupée dans une section repliable. Les AUTRES avertissements restent
  // visibles en clair à proximité du formulaire.
  const explainers = build.warnings.filter((warning) =>
    (PROPOSAL_CREATION_EXPLAINERS as readonly string[]).includes(warning),
  );
  const otherWarnings = build.warnings.filter(
    (warning) => !(PROPOSAL_CREATION_EXPLAINERS as readonly string[]).includes(warning),
  );

  // Toute modification de la saisie invalide le pipeline déjà calculé : on ne
  // signe jamais sur la base d'une simulation qui ne correspond plus. Le buffer
  // du Max en fait partie : changer le buffer change le montant.
  useEffect(() => {
    setPipeline({ status: 'idle' });
    setPreflight(null);
    setSimulation(null);
  }, [build, bufferText]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onBack();
      return true;
    });
    return () => subscription.remove();
  }, [onBack]);

  // Le résumé Max n'est visible que si la saisie correspond encore exactement à
  // l'instantané du calcul : montant, destination, buffer et solde de référence.
  const parsedMaxBuffer = bufferText.trim().length === 0 ? null : parseSolToLamports(bufferText);
  const maxBufferLamports =
    parsedMaxBuffer !== null && parsedMaxBuffer.ok ? parsedMaxBuffer.lamports : 0;
  const maxSummaryVisible =
    maxPlan !== null &&
    maxPlan.ready &&
    isMaxSnapshotCurrent(maxSnapshot, {
      amountLamports: Number.isFinite(lamports) && lamports > 0 ? lamports : null,
      bufferLamports: maxBufferLamports,
      destination,
      vaultLamports: maxSnapshot?.vaultLamports ?? null,
    });

  const canRunPipeline =
    creator.length > 0 && build.errors.length === 0 && pipeline.status !== 'working';

  /**
   * Destination « tentee » : tant que le champ est vide, aucune erreur de
   * destination n'est presentee (le builder produit deja une erreur nommee des
   * le premier rendu, mais elle reste invisible avant toute saisie).
   */
  const destinationAttempted = destination.trim().length > 0;

  /**
   * Max : relit le solde CONFIRMÉ du Main vault, puis fige un montant exact en
   * lamports. Aucune réserve cachée : seul le buffer explicite est retiré, et
   * aucun frais n'est déduit du vault (le membre signataire paie les frais).
   * Aucun wallet, aucune signature, aucun envoi.
   */
  const onMax = useCallback(async () => {
    setMaxPlan(null);
    let freshLamports: number | null = null;
    try {
      freshLamports = await connection.getBalance(new PublicKey(vaultAddress), 'confirmed');
    } catch {
      freshLamports = null;
    }
    // Le buffer saisi est en SOL : il est converti exactement en lamports.
    const parsedBuffer = bufferText.trim().length === 0 ? null : parseSolToLamports(bufferText);
    const bufferLamports = parsedBuffer !== null && parsedBuffer.ok ? parsedBuffer.lamports : 0;
    const plan = computeMaxTransfer({
      explicitBufferLamports: bufferLamports,
      // Faits du chemin de code : ce formulaire ne construit qu'un transfert SOL
      // dont la source est le Main vault (buildProposalCreation).
      recognizedSolTransfer: true,
      sourceMatchesMainVault: true,
      vaultLamports: freshLamports,
    });
    setMaxPlan(plan);
    if (plan.amountLamports !== null && freshLamports !== null) {
      // Montant figé maintenant : il ne suivra jamais un solde futur.
      // La valeur reste un nombre ENTIER de lamports ; seul l'affichage est en SOL.
      setSolText(lamportsToSolText(plan.amountLamports));
      // Instantané : le résumé disparaîtra dès que la saisie changera.
      setMaxSnapshot(maxSnapshotFrom(plan, destination, freshLamports));
      setPipeline({ status: 'idle' });
      setPreflight(null);
      setSimulation(null);
    } else {
      setMaxSnapshot(null);
    }
  }, [bufferText, destination, vaultAddress]);

  /** Portes locales + une lecture de solde, puis simulation (aucun envoi). */
  const runPipeline = async (): Promise<ProposalCreationSimulationResult | null> => {
    // Action explicite : a partir d'ici, les erreurs de montant sont legitimes.
    setAmountAttempted(true);
    if (!canRunPipeline) return null;
    setPipeline({ status: 'working' });
    setPreflight(null);
    setSimulation(null);
    setCreateError(null);
    try {
      const vaultLamports = await connection.getBalance(new PublicKey(vaultAddress), 'confirmed');
      const preflightResult = runProposalCreationPreflight({
        build,
        multisig: { members, transactionIndex, vaultAddress },
        vault: { address: vaultAddress, lamports: vaultLamports },
      });
      setPreflight(preflightResult);
      if (!preflightResult.readyForInstructionBuild) {
        setPipeline({
          message: preflightResult.errors.join(' ') || 'The local preflight refused this build.',
          status: 'error',
        });
        return null;
      }
      const simulationResult = await simulateProposalCreation({
        build,
        connection,
        preflight: preflightResult,
      });
      setSimulation(simulationResult);
      if (!simulationResult.readyToSign) {
        setPipeline({
          message: simulationResult.errors.join(' ') || 'The simulation refused this build.',
          status: 'error',
        });
        return null;
      }
      setPipeline({ status: 'ready' });
      return simulationResult;
    } catch (caught: unknown) {
      setPipeline({
        message: caught instanceof Error ? caught.message : String(caught),
        status: 'error',
      });
      return null;
    }
  };

  const runCreate = async (freshSimulation?: ProposalCreationSimulationResult | null) => {
    const effectiveSimulation = freshSimulation ?? simulation;
    if (sendAttemptedRef.current || effectiveSimulation === null || preflight === null) return;
    if (effectiveSimulation.readyToSign !== true) return;
    sendAttemptedRef.current = true;
    setCreating(true);
    setCreateError(null);
    setCreateResult(null);
    let signature: string | null = null;
    try {
      const result = await signAndSendProposalCreation({
        build,
        connection,
        preflight,
        signAndSendTransactions,
        simulation: effectiveSimulation,
      });
      signature = result.signature;
      setCreateResult(result);
      if (!result.verified) {
        setCreateError(
          // La machine d'état parle d'abord : « sent, verification pending »
          // ne doit jamais être présenté comme un échec de création.
          `${
            result.signingState !== undefined
              ? signingStateTitle(result.signingState)
              : buildOperationReport({
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
            }).title
          } ${
            result.errorMessage !== null
              ? formatMwaError({
                  code: result.errorCode ?? null,
                  message: result.errorMessage,
                  step: 'signAndSendTransactions',
                })
              : result.validationErrors.join(' ')
          }`,
        );
      }
      if (result.verified) {
        // Création VÉRIFIÉE : UNE SEULE actualisation explicite du multisig et
        // de la liste. La chaîne reste la source de vérité, aucun wallet.
        setPostCreate('refreshing');
        const refreshed = onCreatedVerified === undefined ? true : await onCreatedVerified();
        setPostCreate(refreshed ? 'done' : 'failed');
      }
    } catch (caught: unknown) {
      setCreateError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      if (signature === null) sendAttemptedRef.current = false;
      setCreating(false);
    }
  };

  /** Double confirmation explicite avant toute demande au wallet. */
  const onCreate = () => {
    setAmountAttempted(true);
    if (simulation === null || creating || sendAttemptedRef.current) return;
    // Nouvelle tentative après un échec SANS signature : état propre, saisie
    // (destination, montant, memo) intacte. Une tentative signée ne peut pas
    // emprunter ce chemin (bouton désactivé).
    const isRetry = createResult !== null && attemptOutcome?.allowNewAttempt === true;
    if (isRetry) {
      setCreateResult(null);
      setCreateError(null);
    }
    Alert.alert(
      'Create this proposal?',
      [
        `Transfer ${formatSol(build.request?.lamports ?? 0)} to ${destination}`,
        `${members.length} member(s)`,
        `Estimated creation cost: ${
          simulation.estimatedCreatorBalanceDelta === null
            ? 'not measurable'
            : formatSolAmount(Math.abs(simulation.estimatedCreatorBalanceDelta))
        }`,
        'You will sign ONE transaction creating two accounts on devnet.',
      ].join('\n'),
      [
        { style: 'cancel', text: 'Cancel' },
        {
          onPress: () => {
            Alert.alert(
              'Confirm creation',
              [
                'The proposal will be created on devnet now and cannot be undone.',
                'The transfer itself only happens later, when the proposal is executed.',
                'Tap Create to sign with your wallet, or Cancel to stop.',
              ].join('\n'),
              [
                { style: 'cancel', text: 'Cancel' },
                {
                  onPress: () => {
                    // Nouvelle tentative : préflight et simulation sont refaits
                    // AVANT d'ouvrir le wallet (transaction neuve, blockhash neuf).
                    if (isRetry) {
                      void (async () => {
                        const fresh = await runPipeline();
                        if (fresh === null || fresh.readyToSign !== true) return;
                        await runCreate(fresh);
                      })();
                      return;
                    }
                    void runCreate();
                  },
                  text: 'Create',
                },
              ],
              { cancelable: true },
            );
          },
          text: 'Continue',
        },
      ],
      { cancelable: true },
    );
  };

  // Erreur de préflight « solde insuffisant » : détection purement UI (aucune
  // décision métier) afin de ne jamais exposer de lamports au premier niveau.
  const insufficientVaultBalance =
    pipeline.status === 'error' ? parseInsufficientVaultBalance(pipeline.message) : null;

  /** CTA secondaire « Edit details » : revient à la saisie, sans rien signer. */
  const onEditDetails = () => {
    setPipeline({ status: 'idle' });
    setPreflight(null);
    setSimulation(null);
    setAdvancedOpen(false);
    setSimulationLogsOpen(false);
    setTroubleshootingOpen(false);
  };

  // CTA de création UNIQUE : visible tant que la création n'est pas vérifiée
  // (ou qu'une reprise sans signature reste possible).
  const createCtaVisible =
    pipeline.status === 'ready' &&
    (createResult === null || (attemptOutcome?.allowNewAttempt ?? false));

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

        <Text style={styles.kicker}>DEVNET · SOL TRANSFER</Text>
        <Text style={styles.title}>New proposal</Text>
        {/* Sous-titre recentre sur CE QUE FAIT l'ecran. La promesse « rien n'est
            signe » n'apparait plus qu'UNE fois, sous le bouton Review, au point
            de decision : l'ancien doublon (haut + bas) diluait le message. */}
        <Text style={styles.subtitle}>
          A SOL transfer paid by the vault. Set the destination and amount, then review.
        </Text>

        {/* Indicateur d'étapes : PUREMENT visuel, sans navigation ni état. */}
        <View style={styles.steps}>
          <Text style={styles.stepActive}>1 Details</Text>
          <Text style={styles.stepIdle}>2 Review</Text>
          <Text style={styles.stepIdle}>3 Sign</Text>
        </View>

        <View style={styles.block}>
          {/* Destination : le collage passe par le MEME setter qu'une saisie
              manuelle, donc le build et la simulation sont invalidés pareil. */}
          <AddressInput
            label="Destination"
            onChangeText={setDestination}
            placeholder="Public address"
            testID="proposal-destination"
            value={destination}
          />

          <Text style={styles.fieldLabel}>Amount (SOL)</Text>
          <View style={styles.amountRow}>
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="decimal-pad"
              onChangeText={setSolText}
              placeholder="e.g. 0.02"
              placeholderTextColor={colors.textMuted}
              style={styles.amountInput}
              value={solText}
            />
            <Text style={styles.amountUnit}>SOL</Text>
          </View>
          <Text style={styles.fieldNote}>
            {Number.isFinite(lamports) && lamports > 0
              ? `Proposal amount: ${formatSolAmount(lamports)}`
              : parsedSol.ok
                ? 'Enter an amount to continue.'
                : SOL_AMOUNT_MESSAGES[parsedSol.reason]}
          </Text>

          <Text style={styles.fieldLabel}>Memo (optional)</Text>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            multiline
            onChangeText={setMemo}
            placeholder="What is this transfer for?"
            placeholderTextColor={colors.textMuted}
            style={[styles.input, styles.memoInput]}
            value={memo}
          />

          {/* « More options » : replié par défaut. Contient le buffer EXPLICITE
              et le bouton Max. Aucun effet sur les validations. */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Toggle more options"
            accessibilityState={{ expanded: moreOptionsOpen }}
            onPress={() => setMoreOptionsOpen((previous) => !previous)}
            style={({ pressed }) => [styles.toggle, pressed && styles.togglePressed]}
          >
            <Text style={styles.toggleText}>
              {moreOptionsOpen ? 'Hide more options' : 'More options'}
            </Text>
          </Pressable>

          {moreOptionsOpen ? (
            <View style={styles.moreOptions}>
              <Text style={styles.fieldLabel}>Optional safety buffer (SOL)</Text>
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="decimal-pad"
                onChangeText={setBufferText}
                placeholder="e.g. 0.001"
                placeholderTextColor={colors.textMuted}
                style={styles.input}
                value={bufferText}
              />
              <Text style={styles.fieldNote}>
                Amount kept in the Main vault when using Max.
              </Text>
              <Text style={styles.fieldNote}>Keep in Main vault when using Max.</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Fill the maximum transferable amount"
                onPress={() => {
                  void onMax();
                }}
                style={({ pressed }) => [
                  styles.secondaryButton,
                  styles.maxButton,
                  pressed && styles.secondaryPressed,
                ]}
              >
                <Text style={styles.secondaryText}>Max</Text>
              </Pressable>

              {maxSummaryVisible && maxPlan !== null ? (
                <View style={maxPlan.ready ? styles.noticeBox : styles.errorBox}>
                  <Text style={maxPlan.ready ? styles.noticeTitle : styles.errorTitle}>
                    {maxPlan.label}
                  </Text>
                  <Text style={styles.fieldNote}>{maxPlan.hint}</Text>
                  {maxPlan.warnings.map((warning) => (
                    <Text key={warning} style={styles.fieldNote}>
                      · {warning}
                    </Text>
                  ))}
                  {maxPlan.ready ? (
                    <>
                      <Text style={styles.fieldNote}>Current vault balance</Text>
                      <Text selectable style={styles.monoValue}>
                        {formatSol((maxPlan.amountLamports ?? 0) + maxPlan.bufferLamports)} SOL
                      </Text>
                      <Text style={styles.fieldNote}>Proposed transfer</Text>
                      <Text selectable style={styles.monoValue}>
                        {formatSol(maxPlan.amountLamports ?? 0)} SOL
                      </Text>
                      <Text style={styles.fieldNote}>
                        Safety buffer: {formatSolAmount(maxPlan.bufferLamports)}
                      </Text>
                      <Text style={styles.fieldNote}>Estimated remaining balance</Text>
                      <Text selectable style={styles.monoValue}>
                        {formatSol(maxPlan.remainingLamports ?? 0)} SOL
                      </Text>
                      <Text style={styles.fieldNote}>
                        This summary matches the current amount, destination and buffer.
                      </Text>
                    </>
                  ) : null}
                </View>
              ) : maxPlan !== null && !maxPlan.ready ? (
                <View style={styles.errorBox}>
                  <Text style={styles.errorTitle}>{maxPlan.label}</Text>
                  <Text style={styles.fieldNote}>{maxPlan.hint}</Text>
                </View>
              ) : null}
            </View>
          ) : null}
        </View>

        {/* Etats utilisateur : un montant vide n'est PAS une erreur avant toute
            tentative explicite. Les messages visibles sont en SOL ; les lamports
            restent confinés à la section « Advanced diagnostics ». */}
        {build.errors.length > 0 && amountAttempted ? (
          <InfoBox glyph="⚠" style={styles.infoBox} tone="error">
            <InfoText tone="error">
              {parsedSol.ok ? 'Not ready' : SOL_AMOUNT_MESSAGES[parsedSol.reason]}
            </InfoText>
            {build.errors
              .filter((error) => !/lamports/i.test(error))
              .map((error) => (
                <InfoText key={error} tone="error">
                  · {proposalCreationErrorMessage(error)}
                </InfoText>
              ))}
          </InfoBox>
        ) : null}
        {/* Une seule indication de montant manquant, près du champ. La raison
            « destination » n'apparait qu'APRES une saisie (jamais a vide) et
            sous forme de message utilisateur (jamais de code interne). */}
        {!amountAttempted && destinationAttempted && hasInvalidDestinationError(build.errors) ? (
          <Text style={styles.fieldNote}>{INVALID_DESTINATION_MESSAGE}</Text>
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityState={{ busy: pipeline.status === 'working', disabled: !canRunPipeline }}
          disabled={!canRunPipeline}
          onPress={() => {
            void runPipeline();
          }}
          style={({ pressed }) => [
            styles.primaryButton,
            pressed && styles.primaryPressed,
            !canRunPipeline && styles.disabled,
          ]}
        >
          {pipeline.status === 'working' ? (
            <ActivityIndicator color={colors.onLight} />
          ) : (
            <Text style={styles.buttonText}>Review proposal</Text>
          )}
        </Pressable>
        <Text style={styles.fieldNote}>
          Checks the vault balance and simulates the transaction. Nothing is signed or sent.
        </Text>

        {pipeline.status === 'error' ? (
          insufficientVaultBalance !== null ? (
            <>
              {/* Message utilisateur en SOL — jamais « lamports » au premier niveau. */}
              <InfoBox glyph="⚠" style={styles.infoBox} tone="error">
                <InfoText tone="error">Insufficient vault balance</InfoText>
                <InfoText tone="error">
                  Requested: {formatSolAmount(insufficientVaultBalance.requestedLamports)}
                </InfoText>
                <InfoText tone="error">
                  Available: {formatSolAmount(insufficientVaultBalance.availableLamports)}
                </InfoText>
                <InfoText tone="error">
                  Missing: {formatSolAmount(insufficientVaultBalance.missingLamports)}
                </InfoText>
                <InfoText tone="error">Nothing was signed or sent.</InfoText>
              </InfoBox>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Toggle troubleshooting details"
                accessibilityState={{ expanded: troubleshootingOpen }}
                onPress={() => setTroubleshootingOpen((previous) => !previous)}
                style={({ pressed }) => [styles.toggle, pressed && styles.togglePressed]}
              >
                <Text style={styles.toggleText}>
                  {troubleshootingOpen
                    ? 'Hide troubleshooting details'
                    : 'Troubleshooting details'}
                </Text>
              </Pressable>
              {troubleshootingOpen ? (
                <Card style={styles.block}>
                  <Text style={styles.fieldNote}>Error name: InsufficientVaultBalance</Text>
                  <Text selectable style={styles.monoValue}>
                    Requested lamports: {insufficientVaultBalance.requestedLamports}
                  </Text>
                  <Text selectable style={styles.monoValue}>
                    Available lamports: {insufficientVaultBalance.availableLamports}
                  </Text>
                  <Text selectable style={styles.monoValue}>
                    Missing lamports: {insufficientVaultBalance.missingLamports}
                  </Text>
                  <Text selectable style={styles.fieldNote}>{pipeline.message}</Text>
                </Card>
              ) : null}
            </>
          ) : (
            <InfoBox glyph="⚠" style={styles.infoBox} tone="error">
              <InfoText tone="error">Pipeline stopped before any signature</InfoText>
              <InfoText tone="error">{pipeline.message}</InfoText>
            </InfoBox>
          )
        ) : null}

        {simulation !== null && preflight !== null ? (
          <View
            accessibilityLabel={
              pipeline.status === 'ready' ? 'Simulation succeeded' : 'Simulation did not pass'
            }
            style={pipeline.status === 'ready' ? styles.successBox : styles.noticeBox}
          >
            <Text style={pipeline.status === 'ready' ? styles.successTitle : styles.noticeTitle}>
              {pipeline.status === 'ready' ? 'Simulation passed' : 'Simulation did not pass'}
            </Text>
            <Text style={styles.fieldValue}>
              Proposal amount: {formatSolAmount(build.request?.lamports ?? 0)}
            </Text>
            <Text style={styles.fieldValue}>
              Destination: {build.request?.destination ?? destination}
            </Text>
            <Text style={styles.fieldValue}>
              Estimated creation cost:{' '}
              {simulation.estimatedCreatorBalanceDelta === null
                ? 'not measurable'
                : formatSolAmount(Math.abs(simulation.estimatedCreatorBalanceDelta))}
            </Text>
            <Text style={styles.fieldNote}>
              The transfer will occur only after the proposal is approved and executed.
            </Text>

            {/* Section technique FACULTATIVE, fermée par défaut : aucun CTA, et
                elle ne modifie ni le build, ni la simulation, ni la transaction. */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Toggle advanced diagnostics"
              accessibilityState={{ expanded: advancedOpen }}
              onPress={() => setAdvancedOpen((previous) => !previous)}
              style={({ pressed }) => [styles.toggle, pressed && styles.togglePressed]}
            >
              <Text style={styles.toggleText}>
                {advancedOpen ? 'Hide advanced diagnostics' : 'Advanced diagnostics'}
              </Text>
            </Pressable>

            {advancedOpen ? (
              <View style={styles.block}>
                <Text style={styles.fieldNote}>Transaction index</Text>
                <Text style={styles.monoValue}>{build.transactionIndexNext}</Text>
                <Text style={styles.fieldNote}>
                  Internal sequence number used by the multisig.
                </Text>

                <Text style={styles.fieldNote}>Transaction PDA</Text>
                <Text selectable style={styles.monoValue}>{build.transactionPda}</Text>
                <Text style={styles.fieldNote}>Proposal PDA</Text>
                <Text selectable style={styles.monoValue}>{build.proposalPda}</Text>
                <Text style={styles.fieldNote}>
                  Program-derived account addresses used internally by Squads.
                </Text>

                <Text style={styles.fieldNote}>Compute units</Text>
                <Text style={styles.monoValue}>{simulation.unitsConsumed ?? 'unknown'}</Text>
                <Text style={styles.fieldNote}>
                  Compute units measure the processing resources used by the simulated
                  transaction.
                </Text>

                {/* SECOND niveau : les logs complets ne s'affichent qu'après un
                    second tap. Aucun log n'est supprimé. */}
                {simulation.logs.length > 0 ? (
                  <>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Toggle simulation logs"
                      accessibilityState={{ expanded: simulationLogsOpen }}
                      onPress={() => setSimulationLogsOpen((previous) => !previous)}
                      style={({ pressed }) => [styles.toggle, pressed && styles.togglePressed]}
                    >
                      <Text style={styles.toggleText}>
                        {simulationLogsOpen
                          ? `Hide simulation logs (${simulation.logs.length})`
                          : `Simulation logs (${simulation.logs.length})`}
                      </Text>
                    </Pressable>
                    {simulationLogsOpen
                      ? simulation.logs.map((log, position) => (
                          <Text key={`simulation-log-${position}`} style={styles.monoValue}>
                            {log}
                          </Text>
                        ))
                      : null}
                  </>
                ) : null}
              </View>
            ) : null}
          </View>
        ) : null}

        {otherWarnings.length > 0 ? (
          <InfoBox glyph="⚠" style={styles.infoBox} tone="warning">
            {otherWarnings.map((warning) => (
              <InfoText key={warning} tone="warning">
                · {warning}
              </InfoText>
            ))}
          </InfoBox>
        ) : null}

        {/* Section explicative FACULTATIVE, fermée par défaut : information pure,
            sans effet sur les validations ni sur la transaction. */}
        {explainers.length > 0 ? (
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Toggle how proposal creation works"
              accessibilityState={{ expanded: howItWorksOpen }}
              onPress={() => setHowItWorksOpen((previous) => !previous)}
              style={({ pressed }) => [styles.toggle, pressed && styles.togglePressed]}
            >
              <Text style={styles.toggleText}>
                {howItWorksOpen
                  ? 'Hide how proposal creation works'
                  : 'How proposal creation works'}
              </Text>
            </Pressable>
            {howItWorksOpen ? (
              <InfoBox style={styles.infoBox}>
                {explainers.map((warning) => (
                  <InfoText key={warning}>· {warning}</InfoText>
                ))}
              </InfoBox>
            ) : null}
          </>
        ) : null}

        {/* CTA PRINCIPAL unique « Create proposal » (handler réel existant) +
            CTA secondaire « Edit details ». Aucune action redondante. */}
        {createCtaVisible ? (
          <>
            <PillButton
              accessibilityLabel="Create proposal"
              busy={creating}
              disabled={creating}
              label="Create proposal"
              onPress={onCreate}
            />
            {createResult === null ? (
              <PillButton
                accessibilityLabel="Edit details"
                label="Edit details"
                onPress={onEditDetails}
                variant="secondary"
              />
            ) : null}
          </>
        ) : null}

        {creating ? (
          <Text style={styles.fieldNote}>Waiting for the wallet…</Text>
        ) : null}

        {createError !== null ? (
          <InfoBox glyph="⚠" style={styles.infoBox} tone="error">
            <InfoText tone="error">{createError}</InfoText>
          </InfoBox>
        ) : null}

        {createResult !== null ? (
          <View
            style={
              attemptOutcome !== null && attemptOutcome.tone === 'success'
                ? styles.successBox
                : styles.errorBox
            }
          >
            <Text
              style={
                attemptOutcome !== null && attemptOutcome.tone === 'success'
                  ? styles.successTitle
                  : styles.errorTitle
              }
            >
              {/* Sans signature, jamais « Sent » : le libellé vient du verdict. */}
              {attemptOutcome?.label ?? 'Proposal created and verified'}
            </Text>
            <Text selectable style={styles.monoValue}>
              Signature: {createResult.signature ?? 'none'}
            </Text>
            {createResult.readBack !== null ? (
              <>
                <Text style={styles.monoValue}>
                  Proposal: {createResult.readBack.proposalStatus ?? 'unknown'} ·{' '}
                  {createResult.readBack.proposalApprovedCount ?? 0} approval(s)
                </Text>
                <Text style={styles.monoValue}>
                  Transaction index: {createResult.readBack.transactionIndex ?? 'unknown'} ·
                  vault index {createResult.readBack.transactionVaultIndex ?? 'unknown'}
                </Text>
                <Text style={styles.monoValue}>
                  Creator recorded as approver:{' '}
                  {createResult.readBack.creatorIsApprover === null
                    ? 'not observable'
                    : createResult.readBack.creatorIsApprover
                      ? 'yes'
                      : 'no'}
                </Text>
                <Text selectable style={styles.monoValue}>
                  {createResult.readBack.proposalAddress}
                </Text>
              </>
            ) : null}
            {attemptOutcome !== null && attemptOutcome.tone === 'success' ? (
              <>
                <Text style={styles.fieldNote}>
                  {postCreate === 'refreshing'
                    ? 'Refreshing proposals…'
                    : postCreate === 'failed'
                      ? 'Proposal created, but the proposal list could not be refreshed.'
                      : 'The proposal list was refreshed from the chain.'}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Open the created proposal"
                  disabled={
                    createResult.readBack === null ||
                    createResult.readBack.transactionIndex === null
                  }
                  onPress={() => {
                    const createdIndex = createResult.readBack?.transactionIndex ?? null;
                    if (createdIndex !== null) {
                      onOpenCreatedProposal?.(createdIndex);
                    }
                  }}
                  style={({ pressed }) => [
                    styles.secondaryButton,
                    pressed && styles.secondaryPressed,
                    (createResult.readBack === null ||
                      createResult.readBack.transactionIndex === null) &&
                      styles.disabled,
                  ]}
                >
                  <Text style={styles.secondaryText}>Open proposal</Text>
                </Pressable>
              </>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Go to proposals list"
              disabled={postCreate === 'refreshing'}
              onPress={onDone}
              style={({ pressed }) => [
                styles.secondaryButton,
                pressed && styles.secondaryPressed,
                postCreate === 'refreshing' && styles.disabled,
              ]}
            >
              <Text style={styles.secondaryText}>
                {postCreate === 'refreshing' ? 'Refreshing proposals…' : 'Go to Proposals'}
              </Text>
            </Pressable>
          </View>
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Cancel and go back"
          onPress={onBack}
          style={({ pressed }) => [styles.cancel, pressed && styles.secondaryPressed]}
        >
          <Text style={styles.cancelText}>Cancel</Text>
        </Pressable>

        {createResult !== null && createResult.validationWarnings.length > 0 ? (
          <InfoBox glyph="⚠" style={styles.infoBox} tone="warning">
            {createResult.validationWarnings.map((warning) => (
              <InfoText key={warning} tone="warning">
                · {warning}
              </InfoText>
            ))}
          </InfoBox>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  keyboardAvoider: { backgroundColor: colors.background, flex: 1, width: '100%' },
  scrollView: { backgroundColor: colors.background, flex: 1, width: '100%' },
  container: {
    alignItems: 'stretch',
    backgroundColor: colors.background,
    flexGrow: 1,
    padding: spacing.lg,
    // Assez d'espace sous le contenu pour que MEMO et « Review proposal »
    // restent atteignables par scroll quand le clavier est ouvert.
    paddingBottom: 160,
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
  backButtonPressed: { backgroundColor: colors.surface },
  backGlyph: { color: colors.text, fontSize: 24, lineHeight: 26 },
  kicker: {
    color: colors.textMuted,
    fontSize: typography.micro,
    fontWeight: '700',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  title: {
    color: colors.text,
    fontSize: typography.screenTitle,
    fontWeight: '800',
    marginTop: spacing.xs,
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: typography.secondary,
    lineHeight: 19,
    marginTop: spacing.sm,
  },
  steps: {
    alignItems: 'center',
    flexDirection: 'row',
    marginBottom: spacing.lg,
    marginTop: spacing.lg,
  },
  stepActive: {
    color: colors.mint,
    fontSize: typography.caption,
    fontWeight: '800',
    marginRight: spacing.lg,
  },
  stepIdle: {
    color: colors.textMuted,
    fontSize: typography.caption,
    fontWeight: '700',
    marginRight: spacing.lg,
  },
  block: { alignSelf: 'stretch' },
  fieldLabel: {
    color: colors.textMuted,
    fontSize: typography.micro,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginTop: spacing.lg,
    textTransform: 'uppercase',
  },
  amountRow: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    marginTop: spacing.sm,
  },
  amountInput: {
    color: colors.text,
    flex: 1,
    fontSize: typography.balance,
    fontWeight: '800',
    paddingVertical: spacing.xs,
  },
  amountUnit: {
    color: colors.textSecondary,
    fontSize: typography.sectionTitle,
    fontWeight: '700',
    marginBottom: spacing.sm,
    marginLeft: spacing.sm,
  },
  input: {
    backgroundColor: colors.surfaceElevated,
    borderColor: colors.divider,
    borderRadius: radii.field,
    borderWidth: 1,
    color: colors.text,
    fontSize: typography.bodySmall,
    marginTop: spacing.sm,
    minHeight: 48,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  memoInput: { minHeight: 72, textAlignVertical: 'top' },
  fieldNote: {
    color: colors.textSecondary,
    fontSize: typography.secondary,
    lineHeight: 18,
    marginTop: spacing.sm,
  },
  fieldValue: {
    color: colors.text,
    fontSize: typography.body,
    fontWeight: '700',
    marginTop: spacing.xs,
  },
  toggle: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.divider,
    borderRadius: radii.field,
    borderWidth: 1,
    justifyContent: 'center',
    marginTop: spacing.md,
    minHeight: 48,
    paddingHorizontal: spacing.md,
  },
  togglePressed: { backgroundColor: colors.surfaceElevated },
  toggleText: { color: colors.text, fontSize: typography.bodySmall, fontWeight: '700' },
  moreOptions: {
    backgroundColor: colors.surface,
    borderColor: colors.divider,
    borderRadius: radii.card,
    borderWidth: 1,
    marginTop: spacing.md,
    padding: spacing.lg,
  },
  infoBox: { marginTop: spacing.md },
  errorBox: {
    alignSelf: 'stretch',
    backgroundColor: colors.errorSoft,
    borderColor: colors.errorSoft,
    borderRadius: radii.field,
    borderWidth: 1,
    marginTop: spacing.md,
    padding: spacing.md,
  },
  errorTitle: { color: colors.error, fontSize: typography.bodySmall, fontWeight: '800' },
  successBox: {
    alignSelf: 'stretch',
    backgroundColor: colors.successSoft,
    borderColor: colors.successSoft,
    borderRadius: radii.field,
    borderWidth: 1,
    marginTop: spacing.md,
    padding: spacing.md,
  },
  successTitle: { color: colors.success, fontSize: typography.bodySmall, fontWeight: '800' },
  noticeBox: {
    alignSelf: 'stretch',
    backgroundColor: colors.surfaceElevated,
    borderColor: colors.divider,
    borderRadius: radii.field,
    borderWidth: 1,
    marginTop: spacing.md,
    padding: spacing.md,
  },
  noticeTitle: { color: colors.mint, fontSize: typography.bodySmall, fontWeight: '800' },
  monoValue: {
    color: colors.textSecondary,
    fontFamily: 'monospace',
    fontSize: typography.micro,
    marginTop: spacing.xs,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: colors.text,
    borderRadius: radii.button,
    justifyContent: 'center',
    marginTop: spacing.xl,
    minHeight: 52,
    paddingHorizontal: spacing.xl,
  },
  primaryPressed: { opacity: 0.82 },
  buttonText: { color: colors.onLight, fontSize: typography.body, fontWeight: '800', textAlign: 'center' },
  secondaryButton: {
    alignItems: 'center',
    backgroundColor: colors.surfaceElevated,
    borderColor: colors.divider,
    borderRadius: radii.button,
    borderWidth: 1,
    justifyContent: 'center',
    marginTop: spacing.md,
    minHeight: 48,
    paddingHorizontal: spacing.lg,
  },
  secondaryPressed: { backgroundColor: colors.surface },
  secondaryText: { color: colors.text, fontSize: typography.bodySmall, fontWeight: '700', textAlign: 'center' },
  createButton: { marginTop: spacing.xl },
  maxButton: { alignSelf: 'flex-start', marginTop: spacing.sm, paddingHorizontal: spacing.xl },
  // Etat desactive LISIBLE (WCAG AA) : fond gris-clair + texte presque noir
  // (colors.onLight) => contraste ~7:1. Avant, fond `colors.disabled` (#1B2925)
  // sur texte #08110F : le CTA principal disparaissait quand le formulaire etait
  // vide. Un etat desactive doit rester LISIBLE, jamais invisible.
  disabled: { backgroundColor: colors.textSecondary, borderColor: colors.textSecondary },
  cancel: {
    alignItems: 'center',
    borderRadius: radii.button,
    justifyContent: 'center',
    marginTop: spacing.lg,
    minHeight: 48,
  },
  cancelText: { color: colors.textSecondary, fontSize: typography.bodySmall, fontWeight: '700' },
});
