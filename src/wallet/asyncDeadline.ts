/**
 * Bornes de temps pour les opérations d'écriture.
 *
 * Module PUR au sens métier : aucune I/O réseau, aucun wallet, aucune signature.
 * Il ne fait que BORNER l'attente d'une promesse déjà lancée ailleurs, afin
 * qu'aucun écran ne puisse rester bloqué en chargement indéfiniment.
 *
 * Pourquoi c'est indispensable :
 * - `Connection` (web3.js) n'applique AUCUN timeout applicatif : une requête RPC
 *   qui pend (endpoint devnet public lent ou throttlé) ne se résout ni ne se
 *   rejette ;
 * - l'appel MWA `signAndSendTransactions` peut rester pendant si le wallet ne
 *   rend pas la main ;
 * - sans borne, un `finally` ne s'exécute jamais et le spinner reste actif.
 *
 * IMPORTANT : borner n'annule PAS l'opération sous-jacente (MWA n'est pas
 * annulable). C'est la relecture on-chain de la tentative suivante qui garantit
 * l'absence de double approbation.
 */

/** Délai maximal de la PRÉPARATION, avant l'ouverture du wallet. */
export const APPROVAL_PREPARATION_DEADLINE_MS = 30_000;

/** Délai maximal d'attente du wallet (signature), une fois le wallet ouvert. */
export const APPROVAL_WALLET_DEADLINE_MS = 90_000;

/** Erreur dédiée : distingue une expiration de délai d'une erreur métier. */
export class OperationTimeoutError extends Error {
  readonly label: string;

  constructor(label: string, timeoutMs: number) {
    super(`${label} exceeded ${timeoutMs} ms without completing.`);
    this.name = 'OperationTimeoutError';
    this.label = label;
  }
}

/** Vrai si l'erreur provient d'une expiration de délai (jamais d'un RPC). */
export function isOperationTimeout(caught: unknown): caught is OperationTimeoutError {
  return caught instanceof OperationTimeoutError;
}

/**
 * Rejette après `timeoutMs` si `promise` n'a pas abouti.
 * La promesse d'origine continue en arrière-plan (non annulable) : la valeur
 * n'est simplement plus attendue.
 */
export function withDeadline<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new OperationTimeoutError(label, timeoutMs));
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}
