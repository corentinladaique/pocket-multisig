import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { SAFE_TOP_PADDING } from '../safeAreaPadding';
import { colors, radii, spacing, typography } from '../theme';

/**
 * Primitives UI V2 « Seeker style » — Groupe 1 uniquement.
 *
 * Aucune logique métier : pas de RPC, pas de wallet, pas d'état global. Chaque
 * primitive est purement présentationnelle et distinguera explicitement
 * disponible / pressed / busy / disabled. Les icônes sont des glyphes texte
 * (aucun package d'icônes n'est installé et il est interdit d'en ajouter).
 */

// --- AppScreen --------------------------------------------------------------

export function AppScreen({
  children,
  contentStyle,
  scroll = true,
}: {
  children: ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
  /** false pour les écrans qui gèrent leur propre ScrollView. */
  scroll?: boolean;
}) {
  if (!scroll) {
    return (
      <View style={[styles.screen, SAFE_TOP_PADDING, contentStyle]}>{children}</View>
    );
  }
  return (
    <ScrollView
      contentContainerStyle={[styles.screenContent, contentStyle]}
      style={[styles.screen, SAFE_TOP_PADDING]}
    >
      {children}
    </ScrollView>
  );
}

// --- DevnetPill -------------------------------------------------------------

export function DevnetPill({ label = 'Devnet' }: { label?: string }) {
  return (
    <View style={styles.devnetPill} accessibilityRole="text" accessibilityLabel={`${label} network`}>
      <View style={styles.devnetDot} />
      <Text style={styles.devnetText}>{label}</Text>
    </View>
  );
}

// --- Card -------------------------------------------------------------------

export function Card({
  children,
  style,
  elevated = false,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  elevated?: boolean;
}) {
  return <View style={[styles.card, elevated && styles.cardElevated, style]}>{children}</View>;
}

// --- PillButton -------------------------------------------------------------

export type PillButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export function PillButton({
  accessibilityLabel,
  busy = false,
  disabled = false,
  label,
  onPress,
  variant = 'primary',
  glyph,
}: {
  accessibilityLabel?: string;
  busy?: boolean;
  disabled?: boolean;
  label: string;
  onPress?: () => void;
  variant?: PillButtonVariant;
  /** Glyphe texte optionnel affiché avant le libellé (ex. « + », « ↓ »). */
  glyph?: string;
}) {
  const inactive = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ busy, disabled: inactive }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.pill,
        variant === 'primary' && styles.pillPrimary,
        variant === 'secondary' && styles.pillSecondary,
        variant === 'ghost' && styles.pillGhost,
        variant === 'danger' && styles.pillDanger,
        pressed && !inactive && styles.pillPressed,
        inactive && styles.pillDisabled,
      ]}
    >
      {busy ? (
        <ActivityIndicator
          color={variant === 'primary' ? colors.onLight : colors.text}
          size="small"
        />
      ) : (
        <Text
          style={[
            styles.pillText,
            variant === 'primary' ? styles.pillTextPrimary : styles.pillTextSecondary,
            variant === 'danger' && styles.pillTextDanger,
          ]}
        >
          {glyph !== undefined ? `${glyph}  ` : ''}
          {label}
        </Text>
      )}
    </Pressable>
  );
}

// --- ListRow ----------------------------------------------------------------

