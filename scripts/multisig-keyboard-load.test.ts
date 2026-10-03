import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { parseMultisigAddress } from '../src/squads/multisig';

/**
 * Validation clavier du champ « Multisig address » (hotfix UX Groupe 1).
 *
 * Entrée (returnKeyType="go") doit appeler EXACTEMENT le même handler que le
 * bouton « Load multisig » : même validation, même état loading, aucune
 * duplication, aucun appel sur saisie vide/invalide, aucun appel concurrent.
 *
 * Assertions par lecture des sources + un test pur de la validation existante.
 * Execution : npx tsx scripts/multisig-keyboard-load.test.ts
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

const CONNECT = readFileSync('src/screens/ConnectScreen.tsx', 'utf8');
const INPUT = readFileSync('src/ui/AddressInput.tsx', 'utf8');
const LOOKUP = readFileSync('src/squads/useMultisigLookup.ts', 'utf8');

// Bloc du handler unique de chargement manuel.
const handlerStart = CONNECT.indexOf('const onLoadMultisig = useCallback');
const handlerEnd = CONNECT.indexOf('}, [msig, multisigInput]);', handlerStart);
const HANDLER = CONNECT.slice(handlerStart, handlerEnd + 1);

check('1. Entree appelle le handler existant', () => {
  assert.ok(handlerStart > 0 && handlerEnd > handlerStart, 'un handler unique existe');
  assert.ok(CONNECT.includes('returnKeyType="go"'), 'touche Entree = go');
  assert.ok(CONNECT.includes('onSubmitEditing={onLoadMultisig}'), 'Entree appelle le handler');
  assert.ok(INPUT.includes('onSubmitEditing={onSubmitEditing}'), 'le champ relaie onSubmitEditing');
  assert.ok(INPUT.includes("returnKeyType?: TextInputProps['returnKeyType']"), 'prop returnKeyType');
});

check('2. Adresse vide : aucun appel', () => {
  // Validation locale AVANT tout reseau dans le hook existant.
  const parseIdx = LOOKUP.indexOf('parseMultisigAddress(input)');
  const netIdx = LOOKUP.indexOf('loadMultisig(connection');
  assert.ok(parseIdx > 0 && netIdx > 0 && parseIdx < netIdx, 'validation locale avant RPC');
  assert.ok(LOOKUP.includes("setStatus('error');"), 'une saisie vide pose une erreur locale');
  // Le module de validation leve bien sur une saisie vide (aucune valeur inventee).
  assert.throws(() => parseMultisigAddress(''));
  assert.throws(() => parseMultisigAddress('   '));
});

check('3. Adresse invalide : aucun chargement', () => {
  assert.throws(() => parseMultisigAddress('not-a-valid-address'));
  // Le hook sort AVANT le reseau dans le bloc catch de validation.
  const validateBlock = LOOKUP.slice(LOOKUP.indexOf('try {'), LOOKUP.indexOf("setStatus('loading')"));
  assert.ok(validateBlock.length > 0, 'le bloc de validation precede le chargement');
  assert.ok(!validateBlock.includes('loadMultisig(connection'), 'aucun RPC dans la validation');
});

check('4. Loading : aucun second appel', () => {
  assert.ok(
    HANDLER.includes("if (msig.status === 'loading') return;"),
    'un appel concurrent est ignore',
  );
  assert.ok(CONNECT.includes('busy={msig.status === \'loading\'}'), 'etat loading reutilise');
  assert.ok(CONNECT.includes("disabled={msig.status === 'loading'}"), 'saisie desactivee pendant loading');
});

check('5. Le bouton et Entree partagent la meme fonction', () => {
  assert.ok(CONNECT.includes('onPress={onLoadMultisig}'), 'bouton = handler unique');
  assert.ok(CONNECT.includes('onSubmitEditing={onLoadMultisig}'), 'Entree = meme handler');
  // Une seule source d'appel a msig.load : le handler unique.
  assert.equal(
    CONNECT.split('msig.load(').length - 1,
    1,
    'msig.load n est appele qu une seule fois (dans le handler)',
  );
  assert.ok(CONNECT.includes('onPress={() => msig.load(') === false, 'aucun appel direct bouton');
});

check('6. Aucun wallet, aucune signature, aucune transaction ajoutes', () => {
  assert.ok(!/signAndSendTransactions|signTransaction|sendTransaction|authorizeSession/.test(HANDLER));
  assert.ok(!/useMobileWallet|connection\./.test(HANDLER), 'aucun RPC dans le handler');
});

setTimeout(() => {
  console.log(`\n${passed} test(s) OK`);
  if (process.exitCode === 1) process.exit(1);
}, 50);
