// Décodeur PUR d'un message Solana vers un TransactionReviewModel.
//
// Contraintes de ce module :
// - aucune `Connection`, aucun RPC, aucun wallet, aucun stockage, aucun fichier,
//   aucune variable secrète, aucun hook React ;
// - une seule dépendance : @solana/web3.js v1 (imposé par Squads) ;
// - aucun programme autre que `SystemProgram.transfer` n'est interprété.
import {
  MessageV0,
  PublicKey,
  SystemInstruction,
  SystemProgram,
  TransactionMessage,
  type AddressLookupTableAccount,
  type MessageCompiledInstruction,
  type TransactionInstruction,
  type VersionedMessage,
} from '@solana/web3.js';

import {
  SYSTEM_PROGRAM_ID,
  knownField,
  unknownField,
  type ProgramDescriptor,
  type SolAmount,
  type TransactionReviewModel,
} from '../types/transactionReview';

/** Contexte public déjà connu, fourni par l'appelant. */
export interface ReviewContext {
  network: 'devnet';
  multisigAddress: string;
  vaultAddress: string;
  proposalIndex: number;
  proposalStatus: string;
  signerWallet: string;
  /** Vrai pour un jeu de données local de démonstration. */
  isPreview: boolean;
}

export interface DecodeArgs {
  addressLookupTableAccounts?: AddressLookupTableAccount[];
}

/** Message exact exigé lorsqu'une table d'adresses n'est pas fournie. */
export const LOOKUP_TABLE_REQUIRED =
  'Address lookup table data is required to review this transaction.';

const SYSTEM_PROGRAM_DESCRIPTOR: ProgramDescriptor = {
  id: SYSTEM_PROGRAM_ID,
  label: 'System Program',
};

function baseModel(context: ReviewContext): TransactionReviewModel {
  return {
    network: context.network,
    multisigAddress: context.multisigAddress,
    vaultAddress: context.vaultAddress,
    proposalIndex: context.proposalIndex,
    proposalStatus: context.proposalStatus,
    signerWallet: context.signerWallet,
    program: unknownField<ProgramDescriptor>(),
    action: unknownField<string>(),
    source: unknownField<string>(),
    destination: unknownField<string>(),
    amount: unknownField<SolAmount>(),
    fee: unknownField<SolAmount>(), // les frais exigent une simulation
    decodeStatus: 'unknown',
    isPreview: context.isPreview,
    notes: [],
  };
}

/** Décodage d'un `SystemProgram.transfer` ; retourne `null` si non reconnu. */
function tryDecodeSystemTransfer(
  instruction: TransactionInstruction,
): { from: string; to: string; lamports: bigint } | null {
  if (!instruction.programId.equals(SystemProgram.programId)) return null;
  try {
    const decoded = SystemInstruction.decodeTransfer(instruction);
    return {
      from: decoded.fromPubkey.toBase58(),
      to: decoded.toPubkey.toBase58(),
      lamports: decoded.lamports,
    };
  } catch {
    // Données d'instruction invalides : jamais d'exception non interceptée.
    return null;
  }
}

/**
 * Décompile un message et produit un modèle de revue.
 * Aucune donnée n'est inventée : tout champ non décodé reste `known: false`.
 */
