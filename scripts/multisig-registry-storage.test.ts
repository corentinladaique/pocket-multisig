import assert from 'node:assert/strict';

import { createEmptyRegistry, makeEntry, upsertEntry } from '../src/vault/multisigRegistry';
import {
  createMemoryRegistryStorage,
  loadRegistry,
  REGISTRY_STORAGE_KEY,
  saveRegistry,
  type RegistryStorage,
} from '../src/vault/multisigRegistryStorage';

/**
 * Tests PURS de la couche de persistance du registre.
 *
 * Aucun React Native, aucun stockage reel, aucun RPC, aucun secret : le backend
 * est remplace par un stockage memoire. Execution :
 * npx tsx scripts/multisig-registry-storage.test.ts
 */

const MULTISIG = '11111111111111111111111111111111';
const MEMBER = 'SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf';

let passed = 0;

async function check(name: string, run: () => void | Promise<void>): Promise<void> {
  try {
    await run();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (caught: unknown) {
    console.error(`FAIL ${name}`);
    console.error(`  ${caught instanceof Error ? caught.message : String(caught)}`);
    process.exitCode = 1;
  }
}

async function main(): Promise<void> {
  await check('cle unique attendue', () => {
    assert.equal(REGISTRY_STORAGE_KEY, 'pocket-multisig.registry.v1');
  });

  await check('stockage vide : registre vide, aucune erreur', async () => {
    const storage = createMemoryRegistryStorage();
    const result = await loadRegistry(storage);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.registry, createEmptyRegistry());
  });

  await check('save puis load : aller-retour complet', async () => {
    const storage = createMemoryRegistryStorage();
    const { entry } = makeEntry({
      address: MULTISIG,
      vaultName: 'Personal vault',
      memberLabels: { [MEMBER]: 'Ledger at home' },
      source: 'created',
      now: '2026-09-22T10:00:00.000Z',
    });
    assert.ok(entry !== null);
    const registry = upsertEntry(createEmptyRegistry(), entry);

    await saveRegistry(storage, registry);
    const reloaded = await loadRegistry(storage);

    assert.deepEqual(reloaded.errors, []);
    assert.deepEqual(reloaded.registry, registry);
    assert.equal(reloaded.registry.entries[0]?.vaultName, 'Personal vault');
    assert.equal(reloaded.registry.entries[0]?.memberLabels[MEMBER], 'Ledger at home');
  });

  await check('contenu corrompu : registre exploitable + erreurs nommees', async () => {
    const storage = createMemoryRegistryStorage('{ pas du json');
    const result = await loadRegistry(storage);
    assert.equal(result.registry.entries.length, 0);
    assert.ok(result.errors.some((error) => /InvalidJson/.test(error)));
  });

  await check('lecture impossible : StorageReadFailed et registre vide', async () => {
    const failing: RegistryStorage = {
      load: async () => {
        throw new Error('native module unavailable');
      },
      save: async () => undefined,
    };
    const result = await loadRegistry(failing);
    assert.equal(result.registry.entries.length, 0);
    assert.ok(
      result.errors.some(
        (error) => /StorageReadFailed/.test(error) && /native module unavailable/.test(error),
      ),
    );
  });

  await check('ecriture impossible : StorageWriteFailed', async () => {
    const failing: RegistryStorage = {
      load: async () => null,
      save: async () => {
        throw new Error('disk full');
      },
    };
    let message = '';
    try {
      await saveRegistry(failing, createEmptyRegistry());
    } catch (caught: unknown) {
      message = caught instanceof Error ? caught.message : String(caught);
    }
    assert.match(message, /StorageWriteFailed/);
    assert.match(message, /disk full/);
  });

  await check('un secret present dans le stockage n est jamais relu', async () => {
    const storage = createMemoryRegistryStorage(
      JSON.stringify({
        version: 1,
        entries: [
          {
            address: MULTISIG,
            vaultName: 'Personal vault',
            memberLabels: {},
            addedAt: '2026-09-22T10:00:00.000Z',
            source: 'created',
            secretKey: 'SECRET-KEY',
            createKey: 'SECRET-CREATE-KEY',
          },
        ],
      }),
    );
    const result = await loadRegistry(storage);
    assert.equal(result.registry.entries.length, 1);
    const persisted = JSON.stringify(result.registry);
    assert.ok(!persisted.includes('SECRET-KEY'));
    assert.ok(!persisted.includes('SECRET-CREATE-KEY'));
  });

  console.log(`\n${passed} test(s) OK`);
  if (process.exitCode === 1) process.exit(1);
}

void main();