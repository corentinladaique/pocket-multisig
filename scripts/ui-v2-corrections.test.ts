import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

/**
 * UI V2 — corrections du Groupe 1 (contrastes, Home compact, état sans
 * multisig, To do compact, Your wallet compact, navigation Receive, glyphes).
 *
 * Assertions par lecture des sources : le projet n'a pas de renderer.
 * Execution : npx tsx scripts/ui-v2-corrections.test.ts
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
const PRIM = readFileSync('src/ui/v2/primitives.tsx', 'utf8');
const PACKAGE = readFileSync('package.json', 'utf8');

const ACTIONS_GATE = CONNECT.indexOf('{view === null ? null : (');

check('1. Aucun texte principal noir sur les surfaces V2 sombres', () => {
  // Les styles montent desormais leurs couleurs depuis le theme sombre.
  assert.ok(CONNECT.includes('balanceValue: {\n    color: colors.text'), 'solde en theme.text');
  assert.ok(CONNECT.includes('fieldValue: {\n    color: colors.text'), 'valeurs en theme.text');
  assert.ok(CONNECT.includes('todoTitle: {\n    color: colors.text'), 'titre to-do en theme.text');
});

check('2. Balance utilise theme.text', () => {
  assert.ok(CONNECT.includes('balanceValue: {\n    color: colors.text'));
});

check('3. Wallet label utilise une couleur lisible', () => {
  assert.ok(CONNECT.includes('walletLabel: {\n    color: colors.text'));
});

check('4. Technical details utilise une couleur lisible', () => {
  assert.ok(CONNECT.includes('detailsToggleText: {\n    color: colors.textSecondary'));
  assert.ok(CONNECT.includes('memberLine: {\n    color: colors.textSecondary'));
});

check('5. Sans multisig, Receive est absent', () => {
  assert.ok(ACTIONS_GATE > 0, 'les actions sont conditionnees');
  assert.equal(CONNECT.split('label="Receive"').length - 1, 1);
  assert.ok(CONNECT.indexOf('label="Receive"') > ACTIONS_GATE);
});

check('6. Sans multisig, Propose est absent', () => {
  assert.equal(CONNECT.split('label="Propose"').length - 1, 1);
  assert.ok(CONNECT.indexOf('label="Propose"') > ACTIONS_GATE);
});

check('7. Sans multisig, Signers est absent', () => {
  assert.equal(CONNECT.split('label="Signers"').length - 1, 1);
  assert.ok(CONNECT.indexOf('label="Signers"') > ACTIONS_GATE);
});

check('8. Sans multisig, Add existing multisig est disponible', () => {
  assert.ok(
    CONNECT.includes('const manageExpanded = view === null || moreOpen;'),
    'la section More soccupe si aucun vault',
  );
  assert.ok(CONNECT.includes('accessibilityLabel="Add an existing multisig"'));
});

check('9. Sans multisig, Create a vault est disponible', () => {
  assert.ok(CONNECT.includes('accessibilityLabel="Create a vault"'));
  assert.ok(CONNECT.includes('label="Create a vault"'));
});

check('10. Vault charge, les trois actions sont visibles', () => {
  assert.ok(CONNECT.includes('label="Receive"'));
  assert.ok(CONNECT.includes('label="Propose"'));
  assert.ok(CONNECT.includes('label="Signers"'));
});

check('11. Roles techniques absents de la carte principale', () => {
  assert.ok(!CONNECT.includes('My multisig · '), 'plus de liste de roles sur la carte');
  assert.ok(CONNECT.includes("homeIsMember ? 'My multisig' : 'Observed multisig · Read only'"));
});

check('12. Gros Refresh balance absent de la carte principale', () => {
  assert.ok(!CONNECT.includes(": 'Refresh balance'"), 'plus de libelle long pleine largeur');
  assert.ok(CONNECT.includes("? 'Retry'"), 'action inline compacte');
  assert.ok(CONNECT.includes('styles.inlineAction'));
});

check('13. To do utilise des cartes compactes', () => {
  assert.ok(CONNECT.includes('styles.todoRow'), 'ligne compacte cliquable');
  assert.ok(!CONNECT.includes('styles.todoCard'), 'plus de grande carte to-do');
});

check('14. Refresh proposals n est plus un gros CTA principal', () => {
  assert.ok(!CONNECT.includes('label="Refresh proposals"'), 'plus de bouton pleine largeur');
  assert.ok(CONNECT.includes("'Refreshing…' : 'Refresh'"), 'action inline dans l en-tete To do');
});

check('15. Your wallet utilise une ligne compacte', () => {
  assert.ok(CONNECT.includes('styles.walletRow'), 'ligne compacte');
  assert.ok(!CONNECT.includes('styles.walletCard'), 'plus de grande carte wallet');
});

check('16. Copy conserve son handler', () => {
  assert.ok(CONNECT.includes('onPress={onCopyWallet}'));
  assert.ok(CONNECT.includes('copyToClipboard(account.address.toString())'));
});

check('17. Receive utilise ScrollView', () => {
  assert.ok(RECEIVE.includes('<AppScreen'), 'Receive passe par AppScreen');
  assert.ok(PRIM.includes('<ScrollView'), 'AppScreen scrolle (Safe Area compatible)');
  assert.ok(PRIM.includes('SAFE_TOP_PADDING'), 'Safe Area prise en compte');
});

check('18. Receive gere le BackHandler Android', () => {
  assert.ok(RECEIVE.includes('BackHandler.addEventListener'));
  assert.ok(RECEIVE.includes("'hardwareBackPress'"));
});

check('19. Receive supprime le gros bouton Back to vault', () => {
  assert.ok(!RECEIVE.includes('label="Back to vault"'), 'plus de bouton bas pleine largeur');
});

check('20. Receive conserve le bouton retour superieur', () => {
  assert.ok(RECEIVE.includes('accessibilityLabel="Back to vault"'));
  assert.ok(RECEIVE.includes('onPress={onBack}'));
});

check('21. Receive affiche toujours l adresse Main vault complete', () => {
  assert.ok(RECEIVE.includes('{address}'), 'adresse complete, selectionnable');
  assert.ok(RECEIVE.includes('selectable'), 'adresse selectionnable');
});

check('22. Aucune adresse blockchain modifiee', () => {
  assert.ok(!RECEIVE.includes('getVaultPda'), 'Receive ne derive aucune adresse');
  assert.ok(CONNECT.includes('<ReceiveScreen address={viewVaultAddress}'), 'toujours le vault courant');
  assert.ok(
    !/[1-9A-HJ-NP-Za-km-z]{32,}/.test(RECEIVE),
    'aucune adresse codee en dur dans Receive',
  );
});

check('23. Aucun nouvel appel wallet', () => {
  assert.ok(!/useMobileWallet|authorizeSession/.test(RECEIVE));
  assert.ok(!/useMobileWallet|authorizeSession/.test(PRIM));
});

check('24. Aucune transaction ni signature', () => {
  assert.ok(!/signTransaction|signAndSendTransactions|sendTransaction/.test(RECEIVE));
  assert.ok(!/signTransaction|signAndSendTransactions|sendTransaction/.test(PRIM));
});

check('25. Aucun package ajoute', () => {
  assert.ok(!PACKAGE.includes('qrcode'), 'pas de package QR');
  assert.ok(!/@expo\/vector-icons/.test(PRIM), 'pas de package d icones');
});

check('26. Les workflows existants restent inchanges', () => {
  assert.ok(existsSync('.github/workflows/ci.yml'), 'la CI existe toujours');
  const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
  assert.ok(ci.length > 0, 'la CI nest pas videe');
});

setTimeout(() => {
  console.log(`\n${passed} test(s) OK`);
  if (process.exitCode === 1) process.exit(1);
}, 50);
