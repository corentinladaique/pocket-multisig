import { useEffect, useState } from 'react';
import { BackHandler, Pressable, StyleSheet, Text, View } from 'react-native';

import { COPIED_MESSAGE, COPY_FAILED_MESSAGE, copyToClipboard } from '../ui/clipboard';
import { colors, radii, spacing, typography } from '../ui/theme';
import { AppScreen, Card, DevnetPill, InfoBox, InfoText, PillButton } from '../ui/v2/primitives';

/**
 * Receive SOL — vue informative, Groupe 1.
 *
 * LECTURE SEULE : cette vue n'appelle aucun RPC, ne sollicite aucun wallet, ne
 * prépare aucune transaction et n'ouvre aucun faucet. Elle se contente
 * d'afficher une adresse qui lui est FOURNIE par l'appelant.
 *
 * L'adresse doit être EXCLUSIVEMENT le Main vault PDA (index 0) du multisig
 * courant, dérivé par le mécanisme existant (`msig.view.vaultAddress`). Si
 * elle est absente, on affiche un état indisponible honnête : jamais de fausse
 * adresse, jamais de valeur codée en dur.
 *
 * Navigation : un seul retour PRINCIPAL — la flèche supérieure, doublée d'un
 * BackHandler Android (bouton/geste système). Aucun swipe horizontal custom.
 */

export function ReceiveScreen({
  address,
  onBack,
}: {
  /** Adresse complète du Main vault (index 0), ou null si indisponible. */
  address: string | null;
  onBack: () => void;
}) {
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const available = address !== null && address.length > 0;

  // Retour système Android : ferme Receive et rend la main au Home/Vault.
  // Aucun autre écouteur, aucun geste custom, aucune navigation nouvelle.
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onBack();
      return true;
    });
    return () => subscription.remove();
  }, [onBack]);

  const onCopy = () => {
    if (address === null || address.length === 0) return;
    setCopyFeedback(copyToClipboard(address) ? COPIED_MESSAGE : COPY_FAILED_MESSAGE);
  };

  return (
    <AppScreen>
      <View style={styles.headerRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to vault"
          onPress={onBack}
          style={({ pressed }) => [styles.backButton, pressed && styles.backPressed]}
        >
          <Text style={styles.backGlyph}>‹</Text>
        </Pressable>
        <DevnetPill />
      </View>

      <Text style={styles.title}>Receive SOL</Text>
      <Text style={styles.subtitle}>Fund your Main vault</Text>

      {available ? (
        <Card style={styles.addressCard}>
          <Text style={styles.addressLabel}>Main vault address</Text>
          <Text selectable style={styles.addressValue}>
            {address}
          </Text>
          <View style={styles.copyRow}>
            <PillButton
              accessibilityLabel="Copy the Main vault address"
              label="Copy address"
              onPress={onCopy}
              variant="secondary"
            />
          </View>
          {copyFeedback !== null ? (
            <Text
              accessibilityLiveRegion="polite"
              accessibilityRole="text"
              style={styles.copyFeedback}
            >
              {copyFeedback}
            </Text>
          ) : null}
        </Card>
      ) : (
        <Card style={styles.addressCard}>
          <Text style={styles.unavailableTitle}>Address unavailable</Text>
          <InfoText>
            The Main vault address is not loaded yet. Open a multisig first: the address is
            derived from the on-chain multisig, never typed by hand.
          </InfoText>
        </Card>
      )}

      <View style={styles.noticeBlock}>
        <InfoBox glyph="↓">
          <InfoText>Send Devnet SOL only to this Main vault address.</InfoText>
          <InfoText>Do not send funds to the multisig configuration address.</InfoText>
        </InfoBox>
      </View>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.xl,
  },
  backButton: {
    alignItems: 'center',
    backgroundColor: colors.surfaceElevated,
    borderRadius: radii.pill,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  backPressed: {
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
    fontSize: typography.body,
    marginTop: spacing.xs,
  },
  addressCard: {
    marginTop: spacing.xl,
  },
  addressLabel: {
    color: colors.textMuted,
    fontSize: typography.micro,
    textTransform: 'uppercase',
  },
  addressValue: {
    color: colors.text,
    fontFamily: 'monospace',
    fontSize: typography.bodySmall,
    marginTop: spacing.sm,
  },
  copyRow: {
    marginTop: spacing.lg,
  },
  copyFeedback: {
    color: colors.success,
    fontSize: typography.secondary,
    marginTop: spacing.sm,
  },
  unavailableTitle: {
    color: colors.text,
    fontSize: typography.body,
    fontWeight: '700',
    marginBottom: spacing.sm,
  },
  noticeBlock: {
    marginTop: spacing.xl,
  },
});
