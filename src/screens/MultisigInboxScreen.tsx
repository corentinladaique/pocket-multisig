import { useCallback, useEffect } from 'react';
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

import { shortenMemberAddress } from '../vault/vaultDraft';
import { SAFE_TOP_PADDING } from '../ui/safeAreaPadding';
import type { MultisigRegistryEntry } from '../vault/multisigRegistry';
import { useMultisigRegistry } from '../vault/useMultisigRegistry';

/**
 * Inbox des multisigs connus.
 *
 * Ecran de lecture seule : il n'affiche que le registre LOCAL (aucun RPC, aucune
 * blockchain, aucune signature, aucune creation). Le tap sur une entree remonte
 * un callback simple vers l'appelant ; l'ecran de detail viendra ensuite.
 */

function formatAddedAt(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toISOString().slice(0, 10);
}

export function MultisigInboxScreen({
  onBack,
  onOpenMultisig,
}: {
  onBack: () => void;
  /** Callback simple : l'ecran de detail n'existe pas encore. */
  onOpenMultisig: (entry: MultisigRegistryEntry) => void;
}) {
  const registry = useMultisigRegistry();

  // Retour systeme Android (bouton physique et geste) : rend la main a l'appelant.
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onBack();
      return true;
    });
    return () => subscription.remove();
  }, [onBack]);

  const onReload = useCallback(() => {
    registry.refresh();
  }, [registry]);

  return (
    <KeyboardAvoidingView behavior="padding" style={[styles.keyboardAvoider, SAFE_TOP_PADDING]}>
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
        style={styles.scrollView}
      >
        <Text style={styles.badge}>DEVNET</Text>
        <Text style={styles.title}>My multisigs</Text>
        <Text style={styles.subtitle}>Saved on this device only. Nothing is read on-chain here.</Text>

        {registry.status === 'loading' ? (
          <View style={styles.centerBlock}>
            <ActivityIndicator color="#1a56db" />
            <Text style={styles.hint}>Loading local registry…</Text>
          </View>
        ) : null}

        {registry.status !== 'loading' && registry.entries.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyTitle}>No multisig saved yet</Text>
            <Text style={styles.emptyText}>
              Multisigs you create from this app are added here automatically. A multisig you
              are a member of can be added manually from the main screen.
            </Text>
          </View>
        ) : null}

        {registry.entries.map((entry) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Open ${entry.vaultName.length > 0 ? entry.vaultName : entry.address}`}
            key={entry.address}
            onPress={() => onOpenMultisig(entry)}
            style={styles.entryCard}
          >
            <Text style={styles.entryName}>
              {entry.vaultName.length > 0 ? entry.vaultName : 'Untitled vault'}
            </Text>
            <Text style={styles.entryAddress}>{shortenMemberAddress(entry.address)}</Text>
            <Text style={styles.entryMeta}>
              {entry.source === 'created' ? 'Created here' : 'Added manually'} ·{' '}
              {formatAddedAt(entry.addedAt)}
            </Text>
          </Pressable>
        ))}

        {registry.warnings.length > 0 ? (
          <View style={styles.noticeBox}>
            {registry.warnings.map((warning) => (
              <Text key={warning} style={styles.warningText}>{warning}</Text>
            ))}
          </View>
        ) : null}

        {registry.error !== null ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{registry.error}</Text>
          </View>
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Reload local registry"
          onPress={onReload}
          style={styles.retry}
        >
          <Text style={styles.retryText}>Reload</Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to main screen"
          onPress={onBack}
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
    marginBottom: 16,
    marginTop: 4,
    textAlign: 'center',
  },
  centerBlock: {
    alignItems: 'center',
    marginTop: 24,
  },
  emptyBox: {
    alignSelf: 'stretch',
    backgroundColor: '#f9fafb',
    borderColor: '#e5e7eb',
    borderRadius: 10,
    borderStyle: 'dashed',
    borderWidth: 1,
    marginTop: 8,
    padding: 16,
  },
  emptyTitle: {
    color: '#111827',
    fontSize: 15,
    fontWeight: '800',
  },
  emptyText: {
    color: '#4b5563',
    fontSize: 13,
    marginTop: 6,
  },
  entryCard: {
    alignSelf: 'stretch',
    backgroundColor: '#f9fafb',
    borderColor: '#e5e7eb',
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 10,
    padding: 14,
  },
  entryName: {
    color: '#111827',
    fontSize: 16,
    fontWeight: '800',
  },
  entryAddress: {
    color: '#101317',
    fontFamily: 'monospace',
    fontSize: 12,
    marginTop: 2,
  },
  entryMeta: {
    color: '#6b7280',
    fontSize: 12,
    marginTop: 6,
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
  hint: {
    color: '#6b7280',
    fontSize: 13,
    marginTop: 8,
  },
  warningText: {
    color: '#92400e',
    fontSize: 12,
    marginTop: 4,
  },
  noticeBox: {
    alignSelf: 'stretch',
    backgroundColor: '#eef2ff',
    borderColor: '#c7d2fe',
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 16,
    padding: 12,
  },
  errorBox: {
    alignSelf: 'stretch',
    backgroundColor: '#fef2f2',
    borderColor: '#fecaca',
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 16,
    padding: 12,
  },
  errorText: {
    color: '#991b1b',
    fontSize: 13,
  },
  retry: {
    alignItems: 'center',
    marginTop: 16,
    paddingVertical: 8,
  },
  retryText: {
    color: '#1a56db',
    fontSize: 15,
    fontWeight: '600',
  },
});