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

import { buildPreviewData, type VaultCreationRequest } from '../vault/vaultDraft';

/**
 * Preview de creation : lecture seule.
 *
 * Affiche exactement ce qui serait cree (nom, seuil, signataires et adresses
 * completes, reseau) sans rien creer : aucun RPC, aucune signature, aucune API
 * Squads. Le bouton de creation reste desactive.
 */
export function VaultPreviewScreen({
  onBack,
  onOpenTransactionPreview,
  request,
}: {
  onBack: () => void;
  onOpenTransactionPreview: () => void;
  request: VaultCreationRequest;
}) {
  const preview = useMemo(() => buildPreviewData(request), [request]);

  // Retour systeme Android (bouton physique et geste) : revient a Review.
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
        <Text style={styles.title}>Vault preview</Text>
        <Text style={styles.subtitle}>Nothing is created yet.</Text>

        <View style={styles.block}>
          <Text style={styles.fieldLabel}>Vault name</Text>
          <Text style={styles.fieldValue}>
            {preview.vaultName.trim().length > 0
              ? preview.vaultName.trim()
              : 'Vault name required'}
          </Text>

          <Text style={styles.fieldLabel}>Threshold</Text>
          <Text style={styles.fieldValue}>
            {preview.threshold} of {preview.memberCount}
          </Text>

          <Text style={styles.fieldLabel}>Number of signers</Text>
          <Text style={styles.fieldValue}>{preview.memberCount}</Text>

          <Text style={styles.fieldLabel}>Signer addresses</Text>
          {preview.signers.length === 0 ? (
            <Text style={styles.hint}>No signer yet.</Text>
          ) : null}
          {preview.signers.map((signer) => (
            <View key={signer.publicKey} style={styles.signerRow}>
              <Text style={styles.signerLabel}>{signer.label}</Text>
              <Text selectable style={styles.signerAddress}>
                {signer.publicKey}
              </Text>
            </View>
          ))}

          <Text style={styles.fieldLabel}>Network</Text>
          <Text style={styles.fieldValue}>{preview.network}</Text>

          <Text style={styles.fieldLabel}>State</Text>
          <Text style={preview.readyForCreation ? styles.statusReady : styles.warningText}>
            {preview.readyForCreation ? 'Ready' : 'Not Ready'}
          </Text>

          {preview.validationErrors.length > 0 ? (
            <View style={styles.errorBox}>
              {preview.validationErrors.map((message) => (
                <Text key={message} style={styles.errorText}>{message}</Text>
              ))}
            </View>
          ) : null}

          {preview.validationWarnings.length > 0 ? (
            <View style={styles.noticeBox}>
              {preview.validationWarnings.map((message) => (
                <Text key={message} style={styles.warningText}>{message}</Text>
              ))}
            </View>
          ) : null}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open transaction preview"
            onPress={onOpenTransactionPreview}
            style={[styles.button, styles.secondary]}
          >
            <Text style={styles.secondaryText}>Transaction preview</Text>
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
            No RPC call and no signature is performed on this screen.
          </Text>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to review"
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
  signerRow: {
    backgroundColor: '#f9fafb',
    borderColor: '#e5e7eb',
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 8,
    padding: 12,
  },
  signerLabel: {
    color: '#111827',
    fontSize: 14,
    fontWeight: '700',
  },
  signerAddress: {
    color: '#101317',
    fontFamily: 'monospace',
    fontSize: 12,
    marginTop: 4,
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
  hint: {
    color: '#6b7280',
    fontSize: 13,
    marginTop: 8,
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
  noticeBox: {
    backgroundColor: '#eef2ff',
    borderColor: '#c7d2fe',
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 12,
    padding: 12,
  },
});