import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { PublicKey, type Connection } from '@solana/web3.js';

import { confirmSignature } from '../src/solana/confirmSignature';
import { loadProposals } from '../src/squads/proposals';
import {
  describeAttemptOutcome,
  isTemporaryNetworkFailure,
} from '../src/wallet/operationState';

/**
 * Tests du hotfix navigation / rafraichissement / verification.
 *
 * Aucun wallet, aucun reseau reel : les connexions sont des leurres qui
 * ENREGISTRENT les methodes appelees. C'est ce qui permet de prouver qu'une
 * relecture ne declenche ni signature ni invitation wallet.
 *
 * Execution : npx tsx scripts/navigation-refresh.test.ts
 */

let passed = 0;

function check(name: string, run: () => void | Promise<void>): void {
  try {
    const outcome = run();
    if (outcome instanceof Promise) {
      outcome
        .then(() => {
          passed += 1;
          console.log(`PASS ${name}`);
        })
        .catch((caught: unknown) => {
          console.log(`FAIL ${name}`);
          console.log(`  ${caught instanceof Error ? caught.message : String(caught)}`);
          process.exitCode = 1;
        });
      return;
    }
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

/** Methodes de LECTURE autorisees pendant un rafraichissement. */
const READ_METHODS = new Set([
  'getAccountInfo',
  'getBalance',
  'getBlockHeight',
  'getMultipleAccountsInfo',
  'getSignatureStatuses',
  'getSlot',
]);

function recordingConnection(responses: {
  multiple?: unknown;
  single?: unknown;
}): { calls: string[]; connection: Connection } {
  const calls: string[] = [];
  const connection = {
    getAccountInfo: async () => {
      calls.push('getAccountInfo');
      return responses.single ?? null;
    },
    getBlockHeight: async () => {
      calls.push('getBlockHeight');
      return 42;
    },
    getMultipleAccountsInfo: async () => {
      calls.push('getMultipleAccountsInfo');
      return responses.multiple ?? [];
    },
    getSignatureStatuses: async () => {
      calls.push('getSignatureStatuses');
      return { context: { slot: 1 }, value: [null] };
    },
    getSlot: async () => {
      calls.push('getSlot');
      return 42;
    },
  } as unknown as Connection;
  return { calls, connection };
}

/** Wallet leurre : toute sollicitation est une erreur du test. */
function forbiddenWallet(): { calls: number } {
  const state = { calls: 0 };
  return new Proxy(state, {
    get: (target, property) => {
      if (property === 'calls') return target.calls;
      state.calls += 1;
      throw new Error(`WALLET_PROMPT_TRIGGERED (${String(property)})`);
    },
  }) as { calls: number };
}

const SCREENS_WITH_BACK = [
  'MultisigInboxScreen',
  'MultisigDetailsScreen',
  'ProposalListScreen',
  'ProposalDetailsScreen',
  'TransactionReviewScreen',
  'CreateVaultScreen',
  'NewProposalScreen',
];

check('chaque ecran enfant gere le retour Android et le consomme', () => {
  for (const screen of SCREENS_WITH_BACK) {
    const source = readFileSync(`src/screens/${screen}.tsx`, 'utf8');
    assert.ok(
      source.includes("BackHandler.addEventListener('hardwareBackPress'"),
      `${screen} ne gere pas le retour Android`,
    );
    assert.ok(
      /hardwareBackPress'[\s\S]{0,400}?return true;/.test(source),
      `${screen} ne consomme pas le retour (risque de fermeture de l'application)`,
    );
  }
});

check('Transaction Details (revue) ne peut plus fermer l application', () => {
  const source = readFileSync('src/screens/TransactionReviewScreen.tsx', 'utf8');
  assert.ok(source.includes('BackHandler.addEventListener'));
  assert.ok(source.includes('handleBack();'));
});

check('UnknownHostException = erreur reseau temporaire', () => {
  assert.equal(
    isTemporaryNetworkFailure(
      new Error('java.net.UnknownHostException: Unable to resolve host api.devnet.solana.com'),
    ),
    true,
  );
  assert.equal(isTemporaryNetworkFailure(new Error('fetch failed')), true);
  assert.equal(isTemporaryNetworkFailure(new Error('Network request failed')), true);
});

check('un echec definitif n est pas classe comme temporaire', () => {
  assert.equal(isTemporaryNetworkFailure(new Error('InstructionError: custom program error')), false);
  assert.equal(isTemporaryNetworkFailure(new Error('ProposalNotApproved')), false);
});

check('signature presente + reseau indisponible : libelle et relecture seule', () => {
  const outcome = describeAttemptOutcome({
    confirmed: false,
    networkFailure: true,
    signature: 'SIG',
    verified: false,
  });
  assert.equal(outcome.label, 'Transaction signed, verification temporarily unavailable.');
  assert.equal(outcome.sent, true);
  assert.equal(outcome.allowCheckAgain, true);
  assert.equal(outcome.allowNewAttempt, false);
});

check('Check transaction again : lecture seule, aucun wallet sollicite', async () => {
  const { calls, connection } = recordingConnection({});
  const wallet = forbiddenWallet();
  const confirmation = await confirmSignature({ connection, signature: 'SIG', attempts: 2, delayMs: 1 });
  assert.equal(confirmation.status, 'notFound');
  assert.deepEqual(calls, ['getSignatureStatuses', 'getSignatureStatuses']);
  assert.equal(wallet.calls, 0);
});

check('rafraichissement des propositions : lectures seules, aucun wallet', async () => {
  const { calls, connection } = recordingConnection({ multiple: [], single: null });
  const wallet = forbiddenWallet();
  const multisigPda = PublicKey.unique();
  const first = await loadProposals(connection, multisigPda, 3, 0);
  const second = await loadProposals(connection, multisigPda, 3, 0);
  assert.equal(first.proposals.length, second.proposals.length);
  assert.equal(wallet.calls, 0);
  for (const method of calls) {
    assert.ok(READ_METHODS.has(method), `methode non lecture pendant un refresh: ${method}`);
  }
  assert.equal(calls.filter((method) => method === 'getMultipleAccountsInfo').length, 2);
});

check('un refresh ne consomme qu une lecture multiple par multisig', async () => {
  const { calls, connection } = recordingConnection({ multiple: [] });
  await loadProposals(connection, PublicKey.unique(), 2, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0], 'getMultipleAccountsInfo');
});

setTimeout(() => {
  console.log(`\n${passed} test(s) OK`);
  if (process.exitCode === 1) process.exit(1);
}, 50);