import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { describeVaultBalance } from '../src/wallet/vaultBalance';
import { isMaxSnapshotCurrent, maxSnapshotFrom, computeMaxTransfer } from '../src/vault/maxTransfer';

/**
 * Tests du hotfix Home / Max / safe area. Aucun wallet, aucun reseau.
 * Execution : npx tsx scripts/home-hotfix.test.ts
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
const DETAILS = readFileSync('src/screens/ProposalDetailsScreen.tsx', 'utf8');
const PROPOSAL = readFileSync('src/screens/NewProposalScreen.tsx', 'utf8');
const LIST = readFileSync('src/screens/ProposalListScreen.tsx', 'utf8');

check('1. Main vault : une seule explication, pas de doublon', () => {
  const view = describeVaultBalance({
    addressMatches: true,
    lamports: 1_000_000_000,
    status: 'loaded',
  });
  assert.equal(view.hint, '', 'le module ne doit plus fournir dexplication en plus des ecrans');
  const occurrences = HOME.split('This account holds the funds controlled by the multisig.').length - 1;
  assert.equal(occurrences, 1, `explication presente ${occurrences} fois`);
});

check('2. Main vault : aucune zone vide issue dune donnee absente', () => {
  assert.ok(
    HOME.includes('{homeBalanceView.hint.length > 0 ? ('),
    "l'explication conditionnelle doit etre omise si vide",
  );
  assert.ok(HOME.includes('MAIN VAULT'), 'le bloc doit etre titré en clair');
  assert.ok(HOME.includes('styles.balanceValue'), 'le solde doit etre mis en avant');
});

check('3. Home -> Proposal : Approve sans Refresh si le guard autorise', () => {
  assert.ok(
    DETAILS.includes('useEffect(() => {\n    void runDecode();'),
    'la relecture canonique doit se declencher a l ouverture, sans condition',
  );
  assert.ok(
    !DETAILS.includes('if (decodedModel === null) void runDecode()'),
    "le decodage ne doit plus dependre du seul modele fourni par l'appelant",
  );
  assert.ok(DETAILS.includes('[proposal-details] availability'), 'instrumentation de developpement presente');
  assert.ok(DETAILS.includes('Checking approval permissions…'));
});

check('4. Inbox : meme verdict, meme chemin', () => {
  assert.ok(DETAILS.includes('const model = selfModel ?? decodedModel'));
  assert.ok(DETAILS.includes('const effectiveGuardContext = selfGuardContext ?? guardContext'));
  assert.ok(
    DETAILS.includes('useWalletGuard(effectiveGuardContext ?? null)'),
    'le guard existant doit etre utilise tel quel',
  );
});

check('5/6/7. Max : toute modification invalide le resume et l avertissement', () => {
  const plan = computeMaxTransfer({
    recognizedSolTransfer: true,
    sourceMatchesMainVault: true,
    vaultLamports: 1_000_000_000,
  });
  const snapshot = maxSnapshotFrom(plan, 'DEST', 1_000_000_000);
  assert.ok(snapshot !== null);

  // Correspondance exacte : resume affichable.
  assert.equal(
    isMaxSnapshotCurrent(snapshot, {
      amountLamports: 1_000_000_000,
      bufferLamports: 0,
      destination: 'DEST',
      vaultLamports: 1_000_000_000,
    }),
    true,
  );
  // Montant modifie.
  assert.equal(
    isMaxSnapshotCurrent(snapshot, {
      amountLamports: 999_999_999,
      bufferLamports: 0,
      destination: 'DEST',
      vaultLamports: 1_000_000_000,
    }),
    false,
  );
  // Destination modifiee.
  assert.equal(
    isMaxSnapshotCurrent(snapshot, {
      amountLamports: 1_000_000_000,
      bufferLamports: 0,
      destination: 'AUTRE',
      vaultLamports: 1_000_000_000,
    }),
    false,
  );
  // Buffer modifie.
  assert.equal(
    isMaxSnapshotCurrent(snapshot, {
      amountLamports: 1_000_000_000,
      bufferLamports: 1_000,
      destination: 'DEST',
      vaultLamports: 1_000_000_000,
    }),
    false,
  );
  // Solde de reference different.
  assert.equal(
    isMaxSnapshotCurrent(snapshot, {
      amountLamports: 1_000_000_000,
      bufferLamports: 0,
      destination: 'DEST',
      vaultLamports: 500_000_000,
    }),
    false,
  );

  assert.ok(PROPOSAL.includes('{maxSummaryVisible && maxPlan !== null ? ('), 'le resume est conditionne');
  assert.ok(
    PROPOSAL.includes('}, [build, bufferText]);'),
    'une modification invalide build, preflight et simulation',
  );
});

check('8. safe area : bandeau Devnet sous l inset superieur', () => {
  assert.ok(LIST.includes('StatusBar.currentHeight'), 'la hauteur de barre doit etre utilisee');
  assert.ok(LIST.includes('<View style={styles.safeTop} />'), 'un espace doit proteger le haut');
  assert.ok(LIST.indexOf('safeTop') < LIST.indexOf('contentContainerStyle'));
});

check('9. CTA Review proposal avant les details techniques', () => {
  const actions = HOME.indexOf('Actions required');
  const technical = HOME.indexOf('Technical details');
  assert.ok(actions > 0 && technical > 0, 'les deux sections doivent exister');
  assert.ok(actions < technical, 'le CTA doit precede les informations techniques');
  assert.ok(HOME.includes('Review proposal #{priorityIndex}'));
});

check('10. aucun chargement automatique ne sollicite le wallet', () => {
  const decode = DETAILS.slice(DETAILS.indexOf('const runDecode'), DETAILS.indexOf('void runDecode();'));
  assert.ok(decode.length > 0);
  assert.ok(!/signAndSendTransactions|authorize\(|\.connect\(/.test(decode));
  const homeRefresh = HOME.slice(HOME.indexOf('const refreshHomeBalance'), HOME.indexOf('const homeBalanceView'));
  assert.ok(!/signAndSendTransactions|authorize\(/.test(homeRefresh));
});

setTimeout(() => {
  console.log(`\n${passed} test(s) OK`);
  if (process.exitCode === 1) process.exit(1);
}, 50);