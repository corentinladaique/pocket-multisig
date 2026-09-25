import { useCallback, useEffect, useMemo } from 'react';
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

import {
  buildPreviewData,
  buildTransactionPreviewData,
  type VaultCreationRequest,
} from '../vault/vaultDraft';
import type { MultisigCreationSignSendResult } from '../vault/signAndSendMultisigCreation';
import type { OperationReport } from '../wallet/operationState';
import { signingStateTitle } from '../wallet/signingWindow';

/**
 * Preview de transaction.
 *
 * Affiche ce que serait la transaction de creation, et porte le declencheur
 * explicite de la creation reelle : le bouton "Create on Devnet" ouvre une
 * confirmation (threshold, nombre de membres, cout simule, wallet payeur) avant
 * toute signature. Cet ecran ne construit rien et n'envoie rien lui-meme :
 * toute la sequence technique vit dans CreateVaultScreen, et rien ne part
 * depuis un effet ni depuis un rendu.
 */
export function VaultTransactionPreviewScreen({
  canCreate,
  checkReport,
  checking,
  createError,
  createResult,
  creating,
  onBack,
  onCheckTransactionAgain,
  onCreateOnDevnet,
  onReconnectWallet,
  operationReport,
  payer,
  request,
  simulatedCostLamports,
  walletLabel,
}: {
  /** Vrai seulement si le wallet et le plan permettent un envoi. */
  canCreate: boolean;
  /** Résultat du contrôle manuel de transaction (relecture seule). */
  checkReport: string | null;
  checking: boolean;
  createError: string | null;
  createResult: MultisigCreationSignSendResult | null;
  creating: boolean;
  onBack: () => void;
  /** Relecture seule : confirmation + compte métier. Ne signe ni n'envoie. */
  onCheckTransactionAgain: () => void;
  /** Declenche preparation + confirmation. Jamais appele automatiquement. */
  onCreateOnDevnet: () => void;
  /** Réautorisation wallet uniquement. */
  onReconnectWallet: () => void;
  /** Machine d'état : ce qui s'est passé et ce qui reste permis. */
  operationReport: OperationReport | null;
  payer: string | null;
  request: VaultCreationRequest;
  simulatedCostLamports: number | null;
  /** Label du wallet tel que fourni par l'autorisation, s'il existe. */
  walletLabel: string | null;
}) {
  const transaction = useMemo(
    () => buildTransactionPreviewData(buildPreviewData(request)),
    [request],
  );

  // Retour systeme Android (bouton physique et geste) : revient a Preview.
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onBack();
      return true;
    });
    return () => subscription.remove();
  }, [onBack]);

  const onBackPress = useCallback(() => {
    onBack();
  }, [onBack]);

  return (
    <KeyboardAvoidingView behavior="padding" style={styles.keyboardAvoider}>
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
        style={styles.scrollView}
      >
        <Text style={styles.badge}>DEVNET</Text>
        <Text style={styles.title}>Transaction preview</Text>
        <Text style={styles.subtitle}>
          Nothing is built, signed or sent yet.
        </Text>

        <View style={styles.block}>
          <Text style={styles.fieldLabel}>Operation</Text>
          <Text style={styles.fieldValue}>{transaction.operationType}</Text>

          <Text style={styles.fieldLabel}>Network</Text>
          <Text style={styles.fieldValue}>{transaction.network}</Text>

          <Text style={styles.fieldLabel}>Vault name</Text>
          <Text style={styles.fieldValue}>
            {transaction.vaultName.length > 0 ? transaction.vaultName : 'Untitled vault'}
          </Text>

          <Text style={styles.fieldLabel}>Signers</Text>
          <Text style={styles.fieldValue}>{transaction.signersCount}</Text>

          <Text style={styles.fieldLabel}>Threshold</Text>
          <Text style={styles.fieldValue}>
            {transaction.threshold} of {transaction.signersCount}
          </Text>

          <Text style={styles.fieldLabel}>State</Text>
          <Text style={transaction.readyForSigning ? styles.statusReady : styles.warningText}>
            {transaction.readyForSigning ? 'Ready for signing' : 'Not Ready'}
          </Text>

          {transaction.warnings.length > 0 ? (
            <View style={styles.noticeBox}>
              {transaction.warnings.map((message) => (
                <Text key={message} style={styles.warningText}>{message}</Text>
              ))}
            </View>
          ) : null}

          <View style={styles.infoBox}>
            <Text style={styles.infoText}>
              Tapping Create opens a confirmation, then builds, simulates and asks the
              wallet to sign and send this single transaction on Devnet.
            </Text>
          </View>

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
              <Text style={styles.buttonText}>Create on Devnet</Text>
            )}
          </Pressable>

          {creating ? (
            <Text style={styles.hint}>Preparing, simulating and waiting for the wallet…</Text>
          ) : null}

          <Text style={styles.hint}>
            Payer: {payer ?? 'no wallet connected'} · Estimated cost:{' '}
            {simulatedCostLamports === null ? 'not simulated yet' : `${simulatedCostLamports} lamports`}
          </Text>

          {createError !== null ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{createError}</Text>
            </View>
          ) : null}

          {createResult !== null ? (
            <View
              style={createResult.verified ? styles.successBox : styles.errorBox}
            >
              <Text style={createResult.verified ? styles.successText : styles.errorText}>
                {createResult.verified ? 'Multisig created and verified' : 'Created, but verification failed'}
              </Text>
              {createResult.signature !== null ? (
                <Text selectable style={styles.resultValue}>
                  Signature: {createResult.signature}
                </Text>
              ) : null}
              {createResult.readBack !== null ? (
                <>
                  <Text selectable style={styles.resultValue}>
                    Multisig: {createResult.readBack.address}
                  </Text>
                  <Text selectable style={styles.resultValue}>
                    Owner: {createResult.readBack.owner}
                  </Text>
                  <Text style={styles.resultValue}>
                    Threshold: {createResult.readBack.threshold} of {createResult.readBack.memberCount}
                  </Text>
                  <Text selectable style={styles.resultValue}>
                    Config authority: {createResult.readBack.configAuthority}
                  </Text>
                  <Text style={styles.resultValue}>
                    Rent collector: {createResult.readBack.rentCollector ?? 'none'}
                  </Text>
                </>
              ) : null}
            </View>
          ) : null}
        </View>

        {operationReport !== null ? (
                <View
                  style={
                    operationReport.state === 'operation-created-and-verified'
                      ? styles.successBox
                      : styles.errorBox
                  }
                >
                  <Text
                    style={
                      operationReport.state === 'operation-created-and-verified'
                        ? styles.successText
                        : styles.errorText
                    }
                  >
                    {operationReport.title}
                  </Text>
                  {createResult?.signingState !== undefined ? (
                              <Text style={styles.hint}>
                                Signing state: {signingStateTitle(createResult.signingState)}
                              </Text>
                            ) : null}
                            <Text style={styles.hint}>
                              Signature obtained: {operationReport.evidence.signatureObtained ? 'yes' : 'no'} ·
                    confirmed: {operationReport.evidence.confirmed ? 'yes' : 'no'} · read-back verified:{' '}
                    {operationReport.evidence.readBackVerified ? 'yes' : 'no'}
                  </Text>
                  {operationReport.mwa !== null ? (
                    <>
                      <Text style={styles.hint}>
                        Wallet: {walletLabel ?? 'label not provided by the wallet'}
                      </Text>
                      <Text style={styles.hint}>Step: {operationReport.mwa.step}</Text>
                      <Text style={styles.hint}>
                        Protocol code: {operationReport.mwa.code ?? 'none returned'}
                      </Text>
                      <Text style={styles.hint}>
                        Error type: {operationReport.mwa.name ?? 'not an Error instance'}
                      </Text>
                      <Text style={styles.hint}>Message: {operationReport.mwa.message}</Text>
                    </>
                  ) : null}
                  {operationReport.actions.allowCheckAgain ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{ busy: checking, disabled: checking }}
                      disabled={checking}
                      onPress={onCheckTransactionAgain}
                      style={[styles.button, styles.secondary]}
                    >
                      {checking ? (
                        <ActivityIndicator color="#101317" />
                      ) : (
                        <Text style={styles.secondaryText}>Check transaction again</Text>
                      )}
                    </Pressable>
                  ) : null}
                  {checkReport !== null ? <Text style={styles.hint}>{checkReport}</Text> : null}
                  {operationReport.actions.allowReconnect ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Reconnect wallet"
                      onPress={onReconnectWallet}
                      style={[styles.button, styles.secondary]}
                    >
                      <Text style={styles.secondaryText}>Reconnect wallet</Text>
                    </Pressable>
                  ) : null}
                  {operationReport.actions.allowPrepareAndRetry ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Prepare and retry with a fresh transaction"
                      onPress={onCreateOnDevnet}
                      style={[styles.button, styles.disabled]}
                    >
                      <Text style={styles.buttonText}>
                {createResult?.signingState === 'signature-request-expired'
                  ? 'Prepare again'
                  : 'Prepare and retry'}
              </Text>
                    </Pressable>
                  ) : null}
                  {operationReport.evidence.signatureObtained &&
                  !operationReport.actions.allowSecondSend ? (
                    <Text style={styles.hint}>
                      A signature already exists: no second send is allowed until the transaction is proven
                      absent, expired or failed.
                    </Text>
                  ) : null}
                </View>
              ) : null}

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Go back"
                onPress={onBackPress}
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
  },
  subtitle: {
    color: '#6b7280',
    fontSize: 13,
    marginBottom: 12,
    marginTop: 4,
  },
  block: {
    alignSelf: 'stretch',
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
    marginTop: 24,
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
  statusReady: {
    color: '#065f46',
    fontSize: 14,
    fontWeight: '800',
    marginTop: 2,
  },
  warningText: {
    color: '#92400e',
    fontSize: 13,
    marginTop: 4,
  },
  noticeBox: {
    backgroundColor: '#eef2ff',
    borderColor: '#c7d2fe',
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 12,
    padding: 12,
  },
  infoBox: {
    backgroundColor: '#f9fafb',
    borderColor: '#e5e7eb',
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 12,
    padding: 12,
  },
  infoText: {
    color: '#4b5563',
    fontSize: 13,
  },
  hint: {
    color: '#6b7280',
    fontSize: 13,
    marginTop: 8,
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
  },
  successBox: {
    backgroundColor: '#ecfdf5',
    borderColor: '#a7f3d0',
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 12,
    padding: 12,
  },
  successText: {
    color: '#065f46',
    fontSize: 13,
    fontWeight: '800',
  },
  resultValue: {
    color: '#101317',
    fontFamily: 'monospace',
    fontSize: 11,
    marginTop: 6,
  },
});