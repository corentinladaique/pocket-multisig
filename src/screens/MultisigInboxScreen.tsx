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
import { colors, radii, spacing, typography } from '../ui/theme';
import { DevnetPill, InfoBox, InfoText } from '../ui/v2/primitives';
import type { MultisigRegistryEntry } from '../vault/multisigRegistry';
import { useMultisigRegistry } from '../vault/useMultisigRegistry';

/**
 * My multisigs — liste du registre LOCAL (UI V2 sombre).
 *
 * Chaque carte affiche uniquement des donnees LOCALES reelles (nom local,
 * adresse abregée, provenance, date d'ajout). Aucun RPC par carte : le registre
 * local est la seule source. Le tap remonte le callback EXISTANT
 * `onOpenMultisig(entry)` (aucun handler dupliqué).
 *
 * C'est le seul ecran de liste de multisigs de l'app (il porte le titre
 * « My multisigs »). Les actions « Add existing multisig » et « Create a vault »
 * restent sur Home, ou leurs handlers existent deja : rien n'est inventé ici.
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
  /** Callback simple : ouvre le detail dans MultisigDetailsScreen V2. */
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
        <View style={styles.headerRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to main screen"
            onPress={onBack}
            style={({ pressed }) => [styles.backButton, pressed && styles.backButtonPressed]}
          >
            <Text style={styles.backGlyph}>‹</Text>
          </Pressable>
          <DevnetPill />
        </View>

        <Text style={styles.title}>My multisigs</Text>
        <Text style={styles.subtitle}>Saved on this device only.</Text>

        {registry.status === 'loading' ? (
          <View style={styles.centerBlock}>
            <ActivityIndicator color={colors.mint} />
            <Text style={styles.note}>Loading local registry…</Text>
          </View>
        ) : null}

        {registry.status !== 'loading' && registry.entries.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyTitle}>No multisigs yet</Text>
            <Text style={styles.emptyText}>Create a vault or add an existing multisig.</Text>
          </View>
        ) : null}

        {registry.entries.map((entry) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Open ${entry.vaultName.length > 0 ? entry.vaultName : entry.address}`}
            key={entry.address}
            onPress={() => onOpenMultisig(entry)}
            style={({ pressed }) => [styles.entryCard, pressed && styles.entryCardPressed]}
          >
            <View style={styles.entryBody}>
              <Text style={styles.entryName}>
                {entry.vaultName.length > 0 ? entry.vaultName : 'Untitled vault'}
              </Text>
              <Text selectable style={styles.entryAddress}>
                {shortenMemberAddress(entry.address)}
              </Text>
              <Text style={styles.entryMeta}>
                {entry.source === 'created' ? 'Created here' : 'Added manually'} ·{' '}
                {formatAddedAt(entry.addedAt)}
              </Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        ))}

        {registry.warnings.length > 0 ? (
          <InfoBox glyph="⚠" style={styles.infoBox} tone="warning">
            {registry.warnings.map((warning) => (
              <InfoText key={warning} tone="warning">
                {warning}
              </InfoText>
            ))}
          </InfoBox>
        ) : null}

        {registry.error !== null ? (
          <InfoBox glyph="⚠" style={styles.infoBox} tone="error">
            <InfoText tone="error">{registry.error}</InfoText>
          </InfoBox>
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Reload local registry"
          onPress={onReload}
          style={({ pressed }) => [styles.inlineAction, pressed && styles.inlineActionPressed]}
        >
          <Text style={styles.inlineActionText}>Reload</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  keyboardAvoider: {
    backgroundColor: colors.background,
    flex: 1,
    width: '100%',
  },
  scrollView: {
    backgroundColor: colors.background,
    flex: 1,
    width: '100%',
  },
  container: {
    alignItems: 'stretch',
    backgroundColor: colors.background,
    flexGrow: 1,
    padding: spacing.lg,
    paddingBottom: spacing.xxl * 2,
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
  backButtonPressed: {
    backgroundColor: colors.surface,
  },
  backGlyph: {
    color: colors.text,
    fontSize: 24,
    lineHeight: 26,
  },
  title: {
    color: colors.text,
    fontSize: typography.screenTitle - 6,
    fontWeight: '800',
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: typography.bodySmall,
    marginTop: spacing.xs,
  },
  centerBlock: {
    alignItems: 'center',
    marginTop: spacing.xl,
  },
  emptyBox: {
    backgroundColor: colors.surface,
    borderColor: colors.divider,
    borderRadius: radii.card,
    borderStyle: 'dashed',
    borderWidth: 1,
    marginTop: spacing.lg,
    padding: spacing.lg,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: typography.body,
    fontWeight: '800',
  },
  emptyText: {
    color: colors.textSecondary,
    fontSize: typography.secondary,
    marginTop: spacing.sm,
  },
  entryCard: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.divider,
    borderRadius: radii.card,
    borderWidth: 1,
    flexDirection: 'row',
    marginTop: spacing.sm,
    padding: spacing.md,
  },
  entryCardPressed: {
    backgroundColor: colors.surfaceElevated,
  },
  entryBody: {
    flex: 1,
  },
  entryName: {
    color: colors.text,
    fontSize: typography.body,
    fontWeight: '800',
  },
  entryAddress: {
    color: colors.textSecondary,
    fontFamily: 'monospace',
    fontSize: typography.caption,
    marginTop: 2,
  },
  entryMeta: {
    color: colors.textMuted,
    fontSize: typography.caption,
    marginTop: spacing.sm,
  },
  chevron: {
    color: colors.textMuted,
    fontSize: 22,
    marginLeft: spacing.sm,
  },
  infoBox: {
    marginTop: spacing.md,
  },
  note: {
    color: colors.textMuted,
    fontSize: typography.secondary,
    marginTop: spacing.sm,
  },
  inlineAction: {
    alignSelf: 'flex-start',
    borderRadius: radii.pill,
    marginTop: spacing.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  inlineActionPressed: {
    backgroundColor: colors.surface,
  },
  inlineActionText: {
    color: colors.mint,
    fontSize: typography.secondary,
    fontWeight: '700',
  },
});
