import { useCallback, useEffect, useMemo } from 'react';
import {
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

/**
 * Preview de transaction : lecture seule.
 *
 * Represente ce que serait la future transaction de creation du multisig.
 * Aucune instruction Squads n'est construite, aucun compte n'est lu, aucune
 * signature n'est demandee : seuls des champs locaux sont affiches.
 */
export function VaultTransactionPreviewScreen({
  onBack,
  request,
}: {
  onBack: () => void;
  request: VaultCreationRequest;
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
              No Squads instruction is constructed and no signature is requested on this
              screen. This preview is local only.
            </Text>
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: true }}
            disabled
            style={[styles.button, styles.disabled]}
          >
            <Text style={styles.buttonText}>Create on Devnet — not available yet</Text>
          </Pressable>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to preview"
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
});