/**
 * Messages UTILISATEUR pour la creation de proposition.
 *
 * Module PUR, de PRESENTATION uniquement : il traduit le vocabulaire INTERNE du
 * builder (`InvalidDestination: ...`, `InvalidLamports: ...`) en phrases
 * comprehensibles. Aucun code interne ne doit atteindre l'ecran, et aucune
 * validation n'est modifiee ici : le builder reste la seule source de verite.
 */

/** Message utilisateur d'une destination invalide (jamais de code interne). */
export const INVALID_DESTINATION_MESSAGE = 'Enter a valid Solana address.';

/**
 * Vocabulaire INTERNE du builder -> message UTILISATEUR.
 * Aucun code brut (« InvalidDestination », « InvalidLamports », …) a l'ecran.
 */
const PROPOSAL_CREATION_ERROR_MESSAGES: Record<string, string> = {
  InvalidCreator: 'The connected wallet account could not be read.',
  InvalidDestination: INVALID_DESTINATION_MESSAGE,
  InvalidLamports: 'Enter a valid SOL amount.',
  InvalidMultisigPda: 'The multisig account could not be read.',
  InvalidTransactionIndex: 'The multisig transaction index could not be read.',
};

/** True si la liste contient une erreur de destination (code interne). */
export function hasInvalidDestinationError(errors: readonly string[]): boolean {
  return errors.some((error) => error.startsWith('InvalidDestination:'));
}

/** Traduit une erreur interne en message utilisateur ; jamais de code brut. */
export function proposalCreationErrorMessage(error: string): string {
  const code = (error.split(':')[0] ?? '').trim();
  return PROPOSAL_CREATION_ERROR_MESSAGES[code] ?? 'This proposal cannot be prepared yet.';
}
