import assert from 'node:assert/strict';

import { PublicKey, type Connection } from '@solana/web3.js';
import * as multisig from '@sqds/multisig';

import { buildProposalCreation } from '../src/squads/buildProposalCreation';
import { runProposalCreationPreflight } from '../src/squads/proposalCreationPreflight';
import { signAndSendProposalCreation } from '../src/squads/signAndSendProposalCreation';
import type { ProposalCreationSimulationResult } from '../src/squads/simulateProposalCreation';

/**
 * Tests des PORTES du module d'envoi, sans reseau et sans wallet.
 *
 * La connexion est un leurre qui leve `NETWORK_ACCESS_BLOCKED` des qu'une
 * propriete est lue, et `signAndSendTransactions` un leurre qui leve
 * `WALLET_ACCESS_BLOCKED` : les cas de refus ne doivent toucher NI l'un NI
 * l'autre, ce qui est prouve plutot qu'affirme.
 */

const MULTISIG = '11111111111111111111111111111111';
const CREATOR = 'SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf';
const DESTINATION = 'So11111111111111111111111111111111111111112';
const VAULT = multisig.getVaultPda({ index: 0, multisigPda: new PublicKey(MULTISIG) })[0]
  .toBase58();

const NETWORK_MARKER = 'NETWORK_ACCESS_BLOCKED';
const WALLET_MARKER = 'WALLET_ACCESS_BLOCKED';

const offlineConnection = new Proxy(
  {},
  {
    get() {
      throw new Error(NETWORK_MARKER);
    },
  },
) as unknown as Connection;

const offlineSend = async () => {
  throw new Error(WALLET_MARKER);
};

let passed = 0;

async function check(name: string, run: () => void | Promise<void>): Promise<void> {
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
  return runProposalCreationPreflight({
    build: validBuild(),
    multisig: {
      members: [{ address: CREATOR, roles: ['Initiate', 'Vote', 'Execute'] }],
      transactionIndex: 4,
      vaultAddress: VAULT,
    },
    vault: { address: VAULT, lamports: 5_000_000_000 },
  });
}

function readySimulation(): ProposalCreationSimulationResult {
  return {
    err: null,
    errors: [],
    estimatedCreatorBalanceDelta: -2_000_000,
    logs: [],
    proposalPda: validBuild().proposalPda,
    readyToSign: true,
    transactionPda: validBuild().transactionPda,
    unitsConsumed: 40_000,
    warnings: [],
  };
}

