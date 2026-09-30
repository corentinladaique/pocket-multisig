/**
 * Conversion SOL <-> lamports pour la SAISIE utilisateur.
 *
 * Module PUR : aucune I/O, aucun RPC, aucun wallet. Uniquement de
 * l'arithmétique ENTIÈRE (bigint) : 1 SOL = 1 000 000 000 lamports, jamais de
 * division flottante, donc aucune imprécision.
 *
 * Règles de saisie :
 * - nombre décimal positif, point comme séparateur ;
 * - 9 décimales au maximum ;
 * - valeur strictement supérieure à zéro ;
 * - formats ambigus refusés (espaces internes, signe, exposant, `.5`, `1.`).
 */

export const LAMPORTS_PER_SOL = 1_000_000_000;
const LAMPORTS_PER_SOL_BIGINT = 1_000_000_000n;
const MAX_DECIMALS = 9;

export type SolParseReason =
  | 'empty'
  | 'invalid'
  | 'too-many-decimals'
  | 'not-positive'
  | 'too-large';

export type SolParseResult =
  | { ok: true; lamports: number; solText: string }
  | { ok: false; reason: SolParseReason };

/** Messages utilisateur EXACTS (jamais de lamports). */
export const SOL_AMOUNT_MESSAGES: Record<SolParseReason, string> = {
  empty: 'Enter an amount to continue.',
  invalid: 'Enter a valid SOL amount.',
  'too-many-decimals': 'SOL supports up to 9 decimal places.',
  'not-positive': 'Amount must be greater than 0 SOL.',
  'too-large': 'Amount is too large.',
};

const DECIMAL_PATTERN = /^(\d+)(?:\.(\d+))?$/;

/**
 * Convertit une saisie SOL en lamports ENTIERS.
 * Ne devine jamais : toute forme non reconnue renvoie une raison nommée.
 */
export function parseSolToLamports(raw: string): SolParseResult {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { ok: false, reason: 'empty' };

  const match = DECIMAL_PATTERN.exec(trimmed);
  if (match === null) return { ok: false, reason: 'invalid' };

  const wholePart = match[1] ?? '';
  const fractionPart = match[2] ?? '';

  if (fractionPart.length > MAX_DECIMALS) {
    return { ok: false, reason: 'too-many-decimals' };
  }

  // Purement entier : (entier * 1e9) + (fraction padée à 9 chiffres).
  const paddedFraction = fractionPart.padEnd(MAX_DECIMALS, '0');
  const lamportsBigInt =
    BigInt(wholePart) * LAMPORTS_PER_SOL_BIGINT + BigInt(paddedFraction === '' ? '0' : paddedFraction);

  if (lamportsBigInt <= 0n) return { ok: false, reason: 'not-positive' };
  if (lamportsBigInt > BigInt(Number.MAX_SAFE_INTEGER)) {
    return { ok: false, reason: 'too-large' };
  }

  return {
    lamports: Number(lamportsBigInt),
    ok: true,
    solText: lamportsToSolText(Number(lamportsBigInt)),
  };
}

/**
 * Representation SOL exacte d'un montant en lamports, sans suffixe.
 * Arithmétique entière, zéros finaux retirés : `20000000` -> `0.02`.
 */
export function lamportsToSolText(lamports: number | bigint): string {
  const value = typeof lamports === 'bigint' ? lamports : BigInt(Math.trunc(lamports));
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / LAMPORTS_PER_SOL_BIGINT;
  const fraction = absolute % LAMPORTS_PER_SOL_BIGINT;
  if (fraction === 0n) return `${negative ? '-' : ''}${whole}`;
  const digits = fraction.toString().padStart(MAX_DECIMALS, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}.${digits}`;
}

/** Montant SOL prêt à l'affichage, suffixe « SOL » inclus. */
export function formatSolAmount(lamports: number | bigint): string {
  return `${lamportsToSolText(lamports)} SOL`;
}
