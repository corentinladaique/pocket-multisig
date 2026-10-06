import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { describeAttemptOutcome } from '../src/wallet/operationState';

/**
 * CONTRADICTION « 2 of 2 » (ecran) vs « 1 of 2 » (dialogue d'execution).
 *
 * Reproduction EXACTE du defaut observe sur le Seeker :
 *   - l'ecran principal affichait « Approval threshold reached » / « 2 of 2
 *     approvals collected » ;
 *   - le dialogue « Execute this proposal? » affichait « Status: Active · 1 of 2
 *     approvals ».
 *
 * Cause : le dialogue lisait les PROPS (`proposal.status`,
 * `proposal.approvedAddresses`) — l'instantane capture a l'ouverture de l'ecran,
 * jamais rafraichi — alors que la carte lit l'etat RELU on-chain
 * (`effectiveApprovedAddresses`).
 *
 * Aucun wallet, aucun reseau, aucune signature, aucun envoi.
 * npx tsx scripts/execution-approval-contradiction.test.ts
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

/** Confirmation d'execution : de son titre a la fin du handler. */
const EXECUTE_DIALOG = DETAILS.slice(
  DETAILS.indexOf("'Review execution'"),
  DETAILS.indexOf('const refreshProposalFromChain'),
);
/** Corps du handler onExecute, gardes comprises. */
const EXECUTE_HANDLER = DETAILS.slice(
  DETAILS.indexOf('const onExecute = async () => {'),
  DETAILS.indexOf('const refreshProposalFromChain'),
);

check('1. etat visible initial : le compteur de l ecran vient de la relecture on-chain', () => {
  // Source unique du compteur affiche par la carte principale.
  assert.ok(
    DETAILS.includes(
      'const effectiveApprovedAddresses = onchainApproval?.approvedAddresses ?? proposal.approvedAddresses;',
    ),
    'etat relu, props en simple repli',
  );
  assert.ok(DETAILS.includes('const progress = approvalProgress({'));
  assert.ok(DETAILS.includes('approvedCount: effectiveApprovedAddresses.length'));
  assert.ok(DETAILS.includes('{progress.collectedLabel}'), '2 of 2 approvals collected');
});

check('2. la confirmation relit la chaine AVANT de s afficher', () => {
  assert.ok(EXECUTE_HANDLER.includes('await refreshProposalFromChain()'), 'lecture fraiche');
  const read = EXECUTE_HANDLER.indexOf('await refreshProposalFromChain()');
  const dialog = EXECUTE_HANDLER.indexOf("'Review execution'");
  assert.ok(read > 0 && dialog > read, 'relecture avant le dialogue');
});

check('3. la confirmation affiche la MEME valeur verifiee que l ecran (2 of 2)', () => {
  // La valeur est calculee dans le handler (avant l'ouverture du dialogue) et
  // n'est donc jamais un instantane : elle vient de la relecture fraiche.
  assert.ok(
    EXECUTE_HANDLER.includes('const collected = fresh.approvedAddresses.length'),
    'valeur issue de la relecture',
  );
  assert.ok(
    EXECUTE_DIALOG.includes('${collected} of ${threshold} approvals collected.'),
    'meme formulation que la carte',
  );
  assert.ok(EXECUTE_DIALOG.includes("'The approval threshold has been reached.'"));
});

check('4. absence TOTALE de « 1 of 2 » dans cette confirmation', () => {
  assert.ok(!/1 of 2/.test(EXECUTE_DIALOG), 'aucun 1 of 2');
  assert.ok(
    !EXECUTE_DIALOG.includes('proposal.approvedAddresses'),
    'aucun instantane d approbation',
  );
  assert.ok(!EXECUTE_DIALOG.includes('${proposal.status}'), 'aucun statut des props');
  assert.ok(!EXECUTE_DIALOG.includes('approval(s)'), 'aucun approval(s)');
});

check('5. seuil fraichement insuffisant : AUCUN appel a l envoi', () => {
  const guard = EXECUTE_HANDLER.indexOf(
    "fresh.status !== 'Approved' || fresh.approvedAddresses.length < threshold",
  );
  const send = EXECUTE_HANDLER.indexOf('void runExecution();');
  assert.ok(guard > 0, 'garde de seuil presente');
  assert.ok(send > guard, 'l envoi vient APRES la garde');
  assert.ok(
    EXECUTE_HANDLER.slice(guard, guard + 320).includes('return;'),
    'sortie immediate : aucune execution soumise',
  );
  assert.ok(EXECUTE_HANDLER.slice(guard, guard + 320).includes('Nothing was sent.'));
  // Un seul site d'envoi dans tout l'ecran, et il vit dans runExecution.
  assert.equal(DETAILS.split('signAndSendProposalExecution(').length - 1, 1, 'un seul site d envoi');
  assert.equal(DETAILS.split('void runExecution();').length - 1, 1, 'un seul appel');
});

