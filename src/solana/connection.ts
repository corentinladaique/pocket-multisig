// Couche RPC devnet minimale. Une seule instance Connection pour toute l'app.
import { Connection } from '@solana/web3.js';

import { DEVNET_ENDPOINT } from '../config';

/**
 * Instance unique, réutilisée par tous les appels RPC.
 * `commitment: 'confirmed'` est fixé ici une fois pour toutes.
 */
export const connection = new Connection(DEVNET_ENDPOINT, {
  commitment: 'confirmed',
});

/** Délai maximal d'un appel RPC côté application (ms). */
export const RPC_TIMEOUT_MS = 8000;

/** Rejette après `timeoutMs` si la promesse n'a pas abouti. */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`RPC timeout après ${timeoutMs} ms`));
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

/**
 * Contrôle de disponibilité : un seul appel RPC léger (`getSlot`).
 * Aucune lecture de compte, de solde ni de programme.
 * @returns le slot courant confirmé.
 */
export async function pingDevnet(timeoutMs: number = RPC_TIMEOUT_MS): Promise<number> {
  return withTimeout(connection.getSlot('confirmed'), timeoutMs);
}