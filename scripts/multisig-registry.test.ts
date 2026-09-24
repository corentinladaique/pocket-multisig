import assert from 'node:assert/strict';

import {
  createEmptyRegistry,
  findEntry,
  listEntries,
  makeEntry,
  parseRegistry,
  removeEntry,
  serializeRegistry,
  upsertEntry,
  validateEntry,
  type MultisigRegistryEntry,
} from '../src/vault/multisigRegistry';

/**
 * Tests PURS du registre local des multisigs.
 *
 * Aucun stockage, aucun RPC, aucune blockchain, aucun secret : uniquement des
 * adresses publiques de test. Execution :
 * npx tsx scripts/multisig-registry.test.ts
 */

const MULTISIG_A = '11111111111111111111111111111111';
const MULTISIG_B = 'SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf';
const MEMBER_A = 'So11111111111111111111111111111111111111112';
const MEMBER_B = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

let passed = 0;

function check(name: string, run: () => void): void {
  try {
    run();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (caught: unknown) {
    console.error(`FAIL ${name}`);
    console.error(`  ${caught instanceof Error ? caught.message : String(caught)}`);
    process.exitCode = 1;
  }
}

function entryFor(address: string, addedAt: string): MultisigRegistryEntry {
  const { entry, errors } = makeEntry({
    address,
    vaultName: 'Personal vault',
    memberLabels: { [MEMBER_A]: 'Ledger at home' },
    now: addedAt,
    source: 'created',
  });
  assert.deepEqual(errors, []);
  assert.ok(entry !== null);
  return entry;
}

check('registre vide : serialisation et relecture', () => {
  const empty = createEmptyRegistry();
  const roundTrip = parseRegistry(serializeRegistry(empty));
  assert.deepEqual(roundTrip.errors, []);
  assert.deepEqual(roundTrip.registry, empty);
});

check('ajout puis list : une entree retrouvee par adresse', () => {
  const entry = entryFor(MULTISIG_A, '2026-09-22T10:00:00.000Z');
  const registry = upsertEntry(createEmptyRegistry(), entry);
  assert.equal(listEntries(registry).length, 1);
  assert.deepEqual(findEntry(registry, MULTISIG_A), entry);
  assert.equal(findEntry(registry, MULTISIG_B), null);
});

check('upsert sur la meme adresse remplace au lieu de dupliquer', () => {
  const first = entryFor(MULTISIG_A, '2026-09-22T10:00:00.000Z');
  const second: MultisigRegistryEntry = {
    ...entryFor(MULTISIG_A, '2026-09-22T11:00:00.000Z'),
    vaultName: 'Renamed vault',
  };
  const registry = upsertEntry(upsertEntry(createEmptyRegistry(), first), second);
  assert.equal(registry.entries.length, 1);
  assert.equal(findEntry(registry, MULTISIG_A)?.vaultName, 'Renamed vault');
});

check('remove supprime l entree et ignore une adresse absente', () => {
  const registry = upsertEntry(createEmptyRegistry(), entryFor(MULTISIG_A, '2026-09-22T10:00:00.000Z'));
  const afterRemove = removeEntry(registry, MULTISIG_A);
  assert.equal(afterRemove.entries.length, 0);
  const afterNoop = removeEntry(afterRemove, MULTISIG_B);
  assert.equal(afterNoop.entries.length, 0);
});

check('liste triee du plus recent au plus ancien', () => {
  const older = entryFor(MULTISIG_A, '2026-09-22T10:00:00.000Z');
  const newer = entryFor(MULTISIG_B, '2026-09-22T12:00:00.000Z');
  const registry = upsertEntry(upsertEntry(createEmptyRegistry(), older), newer);
  assert.deepEqual(
    listEntries(registry).map((entry) => entry.address),
    [MULTISIG_B, MULTISIG_A],
  );
});

check('adresse invalide rejetee, sans exception', () => {
  const { entry, errors } = makeEntry({
    address: 'not-a-public-key',
    vaultName: 'Broken',
    source: 'manual',
    now: '2026-09-22T10:00:00.000Z',
  });
  assert.equal(entry, null);
  assert.ok(errors.some((error) => /InvalidAddress/.test(error)));

  const invalid = validateEntry({
    address: 'nope',
    vaultName: '',
    memberLabels: {},
    addedAt: '2026-09-22T10:00:00.000Z',
    source: 'manual',
  });
  assert.ok(invalid.some((error) => /InvalidAddress/.test(error)));
});

check('JSON invalide : registre vide + erreur, aucune exception', () => {
  const result = parseRegistry('{ not json');
  assert.equal(result.registry.entries.length, 0);
  assert.ok(result.errors.some((error) => /InvalidJson/.test(error)));
});

check('version inconnue signalee, entrees valides conservees', () => {
  const payload = JSON.stringify({
    version: 99,
    entries: [entryFor(MULTISIG_A, '2026-09-22T10:00:00.000Z')],
  });
  const result = parseRegistry(payload);
  assert.ok(result.errors.some((error) => /UnsupportedVersion/.test(error)));
  assert.equal(result.registry.entries.length, 1);
  assert.equal(result.registry.version, 1);
});

check('entree corrompue ecartee, les autres conservees', () => {
  const payload = JSON.stringify({
    version: 1,
    entries: [
      entryFor(MULTISIG_A, '2026-09-22T10:00:00.000Z'),
      { address: 42, vaultName: 'broken', memberLabels: null, addedAt: '', source: 'weird' },
    ],
  });
  const result = parseRegistry(payload);
  assert.equal(result.registry.entries.length, 1);
  assert.equal(result.registry.entries[0]?.address, MULTISIG_A);
  assert.ok(result.errors.length > 0);
});

check('aucun secret ne peut entrer dans le registre', () => {
  const payload = JSON.stringify({
    version: 1,
    entries: [
      {
        ...entryFor(MULTISIG_A, '2026-09-22T10:00:00.000Z'),
        createKey: 'SECRET-CREATE-KEY',
        secretKey: 'SECRET-KEY',
        mnemonic: 'SECRET MNEMONIC',
      },
    ],
  });
  const result = parseRegistry(payload);
  assert.equal(result.registry.entries.length, 1);
  const persisted = serializeRegistry(result.registry);
  assert.ok(!persisted.includes('SECRET-CREATE-KEY'));
  assert.ok(!persisted.includes('SECRET-KEY'));
  assert.ok(!persisted.includes('SECRET MNEMONIC'));
  assert.deepEqual(Object.keys(result.registry.entries[0] ?? {}).sort(), [
    'addedAt',
    'address',
    'memberLabels',
    'source',
    'vaultName',
  ]);
});

check('labels vides ou espaces nettoyes', () => {
  const { entry } = makeEntry({
    address: MULTISIG_A,
    vaultName: '  Spaced vault  ',
    memberLabels: { [MEMBER_A]: '  Ledger at home  ', [MEMBER_B]: '   ' },
    source: 'manual',
    now: '2026-09-22T10:00:00.000Z',
  });
  assert.ok(entry !== null);
  assert.equal(entry.vaultName, 'Spaced vault');
  assert.deepEqual(entry.memberLabels, { [MEMBER_A]: 'Ledger at home' });
});

console.log(`\n${passed} test(s) OK`);
if (process.exitCode === 1) process.exit(1);