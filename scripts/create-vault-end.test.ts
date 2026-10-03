import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * Fin du parcours Create Vault : un seul CTA de creation, plus aucun ecran
 * Preview intermediaire (creation ET transaction), Learn retire du dashboard
 * charge, Reset onboarding retire de Home. Aucun wallet, aucun reseau.
 * npx tsx scripts/create-vault-end.test.ts
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
const HOME = readFileSync('src/screens/ConnectScreen.tsx', 'utf8');

check('1/2. Step 5 : CTA principal present, plus de mention du bouton mort', () => {
  assert.ok(CREATE.includes('Prepare and create on Devnet'));
  assert.ok(!CREATE.includes('not available yet'));
});

check('3. plus aucune trace des ecrans Preview dans Create Vault', () => {
  assert.ok(!/>Transaction Preview</.test(CREATE), 'aucun libelle Transaction Preview');
  assert.ok(!CREATE.includes('Technical transaction details'), 'plus d acces technique separe');
  assert.ok(!CREATE.includes('VaultPreviewScreen'));
  assert.ok(!CREATE.includes('VaultTransactionPreviewScreen'));
});

check('4. un seul CTA de creation visible : le meme handler, une seule fois', () => {
  assert.equal(
    CREATE.split('onPress={onCreateOnDevnet}').length - 1,
    1,
    'un seul bouton declenche la creation dans le wizard',
  );
  assert.equal(
    CREATE.split('Prepare and create on Devnet').length - 1,
    1,
    'un seul libelle de creation',
  );
});

check('5/6. handler et condition uniques', () => {
  assert.equal(CREATE.split('const canCreate =').length - 1, 1);
  assert.equal(CREATE.split('const onCreateOnDevnet').length - 1, 1);
});

check('7/8. preflight, simulation et validations conservees', () => {
  for (const token of [
    'multisigCreationPreflight',
    'simulateMultisigCreation',
    'prepareCreation',
    'signAndSendMultisigCreation',
    'readyForInstructionBuild',
  ]) {
    assert.ok(CREATE.includes(token), `${token} doit rester utilise`);
  }
  assert.ok(!/multisigCreateV2|new Multisig\(/.test(CREATE), 'aucune instruction Squads dans ce fichier');
});

check('9/10. le parcours technique ne passe plus par un ecran intermediaire', () => {
  assert.ok(!CREATE.includes('setTransactionPreviewOpen'), 'aucun etat menant a une preview');
  assert.ok(!CREATE.includes('setPreviewOpen'), 'aucun etat menant a une preview');
  assert.ok(CREATE.includes('Vault created and verified.'), 'le resultat est rendu sur Step 5');
});

check('11. plus aucun etat de navigation Preview', () => {
  assert.ok(!CREATE.includes('const [previewOpen, setPreviewOpen] = useState(false);'));
  assert.ok(!CREATE.includes('const [transactionPreviewOpen, setTransactionPreviewOpen] = useState(false);'));
  assert.ok(!/\bpreviewOpen\b/.test(CREATE), 'aucun early return ni dependance Preview');
});

check('12. aucun handler de creation duplique', () => {
  assert.equal(CREATE.split('const onCreateOnDevnet').length - 1, 1);
  assert.ok(!/const onCreateOnDevnet2|secondCreateHandler/.test(CREATE));
});

check('13/14. Back conserve le draft, sortie explicite confirmee', () => {
  assert.ok(CREATE.includes("Alert.alert('Discard vault setup?'"));
  assert.ok(CREATE.includes("'Continue editing'"), 'action Keep editing existante');
  assert.ok(CREATE.includes('Discard vault setup'));
  assert.ok(!CREATE.includes('Cancel and back to inbox'), 'libelle ambigu supprime');
  assert.ok(!/\{ style: 'cancel', text: 'Cancel' \}[\s\S]{0,80}setStep/.test(CREATE), 'Back ne detruit rien');
});

check('15/16. Reset onboarding invisible sur Home, fonction conservee', () => {
  assert.ok(!HOME.includes('accessibilityLabel="Reset onboarding"'), 'plus d action visible');
  assert.ok(!HOME.includes('void onboarding.reset()'), 'plus de branchement visible');
  const hook = readFileSync('src/onboarding/useOnboarding.ts', 'utf8');
  assert.ok(hook.includes('const reset = useCallback'), 'la fonction reste dans le code');
  assert.ok(hook.includes('AsyncStorage.removeItem(ONBOARDING_STORAGE_KEY)'));
});

check('16bis. Learn retire du dashboard charge, mais ouvert avant connexion', () => {
  assert.equal(
    HOME.split('onPress={onboarding.open}').length - 1,
    1,
    'un seul acces Learn : celui d avant connexion wallet',
  );
  const learnIndex = HOME.indexOf('Learn how multisig works');
  const dashboardIndex = HOME.indexOf('Open this multisig in the shared detail screen');
  assert.ok(learnIndex > -1 && dashboardIndex > -1 && learnIndex < dashboardIndex, 'Learn hors dashboard');
  const dashboard = HOME.slice(dashboardIndex);
  assert.ok(!dashboard.includes('Learn how multisig works'), 'Learn absent du dashboard charge');
  assert.ok(HOME.includes('onboarding.open'), 'la fonction interne d ouverture reste presente');
});

check('17/18. aucun wallet prompt ni envoi automatique', () => {
  const effects = CREATE.split('useEffect(').slice(1);
  for (const effect of effects) {
    assert.ok(
      !/signAndSendMultisigCreation|authorizeSession|onCreateOnDevnet/.test(effect.slice(0, 800)),
      'aucun envoi declenche par un effet',
    );
  }
});

check('19. le flux compile sans les previews supprimees', () => {
  assert.ok(CREATE.includes('export function CreateVaultScreen'));
  assert.ok(!CREATE.includes('if (transactionPreviewOpen) {'));
  assert.ok(!CREATE.includes('if (previewOpen) {'));
});

setTimeout(() => {
  console.log(`\n${passed} test(s) OK`);
  if (process.exitCode === 1) process.exit(1);
}, 50);
