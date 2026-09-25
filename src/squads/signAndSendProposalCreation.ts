import { PublicKey, Transaction, type Connection } from '@solana/web3.js';
import * as multisig from '@sqds/multisig';

import { describeMwaError } from '../wallet/mwaDiagnostics';
import type { SignatureConfirmationStatus } from '../wallet/operationState';
import { confirmSignature, type SignatureConfirmation } from '../solana/confirmSignature';
import {
  blockhashBundleFromTransaction,
  DEFAULT_BLOCK_MARGIN,
  evaluateSigningWindow,
  signingStateFromEvidence,
  type SigningState,
} from '../wallet/signingWindow';

import {
  applyFreshBlockhash,
  type MultisigCreationBlockhash,
  type SignAndSendTransactionsFn,
} from '../vault/signAndSendMultisigCreation';
import type { ProposalCreationBuildResult } from './buildProposalCreation';
import type { ProposalCreationPreflightResult } from './proposalCreationPreflight';
import type { ProposalCreationSimulationResult } from './simulateProposalCreation';

/**
 * Envoi reel d'une proposition Squads v4 (transfert SOL).
 *
 * Module metier PUR au chargement : aucun ecran, aucun bouton, aucun flux
 * React, aucune execution automatique. La fonction doit etre appelee depuis un
 * geste utilisateur explicite, une seule fois, apres confirmation.
 *
 * La porte d'entree exige que la SIMULATION ait ete faite et reussie
 * (`simulation.readyToSign`) : aucun envoi sans simulation prealable.
 *
 * Un seul signataire : le createur (membre porteur de `Initiate`), payeur du
 * rent des deux comptes crees. Aucun signataire ephemere, donc aucun
 * `partialSign` local.
 */

export type ProposalCreationReadBack = {
  proposalAddress: string;
  proposalStatus: string | null;
  proposalApprovedCount: number | null;
  /** Le createur est-il inscrit comme premier approbateur ? Constat, pas attente. */
  creatorIsApprover: boolean | null;
  transactionAddress: string;
  transactionIndex: number | null;
  transactionVaultIndex: number | null;
};

export type ProposalCreationSignSendResult = {
  signature: string | null;
  readBack: ProposalCreationReadBack | null;
  verified: boolean;
  validationErrors: string[];
  validationWarnings: string[];
  errorMessage: string | null;
  /** Code MWA exact de l'échec d'envoi, `null` s'il n'y en a pas — jamais inventé. */
  errorCode?: string | null;
  /** Preuve n°2 : statut de confirmation de la signature, relu sur la grappe. */
  confirmationStatus?: SignatureConfirmationStatus | null;
  confirmed?: boolean;
  /** Blockhash effectivement utilisé pour l'envoi, avec sa limite en blocs. */
  blockhash?: string | null;
  lastValidBlockHeight?: number | null;
  /** État affichable du parcours de signature. */
  signingState?: SigningState;
};

const READ_BACK_ATTEMPTS = 4;
const READ_BACK_DELAY_MS = 1500;

const SINGLE_SIGNER_WARNING =
  'Only the creator signs this creation: no ephemeral signer, no second signature.';
const TWO_ACCOUNTS_WARNING =
  'Two accounts are created and their rent is paid by the creator.';
const SINGLE_SEND_WARNING =
  'Call this once, from an explicit user gesture, after a fresh preflight and a fresh simulation.';

function toPublicKey(value: string): PublicKey | null {
  try {
    return new PublicKey(value);
  } catch {
    return null;
  }
}

