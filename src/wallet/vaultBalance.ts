/**
 * Solde du vault : mise en forme et estimations, sans aucune I/O.
 *
 * Module PUR : aucun RPC, aucun wallet, aucune signature. C'est la source
 * unique des textes et des calculs affichés par Multisig Details et par
 * Proposal Details, afin que les deux écrans ne puissent pas diverger.
 */

export const LAMPORTS_PER_SOL = 1_000_000_000;

export type BalanceStatus = 'idle' | 'loading' | 'loaded' | 'error';

export type VaultBalanceView = {
  /**
   * Solde affichable en SOL (arrondi lisible, jamais ramene a 0 s'il est non
   * nul), ou `null` si non lisible. La valeur exacte reste dans `lamports`.
   */
  sol: string | null;
  /** Lamports bruts : destinés à Technical details uniquement. */
  lamports: number | null;
  /** Vrai quand le solde est nul ou absent : le vault n'est pas financé. */
  notFunded: boolean;
  /** Vrai quand la valeur affichée provient d'une lecture antérieure. */
  stale: boolean;
  title: string;
  hint: string;
};

/** 1 SOL = 1e9 lamports, en arithmetique ENTIERE (aucun flottant imprecis). */
const LAMPORTS_PER_SOL_BIGINT = 1_000_000_000n;

/**
 * Nombre de decimales AFFICHEES au plus pour un solde utilisateur. Sert
 * uniquement a la lisibilite : aucune valeur interne n'est modifiee.
 */
const BALANCE_DISPLAY_DECIMALS = 6;
/** Multiple de lamports correspondant a la derniere decimale affichee (10^3). */
const BALANCE_ROUND_STEP = 10n ** BigInt(9 - BALANCE_DISPLAY_DECIMALS);
/** Demi-pas, pour un arrondi "au plus proche" en arithmetique ENTIERE. */
const BALANCE_ROUND_HALF = BALANCE_ROUND_STEP / 2n;

/** Convertit une entree lamports en bigint ; refuse un number non entier sur. */
function toSafeLamportsBigInt(lamports: number | bigint): bigint {
  if (typeof lamports === 'bigint') return lamports;
  if (!Number.isSafeInteger(lamports)) {
    throw new RangeError(
      'lamportsToSolDisplay: a number must be a safe integer (no fraction, ' +
        'finite, within Number.MAX_SAFE_INTEGER); use bigint for larger values.',
    );
  }
  return BigInt(lamports);
}

/**
 * Partie decimale construite sur 9 chiffres, en arithmetique ENTIERE.
 * `trimTrailingZeros` retire les zeros finaux inutiles (jamais significatifs).
 */