export function decodeTransactionMessage(
  message: VersionedMessage,
  context: ReviewContext,
  args?: DecodeArgs,
): TransactionReviewModel {
  const model = baseModel(context);

  // --- Décompilation -------------------------------------------------------
  let instructions: TransactionInstruction[];
  try {
    const decompileArgs = args?.addressLookupTableAccounts
      ? { addressLookupTableAccounts: args.addressLookupTableAccounts }
      : undefined;
    instructions = TransactionMessage.decompile(message, decompileArgs).instructions;
  } catch (caught: unknown) {
    const raw = caught instanceof Error ? caught.message : String(caught);
    model.decodeStatus = 'unknown';
    if (/address table lookups were not resolved|mismatch in the number of account keys/i.test(raw)) {
      // Les tables d'adresses ne sont pas résolues : aucune heuristique,
      // aucune requête réseau, aucune adresse reconstituée.
      model.notes.push(LOOKUP_TABLE_REQUIRED);
    } else {
      model.notes.push(`Message could not be decompiled: ${raw}`);
    }
    return model;
  }

  if (instructions.length === 0) {
    model.decodeStatus = 'unknown';
    model.notes.push('The message contains no instruction to review.');
    return model;
  }

  // --- Plusieurs instructions : aucun résumé trompeur -----------------------
  if (instructions.length > 1) {
    const allSystem = instructions.every((ix) => ix.programId.equals(SystemProgram.programId));
    const recognized = instructions.filter((ix) => tryDecodeSystemTransfer(ix) !== null).length;
    model.decodeStatus = 'partial';
    if (allSystem) {
      model.program = knownField(SYSTEM_PROGRAM_DESCRIPTOR);
    } else {
      const programIds = Array.from(
        new Set(instructions.map((ix) => ix.programId.toBase58())),
      );
      model.program = knownField({
        id: programIds[0] ?? '',
        label: `Multiple programs (${programIds.length})`,
      });
    }
    model.action = knownField(
      `${instructions.length} instructions (${recognized} recognized as System Program transfer)`,
    );
    model.notes.push(
      'This message contains several instructions. It is not presented as a single transfer: destination and amount cannot be reduced to one value.',
    );
    return model;
  }

  // --- Une seule instruction ----------------------------------------------
  const instruction = instructions[0];
  if (instruction === undefined) {
    model.decodeStatus = 'unknown';
    return model;
  }

  const programId = instruction.programId.toBase58();

  if (!instruction.programId.equals(SystemProgram.programId)) {
    // Programme inconnu : adresse brute préservée, aucune interprétation.
    model.program = knownField({ id: programId, label: 'Unrecognized program' });
    model.decodeStatus = 'unknown';
    model.notes.push(
      `Program not recognized: no interpretation was attempted for ${programId}.`,
    );
    return model;
  }

  model.program = knownField(SYSTEM_PROGRAM_DESCRIPTOR);

  const decoded = tryDecodeSystemTransfer(instruction);
  if (decoded === null) {
    // Program connu mais données non décodables : donnée critique manquante.
    model.decodeStatus = 'partial';
    model.notes.push(
      'System Program instruction could not be decoded: its data does not match a known transfer layout.',
    );
    return model;
  }

  model.action = knownField('System Program: transfer');
  model.source = knownField(decoded.from);
  model.destination = knownField(decoded.to);
  model.amount = knownField<SolAmount>({ lamports: decoded.lamports, unit: 'SOL' });

  // La source est vérifiée explicitement : elle n'est jamais supposée être le
  // vault du simple fait que le projet utilise Squads.
  if (decoded.from !== context.vaultAddress) {
    model.decodeStatus = 'partial';
    model.notes.push(
      `Unexpected source: the decoded source (${decoded.from}) is not the expected vault (${context.vaultAddress}).`,
    );
    return model;
  }

  model.decodeStatus = 'decoded';
  return model;
}

// ---------------------------------------------------------------------------
// Jeux de données PREVIEW — construits localement, jamais envoyés ni signés.
// Les adresses ci-dessous sont dérivées hors chaîne (aucun compte existant,
// aucun lien avec les membres réels de la fixture devnet).
// ---------------------------------------------------------------------------

export const PREVIEW_MULTISIG = 'DxaHm47inZWeBQmd63hSmEw43kvP9xebNo1H6wVznFXi';
export const PREVIEW_VAULT = 'B6seGKSUaxfo7pQK4pUNKfhNbabA4gqKvV9iE6EByPHy';
export const PREVIEW_SIGNER = 'GZUrVZnw4QoHf3SvXrYvWfFzVbXXHxoA9UKSajWBfUuM';
const PREVIEW_DESTINATION = '9hvAFWYxp2mbZeF7JmvnWZqrhxNrT8tCA2PMvcshHeuR';
const PREVIEW_UNKNOWN_PROGRAM = 'AhrJ9RJNLuNtS1DWPY5BhnKKakZdbNnr7VaGbyCbvnkX';
const PREVIEW_BLOCKHASH = '11111111111111111111111111111111';

const PREVIEW_CONTEXT: ReviewContext = {
  network: 'devnet',
  multisigAddress: PREVIEW_MULTISIG,
  vaultAddress: PREVIEW_VAULT,
  proposalIndex: 1,
  proposalStatus: 'Preview',
  signerWallet: PREVIEW_SIGNER,
  isPreview: true,
};

/** Construit un message legacy déterministe, sans réseau. */
function legacyMessage(instructions: TransactionInstruction[], payer: PublicKey) {
  return new TransactionMessage({
    payerKey: payer,
    recentBlockhash: PREVIEW_BLOCKHASH,
    instructions,
  }).compileToLegacyMessage();
}

function transferInstruction(from: string, to: string, lamports: number) {
  return SystemProgram.transfer({
    fromPubkey: new PublicKey(from),
    toPubkey: new PublicKey(to),
    lamports,
  });
}

/** Cas 1 — transfert System Program de 0 lamport émis par le vault attendu. */
export function previewDecoded(): TransactionReviewModel {
  return decodeTransactionMessage(
    legacyMessage(
      [transferInstruction(PREVIEW_VAULT, PREVIEW_DESTINATION, 0)],
      new PublicKey(PREVIEW_SIGNER),
    ),
    PREVIEW_CONTEXT,
  );
}

