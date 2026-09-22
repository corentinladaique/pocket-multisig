import * as multisig from '@sqds/multisig';

import { isValidSolanaAddress, type VaultCreationRequest } from './vaultDraft';

/**
 * Plan technique de creation d'un multisig Squads v4.
 *
 * Module PUR : il ne contient que des valeurs locales, coherentes avec
 * VAULT-CREATION.md. Aucune API Squads n'est executee (seuls les masques de
 * permissions sont lus), aucun PDA n'est derive, aucune instruction n'est
 * construite, aucune connexion reseau n'est ouverte, aucune signature n'est
 * demandee.
 *
 * La cle ephemere `createKey` et la derivation des PDA (`getMultisigPda`,
 * `getProgramConfigPda`, `getVaultPda`) appartiennent volontairement a l'etape
 * suivante : elles n'ont pas leur place dans un plan declaratif.
 */

// Meme convention que src/squads/multisig.ts : les constantes de permissions
// sont lues dans `multisig.types` sans executer d'appel reseau.
const { Permission } = multisig.types;

/**
 * Masque commun applique a chaque signataire : Initiate | Vote | Execute
 * (1 | 2 | 4 = 7), strictement les valeurs du SDK Squads v4.
 */
export const MEMBER_PERMISSION_MASK: number =
  Permission.Initiate | Permission.Vote | Permission.Execute;

/** Aucun delai on-chain sur le MVP. */
export const PLAN_TIME_LOCK = 0;
/**
 * `configAuthority = null` : la configuration du multisig est figee (aucune
 * cle ne pourra modifier membres ou seuil apres creation).
 */
export const PLAN_CONFIG_AUTHORITY: string | null = null;
/** `rentCollector = null` : le rent revient au createur. */
export const PLAN_RENT_COLLECTOR: string | null = null;

export type MultisigMemberPlan = {
  /** Adresse publique du signataire (jamais une cle privee). */
  key: string;
  /** Masque de permissions du membre (`Member.permissions`). */
  permissions: number;
  /** Label local uniquement : il n'existe pas on-chain (VAULT-CREATION.md §2). */
  label: string;
};

export type MultisigCreationPlan = {
  threshold: number;
  members: MultisigMemberPlan[];
  permissions: number;
  configAuthority: string | null;
  rentCollector: string | null;
  timeLock: number;
  readyForInstructionBuild: boolean;
  validationErrors: string[];
  validationWarnings: string[];
};

const FROZEN_CONFIG_WARNING =
  'Config authority is null: members and threshold cannot be changed after creation.';

/**
 * Transforme une demande de creation en plan technique (aucun effet de bord).
 * Les erreurs bloquantes du brouillon sont conservees telles quelles, auxquelles
 * s'ajoutent les controles propres a l'instruction (`InvalidThreshold`,
 * `EmptyMembers`, `DuplicateMember` dans VAULT-CREATION.md §6).
 */
export function buildMultisigCreationPlan(
  request: VaultCreationRequest,
): MultisigCreationPlan {
  const errors: string[] = [...request.validationErrors];
  const warnings: string[] = [...request.validationWarnings];

  const members: MultisigMemberPlan[] = request.members.map((member) => ({
    key: member.publicKey,
    permissions: MEMBER_PERMISSION_MASK,
    label: member.label,
  }));

  if (members.length === 0) {
    errors.push('EmptyMembers: at least one member is required.');
  }

  const seen = new Set<string>();
  for (const member of members) {
    if (seen.has(member.key)) {
      errors.push(`DuplicateMember: ${member.key.slice(0, 4)}…${member.key.slice(-4)}.`);
      continue;
    }
    seen.add(member.key);
  }

  if (!Number.isInteger(request.threshold) || request.threshold < 1) {
    errors.push('InvalidThreshold: threshold must be at least 1.');
  } else if (request.threshold > members.length) {
    errors.push('InvalidThreshold: threshold cannot exceed the member count.');
  }

  warnings.push(FROZEN_CONFIG_WARNING);

  const readyForInstructionBuild =
    errors.length === 0 && request.readyForCreation && request.vaultName.length > 0;

  return {
    threshold: request.threshold,
    members,
    permissions: MEMBER_PERMISSION_MASK,
    configAuthority: PLAN_CONFIG_AUTHORITY,
    rentCollector: PLAN_RENT_COLLECTOR,
    timeLock: PLAN_TIME_LOCK,
    readyForInstructionBuild,
    validationErrors: errors,
    validationWarnings: warnings,
  };
}

