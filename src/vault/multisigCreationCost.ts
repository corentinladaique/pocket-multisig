/**
 * Decomposition du cout de creation d'un multisig.
 *
 * Module PUR : aucune I/O, aucun RPC, aucune signature. Il ne fait que
 * REORGANISER des lamports DEJA calcules par la simulation (total paye par le
 * createur, et rent du compte multisig cree). Il n'invente jamais de valeur et
 * ne modifie aucune valeur transactionnelle.
 */

export type CreationCostBreakdown = {
  /** Total paye par le createur (frais + rent), tel que simule. */
  totalLamports: number;
  /** Lamports de creation de compte / exemption de rent, si mesurables. */
  rentLamports: number | null;
  /** Frais reseau = total - rent, payes par le createur (fee payer). */
  feeLamports: number | null;
};

/**
 * Renvoie le total des qu'il est disponible, et la decomposition rent/frais
 * UNIQUEMENT si le rent est fiable et coherent (0 <= rent <= total). Sinon les
 * composantes valent `null` : l'appelant affiche « Cost breakdown unavailable »
 * plutot qu'une valeur inventee. `null` seulement si le total est inconnu.
 */
export function decomposeCreationCost(input: {
  totalLamports: number | null;
  rentLamports: number | null;
}): CreationCostBreakdown | null {
  if (input.totalLamports === null) return null;
  const rent =
    input.rentLamports !== null &&
    Number.isFinite(input.rentLamports) &&
    input.rentLamports >= 0 &&
    input.rentLamports <= input.totalLamports
      ? input.rentLamports
      : null;
  return {
    feeLamports: rent === null ? null : input.totalLamports - rent,
    rentLamports: rent,
    totalLamports: input.totalLamports,
  };
}