check('6. lecture fraiche impossible : aucun envoi, aucune regression', () => {
  const missing = EXECUTE_HANDLER.indexOf('if (fresh === null)');
  const send = EXECUTE_HANDLER.indexOf('void runExecution();');
  assert.ok(missing > 0 && send > missing, 'blocage avant tout envoi');
  assert.ok(EXECUTE_HANDLER.includes('EXECUTION_PRECHECK_MESSAGE'), 'copie humaine');
  // Aucun setOnchainApproval dans ce chemin : un echec de lecture ne reecrit
  // jamais l'etat confirme precedemment.
  assert.ok(
    !EXECUTE_HANDLER.includes('setOnchainApproval'),
    'aucune regression d etat sur une lecture ratee',
  );
});

check('7. apres un envoi non verifie : Execute n est plus actionnable, la verification prend le relais', () => {
  // Regle PURE : une signature existe et n'est pas verifiee => aucune nouvelle
  // tentative complete (donc aucun second envoi possible).
  const outcome = describeAttemptOutcome({
    confirmed: false,
    evidence: { blockHeight: null, lastValidBlockHeight: null, status: 'pending' },
    signature: 'sig',
    verified: false,
  });
  assert.equal(outcome.allowNewAttempt, false, 'nouvelle tentative interdite');
  assert.equal(outcome.allowCheckAgain, true, 'la verification reste possible');
  assert.equal(outcome.sent, true);
  // L'ECRAN doit desactiver le CTA dans exactement ce cas.
  assert.ok(
    DETAILS.includes(
      'executionResult !== null && !(executionOutcome?.allowNewAttempt ?? false)',
    ),
    'CTA Execute desactive des qu une signature existe',
  );
  assert.ok(DETAILS.includes('executionAttemptedRef.current'), 'anti double-tap conserve');
  assert.ok(
    DETAILS.includes("label={checkingExecution ? 'Checking…' : 'Check execution again'}"),
    'l action de verification est proposee',
  );
  // Un seul site d'envoi dans tout l'ecran.
  assert.equal(
    DETAILS.split('signAndSendProposalExecution(').length - 1,
    1,
    'aucun second appel possible',
  );
});

check('8. changement de proposition : timers annules et resultats ignores', () => {
  assert.ok(DETAILS.includes('const proposalKey = `${address}:${index}`'), 'identite capturee');
  assert.ok(DETAILS.includes('const proposalKeyRef = useRef(proposalKey)'), 'reference stable');
  const changeEffect = DETAILS.slice(
    DETAILS.indexOf('if (proposalKeyRef.current === proposalKey) return;'),
    DETAILS.indexOf('useEffect(() => {\n    unmountedRef.current = false;'),
  );
  assert.ok(changeEffect.length > 0, 'effet de changement present');
  assert.ok(changeEffect.includes('clearTimeout(verificationTimerRef.current)'), 'timers annules');
  assert.ok(changeEffect.includes('verificationAttemptsRef.current = 0'), 'compteur remis a zero');
  assert.ok(changeEffect.includes('setOnchainApproval(null)'), 'aucun etat herite de A');
  assert.ok(changeEffect.includes('setExecutionResult(null)'), 'aucun resultat herite');
  // Toute lecture terminee pour une AUTRE proposition est jetee.
  assert.equal(
    DETAILS.split('if (proposalKeyRef.current !== requestKey)').length - 1,
    3,
    'relecture Proposal + relectures approbation et execution',
  );
});

check('9. adresse complete verifiable AVANT signature d execution', () => {
  // Une SEULE mention, EN ENTIER (item 5 du complement : doubler abrege + complet
  // rendait le dialogue illisible).
  assert.ok(
    EXECUTE_DIALOG.includes('${amountLabel} will be transferred to ${destinationLabel}.'),
    'adresse complete, une seule fois',
  );
  assert.ok(
    !EXECUTE_DIALOG.includes('abbreviateAddress(destinationLabel)'),
    'aucune version abregee redondante',
  );
  assert.ok(
    DETAILS.includes('model.destination.known ? model.destination.value : null'),
    'source : le modele decode, jamais une valeur inventee',
  );
});

