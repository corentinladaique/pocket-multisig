import type { SignatureConfirmationStatus } from './operationState';

/**
 * Fenêtre de signature : validité réelle du blockhash au moment d'ouvrir le
 * wallet, et états affichables de la préparation à la confirmation.
 *
 * Module PUR : aucune I/O, aucun RPC, aucun chronomètre. La validité est jugée
 * en BLOCS, jamais en secondes : un chronomètre ne dit rien de l'expiration
 * réelle d'un blockhash, la hauteur de bloc oui.
 */

/** Marge de sécurité documentée, en blocs, avant l'expiration du blockhash. */
export const DEFAULT_BLOCK_MARGIN = 20;

export type BlockhashBundle = {
  blockhash: string;
  lastValidBlockHeight: number;
};

export type SigningWindowVerdict = {
  usable: boolean;
  /** Blocs restants avant `lastValidBlockHeight` (négatif si dépassé). */
  remainingBlocks: number | null;
  reason: string;
  expired: boolean;
};

/**
 * Verdict rendu AVANT toute ouverture du wallet.
 *
 * `usable` exige une hauteur connue, un blockhash non expiré ET une marge
 * suffisante : dans le doute (hauteur illisible), on refuse plutôt que
 * d'ouvrir le wallet sur une signature qui risque d'expirer en chemin.
 */
export function evaluateSigningWindow(input: {
  blockHeight: number | null;
  bundle: BlockhashBundle;
  marginBlocks?: number;
}): SigningWindowVerdict {
  const margin = input.marginBlocks ?? DEFAULT_BLOCK_MARGIN;
  if (input.blockHeight === null) {
    return {
      expired: false,
      reason: 'The current block height could not be read: the window cannot be proven usable.',
      remainingBlocks: null,
      usable: false,
    };
  }

  const remaining = input.bundle.lastValidBlockHeight - input.blockHeight;
  if (remaining < 0) {
    return {
      expired: true,
      reason: `The blockhash expired ${-remaining} block(s) ago: the transaction must be rebuilt.`,
      remainingBlocks: remaining,
      usable: false,
    };
  }
  if (remaining < margin) {
    return {
      expired: false,
      reason: `Only ${remaining} block(s) remain before expiry, below the ${margin}-block safety margin: the wallet must not be opened on this transaction.`,
      remainingBlocks: remaining,
      usable: false,
    };
  }

  return {
    expired: false,
    reason: `${remaining} block(s) remain before expiry, at or above the ${margin}-block safety margin.`,
    remainingBlocks: remaining,
    usable: true,
  };
}

/** États affichables du parcours de signature, dans l'ordre chronologique. */
export const SIGNING_STATES = [
  'preparing-fresh-transaction',
  'ready-to-sign',
  'waiting-for-wallet',
  'signature-request-expired',
  'transaction-signed-confirmation-pending',
  'confirmed',
  'confirmed-but-readback-failed',
] as const;

export type SigningState = (typeof SIGNING_STATES)[number];

const SIGNING_TITLES: Record<SigningState, string> = {
  'confirmed': 'Confirmed on-chain.',
  'confirmed-but-readback-failed': 'Confirmed but read-back failed.',
  'preparing-fresh-transaction': 'Preparing fresh transaction…',
  'ready-to-sign': 'Ready to sign.',
  'signature-request-expired':
    'Signature request expired — the transaction was never sent: a fresh one is required.',
  'transaction-signed-confirmation-pending': 'Transaction signed, confirmation pending.',
  'waiting-for-wallet': 'Waiting for wallet…',
};

export function signingStateTitle(state: SigningState): string {
  return SIGNING_TITLES[state];
}

/**
 * État issu des preuves, une fois la préparation terminée.
 *
 * Volontairement identique à la logique de `operationState` : aucune preuve,
 * aucun état avancé.
 */
export function signingStateFromEvidence(input: {
  signatureObtained: boolean;
  confirmed: boolean;
  readBackVerified: boolean;
}): SigningState {
  if (!input.signatureObtained) return 'signature-request-expired';
  if (!input.confirmed) return 'transaction-signed-confirmation-pending';
  if (!input.readBackVerified) return 'confirmed-but-readback-failed';
  return 'confirmed';
}

/** Traduction d'un statut de confirmation en état affichable. */
export function signingStateFromConfirmation(
  status: SignatureConfirmationStatus,
  readBackVerified: boolean,
): SigningState {
  return signingStateFromEvidence({
    confirmed: status === 'confirmed',
    readBackVerified,
    signatureObtained: status !== 'notFound' || readBackVerified,
  });
}

/**
 * Paire blockhash / lastValidBlockHeight d'une transaction prête, si elle est
 * complète. Les deux valeurs sont conservées ENSEMBLE : l'une sans l'autre ne
 * permet pas de juger la validité réelle.
 */
export function blockhashBundleFromTransaction(transaction: {
  recentBlockhash?: string;
  lastValidBlockHeight?: number;
}): BlockhashBundle | null {
  const { recentBlockhash, lastValidBlockHeight } = transaction;
  if (typeof recentBlockhash !== 'string' || recentBlockhash.length === 0) return null;
  if (typeof lastValidBlockHeight !== 'number') return null;
  return { blockhash: recentBlockhash, lastValidBlockHeight };
}