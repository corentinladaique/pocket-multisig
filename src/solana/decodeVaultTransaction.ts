// Adaptateur PUR : VaultTransactionMessage (Squads) -> TransactionInstruction[]
// web3.js -> TransactionReviewModel (règles T09 partagées).
//
// Lecture seule. Ce module n'appelle aucun RPC, ne signe rien, ne désérialise
// aucun compte : il reçoit un message DÉJÀ désérialisé par le SDK officiel
// (`VaultTransaction.fromAccountAddress` / `fromAccountInfo`).
import { PublicKey, TransactionInstruction, type AccountMeta } from '@solana/web3.js';
import * as multisig from '@sqds/multisig';

import {
  LOOKUP_TABLE_REQUIRED,
  modelFromInstructions,
  type ReviewContext,
} from './decodeTransactionMessage';
import type { TransactionReviewModel } from '../types/transactionReview';

type VaultTransactionMessage = multisig.generated.VaultTransactionMessage;

/** Résultat de la reconstruction : soit des instructions, soit un échec typé. */
export type InstructionReconstruction =
  | { ok: true; instructions: TransactionInstruction[] }
  | { ok: false; decodeStatus: 'partial' | 'unknown'; note: string };

/**
 * Reconstruit les `TransactionInstruction` web3.js depuis un message Squads.
 *
 * Les métadonnées signer/writable proviennent EXCLUSIVEMENT des helpers
 * officiels du SDK (`isSignerIndex`, `isStaticWritableIndex`), jamais de
 * suppositions. Toute incohérence d'index est signalée, jamais levée.
 */
export function vaultTransactionMessageToInstructions(
  message: VaultTransactionMessage,
): InstructionReconstruction {
  const accountKeys = message.accountKeys;
  if (accountKeys.length === 0) {
    return { ok: false, decodeStatus: 'unknown', note: 'The message declares no account.' };
  }

  const instructions: TransactionInstruction[] = [];

  for (const [position, compiled] of message.instructions.entries()) {
    const programIdIndex = compiled.programIdIndex;
    if (!Number.isInteger(programIdIndex) || programIdIndex < 0 || programIdIndex >= accountKeys.length) {
      return {
        ok: false,
        decodeStatus: 'unknown',
        note: `Instruction ${position}: programIdIndex (${programIdIndex}) is outside accountKeys (${accountKeys.length}).`,
      };
    }

    const keys: AccountMeta[] = [];
    for (const accountIndex of Array.from(compiled.accountIndexes)) {
      if (!Number.isInteger(accountIndex) || accountIndex < 0 || accountIndex >= accountKeys.length) {
        return {
          ok: false,
          decodeStatus: 'unknown',
          note: `Instruction ${position}: accountIndex (${accountIndex}) is outside accountKeys (${accountKeys.length}).`,
        };
      }
      const pubkey = accountKeys[accountIndex];
      if (pubkey === undefined) {
        return {
          ok: false,
          decodeStatus: 'unknown',
          note: `Instruction ${position}: no public key found for accountIndex ${accountIndex}.`,
        };
      }
      // Règles officielles du message Squads, jamais réinventées.
      keys.push({
        pubkey,
        isSigner: multisig.utils.isSignerIndex(message, accountIndex),
        isWritable: multisig.utils.isStaticWritableIndex(message, accountIndex),
      });
    }

    const programId = accountKeys[programIdIndex];
    if (programId === undefined) {
      return {
        ok: false,
        decodeStatus: 'unknown',
        note: `Instruction ${position}: no program found for programIdIndex ${programIdIndex}.`,
      };
    }

    instructions.push(
      new TransactionInstruction({
        programId: programId as PublicKey,
        keys,
        data: Buffer.from(compiled.data),
      }),
    );
  }

  return { ok: true, instructions };
}

/**
 * Produit un modèle de revue à partir d'un `VaultTransactionMessage` Squads
 * déjà désérialisé.
 *
 * Aucun RPC implicite : si des Address Lookup Tables sont référencées et que
 * leurs données ne sont pas fournies, la revue est refusée explicitement — la
 * résolution automatique n'est jamais tentée ici.
 */
export function decodeVaultTransactionMessage(
  message: VaultTransactionMessage,
  context: ReviewContext,
): TransactionReviewModel {
  if (message.addressTableLookups.length > 0) {
    const model = modelFromInstructions([], context);
    model.decodeStatus = 'unknown';
    model.notes = [LOOKUP_TABLE_REQUIRED];
    return model;
  }

  const reconstruction = vaultTransactionMessageToInstructions(message);
  if (!reconstruction.ok) {
    const model = modelFromInstructions([], context);
    model.decodeStatus = reconstruction.decodeStatus;
    model.notes = [reconstruction.note];
    return model;
  }

  return modelFromInstructions(reconstruction.instructions, context);
}