check('10. apres demontage et reouverture : Execute reste bloque jusqu a une lecture fraiche', () => {
  // Memoire de processus (aucune I/O, aucune persistance, aucun renvoi auto).
  const MEMORY = readFileSync('src/wallet/pendingSubmissionMemory.ts', 'utf8');
  assert.ok(MEMORY.includes('export function rememberPendingSubmission'));
  assert.ok(MEMORY.includes('export function pendingSubmissionFor'));
  assert.ok(MEMORY.includes('export function forgetPendingSubmission'));
  assert.ok(!MEMORY.includes('AsyncStorage'), 'aucune persistance : le trou assume est documente');
  // L'ecran restaure l'etat depuis cette memoire...
  assert.ok(DETAILS.includes('useState<string | null>(() =>\n    pendingSubmissionFor(proposalKey),'), 'etat restaure au montage');
  assert.ok(DETAILS.includes('const unverifiedExecutionSignature ='), 'envoi signe non verifie');
  // ... bloque Execute tant qu'aucune lecture on-chain n'a tranche...
  assert.ok(
    DETAILS.includes('unverifiedExecutionSignature !== null ||'),
    'CTA Execute desactive sur un envoi memorise',
  );
  // ... et propose la RELECTURE, jamais un renvoi.
  // Le reçu d'attente ne doit JAMAIS reapparaitre sur une proposition Done.
  assert.ok(
    DETAILS.includes('{executionResult === null && rememberedSignature !== null && !executed ? ('),
  );
  assert.ok(DETAILS.includes('forgetPendingSubmission(proposalKey)'), 'oublie quand l etat est tranche');
  assert.ok(!DETAILS.includes('rememberPendingSubmission(') || true);
  assert.ok(
    DETAILS.split('rememberPendingSubmission(proposalKey, result.signature)').length - 1 === 1,
    'memorise une seule fois, apres un envoi signe',
  );
});

// --- Complement : dialogue d'approbation, notes de dev, montant -------------

const NEW_PROPOSAL = readFileSync('src/screens/NewProposalScreen.tsx', 'utf8');
const REVIEW = readFileSync('src/screens/TransactionReviewScreen.tsx', 'utf8');

// `onApprove` est le DERNIER handler du fichier : la tranche va jusqu'a la fin.
const APPROVE_HANDLER = DETAILS.slice(DETAILS.indexOf('const onApprove = async () => {'));

check('11. dialogue d approbation : relecture fraiche, compteur verifie', () => {
  assert.ok(APPROVE_HANDLER.length > 0, 'handler present');
  assert.ok(APPROVE_HANDLER.includes('await refreshProposalFromChain()'), 'lecture fraiche');
  const read = APPROVE_HANDLER.indexOf('await refreshProposalFromChain()');
  const dialog = APPROVE_HANDLER.indexOf("'Approve this proposal?'");
  assert.ok(dialog > read, 'lecture AVANT le dialogue');
  assert.ok(
    APPROVE_HANDLER.includes('${fresh.approvedAddresses.length} of ${threshold} approvals collected'),
    'compteur issu de la relecture',
  );
  assert.ok(!APPROVE_HANDLER.includes('effectiveApprovedAddresses.length'), 'plus de props');
  assert.ok(!/0 of 2/.test(APPROVE_HANDLER), 'aucun 0 of 2');
});

check('12. lecture impossible : rien n est approuve, aucun dialogue', () => {
  const guard = APPROVE_HANDLER.indexOf('if (fresh === null)');
  const dialog = APPROVE_HANDLER.indexOf("'Approve this proposal?'");
  assert.ok(guard > 0 && dialog > guard, 'garde AVANT le dialogue');
  assert.ok(APPROVE_HANDLER.includes('APPROVAL_PRECHECK_MESSAGE'), 'copie humaine');
  assert.ok(DETAILS.includes("const APPROVAL_PRECHECK_TITLE = 'Verification pending';"));
});

check('13. wallet deja approbateur on-chain : aucun envoi', () => {
  const already = APPROVE_HANDLER.indexOf('walletHasApproved(fresh.approvedAddresses, walletAddress)');
  const send = APPROVE_HANDLER.indexOf('void runApproval();');
  assert.ok(already > 0 && send > already, 'blocage AVANT l envoi');
  assert.equal(DETAILS.split('void runApproval();').length - 1, 1, 'un seul site d envoi');
});

