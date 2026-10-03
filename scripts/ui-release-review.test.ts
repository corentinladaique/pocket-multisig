import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { PROPOSAL_ACTION_LABELS } from '../src/squads/proposalActionState';

/**
 * Revue UI release (captures Seeker) — assertions par lecture des sources.
 *
 * Aucun rendu, aucun RPC, aucun wallet, aucune signature : ce projet n'a pas
 * de renderer, donc les proprietes visuelles sont verifiees dans le code des
 * ecrans (voir la discipline §8 de references/home-dashboard-and-safe-ui.md).
 *
 * Execution : npx tsx scripts/ui-release-review.test.ts
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

const APP = readFileSync('App.tsx', 'utf8');
const HOME = readFileSync('src/screens/ConnectScreen.tsx', 'utf8');
const NEW = readFileSync('src/screens/NewProposalScreen.tsx', 'utf8');
const DETAILS = readFileSync('src/screens/MultisigDetailsScreen.tsx', 'utf8');
const LIST = readFileSync('src/screens/ProposalListScreen.tsx', 'utf8');
const PD = readFileSync('src/screens/ProposalDetailsScreen.tsx', 'utf8');

/** Le segment [guard, target] ne doit contenir aucun `: null` (garde fermee). */
function guardedByDev(marker: string, target: string): boolean {
  const idx = marker.indexOf(target);
  if (idx === -1) return false;
  const guard = marker.lastIndexOf('{__DEV__ ? (', idx);
  if (guard === -1) return false;
  return !marker.slice(guard, idx).includes(': null');
}

check('1. Les diagnostics wallet ne sont pas visibles en release Home', () => {
  // V2 : les diagnostics d'identite wallet ont quitte le rendu principal.
  assert.ok(!HOME.includes('Icon supplied by the wallet'), 'diagnostic wallet retire du rendu');
  assert.ok(!HOME.includes('label supplied: '), 'diagnostic label retire du rendu');
});

check("2. RPC: Online n'est pas visible en release Home", () => {
  // V2 : le seul affichage reseau de premier niveau est sous __DEV__.
  assert.ok(
    guardedByDev(HOME, 'Network: Devnet · RPC:'),
    'l etat RPC ne doit apparaitre que sous __DEV__',
  );
  assert.ok(!HOME.includes('>Network: Devnet</Text>'), 'plus de ligne reseau en release');
});

check('3. Learn n utilisa plus deux contenants imbriques', () => {
  assert.ok(HOME.includes('accessibilityLabel="Learn how multisig works"'));
  assert.ok(HOME.includes('>Learn how multisig works<'), 'un seul libelle de surface');
  assert.ok(!HOME.includes('styles.helpBox'), 'l ancien contenant helpBox a disparu');
  assert.ok(!HOME.includes('Learn about multisig'), 'l ancien libelle a disparu');
});

check('4. Inbox disponible n utilise pas le style disabled', () => {
  const idx = HOME.indexOf('accessibilityLabel="Open multisig inbox"');
  assert.ok(idx !== -1, 'le bouton Inbox existe');
  const block = HOME.slice(idx, idx + 240);
  assert.ok(block.includes('variant="secondary"'), 'Inbox utilise le style secondaire reel');
  assert.ok(!block.includes('disabled'), 'Inbox ne doit pas etre disabled');
});

check('5. La barre de statut est coherente avec le theme', () => {
  // UI V2 : theme sombre => contenu clair + fond racine sombre.
  assert.ok(APP.includes('<StatusBar style="light" />'), 'contenu clair demande sur fond sombre');
  assert.ok(APP.includes('colors.background'), 'fond racine issu du theme');
  assert.ok(!APP.includes('style="auto"'), 'plus de contenu auto');
});

check('6. New Proposal conserve KeyboardAvoidingView', () => {
  assert.ok(NEW.includes('<KeyboardAvoidingView behavior="padding"'));
});

check('7. New Proposal possede un padding bas adapte au clavier', () => {
  assert.ok(NEW.includes('paddingBottom: 160'), 'padding bas suffisant pour atteindre le CTA');
});

