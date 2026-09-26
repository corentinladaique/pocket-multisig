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
import { buildProposalCreation } from '../squads/buildProposalCreation';
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
import { computeMaxTransfer, type MaxTransferPlan } from '../vault/maxTransfer';

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
  onDone,
  transactionIndex,
  vaultAddress,
}: {
  /** Adresse du multisig (PAS le vault). */
  address: string;
  /** Membres et rôles, lus par l'écran appelant (aucune lecture ici). */
  members: readonly { address: string; roles: readonly string[] }[];
  onBack: () => void;
  /** Appelé après une création vérifiée, pour revenir à la liste. */
  onDone: () => void;
  transactionIndex: number;
  vaultAddress: string;
}) {
  const { account, signAndSendTransactions } = useMobileWallet();
  const creator = account === undefined ? '' : account.address.toString();

  const [destination, setDestination] = useState('');
  const [lamportsText, setLamportsText] = useState('');
  /** Buffer EXPLICITE choisi par l'utilisateur : jamais une réserve cachée. */
  const [bufferText, setBufferText] = useState('');
  const [maxPlan, setMaxPlan] = useState<MaxTransferPlan | null>(null);
  const [memo, setMemo] = useState('');

  const [pipeline, setPipeline] = useState<PipelineState>({ status: 'idle' });
  const [preflight, setPreflight] = useState<ProposalCreationPreflightResult | null>(null);
  const [simulation, setSimulation] = useState<ProposalCreationSimulationResult | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createResult, setCreateResult] = useState<ProposalCreationSignSendResult | null>(null);
  const sendAttemptedRef = useRef(false);
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

  // Saisie entiere uniquement : tout le reste devient NaN et le builder refuse.
  const lamports = /^\d+$/.test(lamportsText.trim()) ? Number(lamportsText.trim()) : Number.NaN;

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
    const bufferLamports = /^\d+$/.test(bufferText.trim()) ? Number(bufferText.trim()) : 0;
    const plan = computeMaxTransfer({
      explicitBufferLamports: bufferLamports,
      // Faits du chemin de code : ce formulaire ne construit qu'un transfert SOL
      // dont la source est le Main vault (buildProposalCreation).
      recognizedSolTransfer: true,
      sourceMatchesMainVault: true,
      vaultLamports: freshLamports,
    });
    setMaxPlan(plan);
    if (plan.amountLamports !== null) {
      // Montant figé maintenant : il ne suivra jamais un solde futur.
      setLamportsText(String(plan.amountLamports));
      setPipeline({ status: 'idle' });
      setPreflight(null);
      setSimulation(null);
    }
  }, [bufferText, vaultAddress]);

  /** Portes locales + une lecture de solde, puis simulation (aucun envoi). */
  const runPipeline = async (): Promise<ProposalCreationSimulationResult | null> => {
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
    } catch (caught: unknown) {
      setCreateError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      if (signature === null) sendAttemptedRef.current = false;
      setCreating(false);
    }
  };

  /** Double confirmation explicite avant toute demande au wallet. */
  const onCreate = () => {
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
        `Next index: ${build.transactionIndexNext} · ${members.length} member(s)`,
        `Estimated cost to you: ${
          simulation.estimatedCreatorBalanceDelta ?? 'not measurable'
        } lamports`,
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
    <KeyboardAvoidingView behavior="padding" style={styles.keyboardAvoider}>
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
          <Text style={styles.fieldLabel}>Destination</Text>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setDestination}
            placeholder="Public address"
            placeholderTextColor="#9ca3af"
            style={styles.input}
            value={destination}
          />

          <Text style={styles.fieldLabel}>Amount (lamports)</Text>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="number-pad"
            onChangeText={setLamportsText}
            placeholder="1000000"
            placeholderTextColor="#9ca3af"
            style={styles.input}
            value={lamportsText}
          />
          <Text style={styles.fieldNote}>
            {Number.isFinite(lamports) && lamports > 0
              ? `= ${formatSol(lamports)}`
              : 'Integer number of lamports, greater than 0.'}
          </Text>

          {/* Max : relit le solde confirme puis fige un montant exact. Le buffer
              est EXPLICITE et facultatif : aucune reserve cachee n'est appliquee. */}
          <Text style={styles.fieldLabel}>Optional explicit buffer (lamports)</Text>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="number-pad"
            onChangeText={setBufferText}
            placeholder="0"
            placeholderTextColor="#9ca3af"
            style={styles.input}
            value={bufferText}
          />
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

          {maxPlan !== null ? (
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
                    Explicit buffer: {maxPlan.bufferLamports} lamports
                  </Text>
                  <Text style={styles.fieldNote}>Estimated remaining balance</Text>
                  <Text selectable style={styles.monoValue}>
                    {formatSol(maxPlan.remainingLamports ?? 0)} SOL
                  </Text>
                </>
              ) : null}
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

        {build.errors.length > 0 ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorTitle}>Not ready</Text>
            {build.errors.map((error) => (
              <Text key={error} style={styles.errorText}>
                · {error}
              </Text>
            ))}
          </View>
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
            <Text style={styles.buttonText}>Check locally and simulate</Text>
          )}
        </Pressable>
        <Text style={styles.fieldNote}>
          Reads the vault balance, runs the local preflight, then simulates. No signature, no
          send.
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
            <Text style={styles.monoValue}>Next index: {build.transactionIndexNext}</Text>
            <Text selectable style={styles.monoValue}>Transaction PDA: {build.transactionPda}</Text>
            <Text selectable style={styles.monoValue}>Proposal PDA: {build.proposalPda}</Text>
            <Text style={styles.monoValue}>
              Estimated cost to you: {simulation.estimatedCreatorBalanceDelta ?? 'not measurable'}{' '}
              lamports
            </Text>
            <Text style={styles.monoValue}>
              Compute units: {simulation.unitsConsumed ?? 'unknown'}
            </Text>
          </View>
        ) : null}

        <View style={styles.noticeBox}>
          {build.warnings.map((warning) => (
            <Text key={warning} style={styles.warningText}>
              · {warning}
            </Text>
          ))}
        </View>

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
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Back to proposals list"
              onPress={onDone}
              style={[styles.button, styles.secondary]}
            >
              <Text style={styles.secondaryText}>Back to proposals</Text>
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