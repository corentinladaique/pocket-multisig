import assert from 'node:assert/strict';

import {
  classifyOperationFailure,
  describeAttemptOutcome,
} from '../src/wallet/operationState';

/**
 * Tests PURS du verdict d'interface : aucun wallet, aucun reseau, aucune
 * signature. Execution : npx tsx scripts/attempt-outcome.test.ts
 *
 * Ils verrouillent la regle du hotfix : sans signature, jamais de libelle
 * "Sent", et le bouton "Prepare again" reste disponible.
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

/** Aucun libelle ne peut laisser croire qu'un envoi a eu lieu. */
function assertNeverClaimsSent(label: string): void {
  assert.ok(!/^sent\b/i.test(label), `libelle trompeur: ${label}`);
  assert.ok(!/sent,? but/i.test(label), `libelle trompeur: ${label}`);
  assert.ok(!/verification failed/i.test(label), `libelle trompeur: ${label}`);
}

check('signature nulle : "Nothing was sent", aucune mention d envoi', () => {
  const outcome = describeAttemptOutcome({ signature: null, verified: false });
  assert.equal(outcome.label, 'Nothing was sent.');
  assert.equal(outcome.sent, false);
  assertNeverClaimsSent(outcome.label);
});

check('signature nulle : nouvelle tentative autorisee, pas de relecture', () => {
  const outcome = describeAttemptOutcome({ signature: null, verified: false });
  assert.equal(outcome.allowNewAttempt, true);
  assert.equal(outcome.allowCheckAgain, false);
});

check('CancellationException : prepare again reactive', () => {
  const state = classifyOperationFailure({
    caught: new Error('java.util.concurrent.CancellationException'),
    step: 'signAndSendTransactions',
  });
  assert.equal(state, 'wallet-session-interrupted');
  const outcome = describeAttemptOutcome({ signature: null, verified: false });
  assert.equal(outcome.allowNewAttempt, true);
  assertNeverClaimsSent(outcome.label);
});

check('TimeoutException : prepare again reactive', () => {
  const state = classifyOperationFailure({
    caught: new Error('java.util.concurrent.TimeoutException: timed out waiting for response'),
    step: 'signAndSendTransactions',
  });
  assert.equal(state, 'send-failed-before-signature');
  const outcome = describeAttemptOutcome({ signature: null, verified: false });
  assert.equal(outcome.allowNewAttempt, true);
  assertNeverClaimsSent(outcome.label);
});

check('resultat sans signature ne desactive pas definitivement le CTA', () => {
  const outcome = describeAttemptOutcome({ confirmed: false, signature: null, verified: false });
  assert.equal(outcome.allowNewAttempt, true);
  assert.equal(outcome.tone, 'warning');
});

check('signature presente, confirmation en attente : jamais de nouveau prepare', () => {
  const outcome = describeAttemptOutcome({
    confirmed: false,
    signature: 'SIG',
    verified: false,
  });
  assert.equal(outcome.label, 'Transaction signed, confirmation pending.');
  assert.equal(outcome.sent, true);
  assert.equal(outcome.allowNewAttempt, false);
  assert.equal(outcome.allowCheckAgain, true);
});

check('signature presente + blockhash expire prouve : nouvelle tentative permise', () => {
  const outcome = describeAttemptOutcome({
    confirmed: false,
    evidence: { blockHeight: 101, lastValidBlockHeight: 100, status: 'notFound' },
    signature: 'SIG',
    verified: false,
  });
  assert.equal(outcome.allowNewAttempt, true);
  assert.equal(outcome.allowCheckAgain, true);
});

check('signature presente + transaction confirmee : aucun nouvel envoi', () => {
  const outcome = describeAttemptOutcome({
    confirmed: false,
    evidence: { blockHeight: 101, lastValidBlockHeight: 100, status: 'confirmed' },
    signature: 'SIG',
    verified: false,
  });
  assert.equal(outcome.allowNewAttempt, false);
});

check('confirme mais relecture manquante : libelle dedie', () => {
  const outcome = describeAttemptOutcome({ confirmed: true, signature: 'SIG', verified: false });
  assert.equal(outcome.label, 'Confirmed but read-back failed.');
  assert.equal(outcome.allowCheckAgain, true);
});

check('succes verifie : libelle inchange, aucun envoi supplementaire', () => {
  const outcome = describeAttemptOutcome({ confirmed: true, signature: 'SIG', verified: true });
  assert.equal(outcome.label, 'Operation confirmed and verified.');
  assert.equal(outcome.tone, 'success');
  assert.equal(outcome.allowNewAttempt, false);
  assert.equal(outcome.allowCheckAgain, false);
});

check('invariant global : aucune combinaison sans signature ne dit "Sent"', () => {
  for (const confirmed of [true, false]) {
    for (const verified of [true, false]) {
      if (verified) continue; // un succes exige une signature
      const outcome = describeAttemptOutcome({ confirmed, signature: null, verified });
      assertNeverClaimsSent(outcome.label);
      assert.equal(outcome.sent, false);
      assert.equal(outcome.allowNewAttempt, true);
    }
  }
});

console.log(`\n${passed} test(s) OK`);
if (process.exitCode === 1) process.exit(1);