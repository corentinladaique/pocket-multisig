import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { describeVaultBalance } from '../src/wallet/vaultBalance';

/**
 * Tests du tableau de bord Home. Verification par lecture des sources pour les
 * comportements d'ecran, plus le module pur pour les etats de solde.
 * Execution : npx tsx scripts/home-dashboard.test.ts
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

check('1. Home affiche le solde du Main vault apres Load multisig', () => {
  assert.ok(HOME.includes('refreshHomeBalance'), 'une lecture de solde doit exister sur Home');
  assert.ok(
    HOME.includes("connection.getBalance(\n          new PublicKey(targetVaultAddress),") ||
      HOME.includes("connection.getBalance(new PublicKey(targetVaultAddress), 'confirmed')"),
    'la lecture doit viser le vault de la vue courante',
  );
  assert.ok(HOME.includes('{homeBalanceView.sol} SOL'), 'le solde doit etre affiche');
  assert.ok(
    HOME.includes('{homeBalanceView.title === \'Main vault not funded\' ? ('),
    "l'etat du solde doit etre affiche",
  );
});

check('2. changement de multisig A vers B : purge immediatement', () => {
  assert.ok(
    HOME.includes('if (viewVaultAddress === null) {\n      setHomeBalance(null);'),
    'le solde doit etre purge quand le vault disparait',
  );
  assert.ok(
    HOME.includes('previous.address === targetVaultAddress ? previous.lamports : null'),
    'aucune valeur d une autre adresse ne peut etre reutilisee',
  );
  const afterSwitch = describeVaultBalance({
    addressMatches: false,
    lamports: 5_000_000_000,
    status: 'loaded',
  });
  assert.equal(afterSwitch.sol, null);
  assert.equal(afterSwitch.title, 'Loading vault balance…');
});

check('3. wallet membre : roles reels lus on-chain', () => {
  assert.ok(
    HOME.includes('view.members.find((member) => member.address === walletAddress)?.roles'),
    'les roles doivent venir des membres lus',
  );
  assert.ok(HOME.includes("homeIsMember ? 'My multisig'"), 'le statut membre doit etre affiche');
});

check('4. wallet non membre : Observed multisig, lecture seule', () => {
  assert.ok(HOME.includes("'Observed multisig · Read only'"));
  assert.ok(
    HOME.includes('This is public on-chain information.'),
    "l'explication de consultation publique doit etre presente",
  );
});

check('5. vault vide : Main vault not funded', () => {
  const view = describeVaultBalance({ addressMatches: true, lamports: 0, status: 'loaded' });
  assert.equal(view.title, 'Main vault not funded');
  assert.ok(
    HOME.includes('<Text style={styles.balanceNote}>Main vault not funded</Text>'),
    'Home doit afficher cet etat',
  );
});

check('6. erreur RPC : dernier solde du meme vault conserve, marque stale', () => {
  const stale = describeVaultBalance({
    addressMatches: true,
    lamports: 1_000_000_000,
    status: 'error',
    stale: true,
  });
  assert.equal(stale.sol, '1.000000000');
  assert.equal(stale.stale, true);
  assert.ok(HOME.includes('setHomeBalanceError(true)'));
  assert.ok(HOME.includes('Retry balance'), 'le bouton doit proposer une relecture');
  assert.ok(HOME.includes('Balance unavailable'), 'letat doit etre explicite');
});

check('7. compteurs d actions calcules depuis les propositions deja lues', () => {
  assert.ok(
    HOME.includes("proposal.status === 'Active'") &&
      HOME.includes("!proposal.approvedAddresses.includes(walletAddress ?? '')"),
    'le compteur de votes attendus doit filtrer les propositions Active non approuvees par le wallet',
  );
  assert.ok(
    HOME.includes("proposal.status === 'Approved' && homeIsMember"),
    'le compteur executable doit exiger le statut Approved et le droit Execute',
  );
  assert.ok(
    HOME.includes("homeWalletRoles.includes('Execute')"),
    'le droit Execute doit etre verifie sur les roles reels',
  );
  assert.ok(!HOME.includes('getProgramAccounts'), 'aucune lecture supplementaire ne doit etre ajoutee');
});

check("8. CTA Home ouvre ProposalDetailsScreen canonique", () => {
  assert.ok(HOME.includes('setOpenDecisionIndex(priorityIndex)'), 'le CTA doit ouvrir la proposition');
  assert.ok(
    HOME.includes('<ProposalDetailsScreen'),
    'le CTA doit ouvrir le MEME ecran que Home et Inbox',
  );
});

check('9. Approve disponible sans Refresh si le guard autorise', () => {
  const details = readFileSync('src/screens/ProposalDetailsScreen.tsx', 'utf8');
  assert.ok(details.includes('useEffect(() => {\n    void runDecode();'));
  assert.ok(details.includes('const effectiveGuardContext = selfGuardContext ?? guardContext'));
  assert.ok(details.includes('Checking approval permissions…'));
  const review = readFileSync('src/screens/TransactionReviewScreen.tsx', 'utf8');
  assert.ok(
    review.includes("• Checking approval permissions…"),
    'la revue ne doit plus afficher le motif brut comme verdict final',
  );
  assert.ok(
    !review.includes("• No guard context was provided"),
    'le motif technique ne doit plus etre rendu a l utilisateur',
  );
});

check('10. aucun chargement Home ni refresh ne sollicite le wallet', () => {
  const refresh = HOME.slice(
    HOME.indexOf('const refreshHomeBalance'),
    HOME.indexOf('const homeBalanceView'),
  );
  assert.ok(refresh.length > 0, 'la fonction de lecture doit exister');
  assert.ok(!/signAndSendTransactions|connect\(|authorizeSession/.test(refresh));
  assert.ok(
    !/connect\(|signAndSendTransactions/.test(HOME.slice(HOME.indexOf('const homeNeedsVote'))),
    'les compteurs ne doivent pas solliciter le wallet',
  );
});

check('identite : nom local du vault et adresse complete selectionnable', () => {
  assert.ok(HOME.includes("registry.entries.find((entry) => entry.address === viewAddress)"));
  assert.ok(HOME.includes('{homeVaultName ?? \'Unnamed multisig\'}'));
  assert.ok(HOME.includes('{msig.view.vaultAddress}'));
});

setTimeout(() => {
  console.log(`\n${passed} test(s) OK`);
  if (process.exitCode === 1) process.exit(1);
}, 50);