export async function signAndSendProposalCreation(input: {
  connection: Connection;
  build: ProposalCreationBuildResult;
  preflight: ProposalCreationPreflightResult;
  simulation: ProposalCreationSimulationResult;
  signAndSendTransactions: SignAndSendTransactionsFn;
  blockhash?: MultisigCreationBlockhash;
}): Promise<ProposalCreationSignSendResult> {
  const { build, preflight, simulation } = input;
  const errors: string[] = [];
  const warnings: string[] = [
    SINGLE_SIGNER_WARNING,
    TWO_ACCOUNTS_WARNING,
    SINGLE_SEND_WARNING,
    ...preflight.warnings,
  ];

  const request = build.request;
  const expectedIndex = build.transactionIndexNext;

  if (request === null) {
    errors.push('MissingRequest: the build result carries no normalized input.');
  }
  if (!build.readyForBuild) {
    errors.push('BuilderNotReady: the build did not succeed.');
  }
  if (!preflight.readyForInstructionBuild) {
    errors.push('PreflightNotReady: the preflight did not allow this build.');
  }
  if (!simulation.readyToSign) {
    errors.push('SimulationNotReady: no successful simulation was provided for this build.');
  }
  if (build.instructions.length !== 2) {
    errors.push(
      `IncompleteInstructionBundle: expected 2 instructions, got ${build.instructions.length}.`,
    );
  }
  if (expectedIndex === null || !Number.isInteger(expectedIndex)) {
    errors.push('MissingTransactionIndex: the build carries no target index.');
  }

  const creator = request === null ? null : toPublicKey(request.creator);
  if (request !== null && creator === null) {
    errors.push('InvalidCreator: creator is not a valid public address.');
  }
  const proposalPda = build.proposalPda === null ? null : toPublicKey(build.proposalPda);
  const transactionPda = build.transactionPda === null ? null : toPublicKey(build.transactionPda);
  if (proposalPda === null || transactionPda === null) {
    errors.push('MissingPda: the build carries no proposal or transaction address.');
  }

  if (
    errors.length > 0 ||
    creator === null ||
    proposalPda === null ||
    transactionPda === null ||
    expectedIndex === null
  ) {
    return {
      errorMessage: null,
      readBack: null,
      signature: null,
      validationErrors: errors,
      validationWarnings: warnings,
      verified: false,
    };
  }

  // Transaction : le createur est payeur ET unique signataire.
  const transaction = new Transaction({ feePayer: creator });
  for (const instruction of build.instructions) {
    transaction.add(instruction);
  }

  // 1. Blockhash frais explicite (meme regle que multisig / approbation / execution).
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
      errorMessage: null,
      readBack: null,
      signature: null,
      validationErrors: errors,
      validationWarnings: warnings,
      verified: false,
    };
  }

  // 1bis. Fenetre de signature : verdict rendu AVANT d'ouvrir le wallet.
  const bundle = blockhashBundleFromTransaction(transaction);
  let blockHeight: number | null = null;
  try {
    blockHeight = await input.connection.getBlockHeight('confirmed');
  } catch (caught: unknown) {
    errors.push(
      `BlockHeightUnavailable: ${caught instanceof Error ? caught.message : String(caught)}`,
    );
  }
  const signingWindow =
    bundle === null
      ? null
      : evaluateSigningWindow({ blockHeight, bundle, marginBlocks: DEFAULT_BLOCK_MARGIN });
  if (bundle === null || signingWindow === null || !signingWindow.usable) {
    if (signingWindow !== null && !signingWindow.usable) {
      errors.push(`SignatureWindowNotUsable: ${signingWindow.reason}`);
    }
    return {
      blockhash: bundle?.blockhash ?? null,
      errorCode: null,
      errorMessage: null,
      lastValidBlockHeight: bundle?.lastValidBlockHeight ?? null,
      readBack: null,
      signature: null,
      signingState: 'signature-request-expired',
      validationErrors: errors,
      validationWarnings: warnings,
      verified: false,
    };
  }

  // 2. Envoi : la signature du createur est produite par le wallet.
  let signature: string | null = null;
  let errorMessage: string | null = null;
  let errorCode: string | null = null;
  let confirmation: SignatureConfirmation | null = null;
  try {
    const returned = await input.signAndSendTransactions(transaction, minContextSlot);
    signature = Array.isArray(returned) ? returned[0] ?? null : returned;
    if (signature === null || signature.length === 0) {
      errors.push('NoSignatureReturned: the wallet returned no transaction signature.');
    }
  } catch (caught: unknown) {
    errorMessage = caught instanceof Error ? caught.message : String(caught);
    // Code MWA conservé séparément : le message seul ne permet pas de diagnostiquer.
    errorCode = describeMwaError(caught, 'signAndSendTransactions').code;
    errors.push(`SendFailed: ${errorMessage}`);
  }

  if (signature === null) {
    return {
      errorCode,
      errorMessage,
      readBack: null,
      signature: null,
      validationErrors: errors,
      validationWarnings: warnings,
      verified: false,
    };
  }

  // 3. Relecture autoritaire : les DEUX comptes, leur proprietaire et l'index.
  let readBack: ProposalCreationReadBack | null = null;
  for (let attempt = 1; attempt <= READ_BACK_ATTEMPTS; attempt += 1) {
    try {
      const proposalInfo = await input.connection.getAccountInfo(proposalPda, 'confirmed');
      const transactionInfo = await input.connection.getAccountInfo(transactionPda, 'confirmed');
      if (proposalInfo !== null && transactionInfo !== null) {
        const [proposal] = multisig.accounts.Proposal.fromAccountInfo(proposalInfo);
        const [vaultTransaction] = multisig.accounts.VaultTransaction.fromAccountInfo(
          transactionInfo,
        );
        readBack = {
          creatorIsApprover: proposal.approved.some(
            (approver) => approver.toBase58() === request?.creator,
          ),
          proposalAddress: proposalPda.toBase58(),
          proposalApprovedCount: proposal.approved.length,
          proposalStatus: proposal.status.__kind,
          transactionAddress: transactionPda.toBase58(),
          transactionIndex: Number(vaultTransaction.index),
          transactionVaultIndex: vaultTransaction.vaultIndex,
        };
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

  // Preuve n°2 : la transaction est-elle confirmée ? Sans elle, aucun succès.
  try {
    confirmation = await confirmSignature({ connection: input.connection, signature });
  } catch (caught: unknown) {
    errors.push(
      `ConfirmationCheckFailed: ${caught instanceof Error ? caught.message : String(caught)}`,
    );
  }

  if (readBack === null) {
    errors.push('ReadBackMissing: the created accounts are not readable yet.');
    return {
      errorCode,
      errorMessage,
      readBack: null,
      signature,
      validationErrors: errors,
      validationWarnings: warnings,
      verified: false,
    };
  }

  // 4. Verifications : presence, proprietaire Squads, index attendu.
  try {
    const proposalInfo = await input.connection.getAccountInfo(proposalPda, 'confirmed');
    const transactionInfo = await input.connection.getAccountInfo(transactionPda, 'confirmed');
    const programId = multisig.PROGRAM_ID.toString();
    if (proposalInfo === null || transactionInfo === null) {
      errors.push('AccountMissingAfterRead: one of the two accounts disappeared.');
    } else {
      if (proposalInfo.owner.toString() !== programId) {
        errors.push(
          `ProposalOwnerMismatch: owner ${proposalInfo.owner.toString()} instead of the Squads program.`,
        );
      }
      if (transactionInfo.owner.toString() !== programId) {
        errors.push(
          `TransactionOwnerMismatch: owner ${transactionInfo.owner.toString()} instead of the Squads program.`,
        );
      }
    }
  } catch (caught: unknown) {
    errors.push(
      `OwnerCheckFailed: ${caught instanceof Error ? caught.message : String(caught)}`,
    );
  }

  if (readBack.transactionIndex !== expectedIndex) {
    errors.push(
      `TransactionIndexMismatch: on-chain index ${readBack.transactionIndex ?? 'unknown'}, expected ${expectedIndex}.`,
    );
  }
  if (readBack.transactionVaultIndex !== 0) {
    errors.push(
      `UnexpectedVaultIndex: on-chain vault index ${readBack.transactionVaultIndex ?? 'unknown'}, expected 0.`,
    );
  }
  if (readBack.proposalStatus === null) {
    errors.push('ProposalStatusUnreadable: the proposal status could not be decoded.');
  }
  if (readBack.proposalApprovedCount === null || readBack.proposalApprovedCount < 1) {
    warnings.push(
      'No approver is recorded on the new proposal: the transaction was created, but it may need a first approval.',
    );
  }
  if (readBack.creatorIsApprover === false) {
    warnings.push(
      'The creator is NOT recorded as an approver on the new proposal (this answers the open question of Phase 8).',
    );
  }

  return {
    blockhash: bundle.blockhash,
    lastValidBlockHeight: bundle.lastValidBlockHeight,
    errorMessage,
    errorCode,
    confirmationStatus: confirmation?.status ?? null,
    confirmed: confirmation?.status === 'confirmed',
    readBack,
    signature,
    signingState: signingStateFromEvidence({
      confirmed: confirmation?.status === 'confirmed',
      readBackVerified: errors.length === 0 && readBack !== null,
      signatureObtained: true,
    }),
    validationErrors: errors,
    validationWarnings: warnings,
    // Trois preuves exigees (signature, confirmation, relecture) : verified
    // n'est vrai que si la confirmation a ete obtenue.
    verified: errors.length === 0 && confirmation?.status === 'confirmed',
  };
}