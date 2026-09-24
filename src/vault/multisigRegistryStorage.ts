import { parseRegistry, serializeRegistry, type MultisigRegistry } from './multisigRegistry';

/**
 * Persistance locale du registre des multisigs (v1) — partie PURE.
 *
 * Contenu stocke : uniquement des donnees publiques (adresses, nom local,
 * labels locaux, date, provenance). Aucun secret, aucune cle privee, aucun
 * `createKey` : le type de registre ne les autorise pas et `parseRegistry`
 * ignore tout champ non reconnu.
 *
 * Le backend est injectable (`RegistryStorage`) : la couche est donc testable
 * sans React Native. Le backend appareil vit dans `deviceRegistryStorage.ts`,
 * seul fichier qui importe la dependance native.
 */

/** Cle unique de stockage : le registre tient dans un seul enregistrement. */
export const REGISTRY_STORAGE_KEY = 'pocket-multisig.registry.v1';

export interface RegistryStorage {
  load: () => Promise<string | null>;
  save: (raw: string) => Promise<void>;
}

/** Backend en memoire (tests, ou repli documente si le stockage est absent). */
export function createMemoryRegistryStorage(initial: string | null = null): RegistryStorage {
  let value = initial;
  return {
    load: async () => value,
    save: async (raw: string) => {
      value = raw;
    },
  };
}

/**
 * Lit et valide le registre. Ne leve jamais : un contenu absent, corrompu ou
 * d'une version inconnue donne un registre exploitable + des erreurs nommees.
 * Un echec du stockage lui-meme remonte une erreur `StorageReadFailed`.
 */
export async function loadRegistry(storage: RegistryStorage): Promise<{
  registry: MultisigRegistry;
  errors: string[];
}> {
  let raw: string | null;
  try {
    raw = await storage.load();
  } catch (caught: unknown) {
    const detail = caught instanceof Error ? caught.message : String(caught);
    const parsed = parseRegistry(null);
    return { registry: parsed.registry, errors: [...parsed.errors, `StorageReadFailed: ${detail}`] };
  }
  return parseRegistry(raw);
}

/** Ecrit le registre (une seule cle). Un echec remonte `StorageWriteFailed`. */
export async function saveRegistry(
  storage: RegistryStorage,
  registry: MultisigRegistry,
): Promise<void> {
  try {
    await storage.save(serializeRegistry(registry));
  } catch (caught: unknown) {
    const detail = caught instanceof Error ? caught.message : String(caught);
    throw new Error(`StorageWriteFailed: ${detail}`);
  }
}