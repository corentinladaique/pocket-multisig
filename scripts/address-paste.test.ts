import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { PublicKey } from '@solana/web3.js';

import {
  ADDRESS_FIELD_HINT,
  EMPTY_PASTE_MESSAGE,
  findMemberDuplicate,
  INVALID_PASTE_MESSAGE,
  parsePastedAddress,
  pasteErrorMessage,
  trimExternalWhitespace,
} from '../src/ui/addressPaste';

/** Incrément Paste : aucun wallet, aucun RPC. npx tsx scripts/address-paste.test.ts */

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

const INPUT = readFileSync('src/ui/AddressInput.tsx', 'utf8');
const PASTE = readFileSync('src/ui/addressPaste.ts', 'utf8');
const HOME = readFileSync('src/screens/ConnectScreen.tsx', 'utf8');
const PROPOSAL = readFileSync('src/screens/NewProposalScreen.tsx', 'utf8');
const VAULT = readFileSync('src/screens/CreateVaultScreen.tsx', 'utf8');

const VALID = PublicKey.unique().toBase58();

check('1/2. espaces et retours a la ligne externes supprimes', () => {
  assert.equal(trimExternalWhitespace(`  \n ${VALID} \t\n  `), VALID);
  assert.equal(trimExternalWhitespace('\n\n' + VALID), VALID);
  const result = parsePastedAddress(`\n  ${VALID}  \n`);
  assert.equal(result.ok, true);
});

check('3. caracteres internes conserves exactement', () => {
  const withInnerSpace = VALID.slice(0, 20) + ' ' + VALID.slice(20);
  assert.equal(parsePastedAddress(withInnerSpace).ok, false, 'adresse modifiee refusee');
  const internal = 'abc\n def';
  assert.equal(trimExternalWhitespace(internal), internal, 'aucun caractere interne touche');
});

check('4/5. adresse valide acceptee, invalide refusee', () => {
  assert.deepEqual(parsePastedAddress(VALID), { address: VALID, ok: true });
  assert.equal(parsePastedAddress('not-a-solana-address!').ok, false);
  assert.equal(parsePastedAddress('0OIl').ok, false);
  // Une recovery phrase n'est jamais une adresse valide.
  assert.equal(parsePastedAddress('abandon abandon abandon about').ok, false);
});

check('6. presse-papiers vide refuse avec message distinct', () => {
  const empty = parsePastedAddress('   \n ');
  assert.equal(empty.ok, false);
  assert.equal(empty.ok === false && empty.reason, 'empty');
  assert.equal(pasteErrorMessage(empty), EMPTY_PASTE_MESSAGE);
  assert.notEqual(EMPTY_PASTE_MESSAGE, INVALID_PASTE_MESSAGE);
  assert.equal(pasteErrorMessage({ ok: false, reason: 'invalid' }), INVALID_PASTE_MESSAGE);
  assert.equal(INVALID_PASTE_MESSAGE, 'Clipboard does not contain a valid Solana address.');
});

check('7/8/10. les trois champs utilisent AddressInput avec leur state d origine', () => {
  assert.ok(HOME.includes('<AddressInput'), 'Load multisig');
  assert.ok(HOME.includes('onChangeText={setMultisigInput}'), 'state multisig conserve');
  assert.ok(PROPOSAL.includes('<AddressInput'), 'destination');
  assert.ok(PROPOSAL.includes('onChangeText={setDestination}'), 'state destination conserve');
  assert.ok(VAULT.includes('<AddressInput'), 'membre en cours d ajout');
  assert.ok(VAULT.includes('onChangeText={setPendingAddress}'), 'state pending conserve');
  assert.ok(VAULT.includes("registerField('pendingAddress')"), 'logique clavier conservee');
  assert.ok(VAULT.includes('onBlur={onFieldBlur}'));
});

