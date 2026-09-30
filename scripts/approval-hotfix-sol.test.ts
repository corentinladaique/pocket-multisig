import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  APPROVAL_OUTCOME_LABELS,
  approvalOutcomeActions,
  classifyApprovalOutcome,
  walletHasApproved,
} from '../src/squads/approvalOutcome';
import {
  APPROVAL_PREPARATION_DEADLINE_MS,
  APPROVAL_WALLET_DEADLINE_MS,
  isOperationTimeout,
  OperationTimeoutError,
  withDeadline,
} from '../src/wallet/asyncDeadline';
import {
  formatSolAmount,
  lamportsToSolText,
  parseSolToLamports,
  SOL_AMOUNT_MESSAGES,
} from '../src/vault/solAmount';

/**
 * Hotfix : attente bornee du flux Approve, anti-double-approbation, montants SOL.
 * Aucun wallet, aucun reseau. npx tsx scripts/approval-hotfix-sol.test.ts
 */

let passed = 0;

async function check(name: string, run: () => void | Promise<void>): Promise<void> {
  try {
    await run();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (caught: unknown) {
    console.log(`FAIL ${name}`);
    const detail = caught instanceof Error ? caught.stack ?? caught.message : String(caught);
    console.log(detail.split('\n').slice(0, 4).join('\n'));
    process.exitCode = 1;
  }
}

const APPROVAL = readFileSync('src/squads/signAndSendProposalApproval.ts', 'utf8');
const DETAILS = readFileSync('src/screens/ProposalDetailsScreen.tsx', 'utf8');
const PROPOSAL = readFileSync('src/screens/NewProposalScreen.tsx', 'utf8');
const GATE = readFileSync('src/squads/proposalApproval.ts', 'utf8');
const ALLOWLIST = readFileSync('src/squads/instructionAllowlist.ts', 'utf8');

(async () => {
  // ---- A. attente bornee ------------------------------------------------
  await check('1/2/5. une preparation qui pend est bornee (expiration detectee)', async () => {
    await assert.rejects(
      withDeadline(new Promise<never>(() => {}), 10, 'ApprovalPreparation'),
      (error: unknown) => isOperationTimeout(error) && error instanceof OperationTimeoutError,
    );
    assert.ok(APPROVAL_PREPARATION_DEADLINE_MS > 0 && APPROVAL_WALLET_DEADLINE_MS > 0);
    assert.ok(
      APPROVAL_PREPARATION_DEADLINE_MS <= APPROVAL_WALLET_DEADLINE_MS,
      'la preparation doit etre bornée plus court que le wallet',
    );
  });

  await check('5b. une promesse rapide n est jamais rejetee par la borne', async () => {
    assert.equal(await withDeadline(Promise.resolve(7), 100, 'Fast'), 7);
  });

  await check('2b. la borne couvre TOUTE la preparation avant le wallet', () => {
    // plan (precheck), blockhash, slot et hauteur de bloc sont tous bornes.
    const beforeWallet = APPROVAL.slice(0, APPROVAL.indexOf('signAndSendTransactions(transaction'));
    assert.ok(beforeWallet.includes('withDeadline('), 'borne presente avant le wallet');
    assert.ok(beforeWallet.includes("'ApprovalPreparation'"));
    assert.ok(beforeWallet.includes("'Blockhash'"));
    assert.ok(beforeWallet.includes("'Slot'"));
    assert.ok(beforeWallet.includes("'BlockHeight'"));
  });

  await check('3/4. expiration : "Nothing was sent." + Prepare again', () => {
    assert.ok(APPROVAL.includes('Approval preparation expired. Nothing was sent.'));
    // Le module signale aussi la fenetre de signature inutilisable AVANT le wallet.
    assert.ok(APPROVAL.includes("signingState: 'signature-request-expired'"));
    // L'ecran propose Prepare again sur une tentative sans signature.
    assert.ok(DETAILS.includes("? 'Prepare again'"));
  });

  await check('6. annulation/erreur/timeout : le spinner est relache dans finally', () => {
    assert.ok(DETAILS.includes('} finally {'));
    assert.ok(DETAILS.includes('setApproving(false);'));
    // Le finally est dans runApproval (approbation) et non dans un useEffect.
    const runApproval = DETAILS.slice(DETAILS.indexOf('const runApproval'), DETAILS.indexOf('const onApprove'));
    assert.ok(runApproval.includes('finally'));
    assert.ok(runApproval.includes('setApproving(false);'));
    assert.ok(/approvalAttemptedRef\.current = false;/.test(runApproval));
  });

  await check('17. aucun useEffect ne signe ni n envoie dans les ecrans touches', () => {
    for (const source of [DETAILS, PROPOSAL]) {
      const effects = source.split('useEffect(').slice(1);
      for (const effect of effects) {
        const body = effect.slice(0, effect.indexOf('});'));
        assert.ok(!/signAndSend|signTransaction|sendRawTransaction/i.test(body));
      }
    }
  });

  // ---- C. etats explicites ---------------------------------------------
  await check('C. libelles exacts des etats de tentative', () => {
    assert.equal(classifyApprovalOutcome({ signature: null, confirmed: false, verified: false }), 'nothing-was-sent');
    assert.equal(classifyApprovalOutcome({ signature: 'sig', confirmed: false, verified: false }), 'signed-confirmation-pending');
    assert.equal(classifyApprovalOutcome({ signature: 'sig', confirmed: true, verified: false }), 'confirmed-readback-pending');
    assert.equal(classifyApprovalOutcome({ signature: 'sig', confirmed: true, verified: true }), 'approved-and-verified');
    assert.equal(APPROVAL_OUTCOME_LABELS['nothing-was-sent'], 'Nothing was sent.');
    assert.equal(APPROVAL_OUTCOME_LABELS['signed-confirmation-pending'], 'Approval signed, confirmation pending.');
    assert.equal(APPROVAL_OUTCOME_LABELS['confirmed-readback-pending'], 'Approval confirmed, proposal verification pending.');
    assert.equal(APPROVAL_OUTCOME_LABELS['approved-and-verified'], 'Proposal approved and verified.');
    assert.ok(DETAILS.includes('APPROVAL_OUTCOME_LABELS[approvalState]'));
  });

  // ---- D. anti-double-approbation --------------------------------------
  await check('7/8. double tap : une seule tentative, bouton desactive pendant', () => {
    assert.ok(DETAILS.includes('if (model === null || allowlist === null || approvalAttemptedRef.current) return;'));
    // Le CTA n'existe que pour la famille « approbation disponible » (ou retry),
    // et reste desactive pendant une tentative.
    assert.ok(DETAILS.includes("actionState === 'approval-available' || approvalRetry"), 'CTA conditionnel');
    assert.ok(DETAILS.includes('disabled={!canConfirm || approving}'), 'desactive pendant approbation');
  });

  await check('9. wallet deja approbateur : aucune construction lancee', () => {
    assert.ok(DETAILS.includes('if (walletAlreadyApproved) {'));
    assert.ok(GATE.includes('has already approved'), 'le module relit et refuse un second vote');
  });

  await check('10/11. Already approved derive du read-back on-chain', () => {
    assert.ok(DETAILS.includes('const walletAlreadyApproved = walletHasApproved(effectiveApprovedAddresses, walletAddress);'));
    assert.ok(DETAILS.includes('refreshProposalFromChain'));
    assert.ok(DETAILS.includes('Proposal.fromAccountInfo'));
    // « Already approved » est desormais un STATUT (« ✓ Approved by you »),
    // plus un bouton gris desactive.
    assert.ok(DETAILS.includes('PROPOSAL_ACTION_LABELS.approvedByYou'));
    // La source est on-chain : jamais un simple etat memoire local seul.
    assert.ok(DETAILS.includes('onchainApproval?.approvedAddresses ?? proposal.approvedAddresses'));
    assert.equal(walletHasApproved(['A', 'B'], 'B'), true);
    assert.equal(walletHasApproved(['A', 'B'], 'C'), false);
  });

  await check('12. signature presente : Prepare again interdit sauf preuve', () => {
    assert.equal(approvalOutcomeActions('signed-confirmation-pending').allowPrepareAgain, false);
    assert.equal(approvalOutcomeActions('confirmed-readback-pending').allowPrepareAgain, false);
    assert.equal(approvalOutcomeActions('approved-and-verified').allowPrepareAgain, false);
    assert.equal(approvalOutcomeActions('nothing-was-sent').allowPrepareAgain, true);
  });

  // ---- E. Check approval again -----------------------------------------
  await check('13/14. Check approval again : aucun wallet, aucun envoi', () => {
    assert.ok(DETAILS.includes('Check approval again'));
    const handler = DETAILS.slice(
      DETAILS.indexOf('const onCheckApprovalAgain'),
      DETAILS.indexOf('const runApproval'),
    );
    assert.ok(handler.includes('confirmSignature'), 'relit le statut de signature');
    assert.ok(handler.includes('refreshProposalFromChain'), 'relit la Proposal');
    for (const forbidden of ['signAndSendTransactions', 'useMobileWallet', 'authorize', 'sendRawTransaction', 'signTransaction', 'connect(']) {
      assert.ok(!handler.includes(forbidden), `action interdite dans Check approval again: ${forbidden}`);
    }
  });

  // ---- F. montants SOL -------------------------------------------------
  await check('15. libelle "Amount (SOL)"', () => {
    assert.ok(PROPOSAL.includes('>Amount (SOL)<'));
    assert.ok(!PROPOSAL.includes('Amount (lamports)'));
  });

  await check('16. 0.02 SOL -> 20 000 000 lamports', () => {
    const parsed = parseSolToLamports('0.02');
    assert.ok(parsed.ok && parsed.lamports === 20_000_000);
    assert.equal(lamportsToSolText(20_000_000), '0.02');
    assert.equal(formatSolAmount(20_000_000), '0.02 SOL');
  });

  await check('17b. 0.000000001 SOL -> 1 lamport', () => {
    const parsed = parseSolToLamports('0.000000001');
    assert.ok(parsed.ok && parsed.lamports === 1);
    assert.equal(formatSolAmount(1), '0.000000001 SOL');
  });

  await check('18. plus de 9 decimales refuse', () => {
    const parsed = parseSolToLamports('0.0000000001');
    assert.ok(!parsed.ok && parsed.reason === 'too-many-decimals');
    assert.equal(SOL_AMOUNT_MESSAGES['too-many-decimals'], 'SOL supports up to 9 decimal places.');
  });

  await check('19. zero et negatif refuses', () => {
    const zero = parseSolToLamports('0');
    assert.ok(!zero.ok && zero.reason === 'not-positive');
    assert.equal(parseSolToLamports('0.000').ok, false);
    assert.equal(parseSolToLamports('-1').ok, false);
    const negativeMixed = parseSolToLamports('-0.5');
    assert.ok(!negativeMixed.ok && negativeMixed.reason === 'invalid');
    assert.equal(SOL_AMOUNT_MESSAGES['not-positive'], 'Amount must be greater than 0 SOL.');
  });

  await check('19b. formats ambigus refuses', () => {
    for (const value of ['1.2.3', '.5', '1.', '1e9', '1,5', ' 1 2 ', 'abc']) {
      assert.equal(parseSolToLamports(value).ok, false, `${value} doit etre refuse`);
    }
    const empty = parseSolToLamports('');
    assert.ok(!empty.ok && empty.reason === 'empty');
    assert.equal(SOL_AMOUNT_MESSAGES.empty, 'Enter an amount to continue.');
    assert.equal(SOL_AMOUNT_MESSAGES.invalid, 'Enter a valid SOL amount.');
  });

  await check('20. aucun lamport visible hors section repliable', () => {
    // Saisie et lecture utilisateur en SOL.
    assert.ok(PROPOSAL.includes('Amount (SOL)'));
    assert.ok(!PROPOSAL.includes('Amount (lamports)'));
    assert.ok(!PROPOSAL.includes('bufferLamports} lamports'));
    assert.ok(!PROPOSAL.includes('} lamports`'));
    assert.ok(!PROPOSAL.includes('lamports):'), 'plus aucun lamport affiché');
    // La section technique est désormais repliable (« Advanced diagnostics »).
    assert.ok(PROPOSAL.includes("'Advanced diagnostics'"));
    assert.ok(PROPOSAL.includes("useState(false);"), 'section fermée par défaut');
    // Les messages d'erreur d'unicite en lamports sont remplaces par du SOL.
    assert.ok(PROPOSAL.includes('SOL_AMOUNT_MESSAGES[parsedSol.reason]'));
    assert.ok(PROPOSAL.includes('.filter((error) => !/lamports/i.test(error))'));
  });

  await check('21. Max conserve une valeur exacte en lamports', () => {
    assert.ok(PROPOSAL.includes('setSolText(lamportsToSolText(plan.amountLamports));'));
    assert.ok(PROPOSAL.includes('parseSolToLamports(bufferText)'));
  });

  // ---- G. USD non implemente -------------------------------------------
  await check('G. aucun USD dynamique dans New Proposal', () => {
    assert.ok(!/USD|usdPerSol/i.test(PROPOSAL), 'aucun prix USD dans New Proposal');
  });

  // ---- 22. garde-fous intacts ------------------------------------------
  await check('22. aucun guard ni instruction Squads modifie', () => {
    assert.ok(ALLOWLIST.includes('SYSTEM_PROGRAM_ID'));
    assert.ok(ALLOWLIST.includes('ALLOWED_PROGRAM_IDS'));
    assert.ok(GATE.includes('multisig.instructions.proposalApprove'));
    assert.ok(APPROVAL.includes('confirmSignature'), 'confirmation conservee');
    assert.ok(APPROVAL.includes('Proposal.fromAccountInfo'), 'read-back conserve');
    assert.ok(APPROVAL.includes('evaluateSigningWindow'), 'fenetre de signature conservee');
    assert.ok(APPROVAL.includes('applyFreshBlockhash'), 'blockhash frais conserve');
  });

  console.log(`\n${passed} test(s) OK`);
})();
