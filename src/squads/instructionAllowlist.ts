// Liste blanche des instructions autorisées (SECURITY §5).
//
// PREPARATION UNIQUEMENT : ce module n'active rien. Il evalue si une revue
// donnee serait autorisee si une confirmation existait un jour. Aucun appel
// d'ecriture, aucun RPC, aucune signature.
import { SYSTEM_PROGRAM_ID } from '../types/transactionReview';
import type { TransactionReviewModel } from '../types/transactionReview';

/** Programmes dont une instruction est reconnue pour le MVP. */
export const ALLOWED_PROGRAM_IDS: readonly string[] = [SYSTEM_PROGRAM_ID];

export interface AllowlistVerdict {
  allowed: boolean;
  /** Même forme que le verdict du guard, pour composer des conditions lisibles. */
  status: 'allowed' | 'blocked';
  reason: string;
}

/**
 * Verdict d'autorisation d'une revue.
 *
 * Regles (cumulatives) :
 * - le decodage doit etre `decoded` ;
 * - le programme appele doit etre connu ;
 * - le program ID doit figurer dans la liste blanche.
 */
export function checkReviewAllowlist(model: TransactionReviewModel): AllowlistVerdict {
  if (model.decodeStatus !== 'decoded') {
    return {
      allowed: false,
      status: 'blocked' as const,
      reason: `Decode status is ${model.decodeStatus}: confirmation must stay blocked.`,
    };
  }

  if (!model.program.known) {
    return {
      allowed: false,
      status: 'blocked' as const,
      reason: 'Called program is unknown: confirmation must stay blocked.',
    };
  }

  if (!ALLOWED_PROGRAM_IDS.includes(model.program.value.id)) {
    return {
      allowed: false,
      status: 'blocked' as const,
      reason: `Program ${model.program.value.id} is not in the allowlist.`,
    };
  }

  return {
    allowed: true,
    status: 'allowed' as const,
    reason: `Program ${model.program.value.id} is allowlisted (${ALLOWED_PROGRAM_IDS.length} entry).`,
  };
}