function solStringFromLamports(value: bigint, trimTrailingZeros: boolean): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / LAMPORTS_PER_SOL_BIGINT;
  let fraction = (absolute % LAMPORTS_PER_SOL_BIGINT).toString().padStart(9, '0');
  if (trimTrailingZeros) fraction = fraction.replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${fraction.length > 0 ? `.${fraction}` : ''}`;
}

/**
 * Formate des lamports en SOL pour l'utilisateur, suffixe « SOL » inclus.
 *
 * REGLES DE FORMATAGE :
 * - 1 SOL = 1 000 000 000 lamports ; les lamports ENTIERS sont la verite ;
 * - arithmetique ENTIERE (bigint) : jamais de division flottante, donc aucune
 *   perte de precision, y compris au-dela de Number.MAX_SAFE_INTEGER ;
 * - partie decimale construite sur 9 chiffres, zeros finaux INUTILES retires ;
 * - jamais plus de 9 decimales.
 *
 * Cas : 1 -> "0.000000001 SOL" ; 1 000 000 -> "0.001 SOL" ;
 * 1 666 080 -> "0.00166608 SOL" ; 1e9 -> "1 SOL" ; 1.5e9 -> "1.5 SOL".
 *
 * ENTREES ACCEPTEES :
 * - `bigint` : toujours accepte (source de verite pour les grandes valeurs) ;
 * - `number` : uniquement un ENTIER SUR (`Number.isSafeInteger`). Un number
 *   fractionnaire, non fini, ou au-dela de `Number.MAX_SAFE_INTEGER` est REFUSE
 *   (`RangeError`) plutot que d'afficher une valeur approximative.
 *
 * Aucune valeur transactionnelle n'est lue ni modifiee : cette fonction ne
 * produit qu'une chaine d'affichage.
 *
 * Exemple : lamportsToSolDisplay(1_666_080) === '0.00166608 SOL'.
 */
export function lamportsToSolDisplay(lamports: number | bigint): string {
  return `${solStringFromLamports(toSafeLamportsBigInt(lamports), true)} SOL`;
}

/**
 * Variante historique SANS suffixe et SANS retrait des zeros finaux (9 decimales
 * fixes) : conservee telle quelle pour les soldes deja affiches (Multisig
 * Details, Proposal Details). La mission en cours ne modifie que le cout de
 * creation (`lamportsToSolDisplay`).
 */
export function formatSol(lamports: number): string {
  return solStringFromLamports(toSafeLamportsBigInt(lamports), false);
}

/**
 * Affichage LISIBLE d'un solde utilisateur, en SOL, sans suffixe.
 *
 * REGLES :
 * - arithmetique ENTIERE (bigint) : aucun flottant, aucune valeur modifiee ;
 * - arrondi au plus proche a 6 decimales au plus (0.399999952 -> 0.4) ;
 * - un montant STRICTEMENT non nul n'est JAMAIS ramene a 0 : si l'arrondi
 *   effacerait le montant (ex. 0.000000048), la valeur exacte est conservee ;
 * - zeros finaux retires.
 *
 * Cas : 399_999_952 -> '0.4' ; 389_999_952 -> '0.39' ; 48 -> '0.000000048' ;
 * 0 -> '0' ; 2_000_000_000 -> '2'.
 *
 * Aucune valeur transactionnelle n'est lue ni modifiee : chaine d'affichage.
 */
export function formatSolBalance(lamports: number | bigint): string {
  const value = toSafeLamportsBigInt(lamports);
  if (value === 0n) return '0';
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const rounded = ((absolute + BALANCE_ROUND_HALF) / BALANCE_ROUND_STEP) * BALANCE_ROUND_STEP;
  // Garde anti-zero : un montant non nul ne s'affiche jamais « 0 ».
  const effective = rounded === 0n ? absolute : rounded;
  return solStringFromLamports(negative ? -effective : effective, true);
}

export function describeVaultBalance(input: {
  addressMatches: boolean;
  lamports: number | null;
  status: BalanceStatus;
  stale?: boolean;
}): VaultBalanceView {
  const stale = input.stale === true && input.lamports !== null;

  // Un solde appartient toujours à une adresse : jamais celui du multisig
  // précédent, même brièvement.
  if (!input.addressMatches || input.status === 'loading') {
    return {
      hint: 'Reading the vault balance on devnet…',
      lamports: null,
      notFunded: false,
      sol: null,
      stale: false,
      title: 'Loading vault balance…',
    };
  }

  if (input.lamports === null) {
    return {
      hint: 'The balance could not be read. The rest of the multisig is still shown.',
      lamports: null,
      notFunded: false,
      sol: null,
      stale: false,
      title: 'Balance unavailable',
    };
  }

  if (input.lamports === 0) {
    return {
      hint: 'This Main vault holds no SOL: transfer proposals will be refused or cannot be executed until it is funded.',
      lamports: 0,
      notFunded: true,
      sol: formatSolBalance(0),
      stale,
      title: 'Main vault not funded',
    };
  }

  return {
    hint: stale
      ? 'Shown from the last successful read: refresh to confirm on-chain.'
      : // Aucune explication ici : chaque écran affiche la sienne, une seule fois.
        '',
    lamports: input.lamports,
    notFunded: false,
    sol: formatSolBalance(input.lamports),
    stale,
    title: 'Vault balance',
  };
}

export type RemainingEstimate = {
  /** Solde restant estimé, `null` quand il ne peut pas être calculé. */
  remainingLamports: number | null;
  sol: string | null;
  ready: boolean;
  reason: string;
};

/**
 * Estimation du solde restant. Calculée seulement si le solde est lisible, le
 * montant décodé, l'opération reconnue comme transfert SOL et la source
 * confondue avec le vault attendu. Aucun frais n'est soustrait au vault : le
 * payeur des frais n'est pas le vault dans ce contrat, et inventer un coût
 * exact serait faux.
 */
export function estimateRemainingBalance(input: {
  vaultLamports: number | null;
  amountLamports: number | null;
  sourceMatchesVault: boolean;
  recognizedSolTransfer: boolean;
}): RemainingEstimate {
  if (input.vaultLamports === null) {
    return {
      ready: false,
      reason: 'The vault balance is not readable yet.',
      remainingLamports: null,
      sol: null,
    };
  }
  if (input.amountLamports === null) {
    return {
      ready: false,
      reason: 'The proposal amount is not decoded yet.',
      remainingLamports: null,
      sol: null,
    };
  }
  if (!input.recognizedSolTransfer) {
    return {
      ready: false,
      reason: 'This operation is not a recognised SOL transfer: no estimate is produced.',
      remainingLamports: null,
      sol: null,
    };
  }
  if (!input.sourceMatchesVault) {
    return {
      ready: false,
      reason: 'The transfer source is not the expected Vault index 0: no estimate is produced.',
      remainingLamports: null,
      sol: null,
    };
  }

  const remaining = input.vaultLamports - input.amountLamports;
  if (remaining < 0) {
    return {
      ready: false,
      reason: `Insufficient vault balance: the vault holds ${formatSol(input.vaultLamports)} SOL but the proposal moves ${formatSol(input.amountLamports)} SOL.`,
      // Jamais de solde restant négatif présenté comme normal.
      remainingLamports: null,
      sol: null,
    };
  }

  return {
    ready: true,
    reason: 'Estimated before execution. Excludes concurrent balance changes.',
    remainingLamports: remaining,
    sol: formatSol(remaining),
  };
}

export type SourceVerdict = {
  matches: boolean;
  label: string;
  hint: string;
};

/** Libellé du lien entre la source du transfert et le vault index 0. */
export function describeTransferSource(input: {
  source: string | null;
  vaultAddress: string;
}): SourceVerdict {
  if (input.source === null) {
    return {
      hint: 'The transfer source could not be decoded from this proposal.',
      label: 'Funds will be sent from: unknown',
      matches: false,
    };
  }
  if (input.source === input.vaultAddress) {
    return {
      hint: 'Funds will be sent from this account.',
      label: 'Source verified: Main vault',
      matches: true,
    };
  }
  return {
    hint: 'Source does not match the Main vault. No explanation is inferred: the shown addresses are the only facts.',
    label: 'Source does not match the Main vault',
    matches: false,
  };
}