import assert from 'node:assert/strict';

import {
  describeMwaError,
  describeWalletIdentity,
  formatMwaError,
  MWA_STEPS,
} from '../src/wallet/mwaDiagnostics';

/**
 * Tests PURS des diagnostics MWA : aucun wallet, aucun réseau, aucune
 * signature. Execution : npx tsx scripts/mwa-diagnostics.test.ts
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

class FakeProtocolError extends Error {
  code: number;
  data: unknown;

  constructor(message: string, code: number, data: unknown = undefined) {
    super(message);
    this.name = 'SolanaMobileWalletAdapterProtocolError';
    this.code = code;
    this.data = data;
  }
}

check('erreur protocole : code, nom, message et donnees conserves', () => {
  const report = describeMwaError(
    new FakeProtocolError('authorization request failed', 4001, { reason: 'rejected' }),
    'authorize',
  );
  assert.equal(report.step, 'authorize');
  assert.equal(report.code, '4001');
  assert.equal(report.name, 'SolanaMobileWalletAdapterProtocolError');
  assert.equal(report.message, 'authorization request failed');
  assert.ok(report.data !== null && report.data.includes('rejected'));
  assert.ok(/protocol-level error code/.test(report.hint));
  assert.ok(/no signature was requested/.test(report.hint));
});

check('erreur sans code : conclu cote wallet ou transport', () => {
  const report = describeMwaError(new Error('authorization request failed'), 'authorize');
  assert.equal(report.code, null);
  assert.equal(report.message, 'authorization request failed');
  assert.ok(/wallet application or the MWA transport/.test(report.hint));
});

check('erreur chaine brute : message repris tel quel', () => {
  const report = describeMwaError('boom', 'unknown');
  assert.equal(report.message, 'boom');
  assert.equal(report.code, null);
  assert.equal(report.name, null);
});

check('code numerique converti en texte, code textuel conserve', () => {
  assert.equal(describeMwaError({ code: 5, message: 'x' }, 'unknown').code, '5');
  assert.equal(describeMwaError({ code: 'ERROR_X', message: 'x' }, 'unknown').code, 'ERROR_X');
});

check('objet sans message ni code : representation stable', () => {
  const report = describeMwaError({ weird: true }, 'signAndSendTransactions');
  assert.ok(report.message.includes('weird'));
  assert.equal(report.code, null);
  assert.ok(/handshake failure here means nothing was signed/.test(report.hint));
});

check('etape non identifiable : signalee comme telle', () => {
  const report = describeMwaError(new Error('x'), 'unknown');
  assert.ok(/could not be identified/.test(report.hint));
});

check('cinq etapes MWA sont declarees, read-back inclus', () => {
  assert.deepEqual([...MWA_STEPS], [
    'authorize',
    'reauthorize',
    'signAndSendTransactions',
    'deauthorize',
    'readBack',
  ]);
});

check('formatMwaError conserve le message verbatim et affiche le code', () => {
  const formatted = formatMwaError({
    code: '4001',
    message: 'authorization request failed',
    step: 'authorize',
  });
  assert.equal(formatted, 'authorize failed · code: 4001 · authorization request failed');
});

check('formatMwaError rend l absence de code explicite', () => {
  const formatted = formatMwaError({
    code: null,
    message: 'CancellationException',
    step: 'signAndSendTransactions',
  });
  assert.ok(formatted.includes('code: none'));
  assert.ok(formatted.includes('CancellationException'));
  assert.ok(formatted.startsWith('signAndSendTransactions failed'));
});

check('read-back est une etape distincte des etapes de signature', () => {
  const report = describeMwaError(new Error('rpc down'), 'readBack');
  assert.equal(report.step, 'readBack');
  assert.ok(/never a signature step/.test(report.hint));
});

check('identite wallet : label, adresse et icone URI', () => {
  const view = describeWalletIdentity({
    address: 'ABC',
    icon: { uri: 'https://example.com/icon.png' },
    label: '  Solflare  ',
  });
  assert.equal(view.label, 'Solflare');
  assert.equal(view.address, 'ABC');
  assert.equal(view.iconUri, 'https://example.com/icon.png');
});

check('identite wallet : sans label ni icone', () => {
  const view = describeWalletIdentity({ address: 'ABC' });
  assert.equal(view.label, null);
  assert.equal(view.iconUri, null);
  assert.equal(view.address, 'ABC');
});

check('identite wallet : icone fournie en chaine directe', () => {
  const view = describeWalletIdentity({ address: 'ABC', icon: 'https://example.com/i.png' });
  assert.equal(view.iconUri, 'https://example.com/i.png');
});

console.log(`\n${passed} test(s) OK`);
if (process.exitCode === 1) process.exit(1);