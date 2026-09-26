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
  /** Solde affichable en SOL, 9 décimales, ou `null` si non lisible. */
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

/** 1 SOL = 1e9 lamports, formaté avec 9 décimales exactes. */
export function formatSol(lamports: number): string {
  const negative = lamports < 0;
  const absolute = Math.abs(Math.trunc(lamports));
  const whole = Math.floor(absolute / LAMPORTS_PER_SOL);
  const fraction = `${absolute - whole * LAMPORTS_PER_SOL}`.padStart(9, '0');
  return `${negative ? '-' : ''}${whole}.${fraction}`;
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
      hint: 'This vault holds no SOL: transfer proposals will be refused or cannot be executed until it is funded.',
      lamports: 0,
      notFunded: true,
      sol: formatSol(0),
      stale,
      title: 'Vault not funded',
    };
  }

  return {
    hint: stale
      ? 'Shown from the last successful read: refresh to confirm on-chain.'
      : 'This address holds the funds controlled by the multisig.',
    lamports: input.lamports,
    notFunded: false,
    sol: formatSol(input.lamports),
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