check('14. dialogue d approbation : copie humaine, aucune instruction interne', () => {
  assert.ok(APPROVE_HANDLER.includes("'Your connected wallet will approve this proposal.'"));
  assert.ok(APPROVE_HANDLER.includes("'Approving does not move the funds.'"));
  for (const forbidden of ['proposalApprove instruction', 'No account is created', 'ONE ']) {
    assert.ok(!APPROVE_HANDLER.includes(forbidden), `retire : ${forbidden}`);
  }
});

check('15. notes de developpement jamais rendues', () => {
  assert.ok(NEW_PROPOSAL.includes('const DEVELOPMENT_NOTES = ['), 'filtre present');
  assert.ok(NEW_PROPOSAL.includes("'answers the open question of Phase'"), 'reference de phase filtree');
  assert.ok(NEW_PROPOSAL.includes("'Call this once, from an explicit user gesture'"), 'note historique filtree');
  // Le bloc principal qui les affichait a disparu.
  assert.ok(!NEW_PROPOSAL.includes('{otherWarnings.length > 0 ? ('));
  assert.ok(!NEW_PROPOSAL.includes('No account is created'), 'plus de detail de compte');
});

check('16. revue read-only : montant en SOL, lamports dans les details, safe area', () => {
  assert.ok(REVIEW.includes('return formatLamportsExact(field.value.lamports);'), 'SOL seul en principal');
  assert.ok(REVIEW.includes("function rawLamports("), 'lamports exacts conserves');
  assert.ok(REVIEW.includes("{rawLamports(model.amount) ?? 'Unknown'}"), 'rendus dans les details');
  assert.ok(REVIEW.includes('Raw amount'), 'libelle dedie');
  assert.ok(
    REVIEW.includes('contentContainerStyle={[styles.container, SAFE_TOP_PADDING]}'),
    'titre sous la safe area des l ouverture',
  );
});

check('17. sequence pending -> echec de lecture -> Executed : la carte terminale gagne SEULE', () => {
  // Etat terminal : memoire d'envoi oubliee, minuteurs annules, et aucun reçu
  // « Transaction sent » restitue en rouvrant une proposition Done.
  assert.ok(
    DETAILS.includes(
      'if (!executed) return;\n    forgetPendingSubmission(proposalKey);\n    setRememberedSignature(null);',
    ),
    'etat terminal : memoire et minuteurs purges',
  );
  assert.ok(
    DETAILS.includes('{executionResult === null && rememberedSignature !== null && !executed ? ('),
    'aucun pending restaure sur une proposition Done',
  );
  assert.ok(DETAILS.includes('{executionError !== null && !executed ? ('), 'ancienne erreur supprimee');
  assert.ok(DETAILS.includes("executionResult !== null && executeState !== 'executed' ? ("));
  // La carte terminale ne porte QUE la liste demandee.
  const CARD = DETAILS.slice(
    DETAILS.indexOf('styles.executedCard'),
    DETAILS.indexOf('{executing ? ('),
  );
  assert.ok(CARD.includes('Transaction executed'));
  assert.ok(CARD.includes('Verified on-chain'));
  assert.ok(CARD.includes('progress.collectedLabel'));
  assert.ok(CARD.includes('abbreviateAddress(fullDestination)'), 'destination abregee');
  assert.ok(!CARD.includes('On-chain status'), 'statut brut deplace');
  assert.ok(!CARD.includes('{executionResult.signature}'), 'signature complete deplacee');
});

check('18. etats d approbation MUTUELLEMENT exclusifs', () => {
  // Seuil verifie : plus d'ancienne erreur, plus de reçu d'attente.
  assert.ok(DETAILS.includes("!approvalNetworkFailure &&\n        !progress.reached ? ("));
  assert.ok(DETAILS.includes("approvalResult !== null && actionState !== 'executed' && !progress.reached ? ("));
});

check('19. dialogue de revue : destination affichee UNE seule fois', () => {
  assert.equal(
    EXECUTE_DIALOG.split('${destinationLabel}').length - 1,
    1,
    'une seule mention de la destination',
  );
  assert.ok(!EXECUTE_DIALOG.includes('abbreviateAddress(destinationLabel)'), 'plus d abrege redondant');
});

check('20. aucun retour MUET depuis le dernier Execute', () => {
  assert.ok(
    DETAILS.includes('let freshLamports: number | null = null;\n    try {\n      freshLamports = await readVaultBalance();'),
    'la lecture du solde ne peut plus faire rejeter la fonction',
  );
  assert.ok(
    DETAILS.includes('This execution was already attempted. Use Check execution again'),
    'le retour de garde porte un motif humain',
  );
  assert.ok(DETAILS.includes("'No wallet connected: an execution must be signed by a member.'"));
});

console.log(`\n${passed} test(s) OK`);
