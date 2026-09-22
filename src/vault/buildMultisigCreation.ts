import { PublicKey, Keypair, Transaction } from '@solana/web3.js';
import * as multisig from '@sqds/multisig';

import {
  buildMultisigInstructionPlan,
  type MultisigCreationPlan,
} from './multisigCreationPlan';

/**
 * Construction EN MEMOIRE de la transaction de creation d'un multisig Squads v4.
 *
 * Autorise ici : generation de `createKey`, derivation des PDA, appel a
 * `multisigCreateV2`, assemblage de la `Transaction`.
 *
 * Interdit et absent de ce module : `simulateTransaction`, `sendTransaction`,
 * `signAndSendTransactions`, toute signature et toute ecriture on-chain. La
 * transaction retournee n'est signee par personne : `createKey` devra signer
 * (`partialSign`) puis le wallet MWA completera la signature, dans une etape
 * ulterieure explicitement autorisee (VAULT-CREATION.md §5).
 */

export type MultisigTransactionBuildResult = {
  createKeyPublicKey: string;
  multisigPda: string;
  programConfigPda: string;
  /** Non signee, sans blockhash recent : rien n'est envoyable en l'etat. */
  transaction: Transaction | null;
  instructionCount: number;
  readyForSimulation: boolean;
  validationErrors: string[];
  validationWarnings: string[];
  /**
   * Signataire ephemere a conserver UNIQUEMENT en memoire (jamais persiste,
   * jamais journalise) : sans lui, la transaction construite serait inutilisable
   * car l'adresse du multisig en derive. SECURITY.md : aucun secret sur disque.
   */
  ephemeralCreateKey: Keypair;
};

const BLOCKHASH_WARNING =
  'Recent blockhash is not set: simulation and sending will require a fresh one.';
const UNSIGNED_WARNING =
  'Transaction is unsigned: createKey must partial-sign, then the wallet signs via MWA.';
const EPHEMERAL_KEY_WARNING =
  'createKey must stay in memory only and must never be persisted or logged.';

function toPublicKey(value: string): PublicKey | null {
  try {
    return new PublicKey(value);
  } catch {
    return null;
  }
}

/**
 * Assemble la transaction de creation (fonction sans I/O).
 *
 * @param input.plan      plan de creation valide (etape pure precedente) ;
 * @param input.creator   adresse publique du wallet payeur (signataire) ;
 * @param input.treasury  `programConfig.treasury`, lu on-chain par un preflight
 *                        en lecture seule : aucune derivation locale n'existe,
 *                        donc `null` bloque la construction (erreur explicite) ;
 * @param input.memo      memo optionnel, jamais de secret.
 */
export function buildMultisigCreationTransaction(input: {
  plan: MultisigCreationPlan;
  creator: string;
  treasury: string | null;
  memo?: string;
}): MultisigTransactionBuildResult {
  const instructionPlan = buildMultisigInstructionPlan(input.plan);
  const errors: string[] = [...instructionPlan.validationErrors];
  const warnings: string[] = [...instructionPlan.validationWarnings];

  // Cle ephemere : graine de derivation du PDA et signataire a venir.
  const ephemeralCreateKey = Keypair.generate();

  // PDA derivables hors ligne (aucune lecture RPC).
  const [programConfigPda] = multisig.getProgramConfigPda({ programId: multisig.PROGRAM_ID });
  const [multisigPda] = multisig.getMultisigPda({
    createKey: ephemeralCreateKey.publicKey,
    programId: multisig.PROGRAM_ID,
  });

  const creator = toPublicKey(input.creator);
  if (creator === null) {
    errors.push('InvalidCreator: creator is not a valid public address.');
  }

  const treasury = input.treasury === null ? null : toPublicKey(input.treasury);
  if (treasury === null) {
    errors.push(
      'MissingTreasury: programConfig.treasury must be read (read-only preflight) before building.',
    );
  }

  // Membres : cles et masques viennent du plan de creation (le plan
  // d'instruction ne porte que le nombre de membres et le masque commun).
  const members: { key: PublicKey; permissions: { mask: number } }[] = [];
  for (const member of input.plan.members) {
    const key = toPublicKey(member.key);
    if (key === null) {
      errors.push('InvalidMember: a member public address is invalid.');
      continue;
    }
    members.push({ key, permissions: { mask: member.permissions } });
  }

  warnings.push(BLOCKHASH_WARNING, UNSIGNED_WARNING, EPHEMERAL_KEY_WARNING);

  let transaction: Transaction | null = null;
  if (errors.length === 0 && creator !== null && treasury !== null) {
    const instruction = multisig.instructions.multisigCreateV2({
      treasury,
      creator,
      multisigPda,
      configAuthority: null,
      threshold: instructionPlan.threshold,
      members,
      timeLock: instructionPlan.timeLock,
      createKey: ephemeralCreateKey.publicKey,
      rentCollector: null,
      memo: input.memo,
      programId: multisig.PROGRAM_ID,
    });

    transaction = new Transaction({ feePayer: creator }).add(instruction);
  }

  return {
    createKeyPublicKey: ephemeralCreateKey.publicKey.toString(),
    multisigPda: multisigPda.toString(),
    programConfigPda: programConfigPda.toString(),
    transaction,
    instructionCount: transaction === null ? 0 : transaction.instructions.length,
    readyForSimulation:
      transaction !== null && errors.length === 0 && instructionPlan.readyForBuild,
    validationErrors: errors,
    validationWarnings: warnings,
    ephemeralCreateKey,
  };
}