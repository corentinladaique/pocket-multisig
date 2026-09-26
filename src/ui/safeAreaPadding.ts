import { Platform, StatusBar } from 'react-native';

import { topInset } from './safeArea';

/**
 * SEUL endroit du projet qui lit la plateforme pour l'espace supérieur : aucun
 * écran ne recalcule sa propre valeur.
 *
 * Usage dans un écran racine :
 *     <KeyboardAvoidingView style={[styles.keyboardAvoider, SAFE_TOP_PADDING]}>
 *
 * Provisoire : à remplacer par `react-native-safe-area-context` (useSafeAreaInsets)
 * lors de la refonte UI, quand une dépendance native pourra être ajoutée.
 */
export const SAFE_TOP_PADDING = {
  paddingTop: topInset(Platform.OS, StatusBar.currentHeight),
};