async function main(): Promise<void> {
  await check('simulation absente ou refusee : aucun envoi, aucun acces wallet', async () => {
    const result = await signAndSendProposalCreation({
      build: validBuild(),
      connection: offlineConnection,
      preflight: validPreflight(),
      signAndSendTransactions: offlineSend,
      simulation: { ...readySimulation(), readyToSign: false },
    });
    assert.equal(result.verified, false);
    assert.ok(result.validationErrors.some((error) => /SimulationNotReady/.test(error)));
    assert.ok(!result.validationErrors.some((error) => error.includes(WALLET_MARKER)));
    assert.ok(!result.validationErrors.some((error) => error.includes(NETWORK_MARKER)));
  });

  await check('preflight refuse : refus local sans reseau ni wallet', async () => {
    const result = await signAndSendProposalCreation({
      build: validBuild(),
      connection: offlineConnection,
      preflight: { errors: ['PreflightNotReady: forced'], readyForInstructionBuild: false, warnings: [] },
      signAndSendTransactions: offlineSend,
      simulation: readySimulation(),
    });
    assert.equal(result.verified, false);
    assert.ok(result.validationErrors.some((error) => /PreflightNotReady/.test(error)));
    assert.ok(!result.validationErrors.some((error) => error.includes(WALLET_MARKER)));
  });

  await check('build non pret : refus local', async () => {
    const build = validBuild();
    const result = await signAndSendProposalCreation({
      build: { ...build, readyForBuild: false, instructions: [] },
      connection: offlineConnection,
      preflight: validPreflight(),
      signAndSendTransactions: offlineSend,
      simulation: readySimulation(),
    });
    assert.equal(result.verified, false);
    assert.ok(result.validationErrors.some((error) => /BuilderNotReady/.test(error)));
    assert.ok(result.validationErrors.some((error) => /IncompleteInstructionBundle/.test(error)));
    assert.equal(result.signature, null);
  });

  await check('toutes les portes franchies : le blockhash frais est demande au reseau', async () => {
    const result = await signAndSendProposalCreation({
      build: validBuild(),
      connection: offlineConnection,
      preflight: validPreflight(),
      signAndSendTransactions: offlineSend,
      simulation: readySimulation(),
    });
    assert.equal(result.signature, null);
    assert.ok(
      result.validationErrors.some((error) => /BlockhashUnavailable/.test(error)),
      'un blockhash explicite doit etre demande avant tout envoi',
    );
    assert.ok(
      !result.validationErrors.some((error) => error.includes(WALLET_MARKER)),
      'aucun appel wallet ne doit avoir lieu si le blockhash echoue',
    );
  });

  await check('blockhash fourni mais slot indisponible : le wallet n est pas appele', async () => {
    const result = await signAndSendProposalCreation({
      blockhash: { blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 1 },
      build: validBuild(),
      connection: offlineConnection,
      preflight: validPreflight(),
      signAndSendTransactions: offlineSend,
      simulation: readySimulation(),
    });
    assert.equal(result.signature, null);
    assert.ok(result.validationErrors.some((error) => /SlotUnavailable/.test(error)));
    assert.ok(
      !result.validationErrors.some((error) => error.includes(WALLET_MARKER)),
      'aucun appel wallet ne doit avoir lieu si le slot echoue',
    );
  });

  await check('slot lisible : le wallet est appele une fois, avec le blockhash fourni', async () => {
    const calls: { blockhash: string | undefined; minContextSlot: number }[] = [];
    const stubConnection = {
      getAccountInfo: async () => null,
      // La fenetre de signature lit desormais la hauteur de bloc AVANT
      // d'ouvrir le wallet : le stub doit donc la fournir.
      getBlockHeight: async () => 42,
      getSlot: async () => 42,
    } as unknown as Connection;
    const recordingSend = async (transaction: unknown, minContextSlot: number) => {
      calls.push({
        blockhash: (transaction as { recentBlockhash?: string }).recentBlockhash,
        minContextSlot,
      });
      throw new Error(WALLET_MARKER);
    };

    const result = await signAndSendProposalCreation({
      blockhash: { blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 1000 },
      build: validBuild(),
      connection: stubConnection,
      preflight: validPreflight(),
      signAndSendTransactions: recordingSend,
      simulation: readySimulation(),
    });

    assert.equal(calls.length, 1, 'le wallet doit etre appele exactement une fois');
    assert.equal(calls[0]?.minContextSlot, 42);
    assert.equal(calls[0]?.blockhash, '11111111111111111111111111111111');
    assert.equal(result.signature, null);
    assert.ok(result.validationErrors.some((error) => error.includes(WALLET_MARKER)));
    assert.ok(result.errorMessage !== null);
    assert.equal(result.readBack, null);
  });

  await check('fenetre de signature insuffisante : le wallet n est jamais ouvert', async () => {
    let walletCalls = 0;
    const stubConnection = {
      getAccountInfo: async () => null,
      // Hauteur 42 : le blockhash fourni (limite 1) est deja expire.
      getBlockHeight: async () => 42,
      getSlot: async () => 42,
    } as unknown as Connection;
    const countingSend = async () => {
      walletCalls += 1;
      throw new Error(WALLET_MARKER);
    };

    const result = await signAndSendProposalCreation({
      blockhash: { blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 1 },
      build: validBuild(),
      connection: stubConnection,
      preflight: validPreflight(),
      signAndSendTransactions: countingSend,
      simulation: readySimulation(),
    });

    assert.equal(walletCalls, 0, 'aucune ouverture de wallet sans marge suffisante');
    assert.equal(result.signature, null);
    assert.equal(result.signingState, 'signature-request-expired');
    assert.ok(result.validationErrors.some((error) => /SignatureWindowNotUsable/.test(error)));
    assert.equal(result.lastValidBlockHeight, 1);
  });

  console.log(`\n${passed} test(s) OK`);
}

void main().then(() => {
  if (process.exitCode === 1) process.exit(1);
});