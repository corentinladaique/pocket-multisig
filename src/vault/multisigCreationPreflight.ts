import { PublicKey, type Connection } from '@solana/web3.js';
import * as multisig from '@sqds/multisig';

import type { MultisigCreationPlan } from './multisigCreationPlan';

/**
 * Preflight LECTURE SEULE avant toute creation de multisig Squads v4.
 *
 * Ce module lit uniquement : le compte `programConfig` (treasury et frais de
 * creation), le solde du createur, le rent minimum du compte multisig et
 * l'eventuelle existence d'un compte a l'adresse cible.
 *
 * Interdit et absent : `simulateTransaction`, `sendTransaction`,
 * `signAndSendTransactions`, toute signature, toute demande MWA, toute
 * ecriture. Le resultat est purement informatif (VAULT-CREATION.md §7) : aucun
 * montant calcule ici n'est presente comme exact, le cout reel n'etant
 * observable que par simulation.
 */

export type MultisigCreationPreflightResult = {
  /** `programConfig.treasury`, lu on-chain (jamais devine). */
  treasury: string | null;
  /** Frais de creation du programme, en lamports (lus on-chain). */
  multisigCreationFee: number;
  /** Solde courant du createur, en lamports (lu on-chain). */
  creatorBalance: number;
  /**
   * BORNE INFERIEURE : frais + rent du compte multisig estime a partir de
   * la taille calculee par le SDK. Le programme deploye alloue davantage que
   * cette taille (ecart mesure : 32 octets), donc le cout reel est superieur.
   * Seule une simulation fournit le montant reellement facture.
   */
  estimatedRequiredLamports: number;
  /**
   * Vrai uniquement vis-a-vis de la borne inferieure : un solde juste au-dessus
   * ne garantit PAS que la creation aboutira.
   */
  sufficientBalance: boolean;
  validationErrors: string[];
  validationWarnings: string[];
  readyForSimulation: boolean;
};

const RENT_ONLY_WARNING =
  'Network transaction fee is not included in estimatedRequiredLamports.';
const RENT_LOWER_BOUND_WARNING =
  'estimatedRequiredLamports is a LOWER BOUND: it uses the SDK account size, which is 32 bytes smaller than what the deployed program allocates (measured 198 vs 166 on a 2-member devnet multisig). Only a simulation can provide the real cost.';
const SIMULATION_ONLY_WARNING =
  'No local computation is authoritative here: the definitive lamports charged are only observable through a simulation before sending.';
const VAULT_NOT_INCLUDED_WARNING =
  'The vault account (index 0) is not created here and is not part of this estimate.';
const EPHEMERAL_KEY_WARNING =
  'The ephemeral createKey must stay in memory only; its public address is the only input needed here.';

