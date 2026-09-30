/**
 * États d'action d'une proposition Squads v4 — logique PURE de présentation.
 *
 * Aucune I/O, aucun RPC, aucun wallet, aucun envoi. Les compteurs proviennent
 * TOUJOURS du read-back on-chain de la Proposal (jamais d'un compteur local).
 *
 * Objectif : une seule famille d'état principal visible à la fois.
 */

export type ProposalActionState =
  | 'executed'
  | 'approval-pending-verification'
  | 'threshold-reached'
  | 'approved-by-you'
  | 'approval-available';

export type ProposalExecuteState = 'executed' | 'unavailable-threshold' | 'no-permission' | 'available';

export type ApprovalProgress = {
  collected: number;
  /** « 1 of 2 approvals collected » */
  collectedLabel: string;
  reached: boolean;
  remaining: number;
  /** « Waiting for 1 more approval. » — `null` si le seuil est atteint. */
  waitingLabel: string | null;
};

/** Progression lisible, dérivée des approbations on-chain relues. */
export function approvalProgress(input: { approvedCount: number; threshold: number }): ApprovalProgress {
  const collected = Math.max(0, input.approvedCount);
  const reached = collected >= input.threshold;
  const remaining = reached ? 0 : Math.max(1, input.threshold - collected);
  return {
    collected,
    collectedLabel: `${collected} of ${input.threshold} approvals collected`,
    reached,
    remaining: reached ? 0 : remaining,
    // Jamais « Waiting for 0 more approvals. »
    waitingLabel: reached
      ? null
      : `Waiting for ${remaining} more approval${remaining === 1 ? '' : 's'}.`,
  };
}

/** Famille d'état principale (exclusive). Priorité : exécuté > en vérification > seuil > … */
export function deriveProposalActionState(input: {
  executed: boolean;
  signaturePendingVerification: boolean;
  thresholdReached: boolean;
  walletAlreadyApproved: boolean;
}): ProposalActionState {
  if (input.executed) return 'executed';
  if (input.signaturePendingVerification) return 'approval-pending-verification';
  if (input.thresholdReached) return 'threshold-reached';
  if (input.walletAlreadyApproved) return 'approved-by-you';
  return 'approval-available';
}

export function deriveProposalExecuteState(input: {
  executed: boolean;
  thresholdReached: boolean;
  walletHasExecute: boolean;
}): ProposalExecuteState {
  if (input.executed) return 'executed';
  if (!input.thresholdReached) return 'unavailable-threshold';
  return input.walletHasExecute ? 'available' : 'no-permission';
}

export const PROPOSAL_ACTION_LABELS = {
  approvedByYou: '✓ Approved by you',
  approvedByYouDetail:
    'This wallet is recorded as an approver on-chain. No new approval can be sent.',
  thresholdReached: '✓ Approval threshold reached',
  executed: '✓ Transaction executed',
  executeCta: 'Execute transaction',
  executeUnavailableTitle: 'Execution not available yet',
  executeNoPermissionTitle: 'Approval threshold reached',
  executeNoPermissionDetail: 'This wallet does not have permission to execute.',
} as const;

/** « One more approval is required… » / « N more approvals are required… ». */
export function executionNotAvailableDetail(remaining: number): string {
  const missing = Math.max(1, remaining);
  return missing === 1
    ? 'One more approval is required before this proposal can be executed.'
    : `${missing} more approvals are required before this proposal can be executed.`;
}
