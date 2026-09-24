// Lecture d'un multisig Squads v4 via le SDK officiel @sqds/multisig.
// Aucun parsing maison : la désérialisation est entièrement déléguée au SDK.
import { PublicKey, type Connection } from '@solana/web3.js';
import * as multisig from '@sqds/multisig';

export interface MemberView {
  /** Adresse publique du membre (base58). */
  address: string;
  /** Rôles décodés à partir du masque officiel du SDK. */
  roles: string[];
}

export interface MultisigView {
  /** Adresse de configuration du multisig (PAS le vault). */
  address: string;
  configAuthority: string;
  members: MemberView[];
  /** `null` si le programme n'a pas de collecteur de rent configure. */
  rentCollector: string | null;
  threshold: number;
  timeLock: number;
  transactionIndex: number;
  /** Index de péremption : les transactions strictement antérieures sont mortes. */
  staleTransactionIndex: number;
  /** Adresse du vault d'index 0, dérivée par l'utilitaire officiel du SDK. */
  vaultAddress: string;
}

/** Erreur porteuse d'un message déjà lisible par l'utilisateur. */
export class MultisigLookupError extends Error {}

/**
 * Valide localement une adresse saisie. Aucun appel réseau.
 * @throws {MultisigLookupError} si la saisie est vide ou n'est pas du base58 valide.
 */
export function parseMultisigAddress(input: string): PublicKey {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    throw new MultisigLookupError('Saisis une adresse de multisig.');
  }
  try {
    return new PublicKey(trimmed);
  } catch {
    throw new MultisigLookupError(
      "Adresse invalide : ce n'est pas une adresse base58 valide.",
    );
  }
}

/** Rôles décodés avec les helpers officiels du SDK. */
function decodeRoles(permissions: { mask: number }): string[] {
  const { Permission, Permissions } = multisig.types;
  const roles: string[] = [];
  if (Permissions.has(permissions, Permission.Initiate)) roles.push('Initiate');
  if (Permissions.has(permissions, Permission.Vote)) roles.push('Vote');
  if (Permissions.has(permissions, Permission.Execute)) roles.push('Execute');
  return roles;
}

/**
 * Charge un multisig par son adresse avec l'API officielle du SDK.
 * Un seul appel RPC (getAccountInfo). Aucun getProgramAccounts, aucun offset.
 * @throws {MultisigLookupError} message lisible si le compte est absent ou illisible.
 */
export async function loadMultisig(
  connection: Connection,
  address: PublicKey,
): Promise<MultisigView> {
  let account: multisig.accounts.Multisig;
  try {
    account = await multisig.accounts.Multisig.fromAccountAddress(connection, address);
  } catch (caught: unknown) {
    const raw = caught instanceof Error ? caught.message : String(caught);
    if (/does not exist|no data|AccountNotFound|could not find account|unable to find/i.test(raw)) {
      throw new MultisigLookupError(
        'Aucun compte à cette adresse sur devnet. Vérifie qu’il s’agit bien d’un multisig Squads v4 déployé sur devnet.',
      );
    }
    if (/deserial|beet|range|slice|out of bounds/i.test(raw)) {
      throw new MultisigLookupError(
        `Ce compte existe mais n’est pas un multisig Squads v4 lisible (${raw}).`,
      );
    }
    throw new MultisigLookupError(`Lecture impossible : ${raw}`);
  }

  // Dérivation locale (aucun appel RPC) via l'utilitaire officiel.
  const [vaultAddress] = multisig.getVaultPda({ multisigPda: address, index: 0 });

  return {
    address: address.toBase58(),
    configAuthority: account.configAuthority.toBase58(),
    members: account.members.map((member) => ({
      address: member.key.toBase58(),
      roles: decodeRoles(member.permissions),
    })),
    // Meme deserialisation, aucun appel supplementaire : le champ etait deja lu.
    rentCollector: account.rentCollector === null ? null : account.rentCollector.toBase58(),
    threshold: account.threshold,
    timeLock: account.timeLock,
    transactionIndex: Number(account.transactionIndex),
    staleTransactionIndex: Number(account.staleTransactionIndex),
    vaultAddress: vaultAddress.toBase58(),
  };
}