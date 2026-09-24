import {
  PublicKey,
  Transaction,
  type Connection,
  type TransactionInstruction,
} from '@solana/web3.js';
import * as multisig from '@sqds/multisig';

import {
  applyFreshBlockhash,
  type MultisigCreationBlockhash,
  type SignAndSendTransactionsFn,
} from '../vault/signAndSendMultisigCreation';

/**
 * Execution d'une proposition approuvee (Squads v4, `vaultTransactionExecute`).
 *
 * Module metier PUR au chargement : aucun ecran, aucun bouton, aucune
 * activation d'UI, aucun effet de bord, aucun appel automatique. La fonction
 * doit etre invoquee depuis un geste utilisateur explicite, une seule fois.
 *
 * Differente de l'approbation sur un point : l'instruction d'execution a besoin
 * des comptes du message stocke (`remaining accounts`). Cette reconstruction
 * n'est PAS reecrite ici : elle est deleguee au SDK officiel
 * (`multisig.instructions.vaultTransactionExecute`), qui lit la transaction et
 * produit l'instruction complete. Les Address Lookup Tables ne sont pas
 * supportees par ce flux (une transaction legacy ne peut pas les resoudre) :
 * leur presence est un refus explicite, jamais un envoi hasardeux.
 */

export type ProposalExecutionReadBack = {
  /** Null si le compte proposal n'existe plus (consomme par l'execution). */
  proposalStatusAfter: string | null;
  proposalAccountPresent: boolean;
  /** Solde du vault apres execution (effet observable). */
  vaultLamportsAfter: number | null;
  /** Variation de solde du vault pendant l'execution. */
  vaultLamportsDelta: number | null;
  vaultAddress: string;
};

export type ProposalExecutionSignSendResult = {
  signature: string | null;
  errorMessage: string | null;
  readBack: ProposalExecutionReadBack | null;
  verified: boolean;
  /** Etat relu AVANT l'envoi (porte de securite du plan). */
  statusBefore: string | null;
  approvalsBefore: number;
  validationErrors: string[];
  validationWarnings: string[];
};

const READ_BACK_ATTEMPTS = 4;
const READ_BACK_DELAY_MS = 1500;

const SINGLE_SIGNER_WARNING =
  'Only one member with the Execute permission signs this execution: the threshold was already reached at approval time.';
const NOT_A_TRANSFER_WARNING =
  'The observable effect is reported as a vault balance change: a message that does not move SOL will show a zero or null delta.';
const SINGLE_SEND_WARNING =
  'Call this once, from an explicit user gesture, after a fresh guard and a fresh status read.';

function toPublicKey(value: string): PublicKey | null {
  try {
    return new PublicKey(value);
  } catch {
    return null;
  }
}

/**
 * Execute une proposition deja approuvee, puis relit l'etat reel.
 *
 * @param input.memberAddress membre porteur de la permission Execute (seul signataire).
 * @param input.threshold seuil du multisig, pour verifier `approvals >= threshold` avant d'envoyer.
 */
