import { PublicKey } from '@solana/web3.js';

/**
 * Modele local de preparation d'un vault Squads personnel.
 *
 * Ce module est PUR : aucun RPC, aucune signature, aucune API de creation
 * Squads, aucun secret (jamais de cle privee, de seed phrase ou de PIN).
 * Il ne manipule que des adresses publiques et des labels saisis a la main.
 */

export type SetupType = 'recommended' | 'twoOfTwo' | 'custom';

export type VaultMemberDraft = {
  id: string;
  label: string;
  publicKey: string;
};

export type VaultDraft = {
  vaultName: string;
  setupType: SetupType;
  members: VaultMemberDraft[];
  threshold: number;
  validationErrors: string[];
  validationWarnings: string[];
};

/** Entree de validation : le brouillon sans ses champs derives. */
export type VaultDraftInput = Omit<VaultDraft, 'validationErrors' | 'validationWarnings'>;

export const MIN_MEMBERS = 2;

export type SetupPreset = {
  type: SetupType;
  title: string;
  detail: string;
  memberCount: number;
  threshold: number;
};

export const SETUP_PRESETS: readonly SetupPreset[] = [
  {
    type: 'recommended',
    title: 'Recommended: 2 of 3',
    detail: '3 signers, 2 approvals needed. One lost signer keeps the vault usable.',
    memberCount: 3,
    threshold: 2,
  },
  {
    type: 'twoOfTwo',
    title: '2 of 2',
    detail: '2 signers, 2 approvals needed. Strong, but both signers must be available.',
    memberCount: 2,
    threshold: 2,
  },
  {
    type: 'custom',
    title: 'Custom',
    detail: 'Choose your own signers and threshold.',
    memberCount: 0,
    threshold: 1,
  },
];

/**
 * Nombre minimum de signataires impose par le preset choisi.
 * Le preset recommande (2 of 3) exige trois signers : sans cela le seuil de 2
 * ne protege plus rien (deux signatures suffisent avec deux membres).
 */
export function minMembersFor(setupType: SetupType): number {
  const preset = SETUP_PRESETS.find((entry) => entry.type === setupType);
  if (preset === undefined || preset.memberCount === 0) return MIN_MEMBERS;
  return Math.max(preset.memberCount, MIN_MEMBERS);
}

/** Identifiant local stable, jamais transmis on-chain. */
export function createMember(input: {
  index: number;
  label: string;
  publicKey: string;
}): VaultMemberDraft {
  return {
    id: `member-${input.index}`,
    label: input.label.trim(),
    publicKey: input.publicKey.trim(),
  };
}

export function createEmptyDraft(): VaultDraftInput {
  return {
    vaultName: '',
    setupType: 'custom',
    members: [],
    threshold: 1,
  };
}

/** Validation pure d'une adresse publique Solana (base58, 32 octets). */
export function isValidSolanaAddress(value: string): boolean {
  const candidate = value.trim();
  if (candidate.length === 0) return false;
  try {
    // eslint-disable-next-line no-new
    new PublicKey(candidate);
    return true;
  } catch {
    return false;
  }
}

/** Adresse abregee pour les listes (les revues affichent l'adresse complete). */
export function shortenMemberAddress(address: string): string {
  return address.length <= 10 ? address : `${address.slice(0, 4)}…${address.slice(-4)}`;
}

/**
 * Valide un brouillon complet. Les erreurs bloquent la creation, les
 * avertissements ne font que signaler un choix risque.
 */
export function validateDraft(input: VaultDraftInput): {
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];
  const members = input.members;

  const requiredMembers = minMembersFor(input.setupType);
  if (members.length < requiredMembers) {
    errors.push(
      input.setupType === 'recommended'
        ? 'Recommended setup requires 3 signers.'
        : `At least ${requiredMembers} members are required.`,
    );
  }

  for (const member of members) {
    const label = member.label.length > 0 ? member.label : 'unlabelled member';
    if (!isValidSolanaAddress(member.publicKey)) {
      errors.push(`Invalid public address for ${label}.`);
    }
  }

  const seen = new Set<string>();
  for (const member of members) {
    const address = member.publicKey.trim();
    if (address.length === 0) continue;
    if (seen.has(address)) {
      errors.push(`Duplicate public address: ${shortenMemberAddress(address)}.`);
      continue;
    }
    seen.add(address);
  }

  if (!Number.isInteger(input.threshold) || input.threshold < 1) {
    errors.push('Threshold must be at least 1.');
  } else if (input.threshold > members.length) {
    errors.push('Threshold cannot exceed the number of members.');
  }

  if (input.threshold === 1) {
    warnings.push('Threshold 1: a single signer can move funds alone.');
  }
  if (members.length >= MIN_MEMBERS && input.threshold === members.length) {
    warnings.push(
      'Threshold equals the member count: losing one signer makes the vault unusable.',
    );
  }

  return { errors, warnings };
}

/** Applique la validation pure et renvoie le brouillon strict complet. */
export function evaluateDraft(input: VaultDraftInput): VaultDraft {
  const { errors, warnings } = validateDraft(input);
  return { ...input, validationErrors: errors, validationWarnings: warnings };
}

/** Le brouillon est-il pret pour une future creation on-chain ? */
export function isDraftReady(draft: VaultDraft): boolean {
  return draft.validationErrors.length === 0 && draft.vaultName.trim().length > 0;
}