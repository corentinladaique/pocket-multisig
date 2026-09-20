// Préparation de l'approbation d'une proposition Squads v4 (T11b).
//
// CE MODULE NE SIGNALE RIEN ET N'ENVOIE RIEN : il ne construit qu'une
// instruction, jamais une transaction, et n'est branché sur aucun bouton.
// Aucun `sendTransaction`, aucun `signAndSendTransaction`, aucune demande MWA.
import { PublicKey, type Connection, type TransactionInstruction } from '@solana/web3.js';
import * as multisig from '@sqds/multisig';

/** Verdicts déjà calculés par le guard et la liste blanche. */
export interface ApprovalPreconditions {
  guardStatus: 'allowed' | 'blocked';
  allowlistStatus: 'allowed' | 'blocked';
  guardReasons?: readonly string[];
}

export interface ApprovalPlanRequest {
  /** Connexion utilisée UNIQUEMENT pour relire la Proposal (lecture ciblée). */
  connection: Connection;
  multisigPda: PublicKey;
  transactionIndex: number;
  /** Adresse publique du membre qui approuverait. */
  walletAddress: string;
  preconditions: ApprovalPreconditions;
}

/**
 * Barrière pure (aucun I/O) : à partir du statut et de la liste des
 * approbateurs déjà enregistrés, décide si une approbation est permise.
 * Exportée pour être testable sans construire ni lire de compte.
 */
export function evaluateApprovalGate(
  proposalStatus: string,
  approvedAddresses: readonly string[],
  walletAddress: string,
): string[] {
  const reasons: string[] = [];
  if (proposalStatus !== 'Active') {
    reasons.push(`Proposal status is ${proposalStatus}, expected Active.`);
  }
  if (approvedAddresses.includes(walletAddress)) {
    reasons.push(`${walletAddress} has already approved this proposal.`);
  }
  return reasons;
}

export type ApprovalPlan =
  | {
      status: 'ready';
      /** Instruction construite, jamais signée ni envoyée dans cette mission. */
      instruction: TransactionInstruction;
      proposalAddress: string;
      proposalStatus: string;
      approvedAddresses: string[];
    }
  | { status: 'refused'; reasons: string[] };

/**
 * Relit la Proposal à l'instant présent puis, si tout est conforme, construit
 * l'instruction `proposalApprove` du SDK officiel sans l'envoyer.
 *
 * Refuse si : le guard ou la liste blanche ne sont pas `allowed`, si le statut
 * n'est pas `Active`, si le wallet a déjà approuvé, ou si la relance échoue.
 */
export async function planProposalApproval(
  request: ApprovalPlanRequest,
): Promise<ApprovalPlan> {
  const { connection, multisigPda, transactionIndex, walletAddress, preconditions } = request;
  const reasons: string[] = [];

  if (preconditions.guardStatus !== 'allowed') {
    reasons.push(
      `Guard is ${preconditions.guardStatus}: ${(preconditions.guardReasons ?? []).join(' ') || 'no detail'}`,
    );
  }
  if (preconditions.allowlistStatus !== 'allowed') {
    reasons.push(`Instruction allowlist is ${preconditions.allowlistStatus}.`);
  }
  if (reasons.length > 0) {
    return { status: 'refused', reasons };
  }

  const [proposalPda] = multisig.getProposalPda({
    multisigPda,
    transactionIndex: BigInt(transactionIndex),
  });

  // Relecture fraîche et ciblée : un seul compte, aucune liste, aucun scan.
  // Toute panne RPC est convertie en refus : jamais d'exception qui remonterait
  // jusqu'à un futur chemin d'écriture.
  let info: Awaited<ReturnType<Connection['getAccountInfo']>>;
  try {
    info = await connection.getAccountInfo(proposalPda, 'confirmed');
  } catch (caught: unknown) {
    return {
      status: 'refused',
      reasons: [
        `Proposal could not be read: ${caught instanceof Error ? caught.message : String(caught)}`,
      ],
    };
  }
  if (info === null) {
    return { status: 'refused', reasons: [`No proposal account at ${proposalPda.toBase58()}.`] };
  }

  let proposal: multisig.accounts.Proposal;
  try {
    [proposal] = multisig.accounts.Proposal.fromAccountInfo(info);
  } catch (caught: unknown) {
    return {
      status: 'refused',
      reasons: [
        `Proposal could not be deserialised: ${caught instanceof Error ? caught.message : String(caught)}`,
      ],
    };
  }

  const status = proposal.status.__kind;
  const approvedAddresses = proposal.approved.map((entry) => entry.toBase58());

  const gateReasons = evaluateApprovalGate(status, approvedAddresses, walletAddress);
  if (gateReasons.length > 0) {
    reasons.push(...gateReasons);
    return { status: 'refused', reasons };
  }

  return {
    status: 'ready',
    instruction: multisig.instructions.proposalApprove({
      multisigPda,
      transactionIndex: BigInt(transactionIndex),
      member: new PublicKey(walletAddress),
    }),
    proposalAddress: proposalPda.toBase58(),
    proposalStatus: status,
    approvedAddresses,
  };
}