export async function signAndSendProposalExecution(input: {
  connection: Connection;
  memberAddress: string;
  multisigPda: string;
  signAndSendTransactions: SignAndSendTransactionsFn;
  threshold: number;
  transactionIndex: number;
  blockhash?: MultisigCreationBlockhash;
}): Promise<ProposalExecutionSignSendResult> {
  const errors: string[] = [];
  const warnings: string[] = [SINGLE_SIGNER_WARNING, NOT_A_TRANSFER_WARNING, SINGLE_SEND_WARNING];

  const member = toPublicKey(input.memberAddress);
  if (member === null) {
    errors.push('InvalidMember: memberAddress is not a valid public address.');
  }
  const multisigPda = toPublicKey(input.multisigPda);
  if (multisigPda === null) {
    errors.push('InvalidMultisigPda: multisigPda is not a valid public address.');
  }
  if (!Number.isInteger(input.transactionIndex) || input.transactionIndex < 1) {
    errors.push('InvalidTransactionIndex: transactionIndex must be an integer >= 1.');
  }
  if (!Number.isInteger(input.threshold) || input.threshold < 1) {
    errors.push('InvalidThreshold: threshold must be an integer >= 1.');
  }

  if (errors.length > 0 || member === null || multisigPda === null) {
    return {
      approvalsBefore: 0,
      errorMessage: null,
      readBack: null,
      signature: null,
      statusBefore: null,
      validationErrors: errors,
      validationWarnings: warnings,
      verified: false,
    };
  }

  const [proposalPda] = multisig.getProposalPda({
    multisigPda,
    transactionIndex: BigInt(input.transactionIndex),
  });
  const [vaultPda] = multisig.getVaultPda({ index: 0, multisigPda });

  // 1. Porte de securite : statut REELLEMENT approuve, seuil REELLEMENT atteint.
  let statusBefore: string | null = null;
  let approvalsBefore = 0;
  let vaultLamportsBefore: number | null = null;
  try {
    const proposalInfo = await input.connection.getAccountInfo(proposalPda, 'confirmed');
    if (proposalInfo === null) {
      errors.push(`NoProposalAccount: nothing at ${proposalPda.toBase58()}.`);
    } else {
      const [proposal] = multisig.accounts.Proposal.fromAccountInfo(proposalInfo);
      statusBefore = proposal.status.__kind;
      approvalsBefore = proposal.approved.length;
      if (statusBefore !== 'Approved') {
        errors.push(`ProposalNotApproved: on-chain status is ${statusBefore}, expected Approved.`);
      }
      if (approvalsBefore < input.threshold) {
        errors.push(
          `ThresholdNotReached: ${approvalsBefore} approval(s) on-chain, ${input.threshold} required.`,
        );
      }
    }
    const vaultInfo = await input.connection.getAccountInfo(vaultPda, 'confirmed');
    vaultLamportsBefore = vaultInfo === null ? null : vaultInfo.lamports;
  } catch (caught: unknown) {
    errors.push(
      `PreExecutionReadFailed: ${caught instanceof Error ? caught.message : String(caught)}`,
    );
  }

  if (errors.length > 0) {
    return {
      approvalsBefore,
      errorMessage: null,
      readBack: null,
      signature: null,
      statusBefore,
      validationErrors: errors,
      validationWarnings: warnings,
      verified: false,
    };
  }

  // 2. Instruction : reconstruction des comptes deleguee au SDK officiel.
  let instruction: TransactionInstruction | null = null;
  try {
    const built = await multisig.instructions.vaultTransactionExecute({
      connection: input.connection,
      member,
      multisigPda,
      transactionIndex: BigInt(input.transactionIndex),
    });
    if (built.lookupTableAccounts.length > 0) {
      errors.push(
        'AddressLookupTablesUnsupported: this message references lookup tables, which this flow cannot resolve.',
      );
    }
    instruction = built.instruction;
  } catch (caught: unknown) {
    errors.push(
      `InstructionBuildFailed: ${caught instanceof Error ? caught.message : String(caught)}`,
    );
  }

  if (errors.length > 0 || instruction === null) {
    return {
      approvalsBefore,
      errorMessage: null,
      readBack: null,
      signature: null,
      statusBefore,
      validationErrors:
        instruction === null && errors.length === 0
          ? ['InstructionBuildFailed: the SDK returned no instruction.']
          : errors,
      validationWarnings: warnings,
      verified: false,
    };
  }

  const transaction = new Transaction({ feePayer: member }).add(instruction);

  // 3. Blockhash frais explicite : meme regle que pour la creation et
  //    l'approbation (jamais de simulation/envoi sans blockhash explicite).
  try {
    if (input.blockhash !== undefined) {
      transaction.recentBlockhash = input.blockhash.blockhash;
      transaction.lastValidBlockHeight = input.blockhash.lastValidBlockHeight;
    } else {
      await applyFreshBlockhash(input.connection, transaction);
    }
  } catch (caught: unknown) {
    errors.push(
      `BlockhashUnavailable: ${caught instanceof Error ? caught.message : String(caught)}`,
    );
  }

  let minContextSlot: number | null = null;
  try {
    minContextSlot = await input.connection.getSlot('confirmed');
  } catch (caught: unknown) {
    errors.push(`SlotUnavailable: ${caught instanceof Error ? caught.message : String(caught)}`);
  }

  if (errors.length > 0 || minContextSlot === null) {
    return {
      approvalsBefore,
      errorMessage: null,
      readBack: null,
      signature: null,
      statusBefore,
      validationErrors: errors,
      validationWarnings: warnings,
      verified: false,
    };
  }

  // 4. Envoi : le membre Execute est l'unique signataire.
  let signature: string | null = null;
  let errorMessage: string | null = null;
  try {
    const returned = await input.signAndSendTransactions(transaction, minContextSlot);
    signature = Array.isArray(returned) ? returned[0] ?? null : returned;
    if (signature === null || signature.length === 0) {
      errors.push('NoSignatureReturned: the wallet returned no transaction signature.');
    }
  } catch (caught: unknown) {
    errorMessage = caught instanceof Error ? caught.message : String(caught);
    errors.push(`SendFailed: ${errorMessage}`);
  }

  if (signature === null) {
    return {
      approvalsBefore,
      errorMessage,
      readBack: null,
      signature: null,
      statusBefore,
      validationErrors: errors,
      validationWarnings: warnings,
      verified: false,
    };
  }

  // 5. Relecture autoritaire : presence du compte proposal, statut reel, et
  //    effet observable sur le vault. Aucune supposition sur la semantique du
  //    compte proposal apres execution : on constate, on ne decrete pas.
  let readBack: ProposalExecutionReadBack | null = null;
  for (let attempt = 1; attempt <= READ_BACK_ATTEMPTS; attempt += 1) {
    try {
      const proposalInfo = await input.connection.getAccountInfo(proposalPda, 'confirmed');
      let proposalStatusAfter: string | null = null;
      if (proposalInfo !== null) {
        const [proposal] = multisig.accounts.Proposal.fromAccountInfo(proposalInfo);
        proposalStatusAfter = proposal.status.__kind;
      }
      const vaultInfo = await input.connection.getAccountInfo(vaultPda, 'confirmed');
      const vaultLamportsAfter = vaultInfo === null ? null : vaultInfo.lamports;
      readBack = {
        proposalAccountPresent: proposalInfo !== null,
        proposalStatusAfter,
        vaultAddress: vaultPda.toBase58(),
        vaultLamportsAfter,
        vaultLamportsDelta:
          vaultLamportsAfter === null || vaultLamportsBefore === null
            ? null
            : vaultLamportsAfter - vaultLamportsBefore,
      };
      // Le compte proposal est consomme par l'execution : s'il est encore
      // present, on laisse une tentative de plus au RPC de se mettre a jour.
      if (!readBack.proposalAccountPresent || readBack.proposalStatusAfter === 'Executed') {
        break;
      }
    } catch (caught: unknown) {
      errors.push(
        `ReadBackFailed: ${caught instanceof Error ? caught.message : String(caught)}`,
      );
      break;
    }
    if (attempt < READ_BACK_ATTEMPTS) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, READ_BACK_DELAY_MS);
      });
    }
  }

  if (readBack === null) {
    errors.push('ReadBackMissing: the execution effect could not be observed.');
    return {
      approvalsBefore,
      errorMessage,
      readBack: null,
      signature,
      statusBefore,
      validationErrors: errors,
      validationWarnings: warnings,
      verified: false,
    };
  }

  // La proposition ne doit plus etre en attente : soit le compte a disparu
  // (consomme), soit son statut n'est plus Active/Approved.
  const stillPending =
    readBack.proposalAccountPresent &&
    (readBack.proposalStatusAfter === 'Active' || readBack.proposalStatusAfter === 'Approved');
  if (stillPending) {
    errors.push(
      `ExecutionNotRecorded: the proposal is still ${readBack.proposalStatusAfter ?? 'pending'} after the send.`,
    );
  }
  if (readBack.vaultLamportsDelta === null) {
    warnings.push(
      'The vault account was not readable before or after: the observable effect could not be measured.',
    );
  }

  return {
    approvalsBefore,
    errorMessage,
    readBack,
    signature,
    statusBefore,
    validationErrors: errors,
    validationWarnings: warnings,
    verified: errors.length === 0,
  };
}