import { isValidSolanaAddress } from './vaultDraft';

/**
 * Registre local des multisigs connus de l'utilisateur (version 1).
 *
 * Module PUR : aucune I/O, aucun RPC, aucun stockage, aucune blockchain.
 * Il ne contient QUE des donnees publiques : adresse du multisig, nom local,
 * labels locaux des membres, date d'ajout et provenance. Jamais de cle privee,
 * jamais de `createKey`, jamais de seed phrase : le type ne les autorise pas et
 * `parseRegistry` ignore tout champ non reconnu, donc un contenu etranger ne
 * peut pas faire entrer un secret dans le registre.
 */

export const REGISTRY_VERSION = 1;

export type MultisigSource = 'created' | 'manual';

export type MultisigRegistryEntry = {
  /** Adresse publique du multisig (base58). */
  address: string;
  /** Nom local du vault : il n'existe pas on-chain. */
  vaultName: string;
  /** Labels locaux par adresse de membre (jamais on-chain). */
  memberLabels: Record<string, string>;
  /** Date d'ajout, ISO 8601. */
  addedAt: string;
  /** `created` = cree depuis l'app, `manual` = ajoute a la main. */
  source: MultisigSource;
};

export type MultisigRegistry = {
  version: number;
  entries: MultisigRegistryEntry[];
};

export function createEmptyRegistry(): MultisigRegistry {
  return { version: REGISTRY_VERSION, entries: [] };
}

function cleanLabels(input: unknown): Record<string, string> {
  const labels: Record<string, string> = {};
  if (input === null || typeof input !== 'object') return labels;
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (typeof value !== 'string') continue;
    const label = value.trim();
    if (label.length === 0) continue;
    labels[key] = label;
  }
  return labels;
}

/** Validation pure d'une entree : liste des erreurs, vide si valide. */
export function validateEntry(entry: MultisigRegistryEntry): string[] {
  const errors: string[] = [];
  if (!isValidSolanaAddress(entry.address)) {
    errors.push('InvalidAddress: the multisig address is not a valid public address.');
  }
  if (entry.source !== 'created' && entry.source !== 'manual') {
    errors.push('InvalidSource: source must be "created" or "manual".');
  }
  if (entry.addedAt.trim().length === 0) {
    errors.push('MissingAddedAt: addedAt is required.');
  }
  return errors;
}

/**
 * Construit une entree a partir de donnees saisies (aucune I/O, aucun secret).
 * Renvoie `entry: null` et les erreurs plutot que de lever.
 */
export function makeEntry(input: {
  address: string;
  vaultName: string;
  memberLabels?: Record<string, string>;
  source: MultisigSource;
  now: string;
}): { entry: MultisigRegistryEntry | null; errors: string[] } {
  const entry: MultisigRegistryEntry = {
    address: input.address.trim(),
    vaultName: input.vaultName.trim(),
    memberLabels: cleanLabels(input.memberLabels ?? {}),
    addedAt: input.now,
    source: input.source,
  };
  const errors = validateEntry(entry);
  return errors.length === 0 ? { entry, errors: [] } : { entry: null, errors };
}

export function serializeRegistry(registry: MultisigRegistry): string {
  return JSON.stringify(registry);
}

/**
 * Lit un contenu de registre potentiellement corrompu ou etranger.
 * Ne leve jamais : les entrees invalides sont ecartees et signalees.
 * Seuls les champs reconnus sont conserves (aucun secret ne peut passer).
 */
export function parseRegistry(raw: string | null): {
  registry: MultisigRegistry;
  errors: string[];
} {
  const errors: string[] = [];
  if (raw === null || raw.trim().length === 0) {
    return { registry: createEmptyRegistry(), errors };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    errors.push('InvalidJson: the stored registry is not valid JSON.');
    return { registry: createEmptyRegistry(), errors };
  }

  if (parsed === null || typeof parsed !== 'object') {
    errors.push('InvalidRegistry: the stored registry is not an object.');
    return { registry: createEmptyRegistry(), errors };
  }

  const container = parsed as { version?: unknown; entries?: unknown };
  if (container.version !== REGISTRY_VERSION) {
    errors.push(`UnsupportedVersion: expected ${REGISTRY_VERSION}.`);
  }
  if (!Array.isArray(container.entries)) {
    errors.push('InvalidEntries: entries must be an array.');
    return { registry: createEmptyRegistry(), errors };
  }

  const entries: MultisigRegistryEntry[] = [];
  for (const candidate of container.entries) {
    if (candidate === null || typeof candidate !== 'object') {
      errors.push('InvalidEntry: entry is not an object.');
      continue;
    }
    const record = candidate as Record<string, unknown>;
    const entry: MultisigRegistryEntry = {
      address: typeof record.address === 'string' ? record.address.trim() : '',
      vaultName: typeof record.vaultName === 'string' ? record.vaultName.trim() : '',
      memberLabels: cleanLabels(record.memberLabels),
      addedAt: typeof record.addedAt === 'string' ? record.addedAt : '',
      source:
        record.source === 'created' || record.source === 'manual'
          ? record.source
          : // Valeur de repli : une entree sans provenance valide est signalee
            // par validateEntry ci-dessous.
            ('manual' as MultisigSource),
    };
    const entryErrors = validateEntry(entry);
    if (entryErrors.length > 0) {
      errors.push(...entryErrors.map((error) => `${error} (${entry.address})`));
      continue;
    }
    entries.push(entry);
  }

  return { registry: { version: REGISTRY_VERSION, entries }, errors };
}

/** Ajoute ou remplace l'entree de meme adresse (une adresse = une entree). */
export function upsertEntry(
  registry: MultisigRegistry,
  entry: MultisigRegistryEntry,
): MultisigRegistry {
  const address = entry.address.trim();
  const others = registry.entries.filter((existing) => existing.address !== address);
  return { version: REGISTRY_VERSION, entries: [...others, entry] };
}

export function removeEntry(registry: MultisigRegistry, address: string): MultisigRegistry {
  const target = address.trim();
  return {
    version: REGISTRY_VERSION,
    entries: registry.entries.filter((existing) => existing.address !== target),
  };
}

/** Liste triee du plus recent au plus ancien (tri stable sur l'adresse). */
export function listEntries(registry: MultisigRegistry): MultisigRegistryEntry[] {
  return [...registry.entries].sort((left, right) => {
    if (left.addedAt === right.addedAt) return left.address.localeCompare(right.address);
    return right.addedAt.localeCompare(left.addedAt);
  });
}

export function findEntry(
  registry: MultisigRegistry,
  address: string,
): MultisigRegistryEntry | null {
  const target = address.trim();
  return registry.entries.find((entry) => entry.address === target) ?? null;
}