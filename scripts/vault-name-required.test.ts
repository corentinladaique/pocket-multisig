import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * Nom de vault obligatoire des Vault setup. Aucun wallet, aucun reseau.
 * Execution : npx tsx scripts/vault-name-required.test.ts
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
const PREVIEW = readFileSync('src/screens/VaultTransactionPreviewScreen.tsx', 'utf8');
const PLAN = readFileSync('src/vault/multisigCreationPlan.ts', 'utf8');

/** Reproduit la condition reelle du bouton Continue a l'etape 1. */
function canContinueStep1(setupType: string | null, vaultName: string): boolean {
  return setupType !== null && vaultName.trim().length > 0;
}

check('1. nom vide : Continue desactive', () => {
  assert.equal(canContinueStep1('custom', ''), false);
  assert.ok(
    /setupType !== null && vaultName\.trim\(\)\.length > 0/.test(CREATE),
    'la condition du bouton doit exiger le nom',
  );
});

check('2. nom uniquement compose d espaces : Continue desactive', () => {
  assert.equal(canContinueStep1('custom', '     '), false);
  assert.equal(canContinueStep1('custom', '\n\t '), false);
});

check('3. placeholder visible : Continue toujours desactive', () => {
  // Le placeholder n'est jamais une valeur : le state reste vide.
  assert.equal(canContinueStep1('custom', ''), false);
  assert.ok(CREATE.includes('placeholder="Personal savings vault"'));
  assert.ok(!/placeholder=[\s\S]{0,40}\n[\s\S]{0,200}canContinue/.test(CREATE));
  assert.ok(!/setVaultName\('Personal savings vault'\)/.test(CREATE));
});

check('4. nom valide : Continue actif si les autres validations passent', () => {
  assert.equal(canContinueStep1('custom', 'Personal savings vault'), true);
  assert.equal(canContinueStep1('2-of-3', 'Tresorerie'), true);
  assert.equal(canContinueStep1(null, 'Tresorerie'), false, 'setupType reste requis');
});

check('5. espaces externes : validation sur la valeur trimee', () => {
  assert.equal(canContinueStep1('custom', '   Tresorerie   '), true);
  assert.ok(CREATE.includes('vaultName.trim().length > 0'));
  assert.ok(!/vaultName\.length > 0/.test(CREATE.split('canContinue')[0].slice(-600)), 'pas de valeur brute');
});

check('6. nom efface apres saisie : Continue redevient desactive', () => {
  assert.equal(canContinueStep1('custom', 'Tresorerie'), true);
  assert.equal(canContinueStep1('custom', ''), false);
});

check('7/8. nom vide : Review et Preview non ouvertes', () => {
  assert.ok(CREATE.includes('disabled={!canContinue}'), 'Le CTA Continue reste le seul passage');
  assert.ok(CREATE.includes('onPress={goNext}'));
  assert.ok(
    CREATE.split('onPress={goNext}').length - 1 === 1,
    'goNext ne doit etre branche que sur le CTA Continue',
  );
  assert.ok(CREATE.includes("Alert.alert('Discard vault setup?'"), 'aucun chemin parallele');
});

check('9. protection Preview conservee (defense en profondeur)', () => {
  assert.ok(CREATE.includes("reasonCode: 'missing-vault-name'"));
  assert.ok(CREATE.includes('Enter a vault name to create this multisig.'));
  assert.ok(CREATE.includes("recommendedAction: 'Back to vault setup'"));
  assert.ok(PREVIEW.includes('Vault name required'));
  assert.ok(PREVIEW.includes('createReadiness.userMessage'));
});

check('10. canCreate et readyForInstructionBuild inchanges', () => {
  assert.ok(
    PLAN.includes('errors.length === 0 && request.readyForCreation && request.vaultName.length > 0'),
    'le plan exige toujours un nom',
  );
  assert.ok(CREATE.includes('plan.readyForInstructionBuild &&'));
  assert.ok(CREATE.includes('!creating'));
});

check('11. aucun nom genere automatiquement', () => {
  assert.ok(!/setVaultName\((?!'')/.test(CREATE), 'aucun setVaultName avec valeur par defaut');
  assert.ok(CREATE.includes("useState('')"), 'le nom demarre vide');
  assert.ok(!/Untitled vault/.test(CREATE), 'aucun faux fallback dans le parcours');
  assert.ok(!/Untitled vault/.test(PREVIEW));
});

check('12. aucun wallet, signature ou transaction dans cette logique', () => {
  const block = CREATE.slice(CREATE.indexOf('const canContinue'), CREATE.indexOf('const canContinue') + 700);
  assert.ok(!/signAndSendTransactions|signTransaction|authorizeSession|connection\./.test(block));
  assert.ok(!/useMobileWallet/.test(block));
});

setTimeout(() => {
  console.log(`\n${passed} test(s) OK`);
  if (process.exitCode === 1) process.exit(1);
}, 50);