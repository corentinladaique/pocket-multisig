import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * UI V2 — Groupe A : My multisigs / Inbox (MultisigInboxScreen) + Learn
 * (OnboardingScreen). Assertions par lecture des sources.
 *
 * Execution : npx tsx scripts/ui-v2-group25.test.ts
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

const INBOX = readFileSync('src/screens/MultisigInboxScreen.tsx', 'utf8');
const LEARN = readFileSync('src/screens/OnboardingScreen.tsx', 'utf8');
const PACKAGE = readFileSync('package.json', 'utf8');

const LIGHT = ['#ffffff', '#101317', '#111827', '#1a56db', '#374151', '#4b5563', '#991b1b', '#f9fafb'];

check('1. My multisigs utilise UI V2', () => {
  assert.ok(INBOX.includes("from '../ui/v2/primitives'"), 'primitives V2');
  assert.ok(INBOX.includes("from '../ui/theme'"), 'theme V2');
  assert.ok(INBOX.includes('<DevnetPill'), 'Devnet pill');
  assert.ok(INBOX.includes('My multisigs'));
});

check('2. Inbox utilise UI V2', () => {
  // L'inbox locale EST l'ecran de liste des multisigs (meme composant).
  assert.ok(INBOX.includes("from '../ui/v2/primitives'"));
  assert.ok(INBOX.includes('useMultisigRegistry'));
});

check('3. Learn utilise UI V2', () => {
  assert.ok(LEARN.includes("from '../ui/v2/primitives'"), 'primitives V2');
  assert.ok(LEARN.includes("from '../ui/theme'"), 'theme V2');
  assert.ok(LEARN.includes('<DevnetPill'), 'Devnet pill');
});

check('4. Aucun fond clair legacy', () => {
  for (const [name, source] of [
    ['MultisigInboxScreen', INBOX],
    ['OnboardingScreen', LEARN],
  ] as const) {
    for (const color of LIGHT) {
      assert.ok(!source.includes(color), `${name} ne doit plus contenir ${color}`);
    }
  }
});

check('5. Chaque multisig utilise son handler existant', () => {
  assert.ok(INBOX.includes('onPress={() => onOpenMultisig(entry)}'));
  assert.ok(INBOX.includes('key={entry.address}'), 'cle stable par adresse');
});

check('6. Aucun RPC ajoute par carte', () => {
  assert.ok(!/getBalance|getAccountInfo|getMultipleAccountsInfo|connection\./.test(INBOX));
});

check('7. Aucun faux solde', () => {
  assert.ok(!/\d+(\.\d+)? SOL/.test(INBOX), 'aucun montant code en dur');
  assert.ok(!/balance/i.test(INBOX), 'aucun solde invente');
});

check('8. Aucun faux nom', () => {
  assert.ok(!INBOX.includes('Team vault'));
  assert.ok(INBOX.includes("entry.vaultName.length > 0 ? entry.vaultName : 'Untitled vault'"));
});

check('9. Inbox utilise uniquement ses decisions reelles', () => {
  assert.ok(INBOX.includes('registry.entries.map'), 'source = registre local reel');
  assert.ok(!/proposalFilters|classifyProposal/.test(INBOX), 'pas de duplication de filtres');
});

check('10. Learn preserve le modele de reponses explicites', () => {
  assert.ok(LEARN.includes('EMPTY_ANSWERS'), 'etat initial vide');
  assert.ok(LEARN.includes('selectLevel(previous, option)'));
  assert.ok(LEARN.includes('selectGoal(previous, option)'));
  assert.ok(LEARN.includes('toggleSigningMean(previous, option)'));
  assert.ok(!LEARN.includes('touched'), 'aucun flag global');
  assert.ok(LEARN.includes('isAnswersComplete(answers)'));
  assert.ok(!LEARN.includes("'new-to-multisig'"), 'aucun fallback code en dur');
});

check('11. Reponse 2 ne selectionne jamais la reponse 1', () => {
  assert.ok(LEARN.includes('const selected = answers.level === option.value;'));
  assert.ok(LEARN.includes('const selected = answers.goal === option.value;'));
  assert.ok(!/optionSelected[\s\S]{0,40}LEVEL_OPTIONS\[0\]/.test(LEARN));
});

check('12. accessibilityState.selected preserve', () => {
  assert.ok(LEARN.includes('accessibilityState={{ selected }}'));
  assert.ok(LEARN.includes('accessibilityLabel={option.label}'));
  assert.ok(LEARN.includes('styles.optionCheck'), 'coche visible');
});

check('13. Aucun wallet', () => {
  for (const source of [INBOX, LEARN]) {
    assert.ok(!/useMobileWallet|authorizeSession/.test(source));
  }
});

check('14. Aucune transaction', () => {
  for (const source of [INBOX, LEARN]) {
    assert.ok(!/signTransaction|signAndSendTransactions|sendRawTransaction/.test(source));
  }
});

check('15. Aucun package', () => {
  assert.ok(!PACKAGE.includes('qrcode'));
  // Décision explicite : `@expo/vector-icons` est autorisé pour la navigation V2.
  // La règle d'origine tient pour tout le reste : aucun paquet SVG, et un seul
  // paquet d'icônes — celui qui a été explicitement autorisé.
  assert.ok(!/react-native-svg/.test(PACKAGE), 'aucun paquet SVG');
  assert.ok(
    PACKAGE.split('vector-icons').length - 1 === 1,
    'un seul paquet d icones, explicitement autorise',
  );
});

setTimeout(() => {
  console.log(`\n${passed} test(s) OK`);
  if (process.exitCode === 1) process.exit(1);
}, 50);
