/**
 * Thème UI V2 « Seeker style » — Pocket Multisig.
 *
 * Module PUR : aucune importation de `react-native`. Il peut donc être importé
 * depuis un test `tsx` (voir la note §5 de la référence du projet : un module
 * qui importe `react-native` casse `npx tsx`). Toutes les couleurs, espacements,
 * rayons et tailles de texte des écrans V2 viennent d'ici : un seul endroit à
 * changer, aucune valeur dispersée dans les écrans.
 */

export const colors = {
  // Fonds
  background: '#08110F',
  surface: '#111C19',
  surfaceElevated: '#16231F',
  divider: 'rgba(255,255,255,0.08)',

  // Textes
  text: '#F7FAF9',
  textSecondary: '#9AA6A2',
  textMuted: '#68736F',

  // Accents de marque
  mint: '#BDEBD3',
  petrol: '#0E4A4A',
  petrolDeep: '#0A3232',

  // États
  success: '#8FE3AE',
  successSoft: '#123524',
  warning: '#F4C56A',
  warningSoft: '#382A0D',
  error: '#F97066',
  errorSoft: '#3A1717',

  // Désactivé
  disabled: '#1B2925',
  disabledText: '#68736F',

  // Encre posée sur une surface claire (pastille blanche, bouton pill blanc)
  onLight: '#08110F',
} as const;

/** Échelle d'espacement imposée : 4 / 8 / 12 / 16 / 24 / 32. */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radii = {
  pill: 999,
  card: 18,
  field: 14,
  button: 999,
} as const;

/** Tailles de texte (police système uniquement, aucun package de police). */
export const typography = {
  screenTitle: 34,
  balance: 48,
  sectionTitle: 19,
  body: 15,
  bodySmall: 14,
  secondary: 13,
  caption: 12,
  micro: 11,
} as const;

export const theme = { colors, spacing, radii, typography } as const;

export type Theme = typeof theme;
