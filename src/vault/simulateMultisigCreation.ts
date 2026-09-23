import { PublicKey, type Connection, type Transaction, type TransactionError } from '@solana/web3.js';
import * as multisig from '@sqds/multisig';

/**
 * Simulation de la creation d'un multisig Squads v4, SANS signature.
 *
 * `sigVerify: false` et `replaceRecentBlockhash: true` permettent a la
 * simulation d'examiner l'instruction sans qu'aucune signature ne soit demandee
 * et sans dependre d'un blockhash recent. Rien n'est signe, rien n'est envoye,
 * aucun compte n'est ecrit : une simulation n'a aucun effet on-chain.
 *
 * C'est la seule source AUTORITAIRE du cout reel (le preflight ne fournit
 * qu'une borne inferieure, voir multisigCreationPreflight.ts).
 */
export type MultisigCreationSimulationResult = {
  /** Erreur d'execution de la simulation, `null` si l'instruction passe. */
  err: TransactionError | null;
  logs: string[];
  unitsConsumed: number | null;
  /** Variation de solde du createur pendant la simulation (frais + rent). */
  creatorBalanceDelta: number | null;
  /**
   * Lamports finaux du compte multisig simule (rent alloue), `null` si le
   * compte n'apparait pas dans le resultat : c'est le montant reellement
   * exige, qui remplace l'estimation borne inferieure du preflight.
   */
  multisigRentLamports: number | null;
  /** Vrai uniquement si la simulation passe ET que le compte multisig est cree. */
  readyToSign: boolean;
  validationErrors: string[];
  validationWarnings: string[];
};

const NO_SIGNATURE_WARNING =
  'Nothing was signed and nothing was sent: this is a simulation only.';
const AUTHORITATIVE_COST_WARNING =
  'creatorBalanceDelta and multisigRentLamports come from the simulation and are the authoritative creation cost.';
const EPHEMERAL_KEY_WARNING =
  'A real run will still require the ephemeral createKey to partial-sign before the wallet signs via MWA.';

function toPublicKey(value: string): PublicKey | null {
  try {
    return new PublicKey(value);
  } catch {
    return null;
  }
}

export async function simulateMultisigCreation(input: {
  connection: Connection;
  transaction: Transaction;
  multisigPda: string;
  creator: string;
}): Promise<MultisigCreationSimulationResult> {
  const errors: string[] = [];
  const warnings: string[] = [NO_SIGNATURE_WARNING, AUTHORITATIVE_COST_WARNING, EPHEMERAL_KEY_WARNING];

  const creator = toPublicKey(input.creator);
  if (creator === null) {
    errors.push('InvalidCreator: creator is not a valid public address.');
  }
  const multisigPda = toPublicKey(input.multisigPda);
  if (multisigPda === null) {
    errors.push('InvalidMultisigPda: multisigPda is not a valid public address.');
  }
  if (input.transaction.feePayer === undefined || input.transaction.feePayer === null) {
    errors.push('MissingFeePayer: the transaction has no fee payer.');
  }
  if (input.transaction.instructions.length === 0) {
    errors.push('EmptyTransaction: the transaction carries no instruction.');
  }

  if (errors.length > 0 || creator === null || multisigPda === null) {
    return {
      err: null,
      logs: [],
      unitsConsumed: null,
      creatorBalanceDelta: null,
      multisigRentLamports: null,
      readyToSign: false,
      validationErrors: errors,
      validationWarnings: warnings,
    };
  }

  let creatorBalanceBefore: number | null = null;
  try {
    creatorBalanceBefore = await input.connection.getBalance(creator);
  } catch (caught: unknown) {
    errors.push(
      `BalanceReadFailed: ${caught instanceof Error ? caught.message : String(caught)}`,
    );
  }

  // API web3.js v1 pour une Transaction legacy : (transaction, signers?, includeAccounts?)
  // - aucun signataire n'est fourni : rien n'est signe et le RPC applique
  //   `sigVerify: false` par defaut (aucune signature exigee) ;
  // - `includeAccounts` demande l'etat post-simulation des comptes, ce qui
  //   donne le cout reellement facture ;
  // - le RPC remplace lui-meme le blockhash recent, absent de la transaction.
  const response = await input.connection.simulateTransaction(
    input.transaction,
    undefined,
    [creator, multisigPda],
  );

  const value = response.value;
  const logs = value.logs ?? [];
  const unitsConsumed = value.unitsConsumed ?? null;
  const accounts = value.accounts ?? [];
  const creatorAccount = accounts[0] ?? null;
  const multisigAccount = accounts[1] ?? null;

  const creatorBalanceDelta =
    creatorBalanceBefore === null || creatorAccount === null
      ? null
      : creatorAccount.lamports - creatorBalanceBefore;

  const multisigRentLamports = multisigAccount === null ? null : multisigAccount.lamports;

  // Le compte multisig doit apparaitre, appartenir au programme Squads et etre
  // renseigne : sinon l'instruction n'a pas produit ce qu'elle pretend.
  if (multisigAccount === null) {
    errors.push('MultisigAccountMissing: the simulated transaction did not create the account.');
  } else if (multisigAccount.owner.toString() !== multisig.PROGRAM_ID.toString()) {
    errors.push(
      `MultisigAccountOwnerMismatch: owner is ${multisigAccount.owner.toString()}, expected ${multisig.PROGRAM_ID.toString()}.`,
    );
  }

  if (value.err !== null) {
    errors.push(`SimulationFailed: ${JSON.stringify(value.err)}`);
  }

  if (unitsConsumed === null) {
    warnings.push('unitsConsumed is absent from the simulation result.');
  }

  return {
    err: value.err,
    logs,
    unitsConsumed,
    creatorBalanceDelta,
    multisigRentLamports,
    readyToSign: value.err === null && errors.length === 0,
    validationErrors: errors,
    validationWarnings: warnings,
  };
}