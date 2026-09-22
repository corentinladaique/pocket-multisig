import assert from 'node:assert/strict';

import { PublicKey } from '@solana/web3.js';
import * as multisig from '@sqds/multisig';

import { buildMultisigCreationTransaction } from '../src/vault/buildMultisigCreation';
import { buildMultisigCreationPlan } from '../src/vault/multisigCreationPlan';
import {
  buildVaultCreationRequest,
  createMember,
  createEmptyDraft,
  evaluateDraft,
} from '../src/vault/vaultDraft';

/**
 * Validation HORS LIGNE de buildMultisigCreationTransaction().
 *
 * Aucun RPC, aucune simulation, aucune signature, aucun envoi, aucun MWA :
 * uniquement de la derivation de PDA et l'assemblage local de l'instruction.
 * Execution : npx tsx scripts/multisig-creation-build.test.ts
 */

// Adresses publiques de test, sans lien avec les fixtures locales.
const MEMBER_A = '11111111111111111111111111111111';
const MEMBER_B = 'SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf';
const MEMBER_C = 'So11111111111111111111111111111111111111112';
const TREASURY = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const CREATOR = 'SysvarRent111111111111111111111111111111111';

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

/** Plan de creation 2 of 3, valide, construit par les etapes pures. */
const plan = buildMultisigCreationPlan(
  buildVaultCreationRequest(
    evaluateDraft({
      ...createEmptyDraft(),
      setupType: 'recommended',
      vaultName: 'Offline build test',
      members: [
        { label: 'Seeker', publicKey: MEMBER_A },
        { label: 'Ledger at home', publicKey: MEMBER_B },
        { label: 'Backup wallet', publicKey: MEMBER_C },
      ].map((member, index) =>
        createMember({ index, label: member.label, publicKey: member.publicKey }),
      ),
      threshold: 2,
    }),
  ),
);

check('plan d entree valide et pret pour l instruction', () => {
  assert.deepEqual(plan.validationErrors, []);
  assert.equal(plan.readyForInstructionBuild, true);
  assert.equal(plan.members.length, 3);
  assert.equal(plan.permissions, 7);
});

check('construction sans exception, createKey et PDA derives', () => {
  const result = buildMultisigCreationTransaction({
    plan,
    creator: CREATOR,
    treasury: TREASURY,
  });

  assert.equal(result.createKeyPublicKey, result.ephemeralCreateKey.publicKey.toString());
  assert.ok(new PublicKey(result.createKeyPublicKey).toBase58() === result.createKeyPublicKey);
  assert.notEqual(result.createKeyPublicKey, result.multisigPda);

  const [expectedMultisig] = multisig.getMultisigPda({
    createKey: new PublicKey(result.createKeyPublicKey),
  });
  assert.equal(result.multisigPda, expectedMultisig.toString());

  const [expectedProgramConfig] = multisig.getProgramConfigPda({});
  assert.equal(result.programConfigPda, expectedProgramConfig.toString());
});

check('transaction assemblee : 1 instruction, non signee, fee payer = creator', () => {
  const result = buildMultisigCreationTransaction({
    plan,
    creator: CREATOR,
    treasury: TREASURY,
  });

  assert.notEqual(result.transaction, null);
  const transaction = result.transaction;
  assert.ok(transaction !== null);
  assert.equal(result.instructionCount, 1);
  assert.equal(transaction.instructions.length, 1);
  assert.equal(
    transaction.instructions[0]?.programId.toString(),
    multisig.PROGRAM_ID.toString(),
  );
  assert.equal(transaction.feePayer?.toString(), new PublicKey(CREATOR).toString());
  assert.ok(transaction.signatures.every((entry) => entry.signature === null));
  assert.equal(result.readyForSimulation, true);
  assert.deepEqual(result.validationErrors, []);
});

check('treasury absent : aucune transaction factice, erreur explicite', () => {
  const result = buildMultisigCreationTransaction({
    plan,
    creator: CREATOR,
    treasury: null,
  });

  assert.equal(result.transaction, null);
  assert.equal(result.instructionCount, 0);
  assert.equal(result.readyForSimulation, false);
  assert.ok(result.validationErrors.some((error) => /MissingTreasury/.test(error)));
});

check('creator invalide : erreur explicite, aucune exception', () => {
  const result = buildMultisigCreationTransaction({
    plan,
    creator: 'not-a-public-key',
    treasury: TREASURY,
  });

  assert.equal(result.transaction, null);
  assert.equal(result.readyForSimulation, false);
  assert.ok(result.validationErrors.some((error) => /InvalidCreator/.test(error)));
});

check('trois constructions successives donnent des multisigPda distinctes', () => {
  const first = buildMultisigCreationTransaction({
    plan,
    creator: CREATOR,
    treasury: TREASURY,
  });
  const second = buildMultisigCreationTransaction({
    plan,
    creator: CREATOR,
    treasury: TREASURY,
  });

  assert.notEqual(first.createKeyPublicKey, second.createKeyPublicKey);
  assert.notEqual(first.multisigPda, second.multisigPda);
});

console.log(`\n${passed} test(s) OK`);
if (process.exitCode === 1) process.exit(1);