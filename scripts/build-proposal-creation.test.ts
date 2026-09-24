import assert from 'node:assert/strict';

import { PublicKey, SystemProgram } from '@solana/web3.js';
import * as multisig from '@sqds/multisig';

import { buildProposalCreation } from '../src/squads/buildProposalCreation';

/**
 * Tests PURS du builder de proposition.
 *
 * Aucun RPC, aucune signature, aucun envoi, aucun ecran : uniquement des
 * adresses publiques et des derivations locales du SDK. Execution :
 * npx tsx scripts/build-proposal-creation.test.ts
 */

const MULTISIG = '11111111111111111111111111111111';
const CREATOR = 'SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf';
const DESTINATION = 'So11111111111111111111111111111111111111112';

let passed = 0;

function check(name: string, run: () => void): void {
  try {
    run();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (caught: unknown) {
    // Tout passe par stdout : evite l'entrelacement stdout/stderr qui rend les
    // rapports de test illisibles.
    console.log(`FAIL ${name}`);
    const detail = caught instanceof Error ? caught.stack ?? caught.message : String(caught);
    console.log(
      detail
        .split('\n')
        .filter((line) => !line.includes('node:internal'))
        .slice(0, 4)
        .join('\n'),
    );
    process.exitCode = 1;
  }
}

function validInput() {
  return {
    creator: CREATOR,
    destination: DESTINATION,
    lamports: 1_000_000,
    memo: 'Test transfer',
    multisigPda: MULTISIG,
    transactionIndex: 4,
  };
}

check('entree valide : pret, index suivant, deux instructions', () => {
  const result = buildProposalCreation(validInput());
  assert.deepEqual(result.errors, []);
  assert.equal(result.readyForBuild, true);
  assert.equal(result.transactionIndexNext, 5);
  assert.equal(result.instructions.length, 2);
  for (const instruction of result.instructions) {
    assert.equal(instruction.programId.toString(), multisig.PROGRAM_ID.toString());
  }
});

check('PDA identiques aux derivations officielles du SDK', () => {
  const result = buildProposalCreation(validInput());
  const multisigPda = new PublicKey(MULTISIG);
  const [vaultPda] = multisig.getVaultPda({ index: 0, multisigPda });
  const [transactionPda] = multisig.getTransactionPda({
    index: BigInt(5),
    multisigPda,
  });
  const [proposalPda] = multisig.getProposalPda({
    multisigPda,
    transactionIndex: BigInt(5),
  });
  assert.equal(result.vaultPda, vaultPda.toBase58());
  assert.equal(result.transactionPda, transactionPda.toBase58());
  assert.equal(result.proposalPda, proposalPda.toBase58());
});

check('le message embarque le vault, la destination et le montant', () => {
  const result = buildProposalCreation(validInput());
  assert.ok(result.vaultPda !== null);
  const [vaultTransactionCreate] = result.instructions;
  assert.ok(vaultTransactionCreate !== undefined);

  // Les comptes de l'instruction de creation : multisig, transaction, creator,
  // system program. Le vault et la destination vivent DANS le message
  // serialise (donnees de l'instruction), pas dans les cles.
  const keys = vaultTransactionCreate.keys.map((meta) => meta.pubkey.toBase58());
  assert.ok(keys.includes(MULTISIG));
  assert.ok(keys.includes(CREATOR));
  assert.ok(keys.includes(SystemProgram.programId.toBase58()));

  const data = Buffer.from(vaultTransactionCreate.data);
  assert.ok(data.includes(new PublicKey(result.vaultPda).toBuffer()), 'vault absent du message');
  assert.ok(
    data.includes(new PublicKey(DESTINATION).toBuffer()),
    'destination absente du message',
  );
  const amount = Buffer.alloc(8);
  amount.writeBigUInt64LE(BigInt(1_000_000));
  assert.ok(data.includes(amount), 'montant absent du message');
});

check('adresse de destination invalide : refus, aucune instruction', () => {
  const result = buildProposalCreation({ ...validInput(), destination: 'pas-une-adresse' });
  assert.equal(result.readyForBuild, false);
  assert.equal(result.instructions.length, 0);
  assert.equal(result.transactionIndexNext, null);
  assert.ok(result.errors.some((error) => /InvalidDestination/.test(error)));
});

check('multisig ou creator invalide : refus nomme', () => {
  const badMultisig = buildProposalCreation({ ...validInput(), multisigPda: 'x' });
  assert.ok(badMultisig.errors.some((error) => /InvalidMultisigPda/.test(error)));
  const badCreator = buildProposalCreation({ ...validInput(), creator: '' });
  assert.ok(badCreator.errors.some((error) => /InvalidCreator/.test(error)));
});

check('montant invalide : refus nomme', () => {
  for (const lamports of [0, -1, 1.5]) {
    const result = buildProposalCreation({ ...validInput(), lamports });
    assert.ok(
      result.errors.some((error) => /InvalidLamports/.test(error)),
      `lamports ${lamports} devrait etre refuse`,
    );
  }
});

check('index de transaction invalide : refus nomme', () => {
  for (const transactionIndex of [-1, 1.5]) {
    const result = buildProposalCreation({ ...validInput(), transactionIndex });
    assert.ok(
      result.errors.some((error) => /InvalidTransactionIndex/.test(error)),
      `index ${transactionIndex} devrait etre refuse`,
    );
  }
});

check('memo : nettoye, et signale quand il est trop long', () => {
  const trimmed = buildProposalCreation({ ...validInput(), memo: '  hello  ' });
  assert.equal(trimmed.errors.length, 0);

  const long = buildProposalCreation({ ...validInput(), memo: 'x'.repeat(201) });
  assert.ok(long.warnings.some((warning) => /Memo is 201 characters long/.test(warning)));

  const none = buildProposalCreation({ ...validInput(), memo: null });
  assert.equal(none.errors.length, 0);
  assert.equal(none.instructions.length, 2);
});

check('avertissements permanents presents sur un build pret', () => {
  const result = buildProposalCreation(validInput());
  assert.ok(
    result.warnings.some((warning) => /rent is paid by the creator/.test(warning)),
  );
  assert.ok(
    result.warnings.some((warning) => /enforced when the transaction is executed/.test(warning)),
  );
});

console.log(`\n${passed} test(s) OK`);
if (process.exitCode === 1) process.exit(1);