check('7/8/10. aucun chargement, aucune proposition, aucun ajout automatique', () => {
  // Le composant ne connait ni le chargement du multisig ni la creation.
  assert.ok(!/loadMultisig|signAndSendTransactions|createMember|addPendingMember/.test(INPUT));
  assert.ok(!/loadMultisig\(|runPipeline\(|void runCreate\(/.test(INPUT));
  // Les actions restent declenchees par leurs propres boutons.
  assert.ok(HOME.includes('Load multisig'));
  assert.ok(VAULT.includes('onPress={addPendingMember}') || VAULT.includes('addPendingMember'));
});

check('9. destination : invalidation de build, simulation et Max', () => {
  assert.ok(/\[address, creator, destination, lamports, memo, transactionIndex\]/.test(PROPOSAL));
  assert.ok(PROPOSAL.includes('}, [build, bufferText]);'), 'pipeline invalide');
  assert.ok(PROPOSAL.includes('isMaxSnapshotCurrent(maxSnapshot, {'), 'snapshot Max compare');
  assert.ok(PROPOSAL.includes('destination,'), 'la destination entre dans la comparaison');
  assert.ok(
    readFileSync('src/vault/maxTransfer.ts', 'utf8').includes('empty the Main vault'),
    "l'avertissement de vault vide existe",
  );
  assert.ok(PROPOSAL.includes('maxSummaryVisible && maxPlan !== null'));
});

check('11/12. collage membre : aucun role modifie, doublon detecte', () => {
  assert.ok(!/roles|Initiate|Vote|Execute/.test(INPUT), 'le composant ne touche pas aux roles');
  assert.ok(!/threshold/.test(INPUT), 'le composant ne touche pas au threshold');
  const members = [{ address: VALID }, { address: PublicKey.unique().toBase58() }];
  assert.equal(findMemberDuplicate(members, VALID, 1), 0, 'doublon detecte');
  assert.equal(findMemberDuplicate(members, VALID, 0), null, 'sa propre ligne ne compte pas');
  assert.equal(findMemberDuplicate(members, PublicKey.unique().toBase58(), 0), null);
  assert.ok(VAULT.includes('createMember({'), 'creation du membre inchangee');
  assert.ok(VAULT.includes('publicKey: address'));
});

check('13/14/15. presse-papiers lu uniquement apres un tap', () => {
  assert.ok(INPUT.includes('onPress={() => {') && INPUT.includes('void onPaste();'));
  assert.ok(INPUT.includes('const onPaste = async () => {'));
  assert.ok(!/useEffect/.test(INPUT), 'aucun effet: rien n est lu au montage');
  assert.ok(!/onFocus[\s\S]{0,80}getString/.test(INPUT), 'aucune lecture au focus');
  assert.ok(!/setInterval|setTimeout|addListener/.test(INPUT), 'aucune surveillance');
  const getStringCalls = INPUT.split('Clipboard.getString()').length - 1;
  assert.equal(getStringCalls, 1, 'une seule lecture, dans le onPress');
});

check('16/17/18. aucun RPC, aucun wallet, aucune signature', () => {
  for (const [name, source] of [['AddressInput', INPUT], ['addressPaste', PASTE]] as const) {
    assert.ok(!/useMobileWallet|signTransaction|signAndSendTransactions|authorizeSession/.test(source), name);
    assert.ok(!/connection\.|getBalance|getAccountInfo|fetch\(|https?:/.test(source), name);
  }
});

check('19. accessibilityLabel sur chaque bouton Paste', () => {
  assert.ok(INPUT.includes('accessibilityLabel={`Paste a Solana address into ${label}`}'));
  assert.ok(INPUT.includes('accessibilityRole="button"'));
  assert.ok(HOME.includes('label="Multisig address"'));
  assert.ok(PROPOSAL.includes('label="Destination"'));
  assert.ok(VAULT.includes('label="Public address"'));
});

check('20. Clipboard importe dans un seul fichier', () => {
  for (const [name, source] of [
    ['ConnectScreen', HOME],
    ['NewProposalScreen', PROPOSAL],
    ['CreateVaultScreen', VAULT],
  ] as const) {
    assert.ok(!source.includes('Clipboard'), `${name} ne doit pas importer Clipboard`);
  }
  assert.ok(INPUT.includes("require('react-native/Libraries/Components/Clipboard/Clipboard')"));
  assert.ok(!/\bany\b/.test(INPUT), 'aucun any dans l API publique');
  assert.ok(INPUT.includes('deprecie') || INPUT.includes('deprecated') || INPUT.includes('React Native\n * 0.86'));
});

check('21/22. saisie manuelle fonctionnelle et efface l erreur', () => {
  assert.ok(INPUT.includes('onChangeText={(next) => {'));
  assert.ok(INPUT.includes('setError(null);'));
  assert.ok(INPUT.includes('onChangeText(next);'));
  assert.ok(INPUT.includes('autoCapitalize="none"'));
  assert.ok(INPUT.includes('autoCorrect={false}'));
  assert.ok(INPUT.includes('value={value}'));
  assert.ok(INPUT.includes('editable={!disabled}'));
  assert.ok(INPUT.includes('{ADDRESS_FIELD_HINT}'));
});

check('rappel de confidentialite present une seule fois dans le composant', () => {
  assert.ok(ADDRESS_FIELD_HINT.includes('Never paste a recovery phrase or private key.'));
  const occurrences = INPUT.split('{ADDRESS_FIELD_HINT}').length - 1;
  assert.equal(occurrences, 1, 'rappel non duplique dans le composant');
});

setTimeout(() => {
  console.log(`\n${passed} test(s) OK`);
  if (process.exitCode === 1) process.exit(1);
}, 50);