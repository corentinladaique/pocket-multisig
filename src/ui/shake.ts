/**
 * Detection du SECOUAGE, en fonctions PURES : tout y est testable sans appareil
 * ni capteur. Le branchement sur l'accelerometre vit dans l'ecran (effet), pas
 * ici, pour que ce module reste exempt de RPC comme de capteur.
 *
 * Aucune donnee n'est lue, transmise ni persistee : on ne fait que comparer une
 * magnitude d'acceleration a un seuil.
 */

/** Magnitude d'acceleration (en g) a partir des trois axes du capteur. */
export function shakeMagnitude(x: number, y: number, z: number): number {
  return Math.sqrt(x * x + y * y + z * z);
}

/**
 * Seuil de declenchement, en g.
 *
 * Au repos la magnitude vaut ~1 (la gravite). Un geste de la main depasse
 * largement 1,7 ; un simple deplacement du telephone, non. Volontairement haut
 * pour ne pas masquer le solde par accident.
 */
export const SHAKE_THRESHOLD_G = 1.7;

/** Vrai si la magnitude correspond a un secouage. */
export function isShake(magnitude: number, threshold: number = SHAKE_THRESHOLD_G): boolean {
  return Number.isFinite(magnitude) && magnitude >= threshold;
}

/**
 * Delai minimal entre deux declenchements, en millisecondes.
 *
 * Un secouage produit une rafale de mesures : sans anti-rebond, on declencherait
 * des dizaines de fois pour un seul geste.
 */
export const SHAKE_COOLDOWN_MS = 1500;

/**
 * Anti-rebond : vrai si assez de temps s'est ecoule depuis le dernier
 * declenchement. `lastTriggerMs` vaut 0 (ou negatif) quand rien n'a encore ete
 * declenche.
 */
export function canTrigger(
  lastTriggerMs: number,
  nowMs: number,
  cooldownMs: number = SHAKE_COOLDOWN_MS,
): boolean {
  if (!Number.isFinite(nowMs)) return false;
  if (!Number.isFinite(lastTriggerMs) || lastTriggerMs <= 0) return true;
  return nowMs - lastTriggerMs >= cooldownMs;
}

/**
 * Etat du detecteur, tenu par l'ecran entre deux mesures.
 *
 * Renvoie `true` quand le secouage doit produire son effet, et le nouvel
 * horodatage a conserver.
 */
export function consumeShake(
  state: { lastTriggerMs: number },
  sample: { x: number; y: number; z: number },
  nowMs: number,
): { triggered: boolean } {
  const magnitude = shakeMagnitude(sample.x, sample.y, sample.z);
  if (!isShake(magnitude)) return { triggered: false };
  if (!canTrigger(state.lastTriggerMs, nowMs)) return { triggered: false };
  state.lastTriggerMs = nowMs;
  return { triggered: true };
}
