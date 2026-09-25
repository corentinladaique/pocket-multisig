import assert from 'node:assert/strict';

import {
  blockhashBundleFromTransaction,
  DEFAULT_BLOCK_MARGIN,
  evaluateSigningWindow,
  SIGNING_STATES,
  signingStateFromEvidence,
  signingStateFromConfirmation,
  signingStateTitle,
} from '../src/wallet/signingWindow';

/**
 * Tests PURS de la fenetre de signature : aucun reseau, aucun chronometre,
 * aucune signature. Execution : npx tsx scripts/signing-window.test.ts
 */

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

const BUNDLE = { blockhash: 'abc', lastValidBlockHeight: 1000 };

check('marge suffisante : fenetre utilisable', () => {
  const verdict = evaluateSigningWindow({ blockHeight: 900, bundle: BUNDLE });
  assert.equal(verdict.usable, true);
  assert.equal(verdict.expired, false);
  assert.equal(verdict.remainingBlocks, 100);
});

check('marge insuffisante : wallet jamais ouvert', () => {
  const verdict = evaluateSigningWindow({
    blockHeight: BUNDLE.lastValidBlockHeight - (DEFAULT_BLOCK_MARGIN - 1),
    bundle: BUNDLE,
  });
  assert.equal(verdict.usable, false);
  assert.equal(verdict.expired, false);
  assert.ok(/safety margin/.test(verdict.reason));
});

check('hauteur exactement a la limite : encore utilisable', () => {
  const verdict = evaluateSigningWindow({
    blockHeight: BUNDLE.lastValidBlockHeight - DEFAULT_BLOCK_MARGIN,
    bundle: BUNDLE,
  });
  assert.equal(verdict.usable, true);
});

check('blockhash deja expire : signale comme tel', () => {
  const verdict = evaluateSigningWindow({ blockHeight: 1005, bundle: BUNDLE });
  assert.equal(verdict.expired, true);
  assert.equal(verdict.usable, false);
  assert.equal(verdict.remainingBlocks, -5);
  assert.ok(/expired 5 block/.test(verdict.reason));
});

check('hauteur illisible : refus explicite, jamais un feu vert', () => {
  const verdict = evaluateSigningWindow({ blockHeight: null, bundle: BUNDLE });
  assert.equal(verdict.usable, false);
  assert.equal(verdict.remainingBlocks, null);
  assert.ok(/cannot be proven usable/.test(verdict.reason));
});

check('marge configurable et prise en compte', () => {
  assert.equal(
    evaluateSigningWindow({ blockHeight: 995, bundle: BUNDLE, marginBlocks: 2 }).usable,
    true,
  );
  assert.equal(
    evaluateSigningWindow({ blockHeight: 995, bundle: BUNDLE, marginBlocks: 20 }).usable,
    false,
  );
});

check('paire blockhash / lastValidBlockHeight : complete ou rien', () => {
  assert.deepEqual(
    blockhashBundleFromTransaction({ lastValidBlockHeight: 10, recentBlockhash: 'xyz' }),
    { blockhash: 'xyz', lastValidBlockHeight: 10 },
  );
  assert.equal(blockhashBundleFromTransaction({ recentBlockhash: 'xyz' }), null);
  assert.equal(blockhashBundleFromTransaction({ lastValidBlockHeight: 10 }), null);
  assert.equal(blockhashBundleFromTransaction({}), null);
});

check('sept etats affichables, chacun avec un titre', () => {
  assert.equal(SIGNING_STATES.length, 7);
  for (const state of SIGNING_STATES) {
    assert.ok(signingStateTitle(state).length > 0, `titre manquant pour ${state}`);
  }
});

check('etats issus des preuves : aucun etat avance sans preuve', () => {
  assert.equal(
    signingStateFromEvidence({ confirmed: false, readBackVerified: false, signatureObtained: false }),
    'signature-request-expired',
  );
  assert.equal(
    signingStateFromEvidence({ confirmed: false, readBackVerified: false, signatureObtained: true }),
    'transaction-signed-confirmation-pending',
  );
  assert.equal(
    signingStateFromEvidence({ confirmed: true, readBackVerified: false, signatureObtained: true }),
    'confirmed-but-readback-failed',
  );
  assert.equal(
    signingStateFromEvidence({ confirmed: true, readBackVerified: true, signatureObtained: true }),
    'confirmed',
  );
});

check('etats issus d une confirmation on-chain', () => {
  assert.equal(signingStateFromConfirmation('confirmed', true), 'confirmed');
  assert.equal(signingStateFromConfirmation('confirmed', false), 'confirmed-but-readback-failed');
  assert.equal(signingStateFromConfirmation('pending', false), 'transaction-signed-confirmation-pending');
  assert.equal(signingStateFromConfirmation('notFound', false), 'signature-request-expired');
});

console.log(`\n${passed} test(s) OK`);
if (process.exitCode === 1) process.exit(1);