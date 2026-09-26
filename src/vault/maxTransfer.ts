/**
 * Calcul « Max » d'un transfert depuis le Main vault : montants exacts, aucune
 * réserve cachée, aucune I/O.
 *
 * Module PUR : aucun RPC, aucun wallet, aucune signature. Le montant produit est
 * un nombre FIXE de lamports, figé au moment de la construction de la
 * proposition : il ne suit jamais un solde futur.
 */

export type MaxTransferPlan = {
  /** Montant fixe proposé, en lamports (`null` si le calcul est refusé). */
  amountLamports: number | null;
  /** Buffer explicitement choisi par l'utilisateur, en lamports. */
  bufferLamports: number;
  /** Vrai si le transfert viderait entièrement le Main vault. */
  wouldEmptyVault: boolean;
  /** Reste estimé après transfert, selon le solde lu. */
  remainingLamports: number | null;
  ready: boolean;
  /** Message principal affiché à l'utilisateur. */
  label: string;
  /** Explication, jamais un conseil financier générique. */
  hint: string;
  warnings: string[];
};

/**
 * Qui paie quoi (fait vérifié dans le code de l'application, pas une hypothèse) :
 *
 * - Création de la proposition : le MEMBRE signataire est le fee payer de la
 *   transaction ; il paie aussi le rent des deux comptes créés.
 * - Exécution : le MEMBRE qui exécute est l'unique signataire et le payeur.
 * - Le Main vault ne paie donc AUCUN frais : seulement le montant transféré.
 *
 * Conséquence : Max ne déduit jamais de frais du vault. Le seul retrait possible
 * est le buffer, explicitement choisi par l'utilisateur.
 */
export const VAULT_PAYS_FEES = false;

export function computeMaxTransfer(input: {
  vaultLamports: number | null;
  /** Buffer explicite choisi par l'utilisateur (0 par défaut). */
  explicitBufferLamports?: number;
  sourceMatchesMainVault: boolean;
  recognizedSolTransfer: boolean;
}): MaxTransferPlan {
  const buffer = Math.max(0, Math.trunc(input.explicitBufferLamports ?? 0));

  if (!input.recognizedSolTransfer) {
    return {
      amountLamports: null,
      bufferLamports: buffer,
      hint: 'Max is only available for a recognised SOL transfer from the Main vault.',
      label: 'Max unavailable',
      ready: false,
      remainingLamports: null,
      warnings: [],
      wouldEmptyVault: false,
    };
  }

  if (!input.sourceMatchesMainVault) {
    return {
      amountLamports: null,
      bufferLamports: buffer,
      hint: 'The transfer source is not the Main vault: nothing is filled in automatically.',
      label: 'Max unavailable',
      ready: false,
      remainingLamports: null,
      warnings: [],
      wouldEmptyVault: false,
    };
  }

  if (input.vaultLamports === null) {
    return {
      amountLamports: null,
      bufferLamports: buffer,
      hint: 'The Main vault balance could not be read: Max needs a confirmed balance.',
      label: 'Max unavailable',
      ready: false,
      remainingLamports: null,
      warnings: [],
      wouldEmptyVault: false,
    };
  }

  const available = input.vaultLamports - buffer;
  if (available <= 0) {
    return {
      amountLamports: null,
      bufferLamports: buffer,
      hint: `Your buffer (${buffer} lamports) is greater than or equal to the Main vault balance (${input.vaultLamports} lamports): nothing can be transferred.`,
      label: 'Max unavailable',
      ready: false,
      remainingLamports: null,
      warnings: [],
      wouldEmptyVault: false,
    };
  }

  const wouldEmptyVault = buffer === 0;
  const warnings: string[] = [];
  if (wouldEmptyVault) {
    warnings.push('This proposal would empty the Main vault.');
  } else {
    warnings.push(
      `An explicit buffer of ${buffer} lamports chosen by you is kept in the Main vault.`,
    );
  }

  return {
    amountLamports: available,
    bufferLamports: buffer,
    hint: VAULT_PAYS_FEES
      ? 'Fees are paid by the vault.'
      : 'Fees are paid by the signing member, not by the Main vault: no fee is deducted from this amount.',
    label: wouldEmptyVault ? 'Max available (empties the vault)' : 'Max available with buffer',
    ready: true,
    remainingLamports: buffer,
    warnings,
    wouldEmptyVault,
  };
}

/**
 * Un montant saisi (ou calculé par Max) reste-t-il valable après une nouvelle
 * lecture du solde ? Sinon la simulation doit être invalidée, jamais ajustée
 * en silence.
 */
export function reevaluateAmountAgainstBalance(input: {
  amountLamports: number | null;
  freshVaultLamports: number | null;
}): { stillValid: boolean; reason: string } {
  if (input.amountLamports === null) {
    return { reason: 'No amount is set.', stillValid: false };
  }
  if (input.freshVaultLamports === null) {
    return {
      reason: 'The Main vault balance could not be read again: the simulation must be redone.',
      stillValid: false,
    };
  }
  if (input.amountLamports > input.freshVaultLamports) {
    return {
      reason: `The Main vault now holds ${input.freshVaultLamports} lamports, less than the ${input.amountLamports} lamports proposal: recalculate Max or enter a new amount.`,
      stillValid: false,
    };
  }
  return { reason: 'The amount is still covered by the Main vault balance.', stillValid: true };
}