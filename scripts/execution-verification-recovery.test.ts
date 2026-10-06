import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { describeAttemptOutcome } from '../src/wallet/operationState';

/**
 * Recuperation de verification d'EXECUTION (lecture seule), reprises bornees et
 * copie simplifiee. Aucun wallet, aucun reseau, aucune signature, aucun envoi.
 * npx tsx scripts/execution-verification-recovery.test.ts
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
const CONNECT = readFileSync('src/screens/ConnectScreen.tsx', 'utf8');
const NEW_PROPOSAL = readFileSync('src/screens/NewProposalScreen.tsx', 'utf8');
const CONTENT = readFileSync('src/onboarding/content.ts', 'utf8');
const PROFILE = readFileSync('src/onboarding/profile.ts', 'utf8');

/** Region du chemin de recuperation : de la fonction de relecture au bouton d'approbation. */
const RECOVERY = DETAILS.slice(
  DETAILS.indexOf('const verifyExecutionOnce'),
  DETAILS.indexOf('const onCheckApprovalAgain'),
);

check('1. signature existante + read-back impossible : la reprise est autorisee', () => {
  const outcome = describeAttemptOutcome({
    confirmed: false,
    evidence: { blockHeight: null, lastValidBlockHeight: null, status: 'pending' },
    networkFailure: true,
    signature: '3K1TvoJmvkYqEX32qsDb9o47QBTSXB1qrgRU6k6rpCUEGpw1ft35V3QZsoGmkjJFfs6n6gHrFChJ78MM5CaWFnQe',
    verified: false,
  });
  // Un envoi SIGNE n'est jamais « failed », et une relecture reste possible.
  assert.equal(outcome.sent, true);
  assert.equal(outcome.allowCheckAgain, true);
  assert.equal(outcome.allowNewAttempt, false, 'jamais de second envoi');
  assert.equal(outcome.tone, 'warning', 'jamais presente comme un echec');
  assert.equal(outcome.label, 'Transaction signed, verification temporarily unavailable.');
});

check('2. une relecture ulterieure confirme l execution', () => {
  assert.ok(RECOVERY.length > 0, 'region presente');
  assert.ok(RECOVERY.includes('confirmSignature({ connection, signature })'), 'statut de la signature');
  assert.ok(RECOVERY.includes('refreshProposalFromChain()'), 'Proposal relue on-chain');
  assert.ok(RECOVERY.includes("fresh.status === 'Executed'"), 'execution deduite de la relecture');
  assert.ok(RECOVERY.includes('verified: confirmed && executedOnchain'), 'jamais un succes sans preuve');
});

check('3. la reprise ne sollicite JAMAIS le wallet', () => {
  assert.ok(!RECOVERY.includes('useMobileWallet'), 'aucun wallet');
  assert.ok(!RECOVERY.includes('authorize'), 'aucune autorisation');
  assert.ok(!RECOVERY.includes('signAndSendTransactions'), 'aucune signature');
  assert.ok(!RECOVERY.includes('signAndSendProposalExecution'), 'aucune reconstruction');
});

check('4. la reprise n envoie JAMAIS de seconde transaction', () => {
  assert.ok(!RECOVERY.includes('sendTransaction'), 'aucun envoi');
  assert.ok(!RECOVERY.includes('vaultTransactionExecute'), 'aucune instruction d execution');
  assert.ok(!RECOVERY.includes('new Transaction()'), 'aucune transaction construite');
});

check('5. etat Executed atteint seulement par la relecture on-chain', () => {
  assert.ok(
    DETAILS.includes("effectiveProposalStatus === 'Executed' || executionResult?.verified === true"),
    'statut terminal ou verification prouvee',
  );
});

check('6. confirme ne regresse jamais vers « pending »', () => {
  const confirmed = describeAttemptOutcome({
    confirmed: true,
    signature: 'sig',
    verified: false,
  });
  assert.equal(confirmed.label, 'Confirmed but read-back failed.');
  const pending = describeAttemptOutcome({ confirmed: false, signature: 'sig', verified: false });
  assert.equal(pending.label, 'Transaction signed, confirmation pending.');
});

check('7. copie humaine : « Transaction sent » + verification temporairement indisponible', () => {
  assert.ok(DETAILS.includes("const EXECUTION_SENT_TITLE = 'Transaction sent';"));
  assert.ok(
    DETAILS.includes(
      "'Verification is temporarily unavailable. Multisig will check again when the network connection returns.'",
    ),
  );
  assert.ok(
    DETAILS.includes('`${EXECUTION_SENT_TITLE}\\n${EXECUTION_UNVERIFIED_MESSAGE}`'),
    'titre + message dans le bloc principal',
  );
  assert.ok(
    DETAILS.includes("tone={executionNetworkFailure ? 'warning' : 'error'}"),
    'un envoi signe non verifie n est pas rouge',
  );
});