check('8. Memo reste present', () => {
  assert.ok(NEW.includes('Memo (optional)'));
  assert.ok(NEW.includes('onChangeText={setMemo}'));
});

check('9. Review proposal reste dans le flux de scroll', () => {
  const cta = NEW.indexOf('<Text style={styles.buttonText}>Review proposal</Text>');
  const scrollEnd = NEW.indexOf('</ScrollView>');
  assert.ok(cta !== -1 && scrollEnd !== -1);
  assert.ok(cta < scrollEnd, 'le CTA ne doit pas sortir du ScrollView');
  assert.ok(!NEW.includes('position: \'absolute\''), 'aucun CTA flottant/sticky');
});

check('10. Aucun handler du formulaire n est modifie', () => {
  assert.ok(NEW.includes('onChangeText={setDestination}'));
  assert.ok(NEW.includes('onChangeText={setSolText}'));
  assert.ok(NEW.includes('onChangeText={setBufferText}'));
  assert.ok(NEW.includes('onChangeText={setMemo}'));
});

check('11. Advanced details est ferme par defaut', () => {
  assert.ok(DETAILS.includes('const [advancedOpen, setAdvancedOpen] = useState(false)'));
  assert.ok(DETAILS.includes("advancedOpen ? '▾ Advanced details' : '▸ Advanced details'"));
  assert.ok(DETAILS.includes('accessibilityState={{ expanded: advancedOpen }}'));
});

check('12. Config authority figure dans Advanced details', () => {
  assert.ok(DETAILS.indexOf('Config authority') > DETAILS.indexOf('{advancedOpen ? ('));
});

check('13. Rent collector figure dans Advanced details', () => {
  assert.ok(DETAILS.indexOf('Rent collector') > DETAILS.indexOf('{advancedOpen ? ('));
});

check('14. Program figure dans Advanced details', () => {
  assert.ok(
    DETAILS.indexOf('multisig.PROGRAM_ID.toString()') > DETAILS.indexOf('{advancedOpen ? ('),
  );
});

check('15. Refresh disponible utilise un style secondaire, pas disabled', () => {
  assert.ok(LIST.includes('styles.secondaryPressed'), 'Refresh a un etat appuye');
  assert.ok(PD.includes('styles.secondaryPressed'), 'Refresh proposal a un etat appuye');
  assert.ok(LIST.includes('pressed && styles.secondaryPressed'));
  assert.ok(PD.includes('pressed && styles.secondaryPressed'));
  // Les actions disponibles gardent un style secondaire reel (bordure).
  // Groupe 2 : ProposalListScreen est passe au theme sombre -> bordure par token.
  assert.ok(LIST.includes('colors.divider'), 'bordure secondaire via le theme V2');
  assert.ok(PD.includes("borderColor: '#d1d5db'"));
});

check('16. Les etats Approved / Executed restent inchanges', () => {
  assert.equal(PROPOSAL_ACTION_LABELS.approvedByYou, '✓ Approved by you');
  assert.equal(PROPOSAL_ACTION_LABELS.thresholdReached, '✓ Approval threshold reached');
  assert.equal(PROPOSAL_ACTION_LABELS.executed, '✓ Transaction executed');
  assert.equal(PROPOSAL_ACTION_LABELS.executeCta, 'Execute transaction');
  assert.ok(PD.includes('PROPOSAL_ACTION_LABELS'), 'les libelles terminaux restent rendus');
});

check('17. Aucun wallet, RPC supplementaire, signature ou envoi ajoute', () => {
  assert.ok(APP.includes('MobileWalletProvider'), 'bootstrap wallet inchange');
  // Les fichiers touches par cette revue UI restent strictement en lecture.
  assert.ok(!HOME.includes('signAndSendTransactions'));
  assert.ok(!DETAILS.includes('signAndSendTransactions'));
  assert.ok(!LIST.includes('signAndSendTransactions'));
  assert.ok(!HOME.includes('getProgramAccounts'), 'aucune lecture supplementaire ajoutee');
});

setTimeout(() => {
  console.log(`\n${passed} test(s) OK`);
  if (process.exitCode === 1) process.exit(1);
}, 50);
