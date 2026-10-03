import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * UI V2 « Seeker style » — Groupe 1 (fondations, Connect, Home, Receive SOL).
 *
 * Assertions par lecture des sources (le projet n'a pas de renderer). Chaque
 * point verrouille un INVARIANT : handler existant réutilisé, données réelles,
 * aucune adresse inventée, aucun wallet/RPC/transaction ajouté.
 *
 * Execution : npx tsx scripts/ui-v2.test.ts
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
const RECEIVE = readFileSync('src/screens/ReceiveScreen.tsx', 'utf8');
const THEME = readFileSync('src/ui/theme.ts', 'utf8');
const PRIM = readFileSync('src/ui/v2/primitives.tsx', 'utf8');
const APP = readFileSync('App.tsx', 'utf8');
const RUNNER = readFileSync('scripts/run-pure-tests.sh', 'utf8');
const PACKAGE = readFileSync('package.json', 'utf8');

// Frontière « écran connecté » : tout ce qui suit ce marqueur est le Home V2.
const HOME_BRANCH = '{account === undefined ? null : (';
const homeStart = CONNECT.indexOf(HOME_BRANCH);

check('1. Connect utilise le handler existant', () => {
  assert.ok(CONNECT.includes('onPress={onConnect}'), 'le CTA Connect reutilise onConnect');
  assert.ok(CONNECT.includes('label="Connect wallet"'), 'CTA Connect wallet present');
});

check('2. Inbox absent de l ecran deconnecte', () => {
  const inbox = CONNECT.indexOf('accessibilityLabel="Open multisig inbox"');
  assert.ok(homeStart > 0 && inbox > homeStart, 'Inbox ne doit vivre que dans le Home connecte');
});

check('3. Loader manuel absent de l ecran deconnecte', () => {
  const loader = CONNECT.indexOf('label="Load multisig"');
  assert.ok(loader > homeStart, 'le loader manuel ne doit vivre que dans le Home connecte');
});

check('4. Diagnostics absents du Connect principal', () => {
  assert.ok(!CONNECT.includes('Icon supplied with the wallet'));
  assert.ok(!CONNECT.includes('Icon supplied by the wallet'));
  assert.ok(!CONNECT.includes('label supplied: '));
});

check('5. RPC absent du Connect principal', () => {
  assert.ok(!CONNECT.includes('>Network: Devnet</Text>'), 'pas de ligne reseau nue en release');
  const rpc = CONNECT.indexOf('Network: Devnet · RPC:');
  const dev = CONNECT.lastIndexOf('{__DEV__ ? (', rpc);
  assert.ok(rpc > 0 && dev > 0 && !CONNECT.slice(dev, rpc).includes(': null'), 'RPC sous __DEV__');
});

check('6. Connecting empeche un double appel', () => {
  assert.ok(CONNECT.includes("busy={phase === 'connecting'}"), 'le CTA passe en busy');
  assert.ok(CONNECT.includes('const busy = phase !== \'idle\''), 'busy derive de phase');
  assert.ok(CONNECT.includes('disabled={busy}'), 'le CTA est desactive pendant la connexion');
});

check('7. Home utilise les vraies donnees du vault', () => {
  assert.ok(CONNECT.includes('${view.threshold} OF ${view.members.length}'), 'badge depuis le vault reel');
  assert.ok(CONNECT.includes('homeVaultName ??'), 'nom local du vault si connu');
});

check('8. Aucun nom "Team vault" code en dur', () => {
  assert.ok(!CONNECT.includes('Team vault'), 'le mockup ne doit pas fuiter dans le code');
});

check('9. Solde affiche depuis l etat reel', () => {
  assert.ok(CONNECT.includes('${homeBalanceView.sol} SOL'), 'solde issu de la vue de solde');
  assert.ok(CONNECT.includes('refreshHomeBalance(viewVaultAddress ?? \'\')'), 'lecture sur le vault courant');
});

check('10. Threshold affiche depuis l etat reel', () => {
  assert.ok(CONNECT.includes('${view.threshold}'), 'threshold lu, jamais code en dur');
  assert.ok(!CONNECT.includes('2 OF 3'), 'aucun 2-of-3 fige dans le rendu');
});

check('11. Receive utilise exclusivement l adresse Main vault index 0', () => {
  assert.ok(
    CONNECT.includes('<ReceiveScreen address={viewVaultAddress}'),
    'Receive recoit le vault courant (index 0)',
  );
  assert.ok(!RECEIVE.includes('@sqds/multisig'), 'Receive ne redérive aucune adresse');
  assert.ok(!RECEIVE.includes("from '../squads"), 'Receive ne lit aucun multisig lui-meme');
  assert.ok(!RECEIVE.includes("from '../solana"), 'Receive ne fait aucun RPC');
});

check('12. Receive n utilise jamais l adresse de configuration', () => {
  assert.ok(!RECEIVE.includes('configAuthority'), 'pas de config authority');
  assert.ok(!RECEIVE.includes('.address}'), 'pas d adresse de configuration');
});

check('13. Receive n utilise jamais l adresse du wallet', () => {
  assert.ok(!RECEIVE.includes('account.address'), 'pas d adresse wallet');
  assert.ok(!RECEIVE.includes('walletAddress'), 'pas de walletAddress');
  assert.ok(!RECEIVE.includes('useMobileWallet'), 'Receive ne touche pas au wallet');
});

check('14. Receive n utilise aucune adresse hardcodee', () => {
  assert.ok(
    !/[1-9A-HJ-NP-Za-km-z]{32,}/.test(RECEIVE),
    'aucune chaine base58 longue (adresse) codee en dur',
  );
});

check('15. Copy address recoit l adresse complete du Main vault', () => {
  assert.ok(RECEIVE.includes('copyToClipboard(address)'), 'copie la valeur recue, telle quelle');
  assert.ok(RECEIVE.includes('{address}'), 'adresse complete affichee, non tronquee');
  assert.ok(RECEIVE.includes('Copy address'), 'action de copie visible');
});

check('16. Copy est indisponible si l adresse manque', () => {
  assert.ok(
    RECEIVE.includes('const available = address !== null && address.length > 0'),
    'disponibilite derivee de la presence de l adresse',
  );
  assert.ok(RECEIVE.includes('if (address === null || address.length === 0) return;'), 'garde de copie');
  assert.ok(RECEIVE.includes('Address unavailable'), 'etat honnete si absente');
});

check('17. Propose conserve son handler existant', () => {
  assert.ok(CONNECT.includes('label="Propose"'), 'action Propose presente');
  const propose = CONNECT.indexOf('label="Propose"');
  assert.ok(CONNECT.slice(propose, propose + 120).includes('setManualDetailsOpen(true)'));
});

check('18. Signers conserve sa navigation existante', () => {
  assert.ok(CONNECT.includes('accessibilityLabel="Open this multisig in the shared detail screen"'));
  const signers = CONNECT.indexOf('label="Signers"');
  assert.ok(CONNECT.slice(signers, signers + 120).includes('setManualDetailsOpen(true)'));
});

check('19. To do utilise des propositions reelles', () => {
  assert.ok(CONNECT.includes('inboxDecisions.slice(0, 3)'), 'trois elements au maximum');
  assert.ok(CONNECT.includes('setOpenDecisionIndex(decision.index)'), 'handler existant vers le detail');
  assert.ok(CONNECT.includes('decision.approvals} of ${decision.threshold} approvals'), 'progression reelle');
});

check('20. Aucun montant d exemple code en dur', () => {
  assert.ok(!CONNECT.includes('0.05 SOL'), 'aucun montant de maquette');
  assert.ok(!CONNECT.includes('0.02 SOL'), 'aucun montant de maquette');
});

check('21. Aucun statut fictif', () => {
  assert.ok(!CONNECT.includes("'Ready'"), 'pas de badge Ready code en dur');
  assert.ok(CONNECT.includes('decision.stateLabel'), 'statut derive de l etat reel');
});

check('22. Aucun nouvel appel wallet', () => {
  assert.ok(!/useMobileWallet|authorizeSession|signAndSendTransactions/.test(RECEIVE));
  assert.ok(!/useMobileWallet|authorizeSession|signAndSendTransactions/.test(PRIM));
});

check('23. Aucune transaction ni signature ajoutee', () => {
  assert.ok(!/signTransaction|signAndSendTransactions|sendTransaction/.test(RECEIVE));
  assert.ok(!/signTransaction|signAndSendTransactions|sendTransaction/.test(PRIM));
});

check('24. Aucun package ajoute', () => {
  assert.ok(!PACKAGE.includes('qrcode'), 'pas de package QR');
  assert.ok(!/@expo\/vector-icons/.test(PRIM), 'pas de package d icones');
});

check('25. Les deux scripts *.check.ts restent exclus de npm test', () => {
  assert.ok(
    !RUNNER.includes('scripts/multisig-creation-preflight.check.ts'),
    'les fixtures reseau restent hors npm test',
  );
  assert.ok(
    !RUNNER.includes('scripts/simulate-multisig-creation.check.ts'),
    'les fixtures reseau restent hors npm test',
  );
});

check('26. Le theme sombre est applique a Connect et Home', () => {
  assert.ok(THEME.includes("background: '#08110F'"), 'fond sombre defini dans le theme');
  assert.ok(CONNECT.includes('colors.background'), 'Connect/Home utilisent le fond du theme');
  assert.ok(APP.includes('colors.background'), 'racine sombre');
  assert.ok(APP.includes('<StatusBar style="light" />'), 'contenu clair sur fond sombre');
});

check('27. Les etats disabled et busy restent distincts', () => {
  assert.ok(PRIM.includes('pillDisabled'), 'style disabled dedie');
  assert.ok(PRIM.includes('busy') && PRIM.includes('ActivityIndicator'), 'etat busy avec indicateur');
  assert.ok(PRIM.includes('accessibilityState={{ busy, disabled: inactive }}'), 'etats annonces');
});

check('28. Tous les ecrans utilisateur sont migres vers UI V2', () => {
  // Fin de la migration : chaque ecran utilise le theme sombre ; tous sauf la vue
  // technique brute utilisent aussi les primitives V2.
  const screens = [
    'ConnectScreen',
    'ReceiveScreen',
    'MultisigDetailsScreen',
    'ProposalListScreen',
    'MultisigInboxScreen',
    'OnboardingScreen',
    'NewProposalScreen',
    'TransactionReviewScreen',
    'ProposalDetailsScreen',
    'TransactionTechnicalDetails',
    'CreateVaultScreen',
  ];
  for (const name of screens) {
    const source = readFileSync(`src/screens/${name}.tsx`, 'utf8');
    assert.ok(source.includes("from '../ui/theme'"), `${name} doit utiliser le theme V2`);
    if (name !== 'TransactionTechnicalDetails') {
      assert.ok(source.includes('ui/v2/primitives'), `${name} doit utiliser les primitives V2`);
    }
  }
});

setTimeout(() => {
  console.log(`\n${passed} test(s) OK`);
  if (process.exitCode === 1) process.exit(1);
}, 50);
