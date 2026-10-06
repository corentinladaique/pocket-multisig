/**
 * Memoire de PROCESSUS des envois signes non encore verifies.
 *
 * Aucune I/O, aucun stockage, aucun secret : cette memoire vit le temps du
 * processus et disparait a la fermeture de l'application. Elle ne stocke qu'une
 * SIGNATURE PUBLIQUE de transaction (jamais une cle, jamais une autorisation).
 *
 * But unique et strictement defensif : rouvrir l'ecran d'une proposition dont
 * une execution a ete signee ne doit PAS reproposer l'execution avant qu'une
 * lecture on-chain ne prouve l'etat. AUCUN renvoi automatique n'est declenche :
 * seule la relecture (et le bouton manuel) peuvent faire avancer l'etat.
 */

const pending = new Map<string, string>();

/** Enregistre une execution signee pour une proposition donnee. */
export function rememberPendingSubmission(key: string, signature: string): void {
  pending.set(key, signature);
}

/** Signature memorisee pour cette proposition, ou null. */
export function pendingSubmissionFor(key: string): string | null {
  return pending.get(key) ?? null;
}

/** Oublie l'envoi : appele des qu'une lecture on-chain a tranche l'etat. */
export function forgetPendingSubmission(key: string): void {
  pending.delete(key);
}
