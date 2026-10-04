import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as Haptics from 'expo-haptics';
import { Pressable, StyleSheet, View } from 'react-native';

import { ANDROID_BOTTOM_INSET_FALLBACK } from '../safeArea';
import { colors, radii, spacing } from '../theme';

/**
 * Barre de navigation à 4 onglets (style wallet Seeker).
 *
 * Purement présentationnelle : aucun RPC, aucun wallet, aucune transaction,
 * aucun état global. Elle signale l'onglet actif et remonte le choix de
 * l'utilisateur ; c'est le parent qui décide quel contenu monter.
 *
 * Icônes fournies par `@expo/vector-icons` (installé avec l'autorisation
 * explicite de l'utilisateur pour cette mission). Onglet actif = icône PLEINE
 * sur la pastille claire (le trait fin se lirait mal dessus) ; onglet inactif =
 * icône au trait, sans fond. La pastille de l'onglet actif reste le SEUL aplat
 * clair de la barre.
 */

export type TabKey = 'vault' | 'proposals' | 'activity' | 'account';

export const TAB_ORDER: readonly TabKey[] = ['vault', 'proposals', 'activity', 'account'];

/** Libellés : jamais peints, uniquement annoncés aux lecteurs d'écran. */
export const TAB_LABELS: Record<TabKey, string> = {
  vault: 'Vault',
  proposals: 'Proposals',
  activity: 'Activity',
  account: 'Account',
};

/**
 * Le premier onglet porte la MARQUE de l'application — le coffre du carré
 * menthe — et non une maison générique : la barre devient la signature du
 * produit. Ce dessin n'existe pas dans Ionicons : c'est la SEULE exception de
 * famille de la barre, assumée et à vérifier visuellement à l'écran.
 */
const VAULT_ICON = { active: 'safe-square', inactive: 'safe-square-outline' } as const;

const TAB_ICONS = {
  proposals: { active: 'list', inactive: 'list-outline' },
  activity: { active: 'pulse', inactive: 'pulse-outline' },
  account: { active: 'person', inactive: 'person-outline' },
} as const;

/**
 * Retour haptique léger, déclenché au changement d'onglet.
 *
 * Volontairement « au feu et on oublie » : un appareil sans vibreur, ou un échec
 * du module, ne doit JAMAIS empêcher la navigation. Aucun RPC, aucun wallet,
 * aucune signature, aucun envoi.
 */
function tabFeedback(): void {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
}

export function TabBar({
  active,
  onSelect,
}: {
  active: TabKey;
  onSelect: (tab: TabKey) => void;
}) {
  return (
    <View accessibilityRole="tablist" style={styles.bar}>
      {TAB_ORDER.map((tab) => {
        const selected = tab === active;
        const iconColor = selected ? colors.onLight : colors.textSecondary;
        return (
          <Pressable
            accessibilityRole="tab"
            accessibilityLabel={TAB_LABELS[tab]}
            accessibilityState={{ selected }}
            key={tab}
            onPress={() => {
              tabFeedback();
              onSelect(tab);
            }}
            style={({ pressed }) => [styles.tab, pressed && styles.tabPressed]}
          >
            <View style={[styles.tabPill, selected && styles.tabPillActive]}>
              {tab === 'vault' ? (
                <MaterialCommunityIcons
                  color={iconColor}
                  name={selected ? VAULT_ICON.active : VAULT_ICON.inactive}
                  size={22}
                />
              ) : (
                <Ionicons
                  color={iconColor}
                  name={selected ? TAB_ICONS[tab].active : TAB_ICONS[tab].inactive}
                  size={22}
                />
              )}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: colors.background,
    borderTopColor: colors.divider,
    borderTopWidth: 1,
    flexDirection: 'row',
    paddingBottom: ANDROID_BOTTOM_INSET_FALLBACK,
    paddingTop: spacing.sm,
  },
  tab: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    minHeight: 48,
  },
  tabPressed: {
    opacity: 0.7,
  },
  // Pilule de l'onglet actif.
  //
  // PIEGE MESURE sur le Seeker : avec une largeur ET une hauteur FIXES, le
  // `borderRadius` n'est PAS applique — la pastille sort en CARRÉ à angles
  // droits. Mesure sur capture : 94x61 px (soit exactement 52x34 dp, la bonne
  // taille) mais un rayon de bord < 2 px. Tous les aplats arrondis qui
  // fonctionnent dans l'app (pilule Devnet, boutons PillButton) sont
  // dimensionnés par leur CONTENU + padding, jamais par une taille fixe : on
  // suit donc le même motif. La taille tactile reste portée par le parent.
  tabPill: {
    alignItems: 'center',
    borderRadius: radii.pill,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
  },
  // SEUL aplat clair de la barre : la pastille de l'onglet actif.
  tabPillActive: {
    backgroundColor: colors.text,
  },
});
