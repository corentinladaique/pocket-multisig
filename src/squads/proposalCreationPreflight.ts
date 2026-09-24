import { PublicKey } from '@solana/web3.js';
import * as multisig from '@sqds/multisig';

import type { ProposalCreationBuildResult } from './buildProposalCreation';

/**
 * Preflight LOCAL de creation de proposition : aucune I/O.
 *
 * Module pur : aucun RPC, aucune signature, aucun envoi, aucun ecran, aucun
 * stockage. Il ne lit rien : la vue du multisig et la vue du vault lui sont
 * fournies par l'appelant, telles qu'il les a deja lues. Son role est de
 * confronter le resultat du builder a ces vues et de refuser explicitement
 * tout ce qui ne tient pas debout.
 */

/** Partie de la vue multisig utile ici (issue de `loadMultisig`). */
export type PreflightMultisigView = {
  transactionIndex: number;
  vaultAddress: string;
  members: readonly { address: string; roles: readonly string[] }[];
};

/** Vue du vault : adresse derivee + solde, `null` si le solde n'a pas pu etre lu. */
export type PreflightVaultView = {
  address: string;
  lamports: number | null;
};

export type ProposalCreationPreflightResult = {
  readyForInstructionBuild: boolean;
  errors: string[];
  warnings: string[];
};

export function runProposalCreationPreflight(input: {
  build: ProposalCreationBuildResult;
  multisig: PreflightMultisigView;
  vault: PreflightVaultView;
}): ProposalCreationPreflightResult {
  const { build, vault } = input;
  // Le namespace du SDK est importe sous `multisig` : la vue est donc aliasée
  // ici pour ne jamais masquer `multisig.PROGRAM_ID` / `getTransactionPda`.
  const multisigView = input.multisig;
  const errors: string[] = [];
  const warnings: string[] = [
    'This preflight is local only: it does not verify that the proposal account is still free (that requires a read).',
  ];

  // 1. Le builder doit avoir abouti, et ses erreurs sont reprises telles quelles.
  if (!build.readyForBuild) {
    errors.push(...(build.errors.length > 0 ? build.errors : ['BuilderNotReady: the build failed.']));
  }
  warnings.push(...build.warnings);

  const request = build.request;
  if (request === null) {
    errors.push('MissingRequest: the build result carries no normalized input.');
  }

  // 2. Index de transaction : coherent avec la vue COURANTE, pas avec un instantane.
  if (!Number.isInteger(multisigView.transactionIndex) || multisigView.transactionIndex < 0) {
    errors.push('InvalidViewTransactionIndex: the multisig view has no usable transaction index.');
  }
  if (
    request !== null &&
    Number.isInteger(multisigView.transactionIndex) &&
    request.transactionIndex !== multisigView.transactionIndex
  ) {
    errors.push(
      `TransactionIndexDrift: the build used index ${request.transactionIndex}, the multisig is now at ${multisigView.transactionIndex}.`,
    );
  }
  if (
    build.transactionIndexNext !== null &&
    Number.isInteger(multisigView.transactionIndex) &&
    build.transactionIndexNext !== multisigView.transactionIndex + 1
  ) {
    errors.push(
      `TransactionIndexMismatch: the build targets ${build.transactionIndexNext}, expected ${multisigView.transactionIndex + 1}.`,
    );
  }

  // 3. Vault : la PDA du build, celle de la vue et celle du vault doivent coincider.
  if (build.vaultPda === null) {
    errors.push('MissingVaultPda: the build carries no vault address.');
  } else {
    if (build.vaultPda !== multisigView.vaultAddress) {
      errors.push(
        `VaultPdaMismatch: the build uses ${build.vaultPda}, the multisig view derives ${multisigView.vaultAddress}.`,
      );
    }
    if (vault.address !== build.vaultPda) {
      errors.push(
        `VaultViewMismatch: the vault view is for ${vault.address}, the build targets ${build.vaultPda}.`,
      );
    }
  }

  // 4. Permission Initiate du createur.
  if (request !== null) {
    const creator = multisigView.members.find((member) => member.address === request.creator);
    if (creator === undefined) {
      errors.push(
        `CreatorNotAMember: ${request.creator} is not a member of this multisig.`,
      );
    } else if (!creator.roles.includes('Initiate')) {
      errors.push(
        `MissingInitiatePermission: ${request.creator} has roles [${creator.roles.join(', ')}], Initiate is required.`,
      );
    }
  }

  // 5. Destination et montant.
  if (request !== null) {
    try {
      new PublicKey(request.destination);
    } catch {
      errors.push('InvalidDestination: the destination is not a valid public address.');
    }
    if (!Number.isInteger(request.lamports) || request.lamports <= 0) {
      errors.push('InvalidLamports: the amount must be an integer greater than 0.');
    }
  }

  // 6. Solde du vault : controle du montant, sans jamais lire la chaine ici.
  if (vault.lamports === null) {
    errors.push('VaultBalanceUnavailable: the vault balance was not read, the amount cannot be checked.');
  } else if (request !== null && request.lamports > vault.lamports) {
    errors.push(
      `InsufficientVaultBalance: ${request.lamports} lamports requested, vault holds ${vault.lamports}.`,
    );
  } else if (request !== null && request.lamports === vault.lamports) {
    warnings.push(
      'The transfer would empty the vault completely: the vault account may be closed, keep a margin.',
    );
  }

  // 7. Lot d'instructions complet et PDA coherentes avec le SDK.
  if (build.instructions.length !== 2) {
    errors.push(
      `IncompleteInstructionBundle: expected 2 instructions (vaultTransactionCreate, proposalCreate), got ${build.instructions.length}.`,
    );
  }
  for (const instruction of build.instructions) {
    if (instruction.programId.toString() !== multisig.PROGRAM_ID.toString()) {
      errors.push(
        `UnexpectedProgram: ${instruction.programId.toString()} is not the Squads program.`,
      );
    }
  }

  if (request !== null && (build.transactionPda !== null || build.proposalPda !== null)) {
    try {
      const multisigPda = new PublicKey(request.multisigPda);
      const nextIndex = build.transactionIndexNext ?? 0;
      const [expectedTransactionPda] = multisig.getTransactionPda({
        index: BigInt(nextIndex),
        multisigPda,
      });
      const [expectedProposalPda] = multisig.getProposalPda({
        multisigPda,
        transactionIndex: BigInt(nextIndex),
      });
      if (build.transactionPda !== expectedTransactionPda.toBase58()) {
        errors.push('TransactionPdaMismatch: the transaction PDA does not match the SDK derivation.');
      }
      if (build.proposalPda !== expectedProposalPda.toBase58()) {
        errors.push('ProposalPdaMismatch: the proposal PDA does not match the SDK derivation.');
      }
    } catch (caught: unknown) {
      errors.push(
        `PdaRecomputationFailed: ${caught instanceof Error ? caught.message : String(caught)}`,
      );
    }
  }

  return {
    errors,
    readyForInstructionBuild: errors.length === 0,
    warnings,
  };
}