import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { formatSol, lamportsToSolDisplay } from '../src/wallet/vaultBalance';
import { deriveVaultVisibleState } from '../src/wallet/vaultCreationState';
import { decomposeCreationCost } from '../src/vault/multisigCreationCost';
import {
  DEVNET_SOL_DISCLAIMER,
  formatPriceUpdatedAt,
  formatUsdEstimate,
  USD_ESTIMATE_UNAVAILABLE,
} from '../src/wallet/fiatEstimate';

/**
 * Coût en SOL (jamais en lamports) + état terminal de Create Vault.
 * Modules purs + sources lues ; aucun wallet, aucun reseau.
 * npx tsx scripts/sol-cost-display.test.ts
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
const BALANCE = readFileSync('src/wallet/vaultBalance.ts', 'utf8');
const FIAT = readFileSync('src/wallet/fiatEstimate.ts', 'utf8');
const COST = readFileSync('src/vault/multisigCreationCost.ts', 'utf8');

const GUARD_OPEN = CREATE.indexOf('{!createdAndVerified ? (');
const SUCCESS_OPEN = CREATE.indexOf('{createdAndVerified ? (');
const NOT_VERIFIED = CREATE.slice(GUARD_OPEN, SUCCESS_OPEN);
const SUCCESS = CREATE.slice(SUCCESS_OPEN, CREATE.indexOf('{/* TROUBLESHOOTING'));

check('1. 1 666 080 lamports -> 0.00166608 SOL', () => {
  assert.equal(lamportsToSolDisplay(1_666_080), '0.00166608 SOL');
});

check('2. 1 lamport -> 0.000000001 SOL', () => {
  assert.equal(lamportsToSolDisplay(1), '0.000000001 SOL');
});

check('3. 1 000 000 000 lamports -> 1 SOL', () => {
  assert.equal(lamportsToSolDisplay(1_000_000_000), '1 SOL');
});

check('4. 0 lamport -> 0 SOL', () => {
  assert.equal(lamportsToSolDisplay(0), '0 SOL');
});

check('5. grande valeur bigint : aucune perte de precision', () => {
  assert.equal(lamportsToSolDisplay(9_007_199_254_740_993n), '9007199.254740993 SOL');
  assert.equal(lamportsToSolDisplay(2n ** 64n), '18446744073.709551616 SOL');
  assert.equal(lamportsToSolDisplay(12345678901234567890n), '12345678901.23456789 SOL');
});

check('6. aucun calcul flottant pour formater les lamports', () => {
  // La conversion lamports -> SOL n'utilise ni Math.*, ni toFixed, ni division flottante.
  assert.ok(!/Math\.|toFixed/.test(BALANCE), 'arithmetique entiere uniquement');
  assert.ok(BALANCE.includes('LAMPORTS_PER_SOL_BIGINT'), 'constante bigint');
  assert.ok(BALANCE.includes('0n'), 'valeurs bigint presentes');
});

check('7. aucun lamport visible dans le parcours Create Vault', () => {
  const texts = [...CREATE.matchAll(/<Text\b[^>]*>([\s\S]*?)<\/Text>/g)].map((match) => match[1]);
  const offending = texts.filter((text) => /lamport/i.test(text.replace(/\{[^}]*\}/g, '')));
  assert.deepEqual(offending, [], `texte JSX avec lamports : ${offending.join(' | ')}`);
});

check('8. total = account creation/rent + network fee', () => {
  const breakdown = decomposeCreationCost({ rentLamports: 890_880, totalLamports: 1_666_080 });
  assert.ok(breakdown !== null);
  assert.equal(breakdown.totalLamports, 1_666_080);
  assert.equal(breakdown.rentLamports, 890_880);
  assert.equal(breakdown.feeLamports, 775_200);
  assert.equal(breakdown.rentLamports + breakdown.feeLamports, breakdown.totalLamports);
});

check('9. composante indisponible : aucune valeur inventee', () => {
  const partial = decomposeCreationCost({ rentLamports: null, totalLamports: 1_666_080 });
  assert.ok(partial !== null, 'le total reste disponible');
  assert.equal(partial.rentLamports, null);
  assert.equal(partial.feeLamports, null);
  // Rent incoherent (superieur au total) : jamais de frais negatif invente.
  const incoherent = decomposeCreationCost({ rentLamports: 9_999_999, totalLamports: 1_666_080 });
  assert.ok(incoherent !== null);
  assert.equal(incoherent.rentLamports, null);
  assert.ok(CREATE.includes('Cost breakdown unavailable'));
});

check('10. prix USD indisponible : creation non bloquee', () => {
  assert.equal(formatUsdEstimate({ lamports: 1_666_080, price: null }), null);
  assert.ok(CREATE.includes('USD_ESTIMATE_UNAVAILABLE'));
  assert.equal(USD_ESTIMATE_UNAVAILABLE, 'USD estimate unavailable.');
  // Aucune recuperation de prix dans le parcours (pas de fetch).
  assert.ok(!/fetch\(|https?:\/\//.test(CREATE), 'aucun appel reseau de prix');
});

check('11. prix USD disponible : heure de mise a jour affichee', () => {
  const price = { fetchedAt: '2026-01-01T11:30:00Z', usdPerSol: 150 };
  assert.equal(formatUsdEstimate({ lamports: 1_000_000_000, price }), '≈ $150.00');
  assert.equal(formatPriceUpdatedAt(price.fetchedAt), 'SOL price updated at 11:30');
  // Horodatage illisible : jamais une heure inventee.
  assert.equal(formatPriceUpdatedAt('not-a-date'), null);
  // Interface prete a recevoir un prix, branchee dans l'ecran.
  assert.ok(CREATE.includes('formatUsdEstimate'));
});

check('12. Devnet : avertissement de non-valeur monetaire affiche', () => {
  assert.ok(CREATE.includes('DEVNET_SOL_DISCLAIMER'));
  assert.ok(DEVNET_SOL_DISCLAIMER.includes('Devnet SOL has no real monetary value'));
  assert.ok(DEVNET_SOL_DISCLAIMER.includes('Mainnet SOL'));
});

check('13. verified masque createReadiness', () => {
  assert.ok(NOT_VERIFIED.includes('createReadiness.userMessage'));
  assert.ok(!SUCCESS.includes('createReadiness'));
});

check('14. verified masque Run the checks again', () => {
  assert.ok(!SUCCESS.includes('Run the checks again'));
});

check('15. verified masque Review and create', () => {
  // Libelle du CTA principal renomme (mission copie) : « Review and create ».
  assert.ok(NOT_VERIFIED.includes('Review and create'));
  assert.ok(!SUCCESS.includes('Review and create'));
});

check('16. verified masque Estimated creation cost', () => {
  assert.ok(!SUCCESS.includes('Estimated creation cost'));
  assert.ok(!SUCCESS.includes('creationCost'));
});

check('17/18. verified affiche Open vault et View proposals', () => {
  assert.ok(SUCCESS.includes('Vault created and verified.'));
  // Les adresses COMPLETES ne sont plus le contenu principal de la carte de
  // succes : elles vivent dans le recu technique replie, meme bloc SUCCESS.
  assert.ok(SUCCESS.includes('Multisig configuration:'));
  assert.ok(SUCCESS.includes('Main vault:'));
  assert.ok(SUCCESS.includes('Open vault'));
  assert.ok(SUCCESS.includes('View proposals'));
  assert.ok(!SUCCESS.includes('onPress={onCreateOnDevnet}'), 'aucun CTA Create residuel');
});

check('19. un unique etat principal rendu a la fois', () => {
  assert.ok(CREATE.includes('{!createdAndVerified ? ('));
  assert.ok(CREATE.includes('{createdAndVerified ? ('));
  for (const state of [
    'signed-pending-confirmation',
    'confirmed-pending-readback',
    'confirmed-readback-temporarily-unavailable',
  ]) {
    assert.ok(NOT_VERIFIED.includes(`vaultVisibleState === '${state}'`), state);
  }
  assert.ok(NOT_VERIFIED.includes("vaultVisibleState === 'awaiting-wallet' ?"));
  assert.equal(
    deriveVaultVisibleState({
      confirmed: true,
      creating: true,
      hasAttempt: true,
      networkFailure: false,
      signatureObtained: true,
      verified: true,
    }),
    'verified',
  );
});

check('20. aucun RPC transactionnel ajoute', () => {
  for (const source of [BALANCE, FIAT, COST]) {
    assert.ok(!/connection|Connection|@solana\/web3\.js/.test(source), 'module pur');
  }
});

check('21. aucun wallet prompt ajoute', () => {
  for (const source of [FIAT, COST]) {
    assert.ok(!/useMobileWallet|authorize|connect\(/.test(source));
  }
});

check('22. aucune signature ou transaction ajoutee', () => {
  for (const source of [FIAT, COST]) {
    assert.ok(!/partialSign|signAndSendTransactions|new Transaction\(/.test(source));
  }
  assert.ok(!/multisigCreateV2|SystemProgram/.test(CREATE));
});

check('formatSol (soldes) garde 9 decimales fixes : non modifie ici', () => {
  assert.equal(formatSol(0), '0.000000000');
  assert.equal(formatSol(1), '0.000000001');
  assert.equal(formatSol(1_234_567_890), '1.234567890');
});

check('refus des entrees insecures pour lamportsToSolDisplay', () => {
  assert.throws(() => lamportsToSolDisplay(1.5), RangeError);
  assert.throws(() => lamportsToSolDisplay(Number.NaN), RangeError);
  assert.throws(() => lamportsToSolDisplay(Number.MAX_SAFE_INTEGER + 1), RangeError);
  assert.equal(lamportsToSolDisplay(Number.MAX_SAFE_INTEGER), '9007199.254740991 SOL');
});

setTimeout(() => {
  console.log(`\n${passed} test(s) OK`);
  if (process.exitCode === 1) process.exit(1);
}, 50);