/** Convertit un `bignum` du SDK (BN ou number) en lamports entiers. */
function toLamports(value: number | { toString(): string }): number {
  if (typeof value === 'number') return value;
  const parsed = Number.parseInt(value.toString(), 10);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function toPublicKey(value: string): PublicKey | null {
  try {
    return new PublicKey(value);
  } catch {
    return null;
  }
}

/**
 * Execute le preflight (lectures RPC uniquement, aucune ecriture).
 *
 * @param input.createKey adresse publique issue de
 *   `buildMultisigCreationTransaction` : la cle privee ephemere reste en memoire
 *   cote appelant et n'est jamais requise ici.
 */
export async function runMultisigCreationPreflight(input: {
  connection: Connection;
  creator: string;
  createKey: string;
  plan: MultisigCreationPlan;
}): Promise<MultisigCreationPreflightResult> {
  const errors: string[] = [];
  const warnings: string[] = [
    RENT_ONLY_WARNING,
    RENT_LOWER_BOUND_WARNING,
    SIMULATION_ONLY_WARNING,
    VAULT_NOT_INCLUDED_WARNING,
    EPHEMERAL_KEY_WARNING,
  ];

  const creator = toPublicKey(input.creator);
  if (creator === null) {
    errors.push('InvalidCreator: creator is not a valid public address.');
  }
  const createKey = toPublicKey(input.createKey);
  if (createKey === null) {
    errors.push('InvalidCreateKey: createKey is not a valid public address.');
  }

  const [programConfigPda] = multisig.getProgramConfigPda({ programId: multisig.PROGRAM_ID });

  let treasury: string | null = null;
  let multisigCreationFee = 0;

  try {
    const programConfig = await multisig.accounts.ProgramConfig.fromAccountAddress(
      input.connection,
      programConfigPda,
    );
    treasury = programConfig.treasury.toString();
    multisigCreationFee = toLamports(programConfig.multisigCreationFee);
    if (!Number.isFinite(multisigCreationFee)) {
      errors.push('InvalidProgramConfig: multisigCreationFee could not be read.');
      multisigCreationFee = 0;
    }
  } catch (caught: unknown) {
    errors.push(
      `ProgramConfigUnavailable: ${
        caught instanceof Error ? caught.message : String(caught)
      }`,
    );
  }

  let multisigAccountSize: number | null = null;
  if (createKey !== null) {
    const [multisigPda] = multisig.getMultisigPda({
      createKey,
      programId: multisig.PROGRAM_ID,
    });
    // Taille calculee par le SDK pour cette configuration. Elle est INFERIEURE
    // a la taille reellement allouee par le programme deploye (ecart mesure de
    // 32 octets), donc le rent qui en decoule est une borne inferieure.
    multisigAccountSize = multisig.accounts.Multisig.byteSize({
      createKey,
      configAuthority: createKey,
      threshold: input.plan.threshold,
      timeLock: input.plan.timeLock,
      transactionIndex: 0,
      staleTransactionIndex: 0,
      rentCollector: null,
      bump: 0,
      members: input.plan.members.map((member) => ({
        key: toPublicKey(member.key) ?? createKey,
        permissions: { mask: member.permissions },
      })),
    });

    try {
      const existing = await input.connection.getAccountInfo(multisigPda);
      if (existing !== null) {
        errors.push(
          `MultisigAccountAlreadyExists: ${multisigPda.toString()} is already in use.`,
        );
      }
    } catch (caught: unknown) {
      errors.push(
        `AccountLookupFailed: ${caught instanceof Error ? caught.message : String(caught)}`,
      );
    }
  }

  let creatorBalance = 0;
  if (creator !== null) {
    try {
      creatorBalance = await input.connection.getBalance(creator);
    } catch (caught: unknown) {
      errors.push(
        `BalanceReadFailed: ${caught instanceof Error ? caught.message : String(caught)}`,
      );
    }
  }

  let rentLamports = 0;
  if (multisigAccountSize !== null) {
    try {
      rentLamports = await input.connection.getMinimumBalanceForRentExemption(
        multisigAccountSize,
      );
    } catch (caught: unknown) {
      errors.push(
        `RentReadFailed: ${caught instanceof Error ? caught.message : String(caught)}`,
      );
    }
  }

  const estimatedRequiredLamports = multisigCreationFee + rentLamports;
  // Comparaison vis-a-vis de la borne inferieure uniquement : voir
  // RENT_LOWER_BOUND_WARNING, qui accompagne toujours ce resultat.
  const sufficientBalance =
    creator !== null &&
    errors.length === 0 &&
    creatorBalance >= estimatedRequiredLamports;

  if (creator !== null && errors.length === 0 && !sufficientBalance) {
    errors.push(
      `InsufficientBalance: need ${estimatedRequiredLamports} lamports, creator has ${creatorBalance}.`,
    );
  }

  if (treasury !== null) {
    warnings.push(`Treasury will receive the creation fee: ${treasury}.`);
  }

  return {
    treasury,
    multisigCreationFee,
    creatorBalance,
    estimatedRequiredLamports,
    sufficientBalance,
    validationErrors: errors,
    validationWarnings: warnings,
    // Jamais true si une lecture a echoue : le preflight ne masque rien.
    readyForSimulation: errors.length === 0,
  };
}