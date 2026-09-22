import assert from 'node:assert/strict';

import {
  createMember,
  createEmptyDraft,
  evaluateDraft,
  isDraftReady,
  minMembersFor,
  validateDraft,
  type SetupType,
  type VaultDraftInput,
} from '../src/vault/vaultDraft';

/**
 * Tests purs du modele de preparation de vault.
 *
 * Aucun RPC, aucune signature, aucune API Squads, aucun secret : uniquement
 * des adresses publiques de test. Execution : npx tsx scripts/vault-draft.test.ts
 */

// Adresses publiques valides, sans lien avec les fixtures locales.
const SEARCHER = '11111111111111111111111111111111';
const BACKUP_A = 'SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf';
const BACKUP_B = 'So11111111111111111111111111111111111111112';

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

function draftWith(
  members: { label: string; publicKey: string }[],
  threshold: number,
  setupType: SetupType = 'custom',
): VaultDraftInput {
  return {
    ...createEmptyDraft(),
    setupType,
    vaultName: 'Personal vault',
    members: members.map((member, index) =>
      createMember({ index, label: member.label, publicKey: member.publicKey }),
    ),
    threshold,
  };
}

check('adresse invalide -> erreur de validation', () => {
  const { errors } = validateDraft(
    draftWith(
      [
        { label: 'Ledger at home', publicKey: 'not-a-public-key' },
        { label: 'Backup wallet', publicKey: BACKUP_A },
      ],
      2,
    ),
  );
  assert.equal(errors.length, 1);
  assert.match(errors[0], /Invalid public address/);
  assert.match(errors[0], /Ledger at home/);
});

check('adresse dupliquee -> erreur de validation', () => {
  const { errors } = validateDraft(
    draftWith(
      [
        { label: 'Seeker', publicKey: SEARCHER },
        { label: 'Backup wallet', publicKey: SEARCHER },
      ],
      2,
    ),
  );
  assert.equal(errors.length, 1);
  assert.match(errors[0], /Duplicate public address/);
});

check('threshold invalide -> erreurs (0 et > membres)', () => {
  const zero = validateDraft(
    draftWith(
      [
        { label: 'Seeker', publicKey: SEARCHER },
        { label: 'Backup wallet', publicKey: BACKUP_A },
      ],
      0,
    ),
  );
  assert.ok(zero.errors.some((error) => /at least 1/.test(error)));

  const tooHigh = validateDraft(
    draftWith(
      [
        { label: 'Seeker', publicKey: SEARCHER },
        { label: 'Backup wallet', publicKey: BACKUP_A },
      ],
      3,
    ),
  );
  assert.ok(tooHigh.errors.some((error) => /cannot exceed/.test(error)));
});

check('2 of 2 valide -> aucune erreur, avertissement seuil = membres', () => {
  const draft = evaluateDraft(
    draftWith(
      [
        { label: 'Seeker', publicKey: SEARCHER },
        { label: 'Ledger at home', publicKey: BACKUP_A },
      ],
      2,
      'twoOfTwo',
    ),
  );
  assert.deepEqual(draft.validationErrors, []);
  assert.equal(draft.validationWarnings.length, 1);
  assert.match(draft.validationWarnings[0], /losing one signer/);
  assert.equal(isDraftReady(draft), true);
});

check('2 of 3 valide -> aucune erreur, aucun avertissement', () => {
  const draft = evaluateDraft(
    draftWith(
      [
        { label: 'Seeker', publicKey: SEARCHER },
        { label: 'Ledger at home', publicKey: BACKUP_A },
        { label: 'Backup wallet', publicKey: BACKUP_B },
      ],
      2,
      'recommended',
    ),
  );
  assert.deepEqual(draft.validationErrors, []);
  assert.deepEqual(draft.validationWarnings, []);
  assert.equal(isDraftReady(draft), true);
  assert.equal(draft.members.length, 3);
});

check('preset recommande exige 3 signers -> erreur explicite avec 2 membres', () => {
  assert.equal(minMembersFor('recommended'), 3);
  assert.equal(minMembersFor('twoOfTwo'), 2);
  assert.equal(minMembersFor('custom'), 2);

  const draft = evaluateDraft(
    draftWith(
      [
        { label: 'Seeker', publicKey: SEARCHER },
        { label: 'Ledger at home', publicKey: BACKUP_A },
      ],
      2,
      'recommended',
    ),
  );
  assert.deepEqual(draft.validationErrors, ['Recommended setup requires 3 signers.']);
  assert.equal(isDraftReady(draft), false);
});

console.log(`\n${passed} test(s) OK`);
if (process.exitCode === 1) process.exit(1);