check('8. erreurs RPC / Java / DNS reservees a Troubleshooting details', () => {
  assert.ok(
    DETAILS.includes('setExecutionDiagnostics((previous) => [...previous, raw])'),
    'le detail brut part dans les diagnostics',
  );
  assert.ok(DETAILS.includes('executionDiagnostics.length > 0 ||'), 'le repli s ouvre alors');
  assert.ok(
    DETAILS.includes('{executionDiagnostics.map((message, position) => ('),
    'et il est rendu la, pas ailleurs',
  );
  assert.ok(
    DETAILS.includes('Execution signature: {executionResult.signature}'),
    'signature conservee dans les details techniques',
  );
});

check('9. reprises bornees : reseau temporaire seulement, jamais apres demontage', () => {
  assert.ok(DETAILS.includes('MAX_VERIFICATION_ATTEMPTS = 3'));
  assert.ok(DETAILS.includes('const VERIFICATION_RETRY_DELAYS_MS = [4000, 8000, 15000]'));
  assert.ok(
    DETAILS.includes("isTemporaryNetworkFailure(executionResult.errorMessage ?? '')"),
    'classe par isTemporaryNetworkFailure uniquement',
  );
  assert.ok(DETAILS.includes('unmountedRef.current = true'), 'jamais apres demontage');
  assert.ok(DETAILS.includes('if (unmountedRef.current || verificationInFlightRef.current) return;'));
  assert.ok(DETAILS.includes('verificationAttemptsRef.current >= MAX_VERIFICATION_ATTEMPTS'));
  assert.ok(DETAILS.includes("label={checkingExecution ? 'Checking…' : 'Check execution again'}"));
});

check('10. la reussite efface l erreur courante', () => {
  assert.ok(RECOVERY.includes('setExecutionError(null)'), 'etat courant reussi');
  assert.ok(
    RECOVERY.includes('verificationAttemptsRef.current = MAX_VERIFICATION_ATTEMPTS'),
    'les reprises s arretent des que l execution est confirmee',
  );
});

check('11. libelles renommes presents', () => {
  assert.ok(CREATE.includes('Review and create'));
  assert.ok(CREATE.includes('Vault configuration'));
  assert.ok(CREATE.includes('{members.length} valid signer addresses'));
  assert.ok(CREATE.includes('No duplicate addresses'));
  assert.ok(CREATE.includes('Good to know'));
  assert.ok(CREATE.includes('Signers ({members.length} added)'));
  assert.ok(CREATE.includes("'Vault ready'"));
  assert.ok(CREATE.includes('Vault ready'));
  assert.ok(CREATE.includes('View proposals'));
  assert.ok(!CREATE.includes('Go to Inbox'));
  assert.ok(CREATE.includes("'Create this vault on Devnet?'"));
  assert.ok(CREATE.includes("text: 'Create vault'"));
  assert.ok(!CREATE.includes('Planned permissions'));
  assert.ok(DETAILS.includes('required approvals'));
});

check('12. plus aucun « approval(s) » ni « Pocket Multisig » cote utilisateur', () => {
  for (const [name, source] of [
    ['ProposalDetailsScreen', DETAILS],
    ['CreateVaultScreen', CREATE],
    ['NewProposalScreen', NEW_PROPOSAL],
  ] as const) {
    assert.ok(!source.includes('approval(s)'), `${name} : plus de approval(s)`);
  }
  for (const [name, source] of [
    ['ProposalDetailsScreen', DETAILS],
    ['CreateVaultScreen', CREATE],
    ['ConnectScreen', CONNECT],
    ['NewProposalScreen', NEW_PROPOSAL],
  ] as const) {
    assert.ok(!source.includes('Pocket Multisig'), `${name} : plus de Pocket Multisig`);
  }
  assert.ok(!CONTENT.includes("'Pocket Multisig"));
  assert.ok(!PROFILE.includes("'Pocket Multisig"));
});

// --- Contradiction « 2 of 2 » vs « 1 of 2 » (regression) ---------------------

/** Region du dialogue de revue d'execution : de sa garde a la fin du handler. */
const EXECUTE_REVIEW = DETAILS.slice(
  DETAILS.indexOf('const onExecute = async () => {'),
  DETAILS.indexOf('const refreshProposalFromChain'),
);

/** Recu d'approbation (bloc principal), hors Troubleshooting. */
const APPROVAL_RECEIPT = DETAILS.slice(
  DETAILS.indexOf("{approvalResult !== null && actionState !== 'executed' && !progress.reached ? ("),
  DETAILS.indexOf('{approvalActions?.allowCheckAgain ? ('),
);

