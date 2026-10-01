import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  REVIEW_SCREEN_CAPABILITIES,
  reviewScreenIsReadOnly,
} from '../src/screens/reviewScreenCapabilities';

/**
 * Une seule voie d'approbation existe :
 *   ProposalDetailsScreen -> onApprove -> runApproval -> signAndSendProposalApproval.
 * `TransactionReviewScreen` est une VUE TECHNIQUE FACULTATIVE, strictement en
 * lecture seule : aucun wallet, aucune signature, aucun envoi.
 *
 * Les vérifications de capacité passent par un module PUR (aucun React Native) ;
 * les vérifications source servent uniquement à garantir l'absence d'import et
 * d'appel directs dangereux.
 * Aucun wallet, aucun réseau. npx tsx scripts/transaction-review-read-only.test.ts
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

const REVIEW = readFileSync('src/screens/TransactionReviewScreen.tsx', 'utf8');
const DETAILS = readFileSync('src/screens/ProposalDetailsScreen.tsx', 'utf8');
const APPROVAL = readFileSync('src/squads/signAndSendProposalApproval.ts', 'utf8');
const EXECUTION = readFileSync('src/squads/signAndSendProposalExecution.ts', 'utf8');
const CAPABILITIES = readFileSync('src/screens/reviewScreenCapabilities.ts', 'utf8');

// --- Capacités déclarées (fonction pure) ---------------------------------
check('0a. l écran déclare n avoir AUCUNE capacité d écriture', () => {
  assert.equal(REVIEW_SCREEN_CAPABILITIES.readOnly, true);
  assert.equal(REVIEW_SCREEN_CAPABILITIES.authorizesWallet, false);
  assert.equal(REVIEW_SCREEN_CAPABILITIES.signsTransaction, false);
  assert.equal(REVIEW_SCREEN_CAPABILITIES.sendsTransaction, false);
  assert.equal(REVIEW_SCREEN_CAPABILITIES.approvesProposal, false);
  assert.equal(REVIEW_SCREEN_CAPABILITIES.executesProposal, false);
  assert.equal(reviewScreenIsReadOnly(), true);
});

check('0b. une capacité d écriture rendrait le verdict NON lecture seule', () => {
  assert.equal(
    reviewScreenIsReadOnly({ ...REVIEW_SCREEN_CAPABILITIES, approvesProposal: true }),
    false,
  );
  assert.equal(
    reviewScreenIsReadOnly({ ...REVIEW_SCREEN_CAPABILITIES, sendsTransaction: true }),
    false,
  );
  assert.equal(reviewScreenIsReadOnly({ ...REVIEW_SCREEN_CAPABILITIES, readOnly: false }), false);
});

check('0c. le module de capacités est PUR (aucun import React Native)', () => {
  assert.ok(!CAPABILITIES.includes('react-native'), 'le module ne doit pas importer React Native');
  assert.ok(!CAPABILITIES.includes('@solana/web3.js'), 'le module ne doit pas toucher à web3.js');
  assert.ok(CAPABILITIES.includes('export function reviewScreenIsReadOnly'));
});

// --- Absence d'import et d'appel directs dangereux -----------------------
check('1. TransactionReviewScreen n importe plus useMobileWallet', () => {
  assert.ok(!REVIEW.includes('useMobileWallet'), 'useMobileWallet encore présent');
  assert.ok(!REVIEW.includes('@wallet-ui/react-native-web3js'), 'provider wallet encore importé');
});

check('2. TransactionReviewScreen ne contient plus signAndSendTransactions', () => {
  assert.ok(!REVIEW.includes('signAndSendTransactions'));
});

check('3. TransactionReviewScreen ne contient plus handleSendApproval', () => {
  assert.ok(!REVIEW.includes('handleSendApproval'));
});

check('4. TransactionReviewScreen ne contient plus handleRequestApproval', () => {
  assert.ok(!REVIEW.includes('handleRequestApproval'));
});

check('5. TransactionReviewScreen ne contient plus "Approve now"', () => {
  assert.ok(!REVIEW.includes('Approve now'));
});

check('6. TransactionReviewScreen ne contient plus de CTA Approve', () => {
  assert.ok(!REVIEW.includes('Approve proposal'), 'CTA "Approve proposal" encore présent');
  assert.ok(!REVIEW.includes('Review and confirm'), 'CTA "Review and confirm" encore présent');
  assert.ok(!REVIEW.includes('handleCancelPlan'), 'handler de plan encore présent');
  assert.ok(!REVIEW.includes('planProposalApproval'), 'plan d approbation encore importé/évalué');
  assert.ok(!REVIEW.includes('VersionedTransaction'), 'construction de transaction encore présente');
  assert.ok(!REVIEW.includes('TransactionMessage'), 'construction de message encore présente');
});

// --- Présence depuis ProposalDetailsScreen (vue technique facultative) ----
check('7. TransactionReviewScreen reste accessible depuis ProposalDetailsScreen', () => {
  assert.ok(DETAILS.includes("from './TransactionReviewScreen'"), 'import manquant');
  assert.ok(DETAILS.includes('<TransactionReviewScreen'), 'rendu manquant');
  assert.ok(DETAILS.includes('setReviewOpen(true)'), 'bouton d ouverture manquant');
});

check('8. Back retourne vers ProposalDetailsScreen (un seul bouton Back)', () => {
  assert.ok(REVIEW.includes('accessibilityLabel="Back to proposal details"'));
  assert.ok(REVIEW.includes('onPress={handleBack}'));
  assert.ok(DETAILS.includes('onBack={() => setReviewOpen(false)}'), 'retour mal branché');
  // Un seul bouton Pressable de sortie, et aucun "Cancel" sur cet écran.
  assert.equal(REVIEW.split('onPress={handleBack}').length - 1, 1, 'un seul Back attendu');
  assert.ok(!REVIEW.includes('>Cancel<'), 'aucun Cancel pour un simple retour');
});

// --- ProposalDetailsScreen reste canonique -------------------------------
check('9. ProposalDetailsScreen contient toujours le CTA Approve', () => {
  // Le CTA existe toujours ; il peut etre rendu conditionnellement (etats
  // exclusifs), donc le libelle est porte par une constante/ternaire.
  assert.ok(DETAILS.includes("'Approve this proposal'"));
  assert.ok(DETAILS.includes('onPress={onApprove}'));
  assert.ok(DETAILS.includes('const onApprove = () => {'));
  assert.ok(DETAILS.includes('const runApproval = async () => {'));
});

check('10. ProposalDetailsScreen utilise signAndSendProposalApproval', () => {
  assert.ok(DETAILS.includes("from '../squads/signAndSendProposalApproval'"));
  assert.ok(DETAILS.includes('await signAndSendProposalApproval({'));
});

check('11. signAndSendProposalApproval conserve blockhash/confirmation/read-back/anti-double', () => {
  assert.ok(APPROVAL.includes('applyFreshBlockhash'), 'blockhash frais manquant');
  assert.ok(APPROVAL.includes('confirmSignature'), 'confirmation manquante');
  assert.ok(APPROVAL.includes('Proposal.fromAccountInfo'), 'read-back de la Proposal manquant');
  assert.ok(APPROVAL.includes('evaluateSigningWindow'), 'fenêtre de signature manquante');
  assert.ok(APPROVAL.includes("verified: errors.length === 0 && confirmation?.status === 'confirmed'"));
  assert.ok(APPROVAL.includes('SINGLE_SEND_WARNING'), 'avertissement anti-double envoi manquant');
});

// --- Une seule voie UI d'approbation -------------------------------------
check('12. une seule voie UI d approbation dans src/screens', () => {
  // Seul ProposalDetailsScreen importe le module métier d'approbation.
  assert.ok(!REVIEW.includes("from '../squads/signAndSendProposalApproval'"));
  // La construction de l'instruction proposalApprove reste dans le module métier.
  const proposalApprovalModule = readFileSync('src/squads/proposalApproval.ts', 'utf8');
  assert.ok(proposalApprovalModule.includes('multisig.instructions.proposalApprove'));
  assert.ok(!REVIEW.includes('proposalApprove('), 'aucune instruction Approve construite dans la vue');
});

// --- Aucun wallet, aucun envoi depuis la vue -----------------------------
check('13/14. TransactionReviewScreen ne peut ouvrir aucun wallet ni envoyer', () => {
  for (const forbidden of [
    'useMobileWallet',
    'signAndSendTransactions',
    'signTransaction',
    'signMessages',
    'authorizeSession',
    'connect(',
    'reauthorize',
    'sendRawTransaction',
    'sendTransaction',
    'partialSign',
  ]) {
    assert.ok(!REVIEW.includes(forbidden), `appel interdit présent: ${forbidden}`);
  }
});

// --- Execute inchangé ----------------------------------------------------
check('15. Execute reste inchangé et utilise le module d exécution', () => {
  assert.ok(DETAILS.includes("from '../squads/signAndSendProposalExecution'"));
  assert.ok(DETAILS.includes('await signAndSendProposalExecution({'));
  assert.ok(EXECUTION.includes('multisig.instructions.vaultTransactionExecute'));
  assert.ok(EXECUTION.includes('confirmSignature'));
});

// --- Guards et allowlist non affaiblis -----------------------------------
check('16. aucun guard ni allowlist n est affaibli', () => {
  assert.ok(REVIEW.includes('useWalletGuard'), 'guard retiré de la vue');
  assert.ok(REVIEW.includes('checkReviewAllowlist'), 'allowlist retirée de la vue');
  assert.ok(DETAILS.includes('useWalletGuard'));
  assert.ok(DETAILS.includes('checkReviewAllowlist'));
  const guard = readFileSync('src/wallet/useWalletGuard.ts', 'utf8');
  assert.ok(guard.includes("network.chain !== DEVNET_CHAIN"));
  assert.ok(guard.includes("network.endpoint !== DEVNET_ENDPOINT"));
  assert.ok(guard.includes("member.roles.includes('Vote')"));
  const allowlist = readFileSync('src/squads/instructionAllowlist.ts', 'utf8');
  assert.ok(allowlist.includes('ALLOWED_PROGRAM_IDS'));
});

// --- Aucun effet de bord de signature ------------------------------------
check('17. aucun useEffect ne signe ni n envoie', () => {
  assert.equal(REVIEW.split('useEffect(').length - 1, 1, 'un seul useEffect (BackHandler) attendu');
  const effect = REVIEW.slice(REVIEW.indexOf('useEffect('), REVIEW.indexOf('return ('));
  assert.ok(!/signAndSend|signTransaction|sendRawTransaction|authorize/i.test(effect));
});

// --- Décodage et informations techniques toujours affichés ---------------
check('18. le décodage et les informations techniques restent affichés', () => {
  assert.ok(REVIEW.includes("from './TransactionTechnicalDetails'"));
  assert.ok(REVIEW.includes('<TransactionTechnicalDetails'));
  for (const label of ['Action', 'Amount', 'Destination', 'Approvals', 'Technical transaction details']) {
    assert.ok(REVIEW.includes(label), `champ technique manquant: ${label}`);
  }
  assert.ok(REVIEW.includes('REVIEW_SCREEN_CAPABILITIES.readOnly'));
});

setTimeout(() => {
  console.log(`\n${passed} test(s) OK`);
  if (process.exitCode === 1) process.exit(1);
}, 50);