/**
 * Plan d'instruction : derniere etape pure avant toute construction on-chain.
 *
 * Ce module ne derive aucun PDA, ne construit aucune instruction Anchor, ne
 * cree aucune transaction et n'appelle aucune fonction du SDK : il ne fait que
 * declarer ce que l'instruction `multisigCreateV2` exigera (VAULT-CREATION.md
 * §1 et §5).
 */
export type MultisigInstructionPlan = {
  /** Programme cible, lu depuis le SDK (devnet et mainnet partagent l'ID). */
  programId: string;
  /** `createKey` est un signataire ephemere obligatoire de l'instruction. */
  createKeyRequired: boolean;
  /** `creator` signe et paie le rent (writable + signer). */
  creatorRequired: boolean;
  threshold: number;
  memberCount: number;
  permissions: number;
  configAuthority: string | null;
  rentCollector: string | null;
  timeLock: number;
  readyForBuild: boolean;
  validationErrors: string[];
  validationWarnings: string[];
};

const ADMIN_AUTHORITY_WARNING =
  'A non-null config authority can change members and threshold outside the approval quorum.';
const HETEROGENEOUS_PERMISSIONS_WARNING =
  'Members do not all share the same permission mask.';

/** Verifie le plan de creation et produit le plan d'instruction (fonction pure). */
export function buildMultisigInstructionPlan(
  plan: MultisigCreationPlan,
): MultisigInstructionPlan {
  const errors: string[] = [...plan.validationErrors];
  const warnings: string[] = [...plan.validationWarnings];

  const memberCount = plan.members.length;

  // Threshold : entier, au moins 1, jamais au-dessus du nombre de membres.
  if (!Number.isInteger(plan.threshold) || plan.threshold < 1) {
    errors.push('InvalidThreshold: threshold must be at least 1.');
  } else if (plan.threshold > memberCount) {
    errors.push('InvalidThreshold: threshold cannot exceed the member count.');
  }

  // Membres : au moins un, aucune adresse dupliquee.
  if (memberCount === 0) {
    errors.push('EmptyMembers: at least one member is required.');
  }
  const seen = new Set<string>();
  for (const member of plan.members) {
    if (seen.has(member.key)) {
      errors.push(`DuplicateMember: ${member.key.slice(0, 4)}…${member.key.slice(-4)}.`);
      continue;
    }
    seen.add(member.key);
  }

  // Permissions : un masque non nul est obligatoire, sinon le membre ne peut
  // ni initier, ni voter, ni executer.
  if (plan.permissions === 0) {
    errors.push('MissingPermissions: a non-zero permission mask is required.');
  }
  if (plan.members.some((member) => member.permissions === 0)) {
    errors.push('MissingPermissions: every member needs a non-zero permission mask.');
  }
  if (plan.members.some((member) => member.permissions !== plan.permissions)) {
    warnings.push(HETEROGENEOUS_PERMISSIONS_WARNING);
  }

  // Config authority : soit figee (null), soit une adresse publique valide.
  if (plan.configAuthority === null) {
    if (!warnings.includes(FROZEN_CONFIG_WARNING)) {
      warnings.push(FROZEN_CONFIG_WARNING);
    }
  } else if (!isValidSolanaAddress(plan.configAuthority)) {
    errors.push('InvalidConfigAuthority: config authority is not a valid public address.');
  } else {
    warnings.push(ADMIN_AUTHORITY_WARNING);
  }

  return {
    programId: multisig.PROGRAM_ID.toString(),
    createKeyRequired: true,
    creatorRequired: true,
    threshold: plan.threshold,
    memberCount,
    permissions: plan.permissions,
    configAuthority: plan.configAuthority,
    rentCollector: plan.rentCollector,
    timeLock: plan.timeLock,
    readyForBuild: errors.length === 0 && plan.readyForInstructionBuild,
    validationErrors: errors,
    validationWarnings: warnings,
  };
}