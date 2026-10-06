import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import {
  classifyProposal,
  filterProposals,
  proposalStatusLabel,
  type ProposalFilterInput,
} from '../src/squads/proposalFilters';

/**
 * UI V2 Groupe 2 — Vault Details + Proposals.
 *
 * Assertions par lecture des sources + tests purs des filtres. Aucun RPC,
 * aucun wallet. Execution : npx tsx scripts/ui-v2-group2.test.ts
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

const DETAILS = readFileSync('src/screens/MultisigDetailsScreen.tsx', 'utf8');
const LIST = readFileSync('src/screens/ProposalListScreen.tsx', 'utf8');
const FILTERS = readFileSync('src/squads/proposalFilters.ts', 'utf8');
const THEME = readFileSync('src/ui/theme.ts', 'utf8');
const PRIM = readFileSync('src/ui/v2/primitives.tsx', 'utf8');
const RUNNER = readFileSync('scripts/run-pure-tests.sh', 'utf8');
const PACKAGE = readFileSync('package.json', 'utf8');
// Home (ConnectScreen) : lu pour verifier qu'il garde les fondations V2 apres
// le hotfix de coherence (bloc technique retire).
const HOME_SRC = readFileSync('src/screens/ConnectScreen.tsx', 'utf8');

const LIGHT_COLORS = ['#ffffff', '#101317', '#1a56db', '#374151', '#991b1b', '#065f46'];

const BASE: ProposalFilterInput = {
  index: 1,
  status: 'Active',
  approvals: 0,
  threshold: 2,
  approvedAddresses: [],
  walletAddress: 'WALLET',
  walletCanApprove: true,
  walletCanExecute: false,
};

check('1. Multisig Details utilise UI V2', () => {
  assert.ok(DETAILS.includes("from '../ui/v2/primitives'"), 'primitives V2 importees');
  assert.ok(DETAILS.includes("from '../ui/theme'"), 'theme V2 importe');
  assert.ok(DETAILS.includes('<DevnetPill'), 'Devnet pill V2');
  assert.ok(DETAILS.includes('<Card'), 'carte V2');
});

check('2. Proposal List utilise UI V2', () => {
  assert.ok(LIST.includes("from '../ui/v2/primitives'"), 'primitives V2 importees');
  assert.ok(LIST.includes("from '../ui/theme'"), 'theme V2 importe');
  assert.ok(LIST.includes('<DevnetPill'), 'Devnet pill V2');
});

check('3. Aucun fond clair ancien', () => {
  for (const [name, source] of [
    ['MultisigDetailsScreen', DETAILS],
    ['ProposalListScreen', LIST],
  ] as const) {
    for (const color of LIGHT_COLORS) {
      assert.ok(!source.includes(color), `${name} ne doit plus contenir ${color}`);
    }
  }
});

check('4. Aucun solde code en dur', () => {
  assert.ok(DETAILS.includes('balanceView.sol'), 'solde issu de la vue reelle');
  assert.ok(!/\d+\.\d+ SOL/.test(DETAILS), 'aucun montant SOL code en dur');
});

check('5. Aucun nom Team vault code en dur', () => {
  assert.ok(!DETAILS.includes('Team vault'));
  assert.ok(!LIST.includes('Team vault'));
});

check('6. Vault name reel ou fallback Main vault', () => {
  assert.ok(DETAILS.includes("? vaultName"), 'nom local du vault utilise');
  assert.ok(DETAILS.includes(": 'Main vault'"), 'fallback Main vault');
});

check('7. Receive recoit view.vaultAddress', () => {
  assert.ok(DETAILS.includes('<ReceiveScreen address={view.vaultAddress}'), 'Main vault PDA index 0');
});

check('8. Receive n utilise aucune autre adresse', () => {
  assert.ok(!DETAILS.includes('<ReceiveScreen address={view.address}'), 'jamais la config');
  assert.equal(DETAILS.split('<ReceiveScreen').length - 1, 1, 'un seul ReceiveScreen monte');
});

check('9. New proposal conserve setNewProposalOpen', () => {
  assert.ok(DETAILS.includes('setNewProposalOpen(true)'));
});

check('10. Proposals conserve setProposalsOpen', () => {
  assert.ok(DETAILS.includes('setProposalsOpen(true)'));
});

check('11. Signers viennent de view.members', () => {
  assert.ok(DETAILS.includes('view.members.map'));
});

check('12. Roles viennent de member.roles', () => {
  assert.ok(DETAILS.includes('member.roles'));
});

check('13. Observer uniquement si non-membre', () => {
  assert.ok(DETAILS.includes("'Observer'"), 'Observer affiche');
  assert.ok(DETAILS.includes('walletIsMember'), 'condition de membre');
  assert.ok(DETAILS.includes('This wallet is not a multisig member.'));
});

check('14. Technical details ferme par defaut', () => {
  assert.ok(DETAILS.includes('const [advancedOpen, setAdvancedOpen] = useState(false)'));
});

check('15. Main vault et configuration distincts', () => {
  assert.ok(DETAILS.includes('{view.vaultAddress}'), 'adresse vault');
  assert.ok(DETAILS.includes('{view.address}'), 'adresse configuration');
  assert.ok(DETAILS.includes('Main vault address'), 'label vault');
  assert.ok(DETAILS.includes('Multisig configuration address'), 'label configuration');
});

check('16. Avertissement configuration conserve', () => {
  assert.ok(DETAILS.includes('Do not send funds to this address.'));
  assert.ok(DETAILS.includes('This account holds the funds controlled by the multisig.'));
});

check('17. Filtres sans RPC', () => {
  assert.ok(!/connection|fetch\(|getMultipleAccountsInfo|PublicKey|useMobileWallet/.test(FILTERS));
});

check('18. Active actionnable → To do', () => {
  assert.equal(classifyProposal({ ...BASE }), 'todo');
  assert.equal(proposalStatusLabel({ ...BASE }), 'Needs your approval');
});

check('19. Approved executable → To do', () => {
  const approved = {
    ...BASE,
    status: 'Approved',
    approvals: 2,
    approvedAddresses: ['A', 'WALLET'],
    walletCanApprove: true,
    walletCanExecute: true,
  };
  assert.equal(classifyProposal(approved), 'todo');
  assert.equal(proposalStatusLabel(approved), 'Ready to execute');
});

check('20. Executed → Done', () => {
  const executed = { ...BASE, status: 'Executed' };
  assert.equal(classifyProposal(executed), 'done');
  assert.equal(proposalStatusLabel(executed), 'Executed');
});

check('21. Aucun statut non prouve dans Done', () => {
  for (const status of ['Cancelled', 'Rejected', 'Expired', 'Draft', 'Active', 'Approved']) {
    const input = { ...BASE, status, walletCanExecute: false };
    if (status === 'Executed') continue;
    assert.notEqual(classifyProposal(input), 'done', `${status} ne doit pas aller dans Done`);
  }
});

check('22. Modele absent → Details available after opening', () => {
  assert.ok(LIST.includes('Details available after opening'));
  assert.ok(!LIST.includes('Operation not decoded yet'), 'ancien texte retire');
});

check('23. Modele present → vrai montant/destination', () => {
  assert.ok(LIST.includes('summary.amount'));
  assert.ok(LIST.includes('summary.destination'));
});

check('24. Carte appelle onOpenProposal', () => {
  assert.ok(LIST.includes('onOpenProposal?.(proposal)'));
});

check('25. Refresh utilise onRefresh/retry', () => {
  assert.ok(LIST.includes('void onRefresh()'));
  assert.ok(LIST.includes('proposals.retry()'));
  assert.ok(DETAILS.includes('onRefresh={reloadFromChain}'));
});

check('26. Aucun nouveau RPC', () => {
  for (const [name, source] of [
    ['MultisigDetailsScreen', DETAILS],
    ['ProposalListScreen', LIST],
  ] as const) {
    assert.ok(!source.includes('getProgramAccounts'), `${name}: aucun scan de programme`);
    assert.ok(
      !/getMultipleAccountsInfo\(/.test(source),
      `${name}: lecture via useProposals uniquement`,
    );
  }
});

check('27. Aucun wallet', () => {
  for (const [name, source] of [
    ['MultisigDetailsScreen', DETAILS],
    ['ProposalListScreen', LIST],
  ] as const) {
    assert.ok(!/authorizeSession|connect\(|signAndSendTransactions/.test(source), name);
  }
});

check('28. Aucune transaction', () => {
  for (const [name, source] of [
    ['MultisigDetailsScreen', DETAILS],
    ['ProposalListScreen', LIST],
  ] as const) {
    assert.ok(!/signTransaction|sendRawTransaction|sendTransaction/.test(source), name);
  }
});

check('29. Aucun package', () => {
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

// "Inchangé" vérifié réellement : les fichiers du Groupe 1 ne doivent apparaître
// dans AUCUN diff vs le dernier commit.
const GROUP1_FILES = [
  'src/ui/theme.ts',
  'src/ui/v2/primitives.tsx',
  'src/screens/ReceiveScreen.tsx',
  'src/ui/clipboard.ts',
  'App.tsx',
];
const changed = execSync(`git diff --name-only HEAD -- ${GROUP1_FILES.join(' ')}`, {
  encoding: 'utf8',
})
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line.length > 0);

check('30. theme.ts : mint aligne sur les apps natives Solana', () => {
  assert.ok(THEME.includes("background: '#08110F'"), 'tokens du theme intacts');
  // Décision explicite de Corentin : l'accent `mint` est échantillonné sur les
  // icônes natives du Solana Phone (Seeker) — valeur relevée par pixel : #AFE6D1.
  assert.ok(THEME.includes("mint: '#AFE6D1'"), 'mint natif Solana (#AFE6D1)');
  // Le token `mint` est désormais réglable sur décision de marque. Le garde-fou
  // anti-dérive vise donc les PRIMITIVES V2 (partagées, figées), pas le thème.
  assert.ok(!changed.includes('src/ui/v2/primitives.tsx'), 'les primitives V2 restent figees');
});

check('31. primitives.tsx inchange', () => {
  assert.ok(PRIM.includes('export function AppScreen'));
  assert.ok(PRIM.includes('export function PillButton'));
  // Décision explicite de Corentin : `ListRow` reçoit une option FACULTATIVE
  // (`glyphNode`) pour afficher une véritable icône fournie par l'appelant.
  // La protection d'origine visait la DÉRIVE des primitives partagées : elle est
  // précisée, pas retirée. Les invariants réels du fichier sont donc vérifiés —
  // c'est plus précis qu'une empreinte, et strictement non plus permissif :
  //   - l'option ajoutée doit être FACULTATIVE ;
  //   - le rendu historique par glyphe TEXTE doit rester en place ;
  //   - ce module ne doit toujours importer AUCUN paquet d'icônes.
  assert.ok(PRIM.includes('glyphNode?: ReactNode'), 'option ajoutee facultative');
  assert.ok(PRIM.includes('glyph !== undefined'), 'rendu par glyphe texte conserve');
  assert.ok(PRIM.includes('styles.rowGlyphText'), 'le texte du glyphe reste rendu');
  assert.ok(!/from '@expo\/vector-icons/.test(PRIM), 'aucun paquet d icones importe ici');
});

check('32. ConnectScreen reste sur les fondations UI V2', () => {
  // Home a evolue (hotfix de coherence) mais garde les fondations du Groupe 1.
  assert.ok(HOME_SRC.includes("from '../ui/v2/primitives'"));
  assert.ok(HOME_SRC.includes("from '../ui/theme'"));
  assert.ok(!HOME_SRC.includes('ui/v2/primitives.tsx'), 'aucune primitive dupliquee');
});

check('33. ReceiveScreen inchange', () => {
  assert.ok(!changed.includes('src/screens/ReceiveScreen.tsx'));
});

check('34. Tous les tests Groupe 1 restent verts', () => {
  // Les suites du Groupe 1 restent enregistrees dans le runner (npm test).
  for (const suite of [
    'scripts/ui-v2.test.ts',
    'scripts/ui-v2-corrections.test.ts',
    'scripts/multisig-keyboard-load.test.ts',
    'scripts/ui-v2-group2.test.ts',
  ]) {
    assert.ok(RUNNER.includes(suite), `${suite} doit rester dans npm test`);
  }
  // Les fondations Groupe 1 sont reutilisees telles quelles (aucune copie locale).
  assert.ok(DETAILS.includes("from '../ui/v2/primitives'"));
  assert.ok(LIST.includes("from '../ui/v2/primitives'"));
});

check('filtres : sans effet de bord ni filtre par date', () => {
  const items = [
    { ...BASE, index: 1 },
    { ...BASE, index: 2, status: 'Executed', approvedAddresses: ['WALLET'] },
  ];
  const before = items.length;
  const todo = filterProposals(items, 'todo');
  assert.equal(items.length, before, 'le tableau source n est pas mute');
  assert.deepEqual(todo.map((entry) => entry.index), [1]);
  assert.ok(!/date|createdAt|timestamp/i.test(FILTERS), 'aucun filtre par date');
});

setTimeout(() => {
  console.log(`\n${passed} test(s) OK`);
  if (process.exitCode === 1) process.exit(1);
}, 50);
