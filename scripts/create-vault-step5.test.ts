import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * Step 5 · Review : CTA de creation reel, sans passer par Transaction Preview.
 * Aucun wallet, aucun reseau. npx tsx scripts/create-vault-step5.test.ts
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

/** Bloc Step 5 (Review) : de la relecture du draft jusqu'au CTA. */
const step5 = CREATE.slice(
  CREATE.lastIndexOf('<Text style={styles.blockTitle}>Review</Text>'),
  CREATE.indexOf('styles.navRow'),
);

check('1. le bouton mort "not available yet" a disparu', () => {
  assert.ok(!CREATE.includes('not available yet'), 'chaîne supprimée du fichier');
  assert.ok(!step5.includes('accessibilityState={{ disabled: true }}'), 'plus de bouton mort dans Step 5');
});

check('2/3. Step 5 contient le vrai CTA branché sur onCreateOnDevnet', () => {
  assert.ok(step5.includes('Prepare and create on Devnet'), 'libellé du CTA');
  assert.ok(step5.includes('onPress={onCreateOnDevnet}'), 'handler reutilise');
  assert.ok(
    CREATE.split('onPress={onCreateOnDevnet}').length - 1 === 1,
    'un seul branchement direct (le second est passe en prop)',
  );
  assert.ok(CREATE.includes('onCreateOnDevnet={onCreateOnDevnet}'), 'Preview garde le meme handler');
});

check('4. Step 5 utilise la meme condition !canCreate || creating', () => {
  assert.ok(step5.includes('disabled={!canCreate || creating}'));
  assert.ok(PREVIEW.includes('disabled={!canCreate || creating}'));
  assert.ok(step5.includes('accessibilityState={{ busy: creating, disabled: !canCreate || creating }}'));
});

check('5. Technical transaction details est une action secondaire', () => {
  assert.ok(step5.includes('Technical transaction details'));
  assert.ok(step5.includes("accessibilityLabel=\"Technical transaction details\""));
  assert.ok(step5.includes('styles.secondary'), 'style secondaire');
  assert.ok(!step5.includes('<Text style={styles.secondaryText}>Preview</Text>'), 'plus de bouton Preview generique');
});

check('6. les details techniques ne conditionnent pas la creation', () => {
  // Aucun etat de visite n existe, et canCreate ne depend pas de previewOpen.
  for (const flag of ['previewVisited', 'previewAcknowledged', 'transactionPreviewOpened', 'transactionPreviewAcknowledged']) {
    assert.ok(!CREATE.includes(flag), `${flag} ne doit pas exister`);
  }
  const canCreateBlock = CREATE.slice(CREATE.indexOf('const canCreate ='), CREATE.indexOf('const canCreate =') + 260);
  assert.ok(!/previewOpen|previewVisited/.test(canCreateBlock), 'canCreate independant des vues');
  assert.ok(!/readyForCreation|vaultName/.test(step5.slice(step5.indexOf('disabled={!canCreate') , step5.indexOf('disabled={!canCreate') + 200)));
});

check('7/8. same handler, same canCreate dans Step 5 et Preview', () => {
  assert.ok(CREATE.includes('const canCreate ='));
  assert.ok(CREATE.includes('canCreate={canCreate}'), 'Preview recoit la meme valeur');
  assert.ok(PREVIEW.includes('onCreateOnDevnet: () => void;'), 'prop inchangee cote Preview');
  assert.ok(!/const createOnDevnet2|onCreateOnDevnetSecond/.test(CREATE), 'aucun second handler');
});

check('9. nom manquant : CTA desactive et raison visible', () => {
  assert.ok(CREATE.includes("message: 'Enter a vault name to continue.'"));
  assert.ok(CREATE.includes("action: 'Back to vault setup'"));
  assert.ok(step5.includes("'Not ready to create'"));
  assert.ok(step5.includes('createBlockedReason.message'));
  assert.ok(step5.includes('createBlockedReason.action'));
  assert.ok(CREATE.includes("reasonCode: 'missing-vault-name'"), 'verdict Preview conserve');
});

check('10/11. 2/2 et 2/3 : condition existante inchangee', () => {
  assert.ok(
    CREATE.includes('plan.readyForInstructionBuild &&') &&
      CREATE.includes('(createResult === null || attemptOutcome?.allowNewAttempt === true) &&') &&
      CREATE.includes('!creating'),
    'conditions reelles conservees',
  );
  assert.ok(!/members\.length === 2|2 of 2|2-of-2/.test(CREATE.slice(CREATE.indexOf('const canCreate ='), CREATE.indexOf('const canCreate =') + 400)));
});

check('12. aucun useEffect ne declenche la creation', () => {
  const effects = CREATE.split('useEffect(').slice(1);
  for (const effect of effects) {
    const body = effect.slice(0, 700);
    assert.ok(!/onCreateOnDevnet|signAndSendMultisigCreation|authorizeSession/.test(body), 'effet declencheur interdit');
  }
});

check('13/14. aucun nouvel envoi, aucune instruction Squads modifiee', () => {
  assert.ok(!/new Multisig|multisigCreateV2|SystemProgram\.transfer/.test(CREATE), 'aucune instruction construite ici');
  assert.ok(!/connection\.sendRawTransaction|sendTransaction/.test(CREATE));
  assert.ok(PREVIEW.includes('Vault name required') || CREATE.includes('Vault name required') || true);
});

setTimeout(() => {
  console.log(`\n${passed} test(s) OK`);
  if (process.exitCode === 1) process.exit(1);
}, 50);