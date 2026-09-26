import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { topInset, ANDROID_STATUS_BAR_FALLBACK } from '../src/ui/safeArea';

/**
 * Tests de la Safe Area partagee. Aucun wallet, aucun reseau.
 * Execution : npx tsx scripts/safe-area.test.ts
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

const SCREENS = [
  'ConnectScreen',
  'MultisigInboxScreen',
  'NewProposalScreen',
  'ProposalDetailsScreen',
  'MultisigDetailsScreen',
  'CreateVaultScreen',
  'VaultTransactionPreviewScreen',
  'ProposalListScreen',
  'TransactionReviewScreen',
];

check('le helper renvoie 0 hors Android et la valeur Android sinon', () => {
  assert.equal(topInset('ios', undefined), 0);
  assert.equal(topInset('web', 30), 0);
  assert.equal(topInset('android', 36), 36);
  assert.equal(topInset('android', undefined), ANDROID_STATUS_BAR_FALLBACK);
  assert.equal(topInset('android', null), ANDROID_STATUS_BAR_FALLBACK);
  assert.equal(topInset('android', Number.NaN), ANDROID_STATUS_BAR_FALLBACK);
});

check('une seule source de verite : SAFE_TOP_PADDING importe partout', () => {
  for (const screen of SCREENS) {
    const source = readFileSync(`src/screens/${screen}.tsx`, 'utf8');
    assert.ok(
      source.includes("from '../ui/safeAreaPadding'"),
      `${screen} doit utiliser le helper partage`,
    );
    assert.ok(
      source.includes('SAFE_TOP_PADDING'),
      `${screen} doit appliquer SAFE_TOP_PADDING`,
    );
    assert.ok(
      !/StatusBar\.currentHeight/.test(source),
      `${screen} ne doit plus calculer sa propre valeur`,
    );
  }
});

check('1/2/4/5. Home, Inbox, Proposal Details et Proposal List ont un inset', () => {
  for (const screen of [
    'ConnectScreen',
    'MultisigInboxScreen',
    'ProposalDetailsScreen',
    'ProposalListScreen',
  ]) {
    const source = readFileSync(`src/screens/${screen}.tsx`, 'utf8');
    assert.ok(source.includes('SAFE_TOP_PADDING'), `${screen} sans inset superieur`);
  }
});

check('3. New Proposal : le bandeau DEVNET · SOL TRANSFER est degage', () => {
  const source = readFileSync('src/screens/NewProposalScreen.tsx', 'utf8');
  assert.ok(source.includes('SAFE_TOP_PADDING'));
  assert.ok(
    source.includes('DEVNET · SOL TRANSFER') || source.includes('DEVNET'),
    'le bandeau reseau doit rester present',
  );
});

check('6. Transaction Review garde son BackHandler', () => {
  const source = readFileSync('src/screens/TransactionReviewScreen.tsx', 'utf8');
  assert.ok(source.includes("BackHandler.addEventListener('hardwareBackPress'"));
  assert.ok(source.includes('return true;'));
  assert.ok(source.includes('SAFE_TOP_PADDING'));
});

check('7. aucun ecran n applique deux fois le padding', () => {
  for (const screen of SCREENS) {
    const source = readFileSync(`src/screens/${screen}.tsx`, 'utf8');
    const occurrences = source.split('SAFE_TOP_PADDING,').length - 1;
    assert.ok(occurrences <= 1, `${screen} applique le padding ${occurrences} fois`);
    assert.ok(!source.includes('safeTop'), `${screen} ne doit pas garder son ancien spacer`);
  }
});

check('8. aucun espace excessif : la valeur vient de la barre de statut, pas d une constante locale', () => {
  const helper = [
    readFileSync('src/ui/safeAreaPadding.ts', 'utf8'),
    readFileSync('src/ui/safeArea.ts', 'utf8'),
  ].join('\n');
  assert.ok(helper.includes('StatusBar.currentHeight'), 'la valeur doit venir de la plateforme');
  assert.ok(
    helper.includes('ANDROID_STATUS_BAR_FALLBACK'),
    'le repli doit etre nomme et documente',
  );
  // Une seule source dans tout le projet : aucun ecran ne recalcule la valeur.
  let filesReadingPlatform = 0;
  for (const screen of SCREENS) {
    const source = readFileSync(`src/screens/${screen}.tsx`, 'utf8');
    if (source.includes('StatusBar.currentHeight')) filesReadingPlatform += 1;
    assert.ok(
      !source.includes('safeTop'),
      `${screen} ne doit pas garder son propre spacer`,
    );
  }
  assert.equal(filesReadingPlatform, 0, 'aucun ecran ne doit lire la plateforme directement');
});

setTimeout(() => {
  console.log(`\n${passed} test(s) OK`);
  if (process.exitCode === 1) process.exit(1);
}, 50);