import { PublicKey, type AccountInfo } from '@solana/web3.js';
import * as multisig from '@sqds/multisig';

/**
 * Read-back d'une création de multisig Squads v4 : décodage + invariants.
 *
 * Module PUR : aucune I/O réseau, aucun wallet, aucune signature, aucun envoi.
 * C'est l'UNIQUE source de vérité pour le read-back INITIAL (après envoi) et le
 * RECHECK (« Check transaction again ») : les deux chemins doivent exiger
 * exactement le même ensemble d'invariants avant d'annoncer
 * « Vault created and verified. ».
 *
 * Les codes d'erreur sont stables et ne servent QU'AU diagnostic technique
 * (Troubleshooting details) : ils ne sont jamais affichés dans le bloc principal.
 */

/** Valeurs attendues, préparées AVANT signature (plan de création). */
export type MultisigCreationExpectation = {
  threshold: number;
  memberCount: number;
  /** `null` = configuration figée (Pubkey::default() on-chain). */
  configAuthority: string | null;
  /** Membres attendus : adresse + masque de permissions exact du SDK. */
  members: readonly { key: string; permissions: number }[];
  timeLock: number;
  /** `null` = rent rendu au créateur (Pubkey::default() côté instruction). */
  rentCollector: string | null;
};

/** Ce qui a RÉELLEMENT été créé, relu on-chain. */
export type MultisigCreationReadBack = {
  address: string;
  owner: string;
  threshold: number;
  memberCount: number;
  configAuthority: string;
  rentCollector: string | null;
  timeLock: number;
  members: { address: string; permissions: number }[];
};

export type MultisigCreationReadBackValidation = {
  verified: boolean;
  /** Codes stables (OwnerMismatch, …). Jamais affichés tels quels à l'utilisateur. */
  errors: string[];
  readBack: MultisigCreationReadBack | null;
};

function sameAddress(left: string, right: string): boolean {
  try {
    return new PublicKey(left).equals(new PublicKey(right));
  } catch {
    return false;
  }
}

/**
 * Décode un compte multisig relu et construit la vue de read-back.
 * `expectedAddress` est l'adresse de la tentative signée : elle est CONSERVÉE
 * telle quelle (jamais re-dérivée depuis une donnée de navigation).
 * Peut lever si le compte n'est pas décodable (l'appelant produit alors
 * ReadBackDecodeFailed).
 */
export function decodeMultisigCreationReadBack(
  accountInfo: AccountInfo<Buffer>,
  expectedAddress: string,
): MultisigCreationReadBack {
  const [decoded] = multisig.accounts.Multisig.fromAccountInfo(accountInfo);
  return {
    address: expectedAddress,
    owner: accountInfo.owner.toString(),
    threshold: decoded.threshold,
    memberCount: decoded.members.length,
    configAuthority: decoded.configAuthority.toString(),
    rentCollector: decoded.rentCollector?.toString() ?? null,
    timeLock: decoded.timeLock,
    members: decoded.members.map((member) => ({
      address: member.key.toBase58(),
      permissions: member.permissions.mask,
    })),
  };
}

/**
 * Applique EXACTEMENT les mêmes invariants que le read-back initial.
 * À utiliser pour tout verdict « vault vérifié », quelle que soit la source.
 */
export function validateMultisigCreationReadBack(input: {
  readBack: MultisigCreationReadBack | null;
  expectation: MultisigCreationExpectation;
  /** Adresse ATTENDUE de la tentative signée (jamais une adresse de navigation). */
  expectedAddress: string | null;
}): MultisigCreationReadBackValidation {
  const errors: string[] = [];
  const { expectation, readBack } = input;

  // 1. Compte absent : rien à vérifier.
  if (readBack === null) {
    return {
      errors: ['ReadBackMissing: the multisig account is not readable yet.'],
      readBack: null,
      verified: false,
    };
  }

  // 2. Adresse du compte relu == adresse attendue de la tentative signée.
  if (input.expectedAddress !== null && !sameAddress(readBack.address, input.expectedAddress)) {
    errors.push(
      `AccountAddressMismatch: on-chain ${readBack.address}, expected ${input.expectedAddress}.`,
    );
  }

  // 3. Propriétaire du compte : toujours le programme Squads.
  const programId = multisig.PROGRAM_ID.toString();
  if (readBack.owner !== programId) {
    errors.push(`OwnerMismatch: owner is ${readBack.owner}, expected ${programId}.`);
  }

  // 4. Config authority : jamais de conversion silencieuse de null.
  const expectedAuthority = expectation.configAuthority;
  const authorityMatches =
    expectedAuthority === null
      ? readBack.configAuthority === PublicKey.default.toString()
      : sameAddress(readBack.configAuthority, expectedAuthority);
  if (!authorityMatches) {
    errors.push(
      `ConfigAuthorityMismatch: on-chain ${readBack.configAuthority}, expected ${
        expectedAuthority ?? PublicKey.default.toString()
      }.`,
    );
  }

  // 5. Threshold.
  if (readBack.threshold !== expectation.threshold) {
    errors.push(
      `ThresholdMismatch: on-chain ${readBack.threshold}, expected ${expectation.threshold}.`,
    );
  }

  // 6. Membres : même nombre, mêmes adresses, mêmes permissions (ordre ignoré).
  if (readBack.memberCount !== expectation.memberCount) {
    errors.push(
      `MemberCountMismatch: on-chain ${readBack.memberCount}, expected ${expectation.memberCount}.`,
    );
  }
  for (const expected of expectation.members) {
    const match = readBack.members.find((member) => sameAddress(member.address, expected.key));
    if (match === undefined) {
      errors.push(`MemberAddressMismatch: expected member ${expected.key} is missing on-chain.`);
      continue;
    }
    if (match.permissions !== expected.permissions) {
      errors.push(
        `MemberPermissionsMismatch: ${expected.key} has mask ${match.permissions}, expected ${expected.permissions}.`,
      );
    }
  }
  for (const onchain of readBack.members) {
    const known = expectation.members.some((expected) => sameAddress(expected.key, onchain.address));
    if (!known) {
      errors.push(`MemberAddressMismatch: unexpected on-chain member ${onchain.address}.`);
    }
  }

  // 7. Time lock.
  if (readBack.timeLock !== expectation.timeLock) {
    errors.push(`TimeLockMismatch: on-chain ${readBack.timeLock}, expected ${expectation.timeLock}.`);
  }

  // 8. Rent collector (null = rent rendu au créateur).
  const expectedRentCollector = expectation.rentCollector;
  const rentCollectorMatches =
    expectedRentCollector === null
      ? readBack.rentCollector === null
      : readBack.rentCollector !== null && sameAddress(readBack.rentCollector, expectedRentCollector);
  if (!rentCollectorMatches) {
    errors.push(
      `RentCollectorMismatch: on-chain ${readBack.rentCollector ?? 'none'}, expected ${
        expectedRentCollector ?? 'none'
      }.`,
    );
  }

  return { errors, readBack, verified: errors.length === 0 };
}
