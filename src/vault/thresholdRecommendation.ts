/**
 * Recommandation de threshold pour la création guidée d'un vault.
 * Module PUR : aucun RPC, aucune instruction, aucun envoi.
 *
 * Pour deux membres, 2 of 2 est la valeur RECOMMANDÉE et le défaut : un seuil de
 * 1 sur 2 n'offre aucune approbation partagée. Threshold 1 reste techniquement
 * supporté (le moteur Squads l'accepte) mais averti explicitement.
 */

export const TWO_MEMBER_RECOMMENDED_THRESHOLD = 2;

export const TWO_MEMBER_RECOMMENDATION = 'Recommended: 2 of 2';
export const TWO_MEMBER_RECOMMENDATION_DETAIL = 'Both members must approve sensitive actions.';

export const THREE_MEMBER_RECOMMENDED_THRESHOLD = 2;
export const THREE_MEMBER_RECOMMENDATION = 'Recommended: 2 of 3';
export const THREE_MEMBER_RECOMMENDATION_DETAIL =
  'Two members must approve. One unavailable member cannot block the vault.';

export const LOW_SECURITY_THRESHOLD_LABEL = 'Low security configuration';
export const LOW_SECURITY_THRESHOLD_DETAIL =
  'Either member can approve actions alone. This setup does not require shared approval.';
export const LOW_SECURITY_THRESHOLD_CONFIRM = 'Use 1 of 2 anyway';

/** Threshold recommandé pour un nombre de membres donné (2 ou 3 → 2). */
export function recommendedThresholdFor(memberCount: number): number {
  return memberCount === 2 || memberCount === 3 ? 2 : 1;
}

/**
 * Recommandation affichée pour un nombre de membres donné, ou `null`.
 * 2 membres → 2 of 2 ; 3 membres → 2 of 3 (un membre indisponible ne bloque pas).
 */
export function recommendationFor(
  memberCount: number,
): { label: string; detail: string } | null {
  if (memberCount === 2) {
    return { detail: TWO_MEMBER_RECOMMENDATION_DETAIL, label: TWO_MEMBER_RECOMMENDATION };
  }
  if (memberCount === 3) {
    return { detail: THREE_MEMBER_RECOMMENDATION_DETAIL, label: THREE_MEMBER_RECOMMENDATION };
  }
  return null;
}

/** Bandeau « Recommended: 2 of 2 » quand il y a exactement deux membres. */
export function twoMemberRecommendation(memberCount: number): string | null {
  return memberCount === 2 ? TWO_MEMBER_RECOMMENDATION : null;
}

/**
 * Avertissement « Low security configuration » : deux membres AVEC threshold 1.
 * `null` dans tous les autres cas. Ne bloque jamais la création.
 */
export function lowSecurityThresholdWarning(memberCount: number, threshold: number): string | null {
  return memberCount === 2 && threshold === 1 ? LOW_SECURITY_THRESHOLD_LABEL : null;
}
