import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * Hotfix de coherence Home vs Vault Details.
 *
 * Un seul rendu detaille du multisig doit subsister : MultisigDetailsScreen.
 * Home reste un dashboard compact (aucun identifiant complet, aucun RPC).
 *
 * Assertions par lecture des sources. Execution :
 * npx tsx scripts/ui-v2-coherence.test.ts
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

const HOME = readFileSync('src/screens/ConnectScreen.tsx', 'utf8');
const DETAILS = readFileSync('src/screens/MultisigDetailsScreen.tsx', 'utf8');
const BOTH = `${HOME}\n${DETAILS}`;

check('1. Home n affiche plus le bloc Technical details complet', () => {
  assert.ok(!HOME.includes('Technical details'), 'bloc technique retire');
  assert.ok(!HOME.includes('Toggle technical details'), 'toggle retire');
  assert.ok(!HOME.includes('detailsOpen'), 'etat de repli retire');
});

check('2. Home n affiche plus le Program ID', () => {
  assert.ok(!HOME.includes('PROGRAM_ID'), 'aucun Program ID dans Home');
});

check('3. Home n affiche plus le RPC au premier niveau', () => {
  // Le seul RPC restant est un diagnostic DEV (jamais au premier niveau release).
  const rpc = HOME.indexOf('RPC:');
  const dev = HOME.indexOf('{__DEV__ ? (');
  assert.ok(rpc > 0 && dev > 0 && rpc > dev, 'RPC confine au diagnostic __DEV__');
});

check('4. Home n affiche pas l adresse de configuration complete', () => {
  assert.ok(!HOME.includes('Multisig configuration address'), 'label retire');
  assert.ok(!HOME.includes('Vault address (index 0)'), 'label retire');
});

check('5. View vault details ouvre MultisigDetailsScreen existant', () => {
  // Le libelle VISIBLE n'a pas change. Le repere d'accessibilite porte desormais
  // l'identite de la vue detaillee (il l'a recu de la tuile Signers retiree) :
  // l'action reste identifiable et accessible, seule sa cle a change.
  assert.ok(
    HOME.includes('accessibilityLabel="Open this multisig in the shared detail screen"'),
    'action presente (repere de la vue detaillee)',
  );
  assert.ok(HOME.includes('View vault details ›'), 'libelle visible');
  assert.ok(
    /Open this multisig in the shared detail screen[\s\S]{0,200}setManualDetailsOpen\(true\)/.test(
      HOME,
    ),
    'reutilise le handler de navigation existant',
  );
  assert.ok(HOME.includes('<MultisigDetailsScreen'), 'ouvre la vue existante');
});

check('6. Inbox continue d ouvrir MultisigDetailsScreen existant', () => {
  // Deux points d'entree (Inbox via openEntry, et « View vault details » via
  // manualDetailsOpen) montent LA MEME vue : aucune deuxieme vue creee.
  assert.ok(HOME.includes('manualDetailsOpen && msig.view !== null'));
  assert.ok(HOME.includes('<MultisigDetailsScreen'), 'vue detaillee existante');
  assert.ok(
    DETAILS.includes('export function MultisigDetailsScreen'),
    'la vue est unique et partagee',
  );
});

check('7. Vault Details affiche Main vault address', () => {
  assert.ok(DETAILS.includes('Main vault address'));
});

check('8. Vault Details affiche la phrase des fonds', () => {
  assert.ok(DETAILS.includes('This account holds the funds controlled by the multisig.'));
});

check('9. Vault Details affiche Multisig configuration address', () => {
  assert.ok(DETAILS.includes('Multisig configuration address'));
});

check('10. Vault Details affiche l avertissement de configuration', () => {
  assert.ok(DETAILS.includes('Do not send funds to this address.'));
});

check('11. Aucun handler blockchain modifie', () => {
  assert.ok(!/multisig\.instructions\.|vaultTransactionCreate|proposalApprove|proposalExecute/.test(BOTH));
  assert.ok(!BOTH.includes('proposalCreate'));
});

check('12. Aucun RPC, wallet, envoi ou signature ajoute', () => {
  for (const forbidden of [
    'signAndSendTransactions',
    'signTransaction',
    'sendRawTransaction',
    'authorizeSession',
    'getProgramAccounts',
  ]) {
    assert.ok(!BOTH.includes(forbidden), `interdit: ${forbidden}`);
  }
});

check('une seule vue detaillee : Home ne rend aucun identifiant complet', () => {
  assert.ok(HOME.includes('shortenAddress(view.vaultAddress)'), 'adresse abregée sur Home');
  assert.ok(!HOME.includes('{view.vaultAddress}'), 'adresse complete absente du Home');
});

setTimeout(() => {
  console.log(`\n${passed} test(s) OK`);
  if (process.exitCode === 1) process.exit(1);
}, 50);
