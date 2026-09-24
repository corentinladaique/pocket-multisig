import { PublicKey, Transaction, type Connection, type TransactionError } from '@solana/web3.js';
import * as multisig from '@sqds/multisig';

import type { ProposalCreationBuildResult } from './buildProposalCreation';
import type { ProposalCreationPreflightResult } from './proposalCreationPreflight';

/**
 * Simulation de la creation d'une proposition Squads v4.
 *
 * Strictement lecture seule : AUCUNE signature, AUCUN envoi, aucune creation
 * reelle, aucun ecran. Le seul appel reseau est `simulateTransaction`, avec
 * `sigVerify` au defaut du RPC (faux) puisqu'aucun signataire n'est fourni :
 * rien n'est signe localement, rien n'est transmis au wallet.
 *
 * Meme discipline que `simulateMultisigCreation` : la simulation sert a
 * mesurer le cout reel (rent des deux comptes crees + frais) et a verifier que
 * les instructions passent, avant toute demande de signature.
 */

export type ProposalCreationSimulationResult = {
  err: TransactionError | null;
  logs: string[];
  unitsConsumed: number | null;
  proposalPda: string | null;
  transactionPda: string | null;
  /** Variation estimee du solde du createur (rent + frais), en lamports. */
  estimatedCreatorBalanceDelta: number | null;
  readyToSign: boolean;
  warnings: string[];
  errors: string[];
};

const NO_SIGNATURE_WARNING =
  'Simulation only: nothing is signed, nothing is sent, no account is created on-chain.';
const TWO_ACCOUNTS_WARNING =
  'Two accounts are created by this transaction (VaultTransaction and Proposal): their rent is paid by the creator.';

function toPublicKey(value: string): PublicKey | null {
  try {
    return new PublicKey(value);
  } catch {
    return null;
  }
}

export async function simulateProposalCreation(input: {
  connection: Connection;
  build: ProposalCreationBuildResult;
  preflight: ProposalCreationPreflightResult;
}): Promise<ProposalCreationSimulationResult> {
  const { build, preflight } = input;
  const errors: string[] = [];
  const warnings: string[] = [NO_SIGNATURE_WARNING, TWO_ACCOUNTS_WARNING, ...preflight.warnings];

  const base: Pick<
    ProposalCreationSimulationResult,
    'logs' | 'unitsConsumed' | 'err' | 'estimatedCreatorBalanceDelta'
  > = {
    err: null,
    estimatedCreatorBalanceDelta: null,
    logs: [],
    unitsConsumed: null,
  };

  const request = build.request;
  if (request === null) {
    errors.push('MissingRequest: the build result carries no normalized input.');
  }
  if (!build.readyForBuild) {
    errors.push(...(build.errors.length > 0 ? build.errors : ['BuilderNotReady: the build failed.']));
  }
  if (!preflight.readyForInstructionBuild) {
    errors.push(
      ...(preflight.errors.length > 0
        ? preflight.errors
        : ['PreflightNotReady: the preflight refused this build.']),
    );
  }
  if (build.instructions.length !== 2) {
    errors.push(
      `IncompleteInstructionBundle: expected 2 instructions, got ${build.instructions.length}.`,
    );
  }
  if (build.proposalPda === null || build.transactionPda === null) {
    errors.push('MissingPda: the build carries no proposal or transaction address.');
  }

  const creator = request === null ? null : toPublicKey(request.creator);
  if (request !== null && creator === null) {
    errors.push('InvalidCreator: creator is not a valid public address.');
  }
  const transactionPda = build.transactionPda === null ? null : toPublicKey(build.transactionPda);
  const proposalPda = build.proposalPda === null ? null : toPublicKey(build.proposalPda);

  if (errors.length > 0 || request === null || creator === null || transactionPda === null || proposalPda === null) {
    return {
      ...base,
      errors,
      proposalPda: build.proposalPda,
      readyToSign: false,
      transactionPda: build.transactionPda,
      warnings,
    };
  }

  // Transaction non signee : le createur est le payeur, les deux instructions
  // du lot sont incluses telles quelles.
  const transaction = new Transaction({ feePayer: creator });
  for (const instruction of build.instructions) {
    transaction.add(instruction);
  }

  let creatorBalanceBefore: number | null = null;
  try {
    creatorBalanceBefore = await input.connection.getBalance(creator, 'confirmed');
  } catch (caught: unknown) {
    errors.push(
      `BalanceReadFailed: ${caught instanceof Error ? caught.message : String(caught)}`,
    );
    return {
      ...base,
      errors,
      proposalPda: proposalPda.toBase58(),
      readyToSign: false,
      transactionPda: transactionPda.toBase58(),
      warnings,
    };
  }

  let response;
  try {
    // Transaction legacy : (transaction, signers?, includeAccounts?). Aucun
    // signataire fourni => rien n'est signe ; les comptes demandes rapportent
    // l'etat POST-simulation.
    response = await input.connection.simulateTransaction(transaction, undefined, [
      creator,
      transactionPda,
      proposalPda,
    ]);
  } catch (caught: unknown) {
    errors.push(
      `SimulationFailed: ${caught instanceof Error ? caught.message : String(caught)}`,
    );
    return {
      ...base,
      errors,
      proposalPda: proposalPda.toBase58(),
      readyToSign: false,
      transactionPda: transactionPda.toBase58(),
      warnings,
    };
  }

  const value = response.value;
  const accounts = value.accounts ?? [];
  const creatorAfter = accounts[0] ?? null;
  const transactionAfter = accounts[1] ?? null;
  const proposalAfter = accounts[2] ?? null;

  if (value.err !== null) {
    errors.push(`SimulationFailed: ${JSON.stringify(value.err)}`);
  }
  if (transactionAfter === null) {
    errors.push('TransactionAccountMissing: the VaultTransaction was not created by the simulation.');
  } else if (transactionAfter.owner.toString() !== multisig.PROGRAM_ID.toString()) {
    errors.push(
      `TransactionAccountOwnerMismatch: owner ${transactionAfter.owner.toString()} instead of the Squads program.`,
    );
  }
  if (proposalAfter === null) {
    errors.push('ProposalAccountMissing: the Proposal was not created by the simulation.');
  } else if (proposalAfter.owner.toString() !== multisig.PROGRAM_ID.toString()) {
    errors.push(
      `ProposalAccountOwnerMismatch: owner ${proposalAfter.owner.toString()} instead of the Squads program.`,
    );
  }

  const estimatedCreatorBalanceDelta =
    creatorAfter === null ? null : creatorAfter.lamports - creatorBalanceBefore;
  if (estimatedCreatorBalanceDelta === null) {
    warnings.push(
      'The creator balance was not returned by the simulation: the real cost could not be measured.',
    );
  }

  return {
    err: value.err,
    errors,
    estimatedCreatorBalanceDelta,
    logs: value.logs ?? [],
    proposalPda: proposalPda.toBase58(),
    readyToSign: errors.length === 0,
    transactionPda: transactionPda.toBase58(),
    unitsConsumed: value.unitsConsumed ?? null,
    warnings,
  };
}