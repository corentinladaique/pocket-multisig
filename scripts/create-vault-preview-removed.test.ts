import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';

import {
  actionsForState,
  describeAttemptOutcome,
  evaluateSignatureEvidence,
} from '../src/wallet/operationState';

/**
 * Suppression definitive du parcours Preview : fichiers, references, etats,
 * routes, libelles. Verifie aussi le conditionnement sur de VRAIS modules purs
 * (aucun wallet, aucun reseau). npx tsx scripts/create-vault-preview-removed.test.ts
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
    console.log(detail.split('\n').slice(0, 4).join('\n'));
    process.exitCode = 1;
  }
}

const CREATE = readFileSync('src/screens/CreateVaultScreen.tsx', 'utf8');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

check('1/2. les fichiers Preview sont absents', () => {
  assert.equal(existsSync('src/screens/VaultPreviewScreen.tsx'), false);
  assert.equal(existsSync('src/screens/VaultTransactionPreviewScreen.tsx'), false);
});

check('3. aucune reference aux ecrans supprimes dans src/', () => {
  for (const file of sourceFiles('src')) {
    const source = readFileSync(file, 'utf8');
    assert.ok(!/VaultPreviewScreen|VaultTransactionPreviewScreen/.test(source), `reference dans ${file}`);
  }
});

check('4/5. aucun etat de navigation Preview', () => {
  assert.ok(!/\bpreviewOpen\b/.test(CREATE), 'previewOpen absent');
  assert.ok(!/\btransactionPreviewOpen\b/.test(CREATE), 'transactionPreviewOpen absent');
  assert.ok(!/setPreviewOpen|setTransactionPreviewOpen/.test(CREATE), 'aucun setter Preview');
});

check('6/7. aucun early return ni BackHandler Preview', () => {
  assert.ok(!CREATE.includes('if (previewOpen) {'));
  assert.ok(!CREATE.includes('if (transactionPreviewOpen) {'));
  assert.ok(!/BackHandler[\s\S]{0,120}previewOpen/.test(CREATE), 'BackHandler sans Preview');
});

check('8/9. libelles techniques absents du parcours Create Vault', () => {
  assert.ok(!CREATE.includes('Technical transaction details'));
  assert.ok(!/>Transaction Preview</.test(CREATE));
  assert.ok(!CREATE.includes('Transaction preview'));
});

check('10/11. un seul CTA Create et un seul handler onCreateOnDevnet', () => {
  assert.equal(CREATE.split('onPress={onCreateOnDevnet}').length - 1, 1);
  assert.equal(CREATE.split('Prepare and create on Devnet').length - 1, 1);
  assert.equal(CREATE.split('const onCreateOnDevnet =').length - 1, 1);
});

// --- Conditionnement reel, sur les modules purs partages (comportement) ---
check('18. sans signature : Nothing was sent. et nouvelle tentative autorisee', () => {
  const outcome = describeAttemptOutcome({ signature: null, verified: false });
  assert.equal(outcome.label, 'Nothing was sent.');
  assert.equal(outcome.allowNewAttempt, true);
  assert.equal(outcome.sent, false);
});

check('19. signature presente : Prepare again interdit par defaut', () => {
  const outcome = describeAttemptOutcome({ signature: 'sig', verified: false });
  assert.equal(outcome.allowNewAttempt, false, 'aucune nouvelle tentative sans preuve');
  const actions = actionsForState('signature-obtained-confirmation-pending', {
    confirmed: false,
    readBackVerified: false,
    signatureObtained: true,
  });
  assert.equal(actions.allowPrepareAndRetry, false, 'aucune reconstruction apres signature');
  assert.equal(actions.allowSecondSend, false, 'aucun second envoi');
});

check('20/21. Check transaction again : disponibilite et lecture seule', () => {
  const actions = actionsForState('signature-obtained-confirmation-pending', {
    confirmed: false,
    readBackVerified: false,
    signatureObtained: true,
  });
  assert.equal(actions.allowCheckAgain, true);
  const readOnly = CREATE.slice(
    CREATE.indexOf('const onCheckTransactionAgain = useCallback'),
    CREATE.indexOf('const onCreateOnDevnet = useCallback'),
  );
  assert.ok(readOnly.includes('confirmSignature'), 'lecture du statut');
  assert.ok(readOnly.includes('getAccountInfo'), 'read-back');
  assert.ok(
    !/signAndSendTransactions|sendRawTransaction|partialSign|applyFreshBlockhash|authorizeSession/.test(readOnly),
    'aucune reconstruction, signature, envoi ni ouverture wallet',
  );
});

check('E. nouvelle tentative apres signature : uniquement si la preuve l autorise', () => {
  assert.equal(
    evaluateSignatureEvidence({ blockHeight: null, lastValidBlockHeight: 100, status: 'pending' }).retryAllowed,
    false,
  );
  assert.equal(
    evaluateSignatureEvidence({ blockHeight: null, lastValidBlockHeight: 100, status: 'failed' }).retryAllowed,
    true,
  );
  assert.equal(
    evaluateSignatureEvidence({ blockHeight: 120, lastValidBlockHeight: 100, status: 'notFound' }).retryAllowed,
    true,
  );
  assert.equal(
    evaluateSignatureEvidence({ blockHeight: 90, lastValidBlockHeight: 100, status: 'notFound' }).retryAllowed,
    false,
  );
});

check('26/27. Troubleshooting details n apparait que si un diagnostic existe', () => {
  assert.ok(CREATE.includes('const hasDiagnostics ='));
  assert.ok(CREATE.includes('{hasDiagnostics ? ('));
  assert.ok(CREATE.includes('Troubleshooting details'));
  // La section n est rendue que par le bloc conditionne : jamais une etape
  // obligatoire, jamais vide.
  assert.ok(!/styles\.blockTitle>Troubleshooting details/.test(CREATE));
});

setTimeout(() => {
  console.log(`\n${passed} test(s) OK`);
  if (process.exitCode === 1) process.exit(1);
}, 50);
