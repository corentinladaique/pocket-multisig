import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { ANDROID_BOTTOM_INSET_FALLBACK } from '../safeArea';
import { colors, radii, spacing, typography } from '../theme';

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
 * Le premier onglet porte la MARQUE de l'application : le coffre du carré
 * menthe, ici en silhouette blanche sur fond transparent, teintée à l'exécution
 * selon l'état de l'onglet. Ce dessin n'existe dans aucune famille d'icônes :
 * c'est la SEULE exception de la barre, assumée et à vérifier visuellement.
 *
 * `require(...)` renvoie l'identifiant d'asset Metro (un nombre), accepté
 * directement par `<Image source={...}>` ; la couleur vient de `tintColor`
 * (`colors.onLight` sur la pastille claire, `colors.textSecondary` au repos).
 */
const VAULT_LOGO = require('../../../assets/tab-vault-logo.png') as number;

/**
 * Le premier onglet porte la MARQUE de l'application : l'eventail des 3 cartes,
 * en silhouette monochrome dont la vague et le point sont EVides. Teintee a
 * l'execution via `tintColor` comme les autres onglets, donc aucune couleur a
 * propager au reste de la barre.
 */

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
            <View style={styles.tabPill}>
              {/* Fond blanc de l'onglet ACTIF : View montée UNIQUEMENT à l'état
                  actif, avec le fond ET le rayon posés ENSEMBLE à la création.
                  Voir la note « PIEGE MESURE » plus bas : un fond qui apparaît
                  APRÈS le montage (style conditionnel sur le conteneur) laisse
                  le drawable Android arrondi sans rayon — la pastille sortait
                  carrée dès le second rendu. */}
              {selected ? <View pointerEvents="none" style={styles.tabPillFill} /> : null}
              {tab === 'vault' ? (
                <Image
                  resizeMode="contain"
                  source={VAULT_LOGO}
                  style={[styles.tabLogo, { tintColor: iconColor }]}
                />
              ) : (
                <Ionicons
                  color={iconColor}
                  name={selected ? TAB_ICONS[tab].active : TAB_ICONS[tab].inactive}
                  size={22}
                />
              )}
            </View>
            <Text
              numberOfLines={1}
              style={[styles.tabLabel, selected && styles.tabLabelActive]}
            >
              {TAB_LABELS[tab]}
            </Text>
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
  // Logo de marque de l'onglet Vault.
  //
  // Le dessin est une SILHOUETTE monochrome avec la vague et le point EN CREUX,
  // et non un trace : `tintColor` aplatit tout le dessin en une seule couleur,
  // donc les creux sont le SEUL moyen de garder du detail (le fond de la
  // pastille traverse et la vague reste lisible). Taille portee a 26 : a 22 le
  // dessin se tassait.
  tabLogo: {
    height: 22,
    width: 22,
  },
  // Pilule de l'onglet actif.
  //
  // PIEGE MESURE sur le Seeker, en DEUX temps :
  //   1) avec une largeur ET une hauteur FIXES, le `borderRadius` n'est PAS
  //      applique — la pastille sort en CARRE a angles droits. Mesure sur
  //      capture : 94x61 px (soit exactement 52x34 dp, la bonne taille) mais un
  //      rayon de bord < 2 px. Tous les aplats arrondis qui fonctionnent dans
  //      l'app (pilule Devnet, boutons PillButton) sont dimensionnes par leur
  //      CONTENU + padding, jamais par une taille fixe : on suit ce motif ici.
  //   2) meme dimensionnee par padding, la pastille sortait ARRONDIE a
  //      l'ouverture puis CARREE au rendu suivant : le fond blanc arrivait via
  //      un style CONDITIONNEL sur le conteneur, donc APRES le montage. Sur
  //      Android, un fond qui apparait apres coup laisse le drawable sans rayon.
  //      Correctif : le fond est une View ENFANT montee uniquement a l'etat
  //      actif (`tabPillFill`), fond + rayon poses ensemble des la creation.
  tabPill: {
    alignItems: 'center',
    borderRadius: radii.pill,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
  },
  // SEUL aplat clair de la barre : le fond de la pastille de l'onglet actif.
  tabPillFill: {
    backgroundColor: colors.text,
    borderRadius: radii.pill,
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  // Libellé sous l'icône. Il n'est plus seulement annoncé aux lecteurs d'écran :
  // un jury ne devine pas « liste », « pouls » et « silhouette » (retour de
  // relecture produit). L'onglet actif porte la menthe, les autres le gris.
  tabLabel: {
    color: colors.textSecondary,
    fontSize: typography.micro,
    fontWeight: '700',
    marginTop: spacing.xs,
  },
  tabLabelActive: {
    color: colors.mint,
  },
});
