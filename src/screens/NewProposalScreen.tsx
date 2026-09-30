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

import { modelFromInstructions } from '../solana/decodeTransactionMessage';
import { connection } from '../solana/connection';
import {
  buildProposalCreation,
  PROPOSAL_CREATION_EXPLAINERS,
} from '../squads/buildProposalCreation';
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
import { TransactionReviewScreen } from './TransactionReviewScreen';
import { formatMwaError } from '../wallet/mwaDiagnostics';
import { buildOperationReport, classifyOperationResult, describeAttemptOutcome, isTemporaryNetworkFailure } from '../wallet/operationState';
import { signingStateTitle } from '../wallet/signingWindow';
import { AddressInput } from '../ui/AddressInput';
import { SAFE_TOP_PADDING } from '../ui/safeAreaPadding';
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
 */

const LAMPORTS_PER_SOL = 1_000_000_000;

function formatSol(lamports: number): string {
  return `${(lamports / LAMPORTS_PER_SOL).toFixed(9)} SOL`;
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
  const [reviewOpen, setReviewOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createResult, setCreateResult] = useState<ProposalCreationSignSendResult | null>(null);
  const sendAttemptedRef = useRef(false);
  /** Suivi de l'actualisation post-création (une seule, on-chain). */
  const [postCreate, setPostCreate] = useState<'idle' | 'refreshing' | 'done' | 'failed'>('idle');
  /** Section technique repliable, FERMÉE par défaut. */
  const [advancedOpen, setAdvancedOpen] = useState(false);
  /** Section explicative repliable, FERMÉE par défaut. */
  const [howItWorksOpen, setHowItWorksOpen] = useState(false);
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

  const reviewModel = useMemo(() => {
    if (!reviewOpen || build.messageInstructions.length === 0) return null;
    return modelFromInstructions(build.messageInstructions, {
      isPreview: true,
      multisigAddress: address,
      network: 'devnet',
      proposalIndex: build.transactionIndexNext ?? 0,
      proposalStatus: 'Not created yet',
      signerWallet: creator,
      vaultAddress,
    });
  }, [address, build.messageInstructions, build.transactionIndexNext, creator, reviewOpen, vaultAddress]);

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

  // Revue locale : l'opération du message (transfert SOL), pas la transaction
  // de création. Aucun contexte de guard réel : la proposition n'existe pas.
  if (reviewOpen && reviewModel !== null) {
    return (
      <TransactionReviewScreen
        guardContext={null}
        model={reviewModel}
        onBack={() => setReviewOpen(false)}
      />
    );
  }

  return (
    <KeyboardAvoidingView behavior="padding" style={[styles.keyboardAvoider, SAFE_TOP_PADDING]}>
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
        style={styles.scrollView}
      >
        <Text style={styles.badge}>DEVNET · SOL TRANSFER</Text>
        <Text style={styles.title}>New proposal</Text>
        <Text style={styles.subtitle}>
          Nothing is signed or sent until the pipeline is green and you confirm twice.
        </Text>

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
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="decimal-pad"
            onChangeText={setSolText}
            placeholder="e.g. 0.02"
            placeholderTextColor="#9ca3af"
            style={styles.input}
            value={solText}
          />
          <Text style={styles.fieldNote}>
            {Number.isFinite(lamports) && lamports > 0
              ? `Proposal amount: ${formatSolAmount(lamports)}`
              : parsedSol.ok
                ? 'Enter an amount to continue.'
                : SOL_AMOUNT_MESSAGES[parsedSol.reason]}
          </Text>

          {/* Max : relit le solde confirme puis fige un montant exact. Le buffer
              est EXPLICITE et facultatif : aucune reserve cachee n'est appliquee. */}
          <Text style={styles.fieldLabel}>Optional safety buffer (SOL)</Text>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="decimal-pad"
            onChangeText={setBufferText}
            placeholder="e.g. 0.001"
            placeholderTextColor="#9ca3af"
            style={styles.input}
            value={bufferText}
          />
          <Text style={styles.fieldNote}>
            Amount kept in the Main vault when using Max.
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Fill the maximum transferable amount"
            onPress={() => {
              void onMax();
            }}
            style={[styles.button, styles.secondary, styles.maxButton]}
          >
            <Text style={styles.secondaryText}>Max</Text>
          </Pressable>

          {maxSummaryVisible && maxPlan !== null ? (
            <View style={maxPlan.ready ? styles.noticeBox : styles.errorBox}>
              <Text style={maxPlan.ready ? styles.noticeText : styles.errorText}>
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
              <Text style={styles.errorText}>{maxPlan.label}</Text>
              <Text style={styles.fieldNote}>{maxPlan.hint}</Text>
            </View>
          ) : null}

          <Text style={styles.fieldLabel}>Memo (optional)</Text>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            multiline
            onChangeText={setMemo}
            placeholder="What is this transfer for?"
            placeholderTextColor="#9ca3af"
            style={[styles.input, styles.memoInput]}
            value={memo}
          />
        </View>

        {/* Etats utilisateur : un montant vide n'est PAS une erreur avant toute
            tentative explicite. Les messages visibles sont en SOL ; les lamports
            restent confinés à la section « Technical details ». */}
        {build.errors.length > 0 && amountAttempted ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorTitle}>
              {parsedSol.ok ? 'Not ready' : SOL_AMOUNT_MESSAGES[parsedSol.reason]}
            </Text>
            {build.errors
              .filter((error) => !/lamports/i.test(error))
              .map((error) => (
                <Text key={error} style={styles.errorText}>
                  · {error}
                </Text>
              ))}
          </View>
        ) : null}
        {/* Une seule indication de montant manquant, près du champ. Les autres
            raisons de blocage restent visibles si elles existent. */}
        {build.errors.length > 0 &&
        !amountAttempted &&
        build.errors.some((error) => !/lamports/i.test(error)) ? (
          <Text style={styles.fieldNote}>
            {build.errors.filter((error) => !/lamports/i.test(error))[0]}
          </Text>
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityState={{ busy: pipeline.status === 'working', disabled: !canRunPipeline }}
          disabled={!canRunPipeline}
          onPress={() => {
            void runPipeline();
          }}
          style={[styles.button, !canRunPipeline && styles.disabled]}
        >
          {pipeline.status === 'working' ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text style={styles.buttonText}>Review proposal</Text>
          )}
        </Pressable>
        <Text style={styles.fieldNote}>
          Checks the vault balance and simulates the transaction. Nothing is signed or sent.
        </Text>

        {pipeline.status === 'error' ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorTitle}>Pipeline stopped before any signature</Text>
            <Text style={styles.errorText}>{pipeline.message}</Text>
          </View>
        ) : null}

        {simulation !== null && preflight !== null ? (
          <View style={pipeline.status === 'ready' ? styles.successBox : styles.noticeBox}>
            <Text style={pipeline.status === 'ready' ? styles.successTitle : styles.warningText}>
              {pipeline.status === 'ready' ? 'Simulation succeeded' : 'Simulation did not pass'}
            </Text>
            <Text style={styles.fieldValue}>
              Proposal amount: {formatSolAmount(build.request?.lamports ?? 0)}
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
              style={[styles.button, styles.secondary]}
            >
              <Text style={styles.secondaryText}>
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

                {simulation.logs.length > 0 ? (
                  <>
                    <Text style={styles.fieldNote}>Simulation logs ({simulation.logs.length})</Text>
                    {simulation.logs.slice(0, 12).map((log) => (
                      <Text key={log} style={styles.monoValue}>
                        {log}
                      </Text>
                    ))}
                  </>
                ) : null}
              </View>
            ) : null}
          </View>
        ) : null}

        {otherWarnings.length > 0 ? (
          <View style={styles.noticeBox}>
            {otherWarnings.map((warning) => (
              <Text key={warning} style={styles.warningText}>
                · {warning}
              </Text>
            ))}
          </View>
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
              style={[styles.button, styles.secondary]}
            >
              <Text style={styles.secondaryText}>
                {howItWorksOpen
                  ? 'Hide how proposal creation works'
                  : 'How proposal creation works'}
              </Text>
            </Pressable>
            {howItWorksOpen ? (
              <View style={styles.noticeBox}>
                {explainers.map((warning) => (
                  <Text key={warning} style={styles.warningText}>
                    · {warning}
                  </Text>
                ))}
              </View>
            ) : null}
          </>
        ) : null}

        {pipeline.status === 'ready' ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Review the transfer to be created"
            onPress={() => setReviewOpen(true)}
            style={[styles.button, styles.secondary]}
          >
            <Text style={styles.secondaryText}>Review the transfer</Text>
          </Pressable>
        ) : null}

        {pipeline.status === 'ready' || createResult !== null ? (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{
              busy: creating,
              disabled: creating || (createResult !== null && !(attemptOutcome?.allowNewAttempt ?? false)),
            }}
            disabled={creating || (createResult !== null && !(attemptOutcome?.allowNewAttempt ?? false))}
            onPress={onCreate}
            style={[
              styles.button,
              styles.createButton,
              (creating || (createResult !== null && !(attemptOutcome?.allowNewAttempt ?? false))) &&
                styles.disabled,
            ]}
          >
            {creating ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text style={styles.buttonText}>
                {createResult !== null && (attemptOutcome?.allowNewAttempt ?? false)
                  ? 'Prepare again'
                  : 'Create on Devnet'}
              </Text>
            )}
          </Pressable>
        ) : null}

        {creating ? (
          <Text style={styles.fieldNote}>Waiting for the wallet…</Text>
        ) : null}

        {createError !== null ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{createError}</Text>
          </View>
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
                  style={[
                    styles.button,
                    styles.secondary,
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
              style={[styles.button, styles.secondary, postCreate === 'refreshing' && styles.disabled]}
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
          style={styles.cancel}
        >
          <Text style={styles.cancelText}>Cancel</Text>
        </Pressable>

        {createResult !== null && createResult.validationWarnings.length > 0 ? (
          <View style={styles.noticeBox}>
            {createResult.validationWarnings.map((warning) => (
              <Text key={warning} style={styles.warningText}>
                · {warning}
              </Text>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  keyboardAvoider: { flex: 1, width: '100%' },
  scrollView: { flex: 1, width: '100%' },
  container: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    flexGrow: 1,
    padding: 24,
    paddingBottom: 96,
  },
  badge: {
    backgroundColor: '#eef2ff',
    borderRadius: 999,
    color: '#4338ca',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 8,
    overflow: 'hidden',
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  title: { fontSize: 22, fontWeight: '700' },
  subtitle: {
    color: '#6b7280',
    fontSize: 13,
    marginBottom: 8,
    marginTop: 4,
    textAlign: 'center',
  },
  block: { alignSelf: 'stretch' },
  fieldLabel: {
    color: '#6b7280',
    fontSize: 11,
    marginTop: 16,
    textTransform: 'uppercase',
  },
  input: {
    borderColor: '#d1d5db',
    borderRadius: 10,
    borderWidth: 1,
    color: '#101317',
    fontSize: 14,
    marginTop: 6,
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  memoInput: { minHeight: 72, textAlignVertical: 'top' },
  fieldNote: { color: '#6b7280', fontSize: 12, marginTop: 6 },
  fieldValue: { color: '#101317', fontSize: 16, fontWeight: '700', marginTop: 4 },
  errorBox: {
    alignSelf: 'stretch',
    backgroundColor: '#fef2f2',
    borderColor: '#fecaca',
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 16,
    padding: 12,
  },
  errorTitle: { color: '#991b1b', fontSize: 14, fontWeight: '800' },
  errorText: { color: '#991b1b', fontSize: 12, marginTop: 4 },
  successBox: {
    alignSelf: 'stretch',
    backgroundColor: '#ecfdf5',
    borderColor: '#a7f3d0',
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 16,
    padding: 12,
  },
  successTitle: { color: '#065f46', fontSize: 14, fontWeight: '800' },
  noticeBox: {
    alignSelf: 'stretch',
    backgroundColor: '#eef2ff',
    borderColor: '#c7d2fe',
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 16,
    padding: 12,
  },
  noticeText: { color: '#3730a3', fontSize: 14, fontWeight: '800' },
  maxButton: {
    alignSelf: 'flex-start',
    marginTop: 8,
    paddingHorizontal: 24,
  },
  warningText: { color: '#3730a3', fontSize: 12, marginTop: 4 },
  monoValue: { color: '#101317', fontFamily: 'monospace', fontSize: 11, marginTop: 4 },
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
  buttonText: { color: '#ffffff', fontSize: 15, fontWeight: '700', textAlign: 'center' },
  createButton: { backgroundColor: '#047857', marginTop: 20 },
  secondary: {
    backgroundColor: '#f3f4f6',
    borderColor: '#d1d5db',
    borderWidth: 1,
    marginTop: 12,
  },
  secondaryText: { color: '#101317', fontSize: 15, fontWeight: '700', textAlign: 'center' },
  disabled: { backgroundColor: '#9ca3af' },
  cancel: {
    alignItems: 'center',
    backgroundColor: '#f3f4f6',
    borderColor: '#d1d5db',
    borderRadius: 10,
    borderWidth: 1,
    justifyContent: 'center',
    marginTop: 24,
    minHeight: 48,
    width: '100%',
  },
  cancelText: { color: '#101317', fontSize: 15, fontWeight: '700' },
});