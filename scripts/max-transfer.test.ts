import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  computeMaxTransfer,
  reevaluateAmountAgainstBalance,
  VAULT_PAYS_FEES,
} from '../src/vault/maxTransfer';

/**
 * Tests du bouton Max : calculs purs, aucun wallet, aucun reseau.
 * Execution : npx tsx scripts/max-transfer.test.ts
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

check('7. Max exige un solde lu : sinon aucun montant', () => {
  const plan = computeMaxTransfer({
    recognizedSolTransfer: true,
    sourceMatchesMainVault: true,
    vaultLamports: null,
  });
  assert.equal(plan.ready, false);
  assert.equal(plan.amountLamports, null);
  assert.ok(/could not be read/.test(plan.hint));
});

check('8. Max produit un montant FIXE en lamports', () => {
  const plan = computeMaxTransfer({
    recognizedSolTransfer: true,
    sourceMatchesMainVault: true,
    vaultLamports: SOL,
  });
  assert.equal(plan.amountLamports, 1_000_000_000);
  assert.equal(typeof plan.amountLamports, 'number');
  assert.equal(plan.ready, true);
});

check('9. Max vidant le vault : avertissement explicite', () => {
  const plan = computeMaxTransfer({
    recognizedSolTransfer: true,
    sourceMatchesMainVault: true,
    vaultLamports: SOL,
  });
  assert.equal(plan.wouldEmptyVault, true);
  assert.ok(plan.warnings.some((warning) => /would empty the Main vault/.test(warning)));
  assert.equal(plan.remainingLamports, 0);
});

check('10. Max avec buffer : montant et buffer visibles', () => {
  const plan = computeMaxTransfer({
    explicitBufferLamports: 10_000,
    recognizedSolTransfer: true,
    sourceMatchesMainVault: true,
    vaultLamports: SOL,
  });
  assert.equal(plan.amountLamports, SOL - 10_000);
  assert.equal(plan.bufferLamports, 10_000);
  assert.equal(plan.remainingLamports, 10_000);
  assert.equal(plan.wouldEmptyVault, false);
  assert.ok(plan.warnings.some((warning) => /explicit buffer/.test(warning)));
});

check('11. frais payes par le membre : aucune deduction du vault', () => {
  assert.equal(VAULT_PAYS_FEES, false);
  const plan = computeMaxTransfer({
    recognizedSolTransfer: true,
    sourceMatchesMainVault: true,
    vaultLamports: SOL,
  });
  // Aucun frais retire : le montant Max egale exactement le solde lu.
  assert.equal(plan.amountLamports, SOL);
  assert.ok(/Fees are paid by the signing member/.test(plan.hint));
});

check('12/13. solde change : montant invalide, jamais ajuste en silence', () => {
  const changed = reevaluateAmountAgainstBalance({
    amountLamports: SOL,
    freshVaultLamports: SOL / 2,
  });
  assert.equal(changed.stillValid, false);
  assert.ok(/recalculate Max or enter a new amount/i.test(changed.reason));

  const unchanged = reevaluateAmountAgainstBalance({
    amountLamports: SOL / 2,
    freshVaultLamports: SOL,
  });
  assert.equal(unchanged.stillValid, true);
});

check('buffer superieur au solde : Max refuse, rien d invente', () => {
  const plan = computeMaxTransfer({
    explicitBufferLamports: SOL * 2,
    recognizedSolTransfer: true,
    sourceMatchesMainVault: true,
    vaultLamports: SOL,
  });
  assert.equal(plan.ready, false);
  assert.equal(plan.amountLamports, null);
  assert.ok(/greater than or equal/.test(plan.hint));
});

check('source differente du Main vault : Max refuse', () => {
  const plan = computeMaxTransfer({
    recognizedSolTransfer: true,
    sourceMatchesMainVault: false,
    vaultLamports: SOL,
  });
  assert.equal(plan.ready, false);
  assert.equal(plan.amountLamports, null);
});

check('15. Max ne sollicite jamais le wallet', () => {
  const module = readFileSync('src/vault/maxTransfer.ts', 'utf8');
  assert.ok(!/signAndSend|signTransaction|MobileWalletProvider/.test(module));

  const screen = readFileSync('src/screens/NewProposalScreen.tsx', 'utf8');
  const onMax = screen.slice(screen.indexOf('const onMax'), screen.indexOf('const runPipeline'));
  assert.ok(onMax.length > 0, 'le handler Max doit exister');
  assert.ok(!/signAndSendTransactions|connect\(|authorize/.test(onMax), 'Max ne touche pas au wallet');
  assert.ok(
    onMax.includes("connection.getBalance(new PublicKey(vaultAddress), 'confirmed')"),
    'Max relit le solde confirme avant de remplir',
  );
});

check('12. changer le buffer invalide le pipeline', () => {
  const screen = readFileSync('src/screens/NewProposalScreen.tsx', 'utf8');
  assert.ok(
    screen.includes('}, [build, bufferText]);'),
    'la simulation doit etre invalidee par un changement de buffer',
  );
});

check('14. vocabulaire accessible : Main vault, plus de « Vault index 0 »', () => {
  const details = readFileSync('src/screens/MultisigDetailsScreen.tsx', 'utf8');
  assert.ok(details.includes('Main vault'));
  assert.ok(details.includes('This account holds the funds controlled by the multisig.'));
  assert.ok(details.includes('Do not send funds to this address.'));
  const proposal = readFileSync('src/screens/ProposalDetailsScreen.tsx', 'utf8');
  assert.ok(proposal.includes('Funds will be sent from'));
});

setTimeout(() => {
  console.log(`\n${passed} test(s) OK`);
  if (process.exitCode === 1) process.exit(1);
}, 50);