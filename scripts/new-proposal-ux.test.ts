import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  buildProposalCreation,
  PROPOSAL_CREATION_EXPLAINERS,
} from '../src/squads/buildProposalCreation';
import { computeMaxTransfer } from '../src/vault/maxTransfer';
import { parseSolToLamports } from '../src/vault/solAmount';

/**
 * Hotfix UI New Proposal : placeholders, CTA, message redondant, section repliable.
 * Aucun wallet, aucun réseau. npx tsx scripts/new-proposal-ux.test.ts
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

const PROPOSAL = readFileSync('src/screens/NewProposalScreen.tsx', 'utf8');

const CREATOR = 'GZUrVZnw4QoHf3SvXrYvWfFzVbXXHxoA9UKSajWBfUuM';
const DEST = '9hvAFWYxp2mbZeF7JmvnWZqrhxNrT8tCA2PMvcshHeuR';
const MULTISIG = 'DxaHm47inZWeBQmd63hSmEw43kvP9xebNo1H6wVznFXi';

function buildWith(lamports: number) {
  return buildProposalCreation({
    creator: CREATOR,
    destination: DEST,
    lamports,
    memo: null,
    multisigPda: MULTISIG,
    transactionIndex: 0,
  });
}

check('1. Amount : state initial vide', () => {
  assert.ok(PROPOSAL.includes("const [solText, setSolText] = useState('');"));
  assert.ok(!PROPOSAL.includes("useState('0"));
});

check('2. "e.g. 0.02" est uniquement un placeholder', () => {
  assert.ok(PROPOSAL.includes('placeholder="e.g. 0.02"'));
  // Jamais affecté à un state ni utilisé comme valeur.
  assert.ok(!PROPOSAL.includes("setSolText('e.g."));
  assert.ok(!PROPOSAL.includes('= \'e.g. 0.02\''));
  assert.ok(PROPOSAL.includes('value={solText}'));
});

check('3. le placeholder ne débloque pas le CTA', () => {
  // Saisie vide => NaN => le builder refuse => canRunPipeline faux.
  assert.equal(buildWith(Number.NaN).readyForBuild, false);
  assert.ok(PROPOSAL.includes('disabled={!canRunPipeline}'));
  assert.ok(PROPOSAL.includes('build.errors.length === 0 && pipeline.status !=='));
});

check('4. le placeholder ne produit aucun lamport', () => {
  const parsed = parseSolToLamports('e.g. 0.02');
  assert.equal(parsed.ok, false);
  const empty = parseSolToLamports('');
  assert.ok(!empty.ok && empty.reason === 'empty');
  // Aucune conversion n'est branchée sur la chaîne du placeholder.
  assert.ok(!PROPOSAL.includes('parseSolToLamports(\'e.g.'));
});

check('5. un montant réellement saisi fonctionne comme avant', () => {
  const parsed = parseSolToLamports('0.02');
  assert.ok(parsed.ok && parsed.lamports === 20_000_000);
  assert.equal(buildWith(20_000_000).readyForBuild, true);
});

check('6. le placeholder du buffer ne modifie pas Max', () => {
  assert.ok(PROPOSAL.includes('placeholder="e.g. 0.001"'));
  assert.ok(!PROPOSAL.includes('placeholder="0"'));
  // Max reste piloté par la valeur RÉELLE du buffer, pas par le placeholder.
  assert.ok(PROPOSAL.includes('parseSolToLamports(bufferText)'));
  assert.equal(parseSolToLamports('e.g. 0.001').ok, false);
  const plan = computeMaxTransfer({
    explicitBufferLamports: 0,
    recognizedSolTransfer: true,
    sourceMatchesMainVault: true,
    vaultLamports: 1_000_000_000,
  });
  assert.equal(plan.amountLamports, 1_000_000_000);
  // Aide affichée sous le champ buffer.
  assert.ok(PROPOSAL.includes('Amount kept in the Main vault when using Max.'));
  assert.ok(PROPOSAL.includes('Optional safety buffer (SOL)'));
});

check('7. "Review proposal" utilise le handler existant', () => {
  assert.ok(PROPOSAL.includes('>Review proposal<'));
  assert.ok(!PROPOSAL.includes('Check locally and simulate'));
  // Le handler n'a pas changé : même pipeline.
  const cta = PROPOSAL.slice(PROPOSAL.indexOf('>Review proposal<') - 400, PROPOSAL.indexOf('>Review proposal<'));
  assert.ok(cta.includes('void runPipeline();'), 'le bouton relance exactement le pipeline');
  assert.ok(PROPOSAL.includes('Checks the vault balance and simulates the transaction. Nothing is signed or sent.'));
});

check('8. aucun build/RPC/wallet/envoi déclenché par un placeholder', () => {
  // Le placeholder n'apparaît que comme attribut d'entrée.
  assert.equal((PROPOSAL.match(/placeholder="e\.g\. 0\.02"/g) ?? []).length, 1);
  assert.equal((PROPOSAL.match(/placeholder="e\.g\. 0\.001"/g) ?? []).length, 1);
  for (const forbidden of ['signAndSendTransactions', 'signTransaction', 'sendRawTransaction']) {
    const inputBlock = PROPOSAL.slice(
      PROPOSAL.indexOf('Amount (SOL)'),
      PROPOSAL.indexOf('Optional safety buffer (SOL)'),
    );
    assert.ok(inputBlock.length > 0, 'portion de saisie localisee');
    assert.ok(!inputBlock.includes(forbidden));
  }
  // Aucune écriture de state depuis une chaîne de placeholder.
  assert.ok(!/set(Sol|Buffer)Text\(\s*'e\.g\./.test(PROPOSAL));
});

check('9. message redondant supprimé', () => {
  assert.ok(PROPOSAL.includes('Enter an amount to continue.'));
  assert.ok(!PROPOSAL.includes(">Enter an amount<"));
});

check('10. bloc technique replié par défaut', () => {
  assert.ok(PROPOSAL.includes("const [howItWorksOpen, setHowItWorksOpen] = useState(false);"));
  assert.ok(PROPOSAL.includes("'How proposal creation works'"));
  assert.ok(PROPOSAL.includes('{howItWorksOpen ? ('));
  assert.ok(PROPOSAL.includes('accessibilityState={{ expanded: howItWorksOpen }}'));
  // Aucune information supprimée : les explications restent dans la section.
  assert.ok(PROPOSAL.includes('PROPOSAL_CREATION_EXPLAINERS'), 'explications importées');
  assert.equal(PROPOSAL_CREATION_EXPLAINERS.length, 3);
  assert.ok(PROPOSAL.includes('explainers.map((warning) => ('));
});

setTimeout(() => {
  console.log(`\n${passed} test(s) OK`);
  if (process.exitCode === 1) process.exit(1);
}, 50);