export function ListRow({
  accessibilityLabel,
  glyph,
  onPress,
  subtitle,
  title,
  trailing,
  trailingStyle,
}: {
  accessibilityLabel?: string;
  glyph?: string;
  onPress?: () => void;
  subtitle?: string;
  title: string;
  trailing?: ReactNode;
  trailingStyle?: StyleProp<ViewStyle>;
}) {
  const content = (
    <>
      {glyph !== undefined ? (
        <View style={styles.rowGlyph}>
          <Text style={styles.rowGlyphText}>{glyph}</Text>
        </View>
      ) : null}
      <View style={styles.rowBody}>
        <Text style={styles.rowTitle}>{title}</Text>
        {subtitle !== undefined ? <Text style={styles.rowSubtitle}>{subtitle}</Text> : null}
      </View>
      {trailing !== undefined ? <View style={trailingStyle}>{trailing}</View> : null}
    </>
  );
  if (onPress === undefined) {
    return (
      <View accessibilityLabel={accessibilityLabel} accessibilityRole="text" style={styles.row}>
        {content}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      onPress={onPress}
      style={({ pressed }) => [styles.row, styles.rowPressable, pressed && styles.rowPressed]}
    >
      {content}
    </Pressable>
  );
}

// --- AddressRow -------------------------------------------------------------

export function AddressRow({
  address,
  label,
  trailing,
}: {
  address: string;
  label: string;
  trailing?: ReactNode;
}) {
  return (
    <View style={styles.addressRow}>
      <Text style={styles.addressLabel}>{label}</Text>
      <View style={styles.addressValueRow}>
        <Text selectable style={styles.addressValue}>
          {address}
        </Text>
        {trailing !== undefined ? trailing : null}
      </View>
    </View>
  );
}

// --- InfoBox ----------------------------------------------------------------

export type InfoTone = 'info' | 'warning' | 'success' | 'error';

export function InfoBox({
  children,
  glyph,
  style,
  tone = 'info',
}: {
  children: ReactNode;
  glyph?: string;
  style?: StyleProp<ViewStyle>;
  tone?: InfoTone;
}) {
  return (
    <View
      style={[
        styles.infoBox,
        tone === 'warning' && styles.infoWarning,
        tone === 'success' && styles.infoSuccess,
        tone === 'error' && styles.infoError,
        style,
      ]}
    >
      {glyph !== undefined ? (
        <Text style={styles.infoGlyph}>{glyph}</Text>
      ) : null}
      <View style={styles.infoBody}>{children}</View>
    </View>
  );
}

export function InfoText({
  children,
  tone = 'info',
}: {
  children: ReactNode;
  tone?: InfoTone;
}) {
  return (
    <Text
      style={[
        styles.infoText,
        tone === 'warning' && styles.infoTextWarning,
        tone === 'success' && styles.infoTextSuccess,
        tone === 'error' && styles.infoTextError,
      ]}
    >
      {children}
    </Text>
  );
}

// --- Styles -----------------------------------------------------------------

const styles = StyleSheet.create({
  screen: {
    backgroundColor: colors.background,
    flex: 1,
    width: '100%',
  },
  screenContent: {
    backgroundColor: colors.background,
    flexGrow: 1,
    padding: spacing.lg,
    paddingBottom: spacing.xxl * 2,
  },

  devnetPill: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: colors.surfaceElevated,
    borderRadius: radii.pill,
    flexDirection: 'row',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
  },
  devnetDot: {
    backgroundColor: colors.mint,
    borderRadius: radii.pill,
    height: 7,
    marginRight: spacing.sm - 2,
    width: 7,
  },
  devnetText: {
    color: colors.mint,
    fontSize: typography.caption,
    fontWeight: '700',
  },

  card: {
    backgroundColor: colors.surface,
    borderColor: colors.divider,
    borderRadius: radii.card,
    borderWidth: 1,
    padding: spacing.lg,
  },
  cardElevated: {
    backgroundColor: colors.surfaceElevated,
  },

  pill: {
    alignItems: 'center',
    borderRadius: radii.button,
    justifyContent: 'center',
    minHeight: 52,
    paddingHorizontal: spacing.xl,
  },
  pillPrimary: {
    backgroundColor: colors.text,
  },
  pillSecondary: {
    backgroundColor: colors.surfaceElevated,
    borderColor: colors.divider,
    borderWidth: 1,
  },
  pillGhost: {
    backgroundColor: 'transparent',
  },
  pillDanger: {
    backgroundColor: colors.errorSoft,
  },
  pillPressed: {
    opacity: 0.82,
  },
  pillDisabled: {
    backgroundColor: colors.disabled,
    borderColor: colors.disabled,
  },
  pillText: {
    fontSize: typography.body + 1,
    fontWeight: '700',
  },
  pillTextPrimary: {
    color: colors.onLight,
  },
  pillTextSecondary: {
    color: colors.text,
  },
  pillTextDanger: {
    color: colors.error,
  },

  row: {
    alignItems: 'center',
    flexDirection: 'row',
    minHeight: 56,
    paddingVertical: spacing.sm,
  },
  rowPressable: {
    borderRadius: radii.field,
  },
  rowPressed: {
    backgroundColor: colors.surfaceElevated,
  },
  rowGlyph: {
    alignItems: 'center',
    backgroundColor: colors.surfaceElevated,
    borderRadius: radii.pill,
    height: 40,
    justifyContent: 'center',
    marginRight: spacing.md,
    width: 40,
  },
  rowGlyphText: {
    color: colors.mint,
    fontSize: 18,
  },
  rowBody: {
    flex: 1,
  },
  rowTitle: {
    color: colors.text,
    fontSize: typography.body,
    fontWeight: '700',
  },
  rowSubtitle: {
    color: colors.textSecondary,
    fontSize: typography.secondary,
    marginTop: 2,
  },

  addressRow: {
    marginTop: spacing.sm,
  },
  addressLabel: {
    color: colors.textMuted,
    fontSize: typography.micro,
    textTransform: 'uppercase',
  },
  addressValueRow: {
    alignItems: 'center',
    flexDirection: 'row',
    marginTop: spacing.xs,
  },
  addressValue: {
    color: colors.text,
    flex: 1,
    fontFamily: 'monospace',
    fontSize: typography.bodySmall,
  },

  infoBox: {
    alignItems: 'flex-start',
    backgroundColor: colors.surfaceElevated,
    borderColor: colors.divider,
    borderRadius: radii.field,
    borderWidth: 1,
    flexDirection: 'row',
    padding: spacing.md,
  },
  infoWarning: {
    backgroundColor: colors.warningSoft,
    borderColor: colors.warningSoft,
  },
  infoSuccess: {
    backgroundColor: colors.successSoft,
    borderColor: colors.successSoft,
  },
  infoError: {
    backgroundColor: colors.errorSoft,
    borderColor: colors.errorSoft,
  },
  infoGlyph: {
    color: colors.textSecondary,
    fontSize: typography.body,
    marginRight: spacing.sm,
  },
  infoBody: {
    flex: 1,
  },
  infoText: {
    color: colors.textSecondary,
    fontSize: typography.secondary,
    lineHeight: 19,
  },
  infoTextWarning: {
    color: colors.warning,
  },
  infoTextSuccess: {
    color: colors.success,
  },
  infoTextError: {
    color: colors.error,
  },
});

/** Export pour les écrans qui veulent un titre V2 homogène. */
export const v2Text: Record<string, TextStyle> = {
  screenTitle: {
    color: colors.text,
    fontSize: typography.screenTitle,
    fontWeight: '800',
  },
  sectionTitle: {
    color: colors.text,
    fontSize: typography.sectionTitle,
    fontWeight: '800',
  },
  body: {
    color: colors.textSecondary,
    fontSize: typography.body,
    lineHeight: 21,
  },
};