/** Cas 2 — transfert d'un montant positif fictif émis par le vault attendu. */
export function previewPositiveAmount(): TransactionReviewModel {
  return decodeTransactionMessage(
    legacyMessage(
      [transferInstruction(PREVIEW_VAULT, PREVIEW_DESTINATION, 500_000_000)],
      new PublicKey(PREVIEW_SIGNER),
    ),
    PREVIEW_CONTEXT,
  );
}

/** Cas 3 — source différente du vault attendu : `partial` + avertissement. */
export function previewUnexpectedSource(): TransactionReviewModel {
  return decodeTransactionMessage(
    legacyMessage(
      [transferInstruction(PREVIEW_SIGNER, PREVIEW_DESTINATION, 0)],
      new PublicKey(PREVIEW_SIGNER),
    ),
    PREVIEW_CONTEXT,
  );
}

/** Cas 4 — programme inconnu : `unknown`, adresse brute préservée. */
export function previewUnknownProgram(): TransactionReviewModel {
  return decodeTransactionMessage(
    legacyMessage(
      [
        {
          programId: new PublicKey(PREVIEW_UNKNOWN_PROGRAM),
          keys: [
            { pubkey: new PublicKey(PREVIEW_VAULT), isSigner: true, isWritable: true },
          ],
          data: Buffer.from([1, 2, 3, 4]),
        } as TransactionInstruction,
      ],
      new PublicKey(PREVIEW_SIGNER),
    ),
    PREVIEW_CONTEXT,
  );
}

/** Cas 5 — plusieurs instructions dont une inconnue : `partial`. */
export function previewMultipleInstructions(): TransactionReviewModel {
  return decodeTransactionMessage(
    legacyMessage(
      [
        transferInstruction(PREVIEW_VAULT, PREVIEW_DESTINATION, 0),
        {
          programId: new PublicKey(PREVIEW_UNKNOWN_PROGRAM),
          keys: [{ pubkey: new PublicKey(PREVIEW_VAULT), isSigner: true, isWritable: true }],
          data: Buffer.from([9]),
        } as TransactionInstruction,
      ],
      new PublicKey(PREVIEW_SIGNER),
    ),
    PREVIEW_CONTEXT,
  );
}

/** Cas 7 — données d'instruction System Program invalides : jamais d'exception. */
export function previewInvalidSystemData(): TransactionReviewModel {
  return decodeTransactionMessage(
    legacyMessage(
      [
        {
          programId: SystemProgram.programId,
          keys: [
            { pubkey: new PublicKey(PREVIEW_VAULT), isSigner: true, isWritable: true },
            { pubkey: new PublicKey(PREVIEW_DESTINATION), isSigner: false, isWritable: true },
          ],
          data: Buffer.from([0xff, 0xff, 0xff, 0xff]),
        } as TransactionInstruction,
      ],
      new PublicKey(PREVIEW_SIGNER),
    ),
    PREVIEW_CONTEXT,
  );
}

/**
 * Cas 6 — message v0 référençant une table d'adresses NON fournie.
 * Aucun RPC, aucune heuristique : le décodeur doit répondre `partial`/`unknown`
 * avec le message officiel exigé.
 */
export function previewUnresolvedLookupTable(): TransactionReviewModel {
  const compiled: MessageCompiledInstruction = {
    programIdIndex: 1,
    accountKeyIndexes: [0, 2],
    data: Uint8Array.from([2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
  };
  const message = new MessageV0({
    header: {
      numRequiredSignatures: 1,
      numReadonlySignedAccounts: 0,
      numReadonlyUnsignedAccounts: 1,
    },
    staticAccountKeys: [new PublicKey(PREVIEW_SIGNER), SystemProgram.programId],
    recentBlockhash: PREVIEW_BLOCKHASH,
    compiledInstructions: [compiled],
    addressTableLookups: [
      {
        accountKey: new PublicKey(PREVIEW_UNKNOWN_PROGRAM),
        writableIndexes: [0],
        readonlyIndexes: [],
      },
    ],
  });
  // Volontairement appelé SANS `addressLookupTableAccounts`.
  return decodeTransactionMessage(message, PREVIEW_CONTEXT);
}

/** Les trois cas affichés par l'écran de revue (Phase F). */
export function buildReviewPreviews(): ReadonlyArray<{
  key: 'decoded' | 'partial' | 'unknown';
  label: string;
  model: TransactionReviewModel;
}> {
  return [
    { key: 'decoded', label: 'decoded', model: previewDecoded() },
    { key: 'partial', label: 'partial', model: previewUnexpectedSource() },
    { key: 'unknown', label: 'unknown', model: previewUnknownProgram() },
  ];
}