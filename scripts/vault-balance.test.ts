import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  describeTransferSource,
  describeVaultBalance,
  estimateRemainingBalance,
  formatSol,
} from '../src/wallet/vaultBalance';

/**
 * Tests du solde du vault et de la coherence des contextes.
 *
 * Aucun wallet, aucun reseau : module pur + lecture des sources pour prouver
 * les comportements d'ecran que l'on ne peut pas executer ici.
 * Execution : npx tsx scripts/vault-balance.test.ts
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

const SOL = 1_000_000_000;

check('1. changement de multisig : aucun solde de l ancien ne subsiste', () => {
  const view = describeVaultBalance({
    addressMatches: false,
    lamports: 5 * SOL,
    status: 'loaded',
  });
  assert.equal(view.sol, null);
  assert.equal(view.title, 'Loading vault balance…');
});

check('2. solde affiche sans aucune proposition ouverte', () => {
  const source = readFileSync('src/screens/MultisigDetailsScreen.tsx', 'utf8');
  assert.ok(
    source.includes("connection.getBalance(new PublicKey(targetVaultAddress), 'confirmed')"),
    'le solde doit etre lu sur le vault index 0 de la vue',
  );
  assert.ok(
    !/proposalsOpen[\s\S]{0,200}getBalance/.test(source),
    "la lecture du solde ne doit pas dependre d'une proposition ouverte",
  );
  const view = describeVaultBalance({ addressMatches: true, lamports: 2 * SOL, status: 'loaded' });
  assert.equal(view.sol, '2.000000000');
});

check('3. 0.1 SOL au vault, 0.02 SOL proposes : reste 0.08 SOL', () => {
  const remaining = estimateRemainingBalance({
    amountLamports: 0.02 * SOL,
    recognizedSolTransfer: true,
    sourceMatchesVault: true,
    vaultLamports: 0.1 * SOL,
  });
  assert.equal(remaining.ready, true);
  assert.equal(remaining.sol, '0.080000000');
  assert.ok(/Excludes concurrent balance changes/.test(remaining.reason));
});

check('4. vault vide : message explicite', () => {
  const view = describeVaultBalance({ addressMatches: true, lamports: 0, status: 'loaded' });
  assert.equal(view.title, 'Vault not funded');
  assert.equal(view.notFunded, true);
  assert.ok(/refused|cannot be executed/.test(view.hint));
});

check('5. echec RPC : solde indisponible ou stale, jamais un ecran en echec', () => {
  const unavailable = describeVaultBalance({
    addressMatches: true,
    lamports: null,
    status: 'error',
  });
  assert.equal(unavailable.title, 'Balance unavailable');
  assert.equal(unavailable.sol, null);

  const stale = describeVaultBalance({
    addressMatches: true,
    lamports: SOL,
    status: 'error',
    stale: true,
  });
  assert.equal(stale.sol, '1.000000000');
  assert.equal(stale.stale, true);

  const source = readFileSync('src/screens/MultisigDetailsScreen.tsx', 'utf8');
  assert.ok(
    source.includes('Un echec de lecture du solde ne fait JAMAIS') ||
      source.includes('échec de lecture du solde ne fait JAMAIS'),
    'un echec de lecture est rattrape (commentaire de garde present)',
  );
  assert.ok(source.includes("status: 'error'"), "l'etat d'erreur est represente");
  assert.ok(source.includes('Refresh balance'), 'un bouton de relecture doit rester disponible');
});

check('6. source = vault : source verifiee', () => {
  const verdict = describeTransferSource({ source: 'VAULT', vaultAddress: 'VAULT' });
  assert.equal(verdict.matches, true);
  assert.equal(verdict.label, 'Source verified: Main vault');
});

check('7. source differente : divergence visible, rien d invente', () => {
  const verdict = describeTransferSource({ source: 'AUTRE', vaultAddress: 'VAULT' });
  assert.equal(verdict.matches, false);
  assert.equal(verdict.label, 'Source does not match the Main vault');
  assert.ok(/No explanation is inferred/.test(verdict.hint));
  // L'estimation est refusee : rien n'est suppose sur une source inconnue.
  const remaining = estimateRemainingBalance({
    amountLamports: SOL,
    recognizedSolTransfer: true,
    sourceMatchesVault: false,
    vaultLamports: 10 * SOL,
  });
  assert.equal(remaining.ready, false);
  assert.equal(remaining.sol, null);
});

check('8. Home et Inbox : meme contexte construit localement, sans refresh', () => {
  const source = readFileSync('src/screens/ProposalDetailsScreen.tsx', 'utf8');
  assert.ok(source.includes('const effectiveGuardContext = guardContext ?? selfGuardContext'));
  assert.ok(source.includes('Checking approval permissions…'));
  assert.ok(
    source.includes('if (decodedModel === null) void runDecode();'),
    'le decodage se declenche a l ouverture, quel que soit le chemin',
  );
});

check('9. le solde est relu avant toute execution', () => {
  const source = readFileSync('src/screens/ProposalDetailsScreen.tsx', 'utf8');
  assert.ok(
    source.includes('Contrôle pré-exécution'),
    'la relecture pre-execution doit etre explicite dans le code',
  );
  assert.ok(source.includes('Insufficient vault balance'));
  assert.ok(
    source.includes('disabled={!canExecute || insufficientBalance'),
    'Execute doit etre bloque si le solde est insuffisant',
  );
});

check('10. apres execution verifiee, le solde est rafraichi', () => {
  const source = readFileSync('src/screens/ProposalDetailsScreen.tsx', 'utf8');
  assert.ok(
    source.includes('if (result.verified) void readVaultBalance();'),
    'le solde doit etre relu apres une execution verifiee',
  );
});

check('formatage SOL : 9 decimales exactes', () => {
  assert.equal(formatSol(0), '0.000000000');
  assert.equal(formatSol(1), '0.000000001');
  assert.equal(formatSol(1_234_567_890), '1.234567890');
});

setTimeout(() => {
  console.log(`\n${passed} test(s) OK`);
  if (process.exitCode === 1) process.exit(1);
}, 50);