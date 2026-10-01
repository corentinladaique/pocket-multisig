import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  PROPOSAL_ACTION_LABELS,
  approvalProgress,
  deriveProposalActionState,
  deriveProposalExecuteState,
  executionNotAvailableDetail,
} from '../src/squads/proposalActionState';
import {
  LOW_SECURITY_THRESHOLD_DETAIL,
  LOW_SECURITY_THRESHOLD_LABEL,
  THREE_MEMBER_RECOMMENDATION,
  THREE_MEMBER_RECOMMENDATION_DETAIL,
  TWO_MEMBER_RECOMMENDATION,
  TWO_MEMBER_RECOMMENDATION_DETAIL,
  lowSecurityThresholdWarning,
  recommendationFor,
  recommendedThresholdFor,
  twoMemberRecommendation,
} from '../src/vault/thresholdRecommendation';

/**
 * États Approved/Executed dans Proposal Details + recommandation 2 of 2.
 * Aucun wallet, aucun réseau. npx tsx scripts/proposal-details-states.test.ts
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

const DETAILS = readFileSync('src/screens/ProposalDetailsScreen.tsx', 'utf8');
const CREATE = readFileSync('src/screens/CreateVaultScreen.tsx', 'utf8');
const ACTION_MODULE = readFileSync('src/squads/proposalActionState.ts', 'utf8');
const THRESHOLD_MODULE = readFileSync('src/vault/thresholdRecommendation.ts', 'utf8');
const ALLOWLIST = readFileSync('src/squads/instructionAllowlist.ts', 'utf8');

const CHECK = DETAILS.slice(
  DETAILS.indexOf('const onCheckApprovalAgain'),
  DETAILS.indexOf('const runApproval'),
);

check('1. recheck reussi : ancienne erreur reseau absente du bloc principal', () => {
  assert.ok(CHECK.includes('if (verified) {'), 'la reussite est detectee');
  assert.ok(CHECK.includes('setApprovalError(null)'), 'erreur courante effacee');
  // L'erreur courante n'est rendue que si elle est encore l'etat courant.
  assert.ok(DETAILS.includes("approvalError !== null && actionState !== 'executed'"));
});

check('2. recheck reussi : Proposal approved and verified visible', () => {
  assert.ok(DETAILS.includes("'Proposal approved and verified.'"));
});

check('3. wallet deja approbateur : aucun bouton Approve', () => {
  assert.equal(
    deriveProposalActionState({
      executed: false,
      signaturePendingVerification: false,
      thresholdReached: false,
      walletAlreadyApproved: true,
    }),
    'approved-by-you',
  );
  // Le CTA n'existe que pour la famille « approbation disponible » (ou retry).
  assert.ok(DETAILS.includes("actionState === 'approval-available' || approvalRetry"));
});

check('4. wallet deja approbateur : statut ✓ Approved by you', () => {
  assert.equal(PROPOSAL_ACTION_LABELS.approvedByYou, '✓ Approved by you');
  assert.ok(DETAILS.includes('PROPOSAL_ACTION_LABELS.approvedByYou'));
  assert.ok(
    DETAILS.includes(
      'This wallet is recorded as an approver on-chain. No new approval can be sent.',
    ) ||
      PROPOSAL_ACTION_LABELS.approvedByYouDetail.includes('recorded as an approver on-chain'),
  );
});

check('5. Already approved n est plus rendu comme bouton', () => {
  assert.ok(!DETAILS.includes("? 'Already approved'"), 'plus de libelle de bouton');
  // Statut non cliquable : role d'information, aucune action.
  assert.ok(DETAILS.includes('accessibilityRole="text"'), 'role de statut');
  assert.ok(DETAILS.includes('accessibilityLabel="Approved by you"'));
});

check('6. progression 1 of 2 affichee depuis les donnees on-chain', () => {
  const progress = approvalProgress({ approvedCount: 1, threshold: 2 });
  assert.equal(progress.collectedLabel, '1 of 2 approvals collected');
  // Source : le read-back on-chain, jamais un compteur local.
  assert.ok(DETAILS.includes('approvedCount: effectiveApprovedAddresses.length'));
});

check('7. une approbation manquante : Waiting for 1 more approval.', () => {
  assert.equal(
    approvalProgress({ approvedCount: 1, threshold: 2 }).waitingLabel,
    'Waiting for 1 more approval.',
  );
  assert.equal(
    approvalProgress({ approvedCount: 0, threshold: 2 }).waitingLabel,
    'Waiting for 2 more approvals.',
  );
});

check('8. threshold atteint : Approval threshold reached', () => {
  const progress = approvalProgress({ approvedCount: 2, threshold: 2 });
  assert.equal(progress.reached, true);
  assert.equal(progress.waitingLabel, null, 'jamais « Waiting for 0 more approvals. »');
  assert.equal(PROPOSAL_ACTION_LABELS.thresholdReached, '✓ Approval threshold reached');
});

check('9. threshold non atteint : aucun gros bouton Execute desactive', () => {
  assert.equal(
    deriveProposalExecuteState({ executed: false, thresholdReached: false, walletHasExecute: true }),
    'unavailable-threshold',
  );
  // Le bouton Execute n'existe que pour l'etat « available ».
  assert.ok(DETAILS.includes("executeState === 'available' ? ("));
  assert.ok(DETAILS.includes("executeState === 'unavailable-threshold' ? ("));
});

check('10. threshold non atteint : raison utilisateur visible', () => {
  assert.equal(PROPOSAL_ACTION_LABELS.executeUnavailableTitle, 'Execution not available yet');
  assert.equal(
    executionNotAvailableDetail(1),
    'One more approval is required before this proposal can be executed.',
  );
  assert.equal(
    executionNotAvailableDetail(2),
    '2 more approvals are required before this proposal can be executed.',
  );
});

check('11. threshold atteint + role Execute : Execute transaction visible', () => {
  assert.equal(
    deriveProposalExecuteState({ executed: false, thresholdReached: true, walletHasExecute: true }),
    'available',
  );
  assert.equal(PROPOSAL_ACTION_LABELS.executeCta, 'Execute transaction');
  assert.ok(DETAILS.includes('PROPOSAL_ACTION_LABELS.executeCta'));
});

check('12. threshold atteint sans role Execute : statut, aucun CTA trompeur', () => {
  assert.equal(
    deriveProposalExecuteState({ executed: false, thresholdReached: true, walletHasExecute: false }),
    'no-permission',
  );
  assert.equal(PROPOSAL_ACTION_LABELS.executeNoPermissionDetail, 'This wallet does not have permission to execute.');
  assert.ok(DETAILS.includes("executeState === 'no-permission' ? ("));
});

check('13. Proposal executee : aucun Approve', () => {
  assert.equal(
    deriveProposalActionState({
      executed: true,
      signaturePendingVerification: false,
      thresholdReached: true,
      walletAlreadyApproved: true,
    }),
    'executed',
  );
  assert.ok(DETAILS.includes("actionState !== 'executed' && walletAlreadyApproved"));
});

check('14. Proposal executee : aucun Execute', () => {
  assert.equal(
    deriveProposalExecuteState({ executed: true, thresholdReached: true, walletHasExecute: true }),
    'executed',
  );
  assert.notEqual(deriveProposalExecuteState({ executed: true, thresholdReached: true, walletHasExecute: true }), 'available');
});

check('15. Proposal executee : ✓ Transaction executed visible', () => {
  assert.equal(PROPOSAL_ACTION_LABELS.executed, '✓ Transaction executed');
  assert.ok(DETAILS.includes('PROPOSAL_ACTION_LABELS.executed'));
});

check('16. deux ou trois membres : threshold par defaut = 2', () => {
  assert.equal(recommendedThresholdFor(2), 2);
  assert.equal(recommendedThresholdFor(3), 2);
  assert.ok(CREATE.includes('setThreshold(recommended)'));
  assert.ok(CREATE.includes('thresholdTouched'));
});

check('16b. trois membres : recommandation 2 of 3 (demo hackathon)', () => {
  const recommendation = recommendationFor(3);
  assert.ok(recommendation !== null);
  assert.equal(recommendation?.label, THREE_MEMBER_RECOMMENDATION);
  assert.equal(THREE_MEMBER_RECOMMENDATION, 'Recommended: 2 of 3');
  assert.equal(recommendation?.detail, THREE_MEMBER_RECOMMENDATION_DETAIL);
  assert.equal(
    THREE_MEMBER_RECOMMENDATION_DETAIL,
    'Two members must approve. One unavailable member cannot block the vault.',
  );
  assert.equal(recommendationFor(4), null, 'pas de recommandation au-dela de 3');
  assert.ok(CREATE.includes('recommendationFor(members.length)'));
  // 3 of 3 n'est jamais impose automatiquement.
  assert.ok(!CREATE.includes('setThreshold(members.length)'));
});

check('17. deux membres + threshold 1 : Low security configuration', () => {
  assert.equal(lowSecurityThresholdWarning(2, 1), 'Low security configuration');
  assert.equal(LOW_SECURITY_THRESHOLD_LABEL, 'Low security configuration');
  assert.ok(LOW_SECURITY_THRESHOLD_DETAIL.includes('Either member can approve actions alone'));
  assert.ok(CREATE.includes('lowSecurityThresholdWarning(members.length, threshold)'));
});

check('18. threshold 1 reste supporte si choisi explicitement', () => {
  // Aucun blocage : l'avertissement est rendu, mais threshold reste modifiable.
  assert.equal(lowSecurityThresholdWarning(2, 2), null);
  assert.equal(lowSecurityThresholdWarning(3, 1), null);
  assert.ok(CREATE.includes('setThresholdTouched(true)'), 'choix explicite respecte');
  assert.ok(CREATE.includes('To continue with this setting, confirm explicitly'));
});

check('18b. recommandation 2 of 2 affichee seulement pour deux membres', () => {
  assert.equal(twoMemberRecommendation(2), TWO_MEMBER_RECOMMENDATION);
  assert.equal(TWO_MEMBER_RECOMMENDATION, 'Recommended: 2 of 2');
  assert.ok(TWO_MEMBER_RECOMMENDATION_DETAIL.includes('Both members must approve'));
  assert.equal(twoMemberRecommendation(3), null);
});

check('19. aucun guard ni role modifie', () => {
  assert.ok(DETAILS.includes('useWalletGuard(effectiveGuardContext ?? null)'));
  assert.ok(DETAILS.includes("member.roles.includes('Execute')"));
});

check('20. aucune instruction Squads modifiee', () => {
  assert.ok(ALLOWLIST.includes('ALLOWED_PROGRAM_IDS'));
  assert.ok(ALLOWLIST.includes('SYSTEM_PROGRAM_ID'));
  assert.ok(DETAILS.includes('multisig.getVaultPda'));
});

check('21. aucun RPC, wallet, envoi ou signature ajoute dans la logique d etat', () => {
  for (const forbidden of ['Connection', 'signAndSend', 'sendRawTransaction', 'authorize', 'react-native']) {
    assert.ok(!ACTION_MODULE.includes(forbidden), `interdit: ${forbidden}`);
    assert.ok(!THRESHOLD_MODULE.includes(forbidden), `interdit: ${forbidden}`);
  }
  assert.ok(!ACTION_MODULE.includes('await '), 'module pur : aucun appel asynchrone');
});

check('22. les etats principaux sont mutuellement exclusifs', () => {
  const states = [
    deriveProposalActionState({ executed: true, signaturePendingVerification: true, thresholdReached: true, walletAlreadyApproved: true }),
    deriveProposalActionState({ executed: false, signaturePendingVerification: true, thresholdReached: true, walletAlreadyApproved: true }),
    deriveProposalActionState({ executed: false, signaturePendingVerification: false, thresholdReached: true, walletAlreadyApproved: true }),
    deriveProposalActionState({ executed: false, signaturePendingVerification: false, thresholdReached: false, walletAlreadyApproved: true }),
    deriveProposalActionState({ executed: false, signaturePendingVerification: false, thresholdReached: false, walletAlreadyApproved: false }),
  ];
  assert.deepEqual(states, [
    'executed',
    'approval-pending-verification',
    'threshold-reached',
    'approved-by-you',
    'approval-available',
  ]);
  assert.equal(new Set(states).size, states.length, 'un seul etat a la fois');
});

setTimeout(() => {
  console.log(`\n${passed} test(s) OK`);
  if (process.exitCode === 1) process.exit(1);
}, 50);
