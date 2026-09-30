/**
 * Estimation fiat INDICATIVE du cout, et avertissement Devnet.
 *
 * Module PUR : aucune I/O, aucun reseau, aucun package, aucun secret. Aucune
 * valeur SOL/USD n'est codee en dur : le prix est FOURNI par l'appelant quand
 * une source fiable existera. Tant qu'aucune source n'est branchee, le prix vaut
 * `null` et l'affichage se contente du SOL, sans bloquer la creation.
 *
 * Le prix ne sert QU'A l'affichage : il n'entre jamais dans la construction,
 * la simulation, la signature ou la verification d'une transaction.
 */

export const LAMPORTS_PER_SOL_FOR_FIAT = 1_000_000_000;

/** Prix de MARCHE Mainnet du SOL, horodate a sa recuperation reelle. */
export type SolPrice = {
  /** USD par SOL (valeur de marche Mainnet, indicative). */
  usdPerSol: number;
  /** Horodatage REEL de recuperation du prix (ISO 8601). */
  fetchedAt: string;
};

/** Affiche lorsque le prix est indisponible : la creation reste possible. */
export const USD_ESTIMATE_UNAVAILABLE = 'USD estimate unavailable.';

/**
 * Avertissement Devnet obligatoire : le SOL Devnet n'a aucune valeur monetaire
 * reelle ; le dollar affiche n'est qu'une comparaison indicative avec le prix de
 * marche du SOL Mainnet — jamais la valeur reelle des fonds, un debit, une
 * garantie de prix ni un conseil financier.
 */
export const DEVNET_SOL_DISCLAIMER =
  'Devnet SOL has no real monetary value. The dollar amount is an indicative ' +
  'comparison using the market price of Mainnet SOL.';

/**
 * Equivalent USD indicatif, ou `null` si le prix est indisponible.
 * Calcul d'AFFICHAGE uniquement : aucune valeur transactionnelle touchee.
 */
export function formatUsdEstimate(input: {
  lamports: number | bigint;
  price: SolPrice | null;
}): string | null {
  if (input.price === null) return null;
  const usdPerSol = input.price.usdPerSol;
  if (!Number.isFinite(usdPerSol) || usdPerSol <= 0) return null;
  const lamports =
    typeof input.lamports === 'bigint' ? Number(input.lamports) : input.lamports;
  if (!Number.isFinite(lamports)) return null;
  const usd = (lamports / LAMPORTS_PER_SOL_FOR_FIAT) * usdPerSol;
  return `≈ $${usd.toFixed(2)}`;
}

/**
 * Libelle « SOL price updated at HH:MM » depuis l'horodatage ISO reel.
 * Rend `null` si l'horodatage est illisible (jamais une heure inventee).
 */
export function formatPriceUpdatedAt(fetchedAt: string): string | null {
  const match = /T(\d{2}):(\d{2})/.exec(fetchedAt);
  if (match === null) return null;
  return `SOL price updated at ${match[1]}:${match[2]}`;
}
