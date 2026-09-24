import {
  PublicKey,
  SystemProgram,
  TransactionMessage,
  type TransactionInstruction,
} from '@solana/web3.js';
import * as multisig from '@sqds/multisig';

/**
 * Construction LOCALE d'une proposition de transfert SOL (Squads v4).
 *
 * Module PUR : aucun RPC, aucune signature, aucune transaction envoyee, aucun
 * ecran, aucun stockage. Il ne fait que deriver des PDA et construire deux
 * instructions (`vaultTransactionCreate` puis `proposalCreate`) dans le meme
 * lot, comme l'exige le programme.
 *
 * Aucun secret, aucune cle privee : seules des adresses publiques entrent et
 * sortent.
 */

export type ProposalCreationInput = {
  /** Adresse du multisig (PAS le vault). */
  multisigPda: string;
  /** Index COURANT du multisig ; la proposition utilisera `transactionIndex + 1`. */
  transactionIndex: number;
  /** Membre createur, porteur de la permission Initiate. */
  creator: string;
  /** Destinataire du transfert. */
  destination: string;
  /** Montant en lamports (entier, > 0). */
  lamports: number;
  /** Memo facultatif attache a la transaction Squads. */
  memo?: string | null;
};

export type ProposalCreationBuildResult = {
  /** Index reellement utilise pour la nouvelle proposition, `null` si invalide. */
  transactionIndexNext: number | null;
  vaultPda: string | null;
  transactionPda: string | null;
  proposalPda: string | null;
  /** Entrées normalisées : le preflight ne reçoit que ce résultat, jamais la saisie brute. */
  request: ProposalCreationRequestEcho | null;
  /**
   * Instructions du message qui sera exécuté par le vault (ici le transfert
   * SOL). Exposées pour permettre la revue locale, sans rejouer la
   * construction ailleurs.
   */
  messageInstructions: TransactionInstruction[];
  /** Vide si la construction a echoue : rien de partiellement construit. */
  instructions: TransactionInstruction[];
  readyForBuild: boolean;
  errors: string[];
  warnings: string[];
};

/** Entrées telles que retenues par le builder, sans transformation cachée. */
export type ProposalCreationRequestEcho = {
  creator: string;
  destination: string;
  lamports: number;
  memo: string | null;
  multisigPda: string;
  transactionIndex: number;
};

/** Longueur au-dela de laquelle un memo est signale comme suspect. */
const MEMO_WARN_LENGTH = 200;

function toPublicKey(value: string): PublicKey | null {
  try {
    return new PublicKey(value);
  } catch {
    return null;
  }
}

/**
 * Construit les deux instructions de creation d'une proposition de transfert.
 * Aucune exception : toute entree invalide produit une erreur nommee et un
 * resultat non pret, sans instruction partielle.
 */
export function buildProposalCreation(input: ProposalCreationInput): ProposalCreationBuildResult {
  const errors: string[] = [];
  const warnings: string[] = [
    'A VaultTransaction account and a Proposal account are both created: their rent is paid by the creator.',
    'The transferred amount is enforced when the transaction is executed, not when the proposal is created.',
    'ProposalCreate may record the creator as the first approver: verify the approval count on-chain after the first creation.',
  ];

  const multisigPda = toPublicKey(input.multisigPda);
  if (multisigPda === null) {
    errors.push('InvalidMultisigPda: multisigPda is not a valid public address.');
  }
  const creator = toPublicKey(input.creator);
  if (creator === null) {
    errors.push('InvalidCreator: creator is not a valid public address.');
  }
  const destination = toPublicKey(input.destination);
  if (destination === null) {
    errors.push('InvalidDestination: destination is not a valid public address.');
  }
  if (!Number.isInteger(input.transactionIndex) || input.transactionIndex < 0) {
    errors.push('InvalidTransactionIndex: transactionIndex must be an integer >= 0.');
  }
  if (!Number.isInteger(input.lamports) || input.lamports <= 0) {
    errors.push('InvalidLamports: lamports must be an integer greater than 0.');
  }

  const memo = input.memo === undefined || input.memo === null ? null : input.memo.trim();
  if (memo !== null && memo.length > MEMO_WARN_LENGTH) {
    warnings.push(
      `Memo is ${memo.length} characters long: oversized memos can be rejected when the transaction is created.`,
    );
  }

  if (errors.length > 0 || multisigPda === null || creator === null || destination === null) {
    return {
      errors,
      instructions: [],
      messageInstructions: [],
      proposalPda: null,
      readyForBuild: false,
      request: null,
      transactionIndexNext: null,
      transactionPda: null,
      vaultPda: null,
      warnings,
    };
  }

  const transactionIndexNext = input.transactionIndex + 1;

  // Derivation locale, uniquement via les utilitaires officiels du SDK.
  const [vaultPda] = multisig.getVaultPda({ index: 0, multisigPda });
  const [transactionPda] = multisig.getTransactionPda({
    index: BigInt(transactionIndexNext),
    multisigPda,
  });
  const [proposalPda] = multisig.getProposalPda({
    multisigPda,
    transactionIndex: BigInt(transactionIndexNext),
  });

  // Le message transfere des lamports DEPUIS le vault : c'est le vault qui
  // signera par PDA a l'execution, aucun signataire ephemere n'est necessaire.
  const transferInstruction = SystemProgram.transfer({
    fromPubkey: vaultPda,
    lamports: input.lamports,
    toPubkey: destination,
  });

  // Le blockhash n'est jamais serialise par le format Squads (qui ne conserve
  // que les comptes et les instructions) : il sert uniquement a compiler le
  // message, et le vrai blockhash appartient a la transaction de creation.
  const transactionMessage = new TransactionMessage({
    instructions: [transferInstruction],
    payerKey: vaultPda,
    recentBlockhash: PublicKey.default.toBase58(),
  });

  const instructions: TransactionInstruction[] = [
    multisig.instructions.vaultTransactionCreate({
      creator,
      ephemeralSigners: 0,
      memo: memo === null ? undefined : memo,
      multisigPda,
      transactionIndex: BigInt(transactionIndexNext),
      transactionMessage,
      vaultIndex: 0,
    }),
    multisig.instructions.proposalCreate({
      creator,
      multisigPda,
      transactionIndex: BigInt(transactionIndexNext),
    }),
  ];

  return {
    errors,
    instructions,
    messageInstructions: [transferInstruction],
    proposalPda: proposalPda.toBase58(),
    readyForBuild: true,
    request: {
      creator: creator.toBase58(),
      destination: destination.toBase58(),
      lamports: input.lamports,
      memo,
      multisigPda: multisigPda.toBase58(),
      transactionIndex: input.transactionIndex,
    },
    transactionIndexNext,
    transactionPda: transactionPda.toBase58(),
    vaultPda: vaultPda.toBase58(),
    warnings,
  };
}