/**
 * Etat visible du parcours de creation d'un vault, derive des PREUVES les plus
 * avancees disponibles. Module PUR : aucune I/O, aucun RPC, aucune signature,
 * aucun envoi.
 *
 * Regle non negociable : un etat moins avance ne remplace jamais une preuve plus
 * avancee deja obtenue. `confirmed` ne redevient jamais « confirmation pending ».
 *
 * Ordre de preuve : verified > confirmed > signed > (aucune signature).
 */

export const VAULT_VISIBLE_STATES = [
  'idle',
  'awaiting-wallet',
  'signed-pending-confirmation',
  'confirmed-pending-readback',
  'confirmed-readback-temporarily-unavailable',
  'verified',
] as const;

export type VaultVisibleState = (typeof VAULT_VISIBLE_STATES)[number];

export const VAULT_VISIBLE_LABELS: Record<VaultVisibleState, string> = {
  idle: '',
  'awaiting-wallet': 'Waiting for wallet.',
  'signed-pending-confirmation': 'Transaction signed, confirmation pending.',
  'confirmed-pending-readback': 'Transaction confirmed, vault verification pending.',
  'confirmed-readback-temporarily-unavailable':
    'Transaction confirmed. Vault verification is temporarily unavailable.',
  verified: 'Vault created and verified.',
};

export function deriveVaultVisibleState(input: {
  /** Une tentative d'envoi existe (un resultat de tentative est disponible). */
  hasAttempt: boolean;
  /** Envoi en cours, avant toute signature obtenue. */
  creating: boolean;
  signatureObtained: boolean;
  /** Transaction confirmee on-chain (preuve n°2). */
  confirmed: boolean;
  /** Compte multisig relu ET coherent (preuve n°3). */
  verified: boolean;
  /** Relecture impossible POUR UNE RAISON RESEAU (temporaire). */
  networkFailure: boolean;
}): VaultVisibleState {
  if (input.verified) return 'verified';
  if (input.signatureObtained) {
    if (input.confirmed) {
      return input.networkFailure
        ? 'confirmed-readback-temporarily-unavailable'
        : 'confirmed-pending-readback';
    }
    return 'signed-pending-confirmation';
  }
  if (input.creating) return 'awaiting-wallet';
  return 'idle';
}
