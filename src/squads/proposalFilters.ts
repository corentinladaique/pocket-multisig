/**
 * Filtres de propositions — logique PURE, sans I/O.
 *
 * Aucun RPC, aucun wallet, aucun effet secondaire : ces fonctions se contentent
 * de classer des propositions déjà lues on-chain. Elles sont donc testables
 * hors ligne et ne peuvent pas déclencher de lecture supplémentaire.
 *
 * Statuts terminalement PROUVÉS dans le code : seul `Executed` est utilisé
 * ailleurs (read-back d'exécution, ProposalDetails). Aucun autre statut terminal
 * (Cancelled, Rejected, Expired…) n'est inventé : ils ne sont donc jamais
 * classés dans « Done ».
 */

export type ProposalFilterGroup = 'todo' | 'open' | 'done';

export interface ProposalFilterInput {
  index: number;
  /** Statut on-chain tel que renvoyé par le SDK (`__kind`). */
  status: string;
  approvals: number;
  threshold: number;
  approvedAddresses: readonly string[];
  walletAddress: string | null;
  /** Vrai si le wallet est membre avec le droit de vote (peut approuver). */
  walletCanApprove: boolean;
  /** Vrai si le wallet est membre avec le droit d'exécution (peut exécuter). */
  walletCanExecute: boolean;
}

/** Libellés d'état visibles, uniquement dérivés de données réelles. */
export type ProposalStatusLabel =
  | 'Needs your approval'
  | 'Ready to execute'
  | 'Open'
  | 'Executed';

function walletApproved(input: ProposalFilterInput): boolean {
  return input.walletAddress !== null && input.approvedAddresses.includes(input.walletAddress);
}

/**
 * Groupe d'affichage d'une proposition.
 *
 * - `todo` : le wallet peut agir MAINTENANT
 *   - `Active` + wallet peut approuver + n'a pas encore approuvé ;
 *   - `Approved` + wallet peut exécuter.
 * - `done` : uniquement `Executed` (seul terminal prouvé).
 * - `open` : tout le reste (non terminal, ou sans action immédiate).
 */
export function classifyProposal(input: ProposalFilterInput): ProposalFilterGroup {
  if (input.status === 'Executed') return 'done';
  if (input.status === 'Approved' && input.walletCanExecute) return 'todo';
  if (input.status === 'Active' && input.walletCanApprove && !walletApproved(input)) return 'todo';
  return 'open';
}

/** État visible d'une proposition (jamais de statut inventé). */
export function proposalStatusLabel(input: ProposalFilterInput): ProposalStatusLabel {
  if (input.status === 'Executed') return 'Executed';
  if (input.status === 'Approved') return 'Ready to execute';
  if (input.status === 'Active' && input.walletCanApprove && !walletApproved(input)) {
    return 'Needs your approval';
  }
  return 'Open';
}

/** Filtre par groupe, sans effet de bord (retourne un nouveau tableau). */
export function filterProposals<T extends ProposalFilterInput>(
  items: readonly T[],
  group: ProposalFilterGroup,
): T[] {
  return items.filter((item) => classifyProposal(item) === group);
}
