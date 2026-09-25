import assert from 'node:assert/strict';

import {
  actionsForState,
  buildOperationReport,
  classifyOperationFailure,
  classifyOperationResult,
  evaluateSignatureEvidence,
  OPERATION_STATES,
} from '../src/wallet/operationState';

/**
 * Tests PURS de la machine d'etat : aucun wallet, aucun reseau, aucune
 * signature, aucun envoi. Execution : npx tsx scripts/operation-state.test.ts
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

const NO_PROOF = { confirmed: false, readBackVerified: false, signatureObtained: false };

check('huit etats declares, tous distincts', () => {
  assert.equal(OPERATION_STATES.length, 8);
  assert.equal(new Set(OPERATION_STATES).size, 8);
});

check('CancellationException = interruption de session, jamais un succes', () => {
  const state = classifyOperationFailure({
    caught: new Error('java.util.concurrent.CancellationException'),
    step: 'signAndSendTransactions',
  });
  assert.equal(state, 'wallet-session-interrupted');
  const report = buildOperationReport({ caught: new Error('x'), state });
  assert.ok(/never as a success/.test(report.title));
});

check('refus utilisateur pendant authorize = authorization cancelled', () => {
  assert.equal(
    classifyOperationFailure({ caught: new Error('User rejected the request'), step: 'authorize' }),
    'authorization-cancelled',
  );
});

check('mauvais reseau : detecte par message ou par contexte', () => {
  assert.equal(
    classifyOperationFailure({ caught: new Error('network mismatch'), step: 'signAndSendTransactions' }),
    'network-mismatch',
  );
  assert.equal(
    classifyOperationFailure({
      caught: new Error('something else'),
      networkMismatch: true,
      step: 'signAndSendTransactions',
    }),
    'network-mismatch',
  );
});

check('blockhash inutilisable avant signature', () => {
  assert.equal(
    classifyOperationFailure({ caught: new Error('BlockhashNotFound'), step: 'signAndSendTransactions' }),
    'blockhash-expired-before-signing',
  );
  assert.equal(
    classifyOperationFailure({ caught: new Error('Blockhash expired'), step: 'signAndSendTransactions' }),
    'blockhash-expired-before-signing',
  );
});

check('tout le reste : echec d envoi sans signature', () => {
  assert.equal(
    classifyOperationFailure({ caught: new Error('boom'), step: 'signAndSendTransactions' }),
    'send-failed-before-signature',
  );
});

check('resultat : aucun succes sans les trois preuves', () => {
  assert.equal(classifyOperationResult(NO_PROOF), 'send-failed-before-signature');
  assert.equal(
    classifyOperationResult({ ...NO_PROOF, signatureObtained: true }),
    'signature-obtained-confirmation-pending',
  );
  assert.equal(
    classifyOperationResult({ ...NO_PROOF, confirmed: true, signatureObtained: true }),
    'transaction-confirmed-readback-failed',
  );
  assert.equal(
    classifyOperationResult({ confirmed: true, readBackVerified: true, signatureObtained: true }),
    'operation-created-and-verified',
  );
});

check('etat post-signature sans signature prouvee : retombe sur un echec d envoi', () => {
  const actions = actionsForState('operation-created-and-verified', NO_PROOF);
  assert.equal(actions.keepDraft, true);
  assert.equal(actions.allowPrepareAndRetry, true);
  assert.equal(actions.allowSecondSend, false);
});

check('signature obtenue : second envoi interdit, relecture autorisee seulement', () => {
  const actions = actionsForState('signature-obtained-confirmation-pending', {
    confirmed: false,
    readBackVerified: false,
    signatureObtained: true,
  });
  assert.equal(actions.allowSecondSend, false);
  assert.equal(actions.allowCheckAgain, true);
  assert.equal(actions.allowPrepareAndRetry, false);
  assert.equal(actions.rearmAttemptLock, false);
  assert.equal(actions.keepDraft, true);
});

check('succes verifie : le brouillon peut etre libere, jamais de second envoi', () => {
  const actions = actionsForState('operation-created-and-verified', {
    confirmed: true,
    readBackVerified: true,
    signatureObtained: true,
  });
  assert.equal(actions.keepDraft, false);
  assert.equal(actions.allowSecondSend, false);
});

check('echec sans signature : brouillon conserve et verrou rearme', () => {
  for (const state of [
    'authorization-cancelled',
    'wallet-session-interrupted',
    'network-mismatch',
    'blockhash-expired-before-signing',
    'send-failed-before-signature',
  ] as const) {
    const actions = actionsForState(state, NO_PROOF);
    assert.equal(actions.keepDraft, true, `${state} doit conserver le brouillon`);
    assert.equal(actions.rearmAttemptLock, true, `${state} doit rearmer le verrou`);
    assert.equal(actions.allowPrepareAndRetry, true, `${state} doit autoriser une nouvelle tentative`);
    assert.equal(actions.allowSecondSend, false, `${state} ne doit jamais autoriser un second envoi direct`);
  }
});

check('preuve de signature : retry interdit tant que la transaction peut aboutir', () => {
  assert.equal(
    evaluateSignatureEvidence({ blockHeight: 10, lastValidBlockHeight: 100, status: 'confirmed' })
      .retryAllowed,
    false,
  );
  assert.equal(
    evaluateSignatureEvidence({ blockHeight: 10, lastValidBlockHeight: 100, status: 'pending' })
      .retryAllowed,
    false,
  );
  assert.equal(
    evaluateSignatureEvidence({ blockHeight: 10, lastValidBlockHeight: 100, status: 'failed' })
      .retryAllowed,
    true,
  );
  assert.equal(
    evaluateSignatureEvidence({ blockHeight: 101, lastValidBlockHeight: 100, status: 'notFound' })
      .retryAllowed,
    true,
  );
  assert.equal(
    evaluateSignatureEvidence({ blockHeight: 10, lastValidBlockHeight: 100, status: 'notFound' })
      .retryAllowed,
    false,
  );
});

check('preuve de signature : hauteur inconnue = pas de retry', () => {
  const verdict = evaluateSignatureEvidence({
    blockHeight: null,
    lastValidBlockHeight: null,
    status: 'notFound',
  });
  assert.equal(verdict.retryAllowed, false);
  assert.ok(/may still land/.test(verdict.reason));
});

check('le rapport conserve le diagnostic MWA d origine', () => {
  const caught = Object.assign(new Error('authorization request failed'), { code: 4001 });
  const report = buildOperationReport({ caught, state: 'send-failed-before-signature', step: 'signAndSendTransactions' });
  assert.ok(report.mwa !== null);
  assert.equal(report.mwa?.code, '4001');
  assert.equal(report.mwa?.message, 'authorization request failed');
  assert.equal(report.mwa?.step, 'signAndSendTransactions');
});

console.log(`\n${passed} test(s) OK`);
if (process.exitCode === 1) process.exit(1);