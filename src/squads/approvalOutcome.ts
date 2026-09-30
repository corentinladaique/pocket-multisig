/**
 * Verdict d'une tentative d'approbation — libellés et actions.
 *
 * Module PUR : aucune I/O, aucun RPC, aucun wallet, aucune signature. Il traduit
 * les PREUVES disponibles (signature, confirmation, read-back) en un état
 * affichable et en actions autorisées.
 *
 * Règle non négociable : sans signature, on n'annonce JAMAIS un envoi. Un état
 * « signé » n'est jamais présenté comme un échec, et un état vérifié ne
 * redevient jamais « en attente ».
 */

export const APPROVAL_OUTCOME_STATES = [
  'nothing-was-sent',
  'signed-confirmation-pending',
  'confirmed-readback-pending',
  'approved-and-verified',
] as const;

export type ApprovalOutcomeState = (typeof APPROVAL_OUTCOME_STATES)[number];

/** Libellés EXACTS affichés à l'utilisateur pour chacune des preuves. */
export const APPROVAL_OUTCOME_LABELS: Record<ApprovalOutcomeState, string> = {
  'nothing-was-sent': 'Nothing was sent.',
  'signed-confirmation-pending': 'Approval signed, confirmation pending.',
  'confirmed-readback-pending': 'Approval confirmed, proposal verification pending.',
  'approved-and-verified': 'Proposal approved and verified.',
};

export type ApprovalOutcomeActions = {
  /** Nouvelle tentative COMPLÈTE (préparation fraîche) autorisée ? */
  allowPrepareAgain: boolean;
  /** Relecture seule (statut de signature + proposition) autorisée ? */
  allowCheckAgain: boolean;
};

/**
 * Classe une tentative à partir de ses seules preuves.
 * L'ordre des preuves est monotone : signature > confirmation > read-back.
 */
export function classifyApprovalOutcome(input: {
  signature: string | null;
  confirmed: boolean;
  verified: boolean;
}): ApprovalOutcomeState {
  if (input.signature === null) return 'nothing-was-sent';
  if (!input.confirmed) return 'signed-confirmation-pending';
  if (!input.verified) return 'confirmed-readback-pending';
  return 'approved-and-verified';
}

/**
 * Actions autorisées par état.
 * - aucune signature : on peut reconstruire (la prochaine tentative relit la
 *   proposition on-chain, ce qui interdit une double approbation) ;
 * - signature obtenue : PLUS AUCUN envoi, seulement une relecture ;
 * - vérifié : plus aucune action.
 */
export function approvalOutcomeActions(state: ApprovalOutcomeState): ApprovalOutcomeActions {
  switch (state) {
    case 'nothing-was-sent':
      return { allowCheckAgain: false, allowPrepareAgain: true };
    case 'signed-confirmation-pending':
    case 'confirmed-readback-pending':
      return { allowCheckAgain: true, allowPrepareAgain: false };
    case 'approved-and-verified':
      return { allowCheckAgain: false, allowPrepareAgain: false };
    default:
      return { allowCheckAgain: false, allowPrepareAgain: false };
  }
}

/**
 * Le wallet a-t-il DÉJÀ approuvé, d'après une liste d'approbateurs relue
 * on-chain ? Source unique du libellé « Already approved ».
 */
export function walletHasApproved(
  approvedAddresses: readonly string[],
  walletAddress: string | null,
): boolean {
  if (walletAddress === null || walletAddress.length === 0) return false;
  return approvedAddresses.includes(walletAddress);
}
