/**
 * Espace supérieur Android — partie PURE (aucun import react-native), donc
 * testable. Le style prêt à l'emploi vit dans `safeAreaPadding.ts`, seul endroit
 * qui lit la plateforme.
 *
 * PROVISOIRE : `react-native-safe-area-context` n'est pas installé et cette
 * mission n'ajoute aucune dépendance native. On s'appuie sur la hauteur de barre
 * de statut publiée par la plateforme, ce qui dégage la barre de statut, la
 * caméra frontale et la zone découpée du Seeker. La migration vers une vraie Safe
 * Area (insets réels, y compris latéraux et bas) est prévue à la refonte UI.
 *
 * Règle anti-double-padding : les écrans se rendent en EXCLUSION mutuelle (un
 * parent sort en early-return quand un écran enfant est ouvert), donc chaque
 * écran racine applique son inset une seule fois. Un écran qui enveloppe un autre
 * écran ne doit pas ajouter d'espace supplémentaire.
 */

/** Hauteur de repli quand Android ne publie pas la valeur. */
export const ANDROID_STATUS_BAR_FALLBACK = 24;

/**
 * Plancher Android : la barre de statut publiee peut etre plus petite que la
 * decoupe reelle de l'ecran (camera frontale du Seeker, Android 15+ en
 * edge-to-edge). On reserve donc au moins cette hauteur.
 */
export const ANDROID_TOP_INSET_FLOOR = 28;

/**
 * Espace visuel ajoute APRES l'inset : le bandeau reseau ne doit pas seulement
 * eviter la camera, il doit respirer sous celle-ci.
 */
export const SAFE_TOP_SPACING = 12;

/**
 * Espace supérieur à réserver, en pixels indépendants.
 * Renvoie 0 sur toute plateforme où la barre de statut n'est pas superposée.
 */
export function topInset(
  platform: string,
  statusBarHeight: number | null | undefined,
): number {
  if (platform !== 'android') return 0;
  if (typeof statusBarHeight !== 'number' || !Number.isFinite(statusBarHeight)) {
    return ANDROID_STATUS_BAR_FALLBACK;
  }
  return Math.max(ANDROID_TOP_INSET_FLOOR, Math.ceil(statusBarHeight));
}