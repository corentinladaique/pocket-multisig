import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import { VAULT_VISIBLE_LABELS } from '../src/wallet/vaultCreationState';

/**
 * Step 5 · Review : parcours de creation unique (plus de Preview separee).
 * Tous les etats utiles sont rendus sur Step 5, avec un seul CTA de creation et
 * un seul handler d'envoi. Aucun wallet, aucun reseau.
 * npx tsx scripts/create-vault-step5.test.ts
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

/** Bloc Step 5 (Review) : de la relecture du draft jusqu'au CTA. */
const step5 = CREATE.slice(
  CREATE.lastIndexOf('<Text style={styles.blockTitle}>Review</Text>'),
  CREATE.indexOf('styles.navRow'),
);

check('1. les deux ecrans Preview ont ete supprimes du disque', () => {
  assert.equal(existsSync('src/screens/VaultPreviewScreen.tsx'), false);
  assert.equal(existsSync('src/screens/VaultTransactionPreviewScreen.tsx'), false);
});

check('2. Step 5 rend les quatre familles d etats', () => {
  assert.ok(step5.includes('Review and create'), 'etat ready : CTA principal');
  assert.ok(step5.includes('Nothing was sent.'), 'etat echec avant signature');
  assert.ok(
    step5.includes("VAULT_VISIBLE_LABELS['signed-pending-confirmation']"),
    'etat signature en attente (libelle partage)',
  );
  assert.equal(
    VAULT_VISIBLE_LABELS['signed-pending-confirmation'],
    'Transaction signed, confirmation pending.',
  );
  assert.ok(step5.includes('Vault created and verified.'), 'etat succes verifie');
});

check('3. Prepare again et Check transaction again reutilisent les handlers existants', () => {
  assert.ok(step5.includes("'Prepare again'"), 'libelle de reessai present');
  assert.ok(
    step5.includes('needsPrepareAgain ?') && CREATE.includes('attemptOutcome?.allowNewAttempt === true'),
    'Prepare again conditionne par la machine d etat, jamais par une signature',
  );
  assert.ok(step5.includes('void onCheckTransactionAgain();'), 'relecture reutilise le handler');
});

check('4. un seul CTA de creation et un seul handler d envoi', () => {
  assert.equal(
    CREATE.split('onPress={onCreateOnDevnet}').length - 1,
    1,
    'un seul branchement direct sur le handler de creation',
  );
  assert.equal(CREATE.split('const onCreateOnDevnet').length - 1, 1, 'un seul handler d envoi');
  assert.equal(
    CREATE.split('Review and create').length - 1,
    1,
    'un seul libelle Review and create',
  );
  assert.ok(!/const createOnDevnet2|onCreateOnDevnetSecond/.test(CREATE), 'aucun second handler');
});

check('5. plus aucune route ni etat de Preview', () => {
  assert.ok(!CREATE.includes('previewOpen'), 'aucun early return / etat Preview');
  assert.ok(!CREATE.includes('transactionPreviewOpen'), 'aucun etat de transaction preview');
  assert.ok(!CREATE.includes('VaultPreviewScreen'), 'aucun import du preview de creation');
  assert.ok(!CREATE.includes('VaultTransactionPreviewScreen'), 'aucun import du preview de transaction');
  assert.ok(!CREATE.includes('Technical transaction details'), 'plus d acces a l ancien ecran technique');
});

check('6/7. canCreate, preflight et simulation conserves', () => {
  assert.equal(CREATE.split('const canCreate =').length - 1, 1);
  for (const token of [
    'multisigCreationPreflight',
    'simulateMultisigCreation',
    'prepareCreation',
    'signAndSendMultisigCreation',
    'readyForInstructionBuild',
  ]) {
    assert.ok(CREATE.includes(token), `${token} doit rester utilise`);
  }
  assert.ok(!/multisigCreateV2|new Multisig\(/.test(CREATE), 'aucune instruction Squads ici');
});

check('8. aucun useEffect ne declenche la creation', () => {
  const effects = CREATE.split('useEffect(').slice(1);
  for (const effect of effects) {
    const body = effect.slice(0, 800);
    assert.ok(!/onCreateOnDevnet|signAndSendMultisigCreation|authorizeSession/.test(body), 'effet declencheur interdit');
  }
});

check('9. sans signature : Nothing was sent. et Prepare again correctement conditionne', () => {
  assert.ok(step5.includes('Nothing was sent.'));
  assert.ok(
    CREATE.includes('const needsPrepareAgain = hasCreateResult && attemptOutcome?.allowNewAttempt === true;'),
    'Prepare again depend de allowNewAttempt',
  );
  assert.ok(!CREATE.includes('Prepare and retry'), 'libelle ambigu supprime');
});

check('10/11. signature presente : Prepare again absent, Check transaction again present', () => {
  // La CTA n affiche « Prepare again » que si needsPrepareAgain (jamais sur une
  // signature non revoquee : allowNewAttempt y est faux par construction).
  assert.ok(step5.includes("needsPrepareAgain ? 'Prepare again' : 'Review and create'"));
  assert.ok(step5.includes('Check transaction again'));
});

check('12/13. relecture en lecture seule, section repliable conditionnee', () => {
  const readOnly = CREATE.slice(
    CREATE.indexOf('const onCheckTransactionAgain = useCallback'),
    CREATE.indexOf('const onCreateOnDevnet = useCallback'),
  );
  assert.ok(!/signAndSendTransactions|sendRawTransaction|partialSign/.test(readOnly), 'aucune methode d envoi');
  assert.ok(readOnly.includes('confirmSignature'), 'lecture du statut de signature');
  assert.ok(CREATE.includes('hasDiagnostics ?'), 'section repliable gated');
  assert.ok(CREATE.includes('Troubleshooting details'));
});

check('14. succes : Open vault et View proposals disponibles', () => {
  assert.ok(step5.includes('Open vault'));
  assert.ok(step5.includes('View proposals'));
  assert.ok(step5.includes('onGoToInbox'));
});

setTimeout(() => {
  console.log(`\n${passed} test(s) OK`);
  if (process.exitCode === 1) process.exit(1);
}, 50);