check('13. le dialogue d execution lit l etat RELU, jamais l instantane des props', () => {
  assert.ok(EXECUTE_REVIEW.length > 0, 'region presente');
  assert.ok(
    EXECUTE_REVIEW.includes('await refreshProposalFromChain()'),
    'relecture on-chain avant confirmation',
  );
  // La cause exacte de « 2 of 2 » (carte) vs « 1 of 2 » (dialogue) :
  assert.ok(
    !EXECUTE_REVIEW.includes('proposal.approvedAddresses.length'),
    'plus jamais le compteur des props',
  );
  assert.ok(!EXECUTE_REVIEW.includes('${proposal.status}'), 'plus jamais le statut des props');
  assert.ok(EXECUTE_REVIEW.includes('${collected} of ${threshold} approvals collected.'), '2 of 2 affiche');
  assert.ok(EXECUTE_REVIEW.includes("'The approval threshold has been reached.'"));
});

check('14. relecture fraiche insuffisante : execution bloquee', () => {
  assert.ok(
    EXECUTE_REVIEW.includes("fresh.status !== 'Approved' || fresh.approvedAddresses.length < threshold"),
    'seuil revalide sur la relecture',
  );
  assert.ok(EXECUTE_REVIEW.includes('Nothing was sent.'), 'dit que rien n est parti');
});

check('15. relecture impossible : aucun envoi, et la garde precede le dialogue', () => {
  assert.ok(EXECUTE_REVIEW.includes('EXECUTION_PRECHECK_MESSAGE'), 'copie humaine');
  const guard = EXECUTE_REVIEW.indexOf('if (fresh === null)');
  const dialog = EXECUTE_REVIEW.indexOf("'Review execution'");
  const send = EXECUTE_REVIEW.indexOf('void runExecution();');
  assert.ok(guard > 0 && dialog > guard, 'garde AVANT le dialogue');
  assert.ok(send > dialog, 'envoi uniquement apres confirmation');
});

check('16. aucune seconde execution possible depuis la revue', () => {
  assert.equal(DETAILS.split('void runExecution();').length - 1, 1, 'un seul chemin d envoi');
  assert.ok(!EXECUTE_REVIEW.includes('vaultTransactionExecute'), 'plus d instruction technique');
  assert.ok(!EXECUTE_REVIEW.includes('signAndSendProposalExecution'), 'aucune reconstruction');
});

check('17. approbation signee non verifiee : copie humaine + ton neutre', () => {
  assert.ok(DETAILS.includes("const APPROVAL_SENT_TITLE = 'Approval sent';"));
  assert.ok(
    DETAILS.includes(
      "'Verification is temporarily unavailable. Multisig will check again when the network connection returns.'",
    ),
  );
  assert.ok(DETAILS.includes("tone={approvalNetworkFailure ? 'warning' : 'error'}"));
});

check('18. recu d approbation : plus de signature complete ni d adresse de compte', () => {
  assert.ok(APPROVAL_RECEIPT.length > 0, 'region presente');
  // Le JSX coupe la phrase sur deux lignes : on tolere le retour a la ligne.
  assert.ok(/approvals\s+collected/.test(APPROVAL_RECEIPT), 'compteur verifie');
  assert.ok(!APPROVAL_RECEIPT.includes('approvalResult.readBack.address'), 'adresse deplacee');
  assert.ok(!APPROVAL_RECEIPT.includes('approval(s)'), 'plus de approval(s)');
  assert.ok(!APPROVAL_RECEIPT.includes('{approvalResult.signature}'), 'signature complete deplacee');
});

check('19. creation de proposition : un seul dialogue, lisible, sans detail de compte', () => {
  assert.ok(NEW_PROPOSAL.includes("'Create this proposal?'"));
  assert.ok(!NEW_PROPOSAL.includes('Confirm creation'), 'un seul dialogue');
  assert.ok(!NEW_PROPOSAL.includes('member(s)'), 'plus de member(s)');
  assert.ok(
    !NEW_PROPOSAL.includes('You will sign ONE transaction creating two accounts'),
    'plus de detail de construction',
  );
  assert.ok(NEW_PROPOSAL.includes('Creating the proposal does not move the funds.'));
  assert.ok(NEW_PROPOSAL.includes("text: 'Create proposal'"));
  assert.ok(NEW_PROPOSAL.includes('Estimated creation cost:'), 'cout conserve');
  assert.ok(NEW_PROPOSAL.includes("abbreviateAddress(destination)"), 'destination raccourcie');
});

check('20. montant de confirmation formate en SOL lisible (0.2, pas 0.200000000)', () => {
  const dialog = NEW_PROPOSAL.slice(
    NEW_PROPOSAL.indexOf("'Create this proposal?'"),
    NEW_PROPOSAL.indexOf("text: 'Create proposal'"),
  );
  assert.ok(dialog.includes('formatSolAmount(build.request?.lamports ?? 0)'));
  assert.ok(!dialog.includes('formatSol('), 'jamais 9 decimales dans la confirmation');
});

check('21. etat execute : titre et verification explicites', () => {
  assert.ok(DETAILS.includes('Transaction executed'));
  assert.ok(DETAILS.includes('Verified on-chain'));
});

console.log(`\n${passed} test(s) OK`);
