import type { Connection } from '@solana/web3.js';

import type { SignatureConfirmationStatus } from '../wallet/operationState';

/**
 * Confirmation d'une signature, bornée et sans effet de bord.
 *
 * C'est la DEUXIÈME preuve exigée avant d'annoncer un succès (la première est
 * l'obtention de la signature, la troisième la relecture du compte métier).
 * Aucune signature, aucun envoi : uniquement des lectures `getSignatureStatuses`.
 *
 * `confirmed` n'est renvoyé que si la grappe rapporte `confirmationStatus`
 * `confirmed` ou `finalized` : `processed` reste `pending`, jamais un succès.
 */

export type SignatureConfirmation = {
  status: SignatureConfirmationStatus;
  slot: number | null;
  error: string | null;
  attempts: number;
};

const DEFAULT_ATTEMPTS = 4;
const DEFAULT_DELAY_MS = 1500;

function delay(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function confirmSignature(input: {
  connection: Connection;
  signature: string;
  attempts?: number;
  delayMs?: number;
  /** Profondeur de recherche : nécessaire pour retrouver une transaction ancienne. */
  searchTransactionHistory?: boolean;
}): Promise<SignatureConfirmation> {
  const attempts = input.attempts ?? DEFAULT_ATTEMPTS;
  const delayMs = input.delayMs ?? DEFAULT_DELAY_MS;
  const searchTransactionHistory = input.searchTransactionHistory ?? true;

  let status: SignatureConfirmationStatus = 'notFound';
  let slot: number | null = null;
  let error: string | null = null;
  let performed = 0;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    performed = attempt;
    const response = await input.connection.getSignatureStatuses([input.signature], {
      searchTransactionHistory,
    });
    const value = response.value[0] ?? null;

    if (value !== null) {
      slot = value.slot ?? null;
      if (value.err !== null && value.err !== undefined) {
        status = 'failed';
        error = typeof value.err === 'string' ? value.err : JSON.stringify(value.err);
        break;
      }
      const confirmation = value.confirmationStatus ?? null;
      if (confirmation === 'confirmed' || confirmation === 'finalized') {
        status = 'confirmed';
        error = null;
        break;
      }
      status = 'pending';
    } else {
      status = 'notFound';
    }

    if (attempt < attempts) {
      await delay(delayMs);
    }
  }

  return { attempts: performed, error, slot, status };
}