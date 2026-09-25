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
  planProposalApproval,
  type ApprovalPreconditions,
} from './proposalApproval';
import {
  applyFreshBlockhash,
  type MultisigCreationBlockhash,
  type SignAndSendTransactionsFn,
} from '../vault/signAndSendMultisigCreation';

/**
 * Approbation d'une proposition Squads v4 : preparation, envoi, relecture.
 *
 * Aucun effet de bord au chargement, aucun ecran, aucun bouton, aucun appel
 * automatique : la fonction n'est jamais executee d'elle-meme. Elle doit etre
 * appelee depuis un geste utilisateur explicite, une seule fois.
 *
 * Differences structurelles avec la creation d'un multisig : UN SEUL
 * signataire (le membre), aucun signataire ephemere, donc aucun `partialSign`
 * local ; aucun compte cree, donc aucun rent. La signature du membre (wallet
 * via MWA) est la seule exigee.
 */

export type ProposalApprovalReadBack = {
  index: number;
  status: string;
  approvedAddresses: string[];
  address: string;
};

export type ProposalApprovalSignSendResult = {
  signature: string | null;
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
  readBack: ProposalApprovalReadBack | null;
  /** Vrai seulement si l'envoi a reussi ET que la relecture confirme l'approbation. */
  verified: boolean;
  /** Etat de la proposition AVANT l'envoi (relu par le plan). */
  approvalsBefore: number;
  validationErrors: string[];
  validationWarnings: string[];
};

const READ_BACK_ATTEMPTS = 4;
const READ_BACK_DELAY_MS = 1500;

const SINGLE_SIGNER_WARNING =
  'Only the connected member signs this approval: no ephemeral signer, no payer change.';
const NO_RENT_WARNING =
  'No account is created and no rent is paid by an approval.';
const SINGLE_SEND_WARNING =
  'Call this once, from an explicit user gesture, after a fresh guard and a fresh plan.';

function toPublicKey(value: string): PublicKey | null {
  try {
    return new PublicKey(value);
  } catch {
    return null;
  }
}

/**
 * Signe (par le wallet uniquement) et envoie l'approbation, puis relit la
 * proposition pour verifier ce que la chaine a reellement enregistre.
 *
 * @param input.preconditions verdicts DEJA calcules par le guard et la liste
 *   blanche (`evaluateReviewGuard`, `checkReviewAllowlist`), transmis tels quels :
 *   cette fonction ne re-evalue aucune regle de securite par elle-meme.
 * @param input.blockhash blockhash deja pose (celui de la simulation ou de la
 *   relecture precedente) ; s'il est absent, un blockhash frais est demande.
 */
export async function signAndSendProposalApproval(input: {
  connection: Connection;
  memberAddress: string;
  multisigPda: string;
  preconditions: ApprovalPreconditions;
  signAndSendTransactions: SignAndSendTransactionsFn;
  threshold: number;
  transactionIndex: number;
  blockhash?: MultisigCreationBlockhash;
}): Promise<ProposalApprovalSignSendResult> {
  const errors: string[] = [];
  const warnings: string[] = [SINGLE_SIGNER_WARNING, NO_RENT_WARNING, SINGLE_SEND_WARNING];

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
      validationErrors: errors,
      validationWarnings: warnings,
      verified: false,
    };
  }

  // 1. Plan : le guard et la liste blanche sont deja verdictes, et
  //    `planProposalApproval` relit la proposition avant de construire.
  const plan = await planProposalApproval({
    connection: input.connection,
    multisigPda,
    preconditions: input.preconditions,
    transactionIndex: input.transactionIndex,
    walletAddress: input.memberAddress,
  });

  if (plan.status !== 'ready') {
    return {
      approvalsBefore: 0,
      errorMessage: null,
      readBack: null,
      signature: null,
      validationErrors: plan.reasons,
      validationWarnings: warnings,
      verified: false,
    };
  }

  const [proposalPda] = multisig.getProposalPda({
    multisigPda,
    transactionIndex: BigInt(input.transactionIndex),
  });
  const approvalsBefore = plan.approvedAddresses.length;

  // 2. Transaction : le membre est payeur ET unique signataire. Aucun
  //    partialSign : le wallet signera lui-meme.
  const transaction = new Transaction({ feePayer: member }).add(plan.instruction);

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
    return {
      approvalsBefore,
      errorMessage: null,
      readBack: null,
      signature: null,
      validationErrors: errors,
      validationWarnings: warnings,
      verified: false,
    };
  }

  let minContextSlot: number;
  try {
    minContextSlot = await input.connection.getSlot('confirmed');
  } catch (caught: unknown) {
    errors.push(
      `SlotUnavailable: ${caught instanceof Error ? caught.message : String(caught)}`,
    );
    return {
      approvalsBefore,
      errorMessage: null,
      readBack: null,
      signature: null,
      validationErrors: errors,
      validationWarnings: warnings,
      verified: false,
    };
  }

  // 2bis. Fenetre de signature : verdict rendu AVANT d'ouvrir le wallet.
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
      approvalsBefore,
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

  // 3. Envoi : la signature du membre est produite par le wallet.
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
      approvalsBefore,
      errorMessage,
      errorCode,
      readBack: null,
      signature: null,
      validationErrors: errors,
      validationWarnings: warnings,
      verified: false,
    };
  }

  // 4. Relecture autoritaire de la proposition.
  let readBack: ProposalApprovalReadBack | null = null;
  for (let attempt = 1; attempt <= READ_BACK_ATTEMPTS; attempt += 1) {
    try {
      const info = await input.connection.getAccountInfo(proposalPda, 'confirmed');
      if (info !== null) {
        const [decoded] = multisig.accounts.Proposal.fromAccountInfo(info);
        readBack = {
          address: proposalPda.toBase58(),
          approvedAddresses: decoded.approved.map((entry) => entry.toBase58()),
          index: input.transactionIndex,
          status: decoded.status.__kind,
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
    errors.push('ReadBackMissing: the proposal account is not readable yet.');
    return {
      approvalsBefore,
      errorMessage,
      errorCode,
      readBack: null,
      signature,
      validationErrors: errors,
      validationWarnings: warnings,
      verified: false,
    };
  }

  // 5. Verification : le membre figure dans les approbateurs, et le compte a
  //    progresse d'au moins une approbation. Le statut doit correspondre au
  //    franchissement (ou non) du seuil : c'est la chaine qui decide.
  if (!readBack.approvedAddresses.includes(input.memberAddress)) {
    errors.push(
      `ApprovalNotRecorded: ${input.memberAddress} is not in the approved list after the send.`,
    );
  }
  if (readBack.approvedAddresses.length < approvalsBefore + 1) {
    errors.push(
      `ApprovalCountUnchanged: on-chain ${readBack.approvedAddresses.length}, expected at least ${
        approvalsBefore + 1
      }.`,
    );
  }
  const reachedThreshold = readBack.approvedAddresses.length >= input.threshold;
  const expectedStatus = reachedThreshold ? 'Approved' : 'Active';
  if (readBack.status !== expectedStatus) {
    errors.push(
      `StatusMismatch: on-chain ${readBack.status}, expected ${expectedStatus} (${
        reachedThreshold ? 'threshold reached' : 'threshold not reached yet'
      }).`,
    );
  }

  return {
    approvalsBefore,
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
    // Trois preuves exigees : signature, confirmation, relecture de la proposition.
    verified: errors.length === 0 && confirmation?.status === 'confirmed',
  };
}