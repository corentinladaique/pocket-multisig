import assert from 'node:assert/strict';

import { PublicKey } from '@solana/web3.js';
import * as multisig from '@sqds/multisig';

import {
  buildProposalCreation,
  type ProposalCreationBuildResult,
} from '../src/squads/buildProposalCreation';
import {
  runProposalCreationPreflight,
  type PreflightMultisigView,
} from '../src/squads/proposalCreationPreflight';

/**
 * Tests PURS du preflight de creation de proposition.
 *
 * Aucun RPC, aucune signature, aucun envoi, aucun ecran : les vues (multisig,
 * vault) sont fabriquees localement, comme si elles venaient d'etre lues.
 * Execution : npx tsx scripts/proposal-creation-preflight.test.ts
 */

const MULTISIG = '11111111111111111111111111111111';
const CREATOR = 'SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf';
const OTHER_MEMBER = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const DESTINATION = 'So11111111111111111111111111111111111111112';

const VAULT = multisig.getVaultPda({ index: 0, multisigPda: new PublicKey(MULTISIG) })[0]
  .toBase58();

let passed = 0;

function check(name: string, run: () => void): void {
  try {
    run();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (caught: unknown) {
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

function build(overrides: Partial<Parameters<typeof buildProposalCreation>[0]> = {}) {
  return buildProposalCreation({
    creator: CREATOR,
    destination: DESTINATION,
    lamports: 1_000_000,
    memo: null,
    multisigPda: MULTISIG,
    transactionIndex: 4,
    ...overrides,
  });
}

function view(overrides: Partial<PreflightMultisigView> = {}): PreflightMultisigView {
  return {
    members: [
      { address: CREATOR, roles: ['Initiate', 'Vote', 'Execute'] },
      { address: OTHER_MEMBER, roles: ['Vote'] },
    ],
    transactionIndex: 4,
    vaultAddress: VAULT,
    ...overrides,
  };
}

function run(
  buildResult: ProposalCreationBuildResult,
  multisigView: PreflightMultisigView = view(),
  lamports: number | null = 5_000_000_000,
) {
  return runProposalCreationPreflight({
    build: buildResult,
    multisig: multisigView,
    vault: { address: VAULT, lamports },
  });
}

check('cas nominal : preflight pret, aucune erreur', () => {
  const result = run(build());
  assert.deepEqual(result.errors, []);
  assert.equal(result.readyForInstructionBuild, true);
  assert.ok(result.warnings.some((warning) => /does not verify that the proposal account is still free/.test(warning)));
});

check('createur sans permission Initiate : refus nomme', () => {
  const result = run(build({ creator: OTHER_MEMBER }), view());
  assert.equal(result.readyForInstructionBuild, false);
  assert.ok(result.errors.some((error) => /MissingInitiatePermission/.test(error)));
});

check('createur non membre : refus nomme', () => {
  const outsider = '11111111111111111111111111111112';
  const result = run(build({ creator: outsider }));
  assert.ok(result.errors.some((error) => /CreatorNotAMember/.test(error)));
});

check('derive d index de transaction : refus nomme', () => {
  const result = run(build(), view({ transactionIndex: 5 }));
  assert.ok(result.errors.some((error) => /TransactionIndexDrift/.test(error)));
  assert.ok(result.errors.some((error) => /TransactionIndexMismatch/.test(error)));
});

check('vue multisig sans index exploitable : refus nomme', () => {
  const result = run(build(), view({ transactionIndex: -1 }));
  assert.ok(result.errors.some((error) => /InvalidViewTransactionIndex/.test(error)));
});

check('vault PDA incoherente : refus nomme', () => {
  const result = run(build(), view({ vaultAddress: DESTINATION }));
  assert.ok(result.errors.some((error) => /VaultPdaMismatch/.test(error)));
});

check('vue vault pour une autre adresse : refus nomme', () => {
  const result = runProposalCreationPreflight({
    build: build(),
    multisig: view(),
    vault: { address: DESTINATION, lamports: 5_000_000_000 },
  });
  assert.ok(result.errors.some((error) => /VaultViewMismatch/.test(error)));
});

check('solde du vault non lu : refus nomme', () => {
  const result = run(build(), view(), null);
  assert.ok(result.errors.some((error) => /VaultBalanceUnavailable/.test(error)));
});

check('montant superieur au solde : refus nomme', () => {
  const result = run(build({ lamports: 2_000_000 }), view(), 1_000_000);
  assert.ok(result.errors.some((error) => /InsufficientVaultBalance/.test(error)));
});

check('montant egal au solde : avertissement, pas une erreur', () => {
  const result = run(build({ lamports: 1_000_000 }), view(), 1_000_000);
  assert.deepEqual(result.errors, []);
  assert.equal(result.readyForInstructionBuild, true);
  assert.ok(result.warnings.some((warning) => /empty the vault completely/.test(warning)));
});

check('build refuse : erreurs reprises et resultat non pret', () => {
  const refused = build({ destination: 'pas-une-adresse' });
  const result = run(refused);
  assert.equal(result.readyForInstructionBuild, false);
  assert.ok(result.errors.some((error) => /InvalidDestination/.test(error)));
});

check('lot d instructions incomplet : refus nomme', () => {
  const incomplete = { ...build(), instructions: [build().instructions[0]] } as ProposalCreationBuildResult;
  const result = run(incomplete);
  assert.ok(result.errors.some((error) => /IncompleteInstructionBundle/.test(error)));
});

check('PDA de transaction incoherente : refus nomme', () => {
  const tampered = { ...build(), transactionPda: DESTINATION } as ProposalCreationBuildResult;
  const result = run(tampered);
  assert.ok(result.errors.some((error) => /TransactionPdaMismatch/.test(error)));
});

check('echo absent : refus nomme', () => {
  const tampered = { ...build(), request: null } as ProposalCreationBuildResult;
  const result = run(tampered);
  assert.ok(result.errors.some((error) => /MissingRequest/.test(error)));
});

console.log(`\n${passed} test(s) OK`);
if (process.exitCode === 1) process.exit(1);