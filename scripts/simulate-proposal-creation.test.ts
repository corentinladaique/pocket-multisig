import assert from 'node:assert/strict';

import type { Connection } from '@solana/web3.js';

import { buildProposalCreation } from '../src/squads/buildProposalCreation';
import { runProposalCreationPreflight } from '../src/squads/proposalCreationPreflight';
import { simulateProposalCreation } from '../src/squads/simulateProposalCreation';
import { PublicKey } from '@solana/web3.js';
import * as multisig from '@sqds/multisig';

/**
 * Tests du module de simulation, SANS reseau.
 *
 * La connexion est un leurre qui leve des qu'on touche une de ses proprietes :
 * il prouve donc que les chemins de refus ne declenchent aucune I/O, et que le
 * reseau n'est atteint qu'apres avoir franchi toutes les portes.
 */

const MULTISIG = '11111111111111111111111111111111';
const CREATOR = 'SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf';
const DESTINATION = 'So11111111111111111111111111111111111111112';
const VAULT = multisig.getVaultPda({ index: 0, multisigPda: new PublicKey(MULTISIG) })[0]
  .toBase58();

const NETWORK_MARKER = 'NETWORK_ACCESS_BLOCKED';

const offlineConnection = new Proxy(
  {},
  {
    get() {
      throw new Error(NETWORK_MARKER);
    },
  },
) as unknown as Connection;

let passed = 0;

async function check(name: string, run: () => Promise<void>): Promise<void> {
  try {
    await run();
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

function validBuild() {
  return buildProposalCreation({
    creator: CREATOR,
    destination: DESTINATION,
    lamports: 1_000_000,
    memo: null,
    multisigPda: MULTISIG,
    transactionIndex: 4,
  });
}

function validPreflight() {
  const build = validBuild();
  return runProposalCreationPreflight({
    build,
    multisig: {
      members: [{ address: CREATOR, roles: ['Initiate', 'Vote', 'Execute'] }],
      transactionIndex: 4,
      vaultAddress: VAULT,
    },
    vault: { address: VAULT, lamports: 5_000_000_000 },
  });
}

async function main(): Promise<void> {
  await check('build refuse : refus local, aucun acces reseau', async () => {
    const build = buildProposalCreation({
      creator: CREATOR,
      destination: 'pas-une-adresse',
      lamports: 1_000_000,
      memo: null,
      multisigPda: MULTISIG,
      transactionIndex: 4,
    });
    const result = await simulateProposalCreation({
      build,
      connection: offlineConnection,
      preflight: validPreflight(),
    });
    assert.equal(result.readyToSign, false);
    assert.ok(result.errors.some((error) => /InvalidDestination/.test(error)));
    assert.ok(!result.errors.some((error) => error.includes(NETWORK_MARKER)));
  });

  await check('preflight refuse : refus local, aucun acces reseau', async () => {
    const build = validBuild();
    const preflight = runProposalCreationPreflight({
      build,
      multisig: {
        members: [{ address: CREATOR, roles: ['Vote'] }],
        transactionIndex: 4,
        vaultAddress: VAULT,
      },
      vault: { address: VAULT, lamports: 5_000_000_000 },
    });
    const result = await simulateProposalCreation({
      build,
      connection: offlineConnection,
      preflight,
    });
    assert.equal(result.readyToSign, false);
    assert.ok(result.errors.some((error) => /MissingInitiatePermission/.test(error)));
    assert.ok(!result.errors.some((error) => error.includes(NETWORK_MARKER)));
  });

  await check('build pret mais preflight non fourni : refus nomme', async () => {
    const result = await simulateProposalCreation({
      build: validBuild(),
      connection: offlineConnection,
      preflight: { errors: ['PreflightNotReady: forced'], readyForInstructionBuild: false, warnings: [] },
    });
    assert.equal(result.readyToSign, false);
    assert.ok(result.errors.some((error) => /PreflightNotReady/.test(error)));
    assert.ok(!result.errors.some((error) => error.includes(NETWORK_MARKER)));
  });

  await check('lot incomplet : refus nomme sans reseau', async () => {
    const build = validBuild();
    const result = await simulateProposalCreation({
      build: { ...build, instructions: [build.instructions[0]!] },
      connection: offlineConnection,
      preflight: validPreflight(),
    });
    assert.equal(result.readyToSign, false);
    assert.ok(result.errors.some((error) => /IncompleteInstructionBundle/.test(error)));
    assert.ok(!result.errors.some((error) => error.includes(NETWORK_MARKER)));
  });

  await check('echo absent : refus nomme sans reseau', async () => {
    const result = await simulateProposalCreation({
      build: { ...validBuild(), request: null },
      connection: offlineConnection,
      preflight: validPreflight(),
    });
    assert.equal(result.readyToSign, false);
    assert.ok(result.errors.some((error) => /MissingRequest/.test(error)));
    assert.ok(!result.errors.some((error) => error.includes(NETWORK_MARKER)));
  });

  await check('toutes les portes franchies : le reseau devient necessaire', async () => {
    const result = await simulateProposalCreation({
      build: validBuild(),
      connection: offlineConnection,
      preflight: validPreflight(),
    });
    assert.equal(result.readyToSign, false);
    assert.ok(
      result.errors.some((error) => error.includes(NETWORK_MARKER)),
      'une fois les portes franchies, la lecture du solde doit etre tentee',
    );
  });

  await check('avertissements permanents presents', async () => {
    const result = await simulateProposalCreation({
      build: buildProposalCreation({
        creator: CREATOR,
        destination: 'pas-une-adresse',
        lamports: 1_000_000,
        memo: null,
        multisigPda: MULTISIG,
        transactionIndex: 4,
      }),
      connection: offlineConnection,
      preflight: validPreflight(),
    });
    assert.ok(result.warnings.some((warning) => /nothing is sent/.test(warning)));
    assert.ok(result.warnings.some((warning) => /Two accounts are created/.test(warning)));
  });

  console.log(`\n${passed} test(s) OK`);
  if (process.exitCode === 1) process.exit(1);
}

void main();