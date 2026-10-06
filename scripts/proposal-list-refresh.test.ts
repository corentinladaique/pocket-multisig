import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { computeProposalIndexes } from '../src/squads/proposals';
import { buildProposalCreation } from '../src/squads/buildProposalCreation';

/**
 * Hotfix : liste Proposals périmée après création + bloc Simulation simplifié.
 * Aucun wallet, aucun réseau. npx tsx scripts/proposal-list-refresh.test.ts
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

const PROPOSALS = readFileSync('src/squads/proposals.ts', 'utf8');
const LIST = readFileSync('src/screens/ProposalListScreen.tsx', 'utf8');
const DETAILS = readFileSync('src/screens/MultisigDetailsScreen.tsx', 'utf8');
const PROPOSAL = readFileSync('src/screens/NewProposalScreen.tsx', 'utf8');
const ALLOWLIST = readFileSync('src/squads/instructionAllowlist.ts', 'utf8');
const GATE = readFileSync('src/squads/proposalApproval.ts', 'utf8');

const DETAILS_ACTIONS = DETAILS.slice(
  DETAILS.indexOf('const reloadFromChain'),
  DETAILS.indexOf('const openCreatedProposal'),
);
const PROPOSAL_ACTION = LIST.slice(
  LIST.indexOf('const onPressRefresh'),
  LIST.indexOf('useEffect('),
);
// Bloc principal de simulation (avant la section repliable).
const SIM_MAIN = PROPOSAL.slice(
  PROPOSAL.indexOf("'Simulation succeeded'"),
  PROPOSAL.indexOf('accessibilityLabel="Toggle advanced diagnostics"'),
);

// ---- A/B : actualisation après création --------------------------------
check('1. proposition vérifiée : callback de refresh déclenché', () => {
  assert.ok(PROPOSAL.includes('if (result.verified) {'));
  assert.ok(PROPOSAL.includes('await onCreatedVerified()'), 'refresh on-chain demandé');
  assert.ok(PROPOSAL.includes("setPostCreate('refreshing')"));
  assert.ok(DETAILS.includes('onCreatedVerified={reloadFromChain}'), 'parent branché');
});

check('2. read-back échoué : aucun refresh présenté comme réussi', () => {
  const failed = PROPOSAL.slice(
    PROPOSAL.indexOf('if (!result.verified) {'),
    PROPOSAL.indexOf('if (result.verified) {'),
  );
  assert.ok(!failed.includes('onCreatedVerified'), 'aucun refresh dans le chemin non vérifié');
  assert.ok(PROPOSAL.includes('Proposal created, but the proposal list could not be refreshed.'));
  assert.ok(PROPOSAL.includes("setPostCreate(refreshed ? 'done' : 'failed')"));
});

check('3/4/5. Refresh relit le multisig puis remplace la liste (on-chain)', () => {
  assert.ok(DETAILS_ACTIONS.includes('loadMultisig(connection, key)'), 'transactionIndex relu');
  assert.ok(DETAILS_ACTIONS.includes('setRefreshNonce((previous) => previous + 1)'));
  assert.ok(LIST.includes('onRefresh={reloadFromChain}') || DETAILS.includes('onRefresh={reloadFromChain}'));
  // Le nonce ne passe plus par les props de la liste : le hook `useProposals`
  // vit desormais dans le PARENT, seul proprietaire de la lecture (pour qu'un
  // onglet puisse reutiliser la meme liste sans seconde lecture). L'intention est
  // inchangee : c'est bien le nonce du parent qui force la relecture.
  assert.ok(
    DETAILS.includes('useProposals(') && DETAILS.includes('refreshNonce,'),
    'le nonce alimente la lecture des propositions faite par le parent',
  );
  // La liste est REMPLACÉE par les données on-chain actuelles.
  assert.ok(PROPOSALS.includes('setList(fresh);'));
  assert.ok(PROPOSALS.includes('loadProposals(connection, multisigPda, transactionIndex, staleTransactionIndex)'));
  // Le nouvel index est bien inclus dans la plage relue.
  assert.deepEqual(computeProposalIndexes(5, 0), [1, 2, 3, 4, 5]);
});

check('6. Refresh RPC échoué : liste marquée stale, jamais supprimée', () => {
  assert.ok(PROPOSALS.includes('setStale(true);'));
  assert.ok(PROPOSALS.includes('setStale(false);'));
  assert.ok(LIST.includes('proposals.stale && proposals.list !== null'));
  assert.ok(LIST.includes('Showing the last successfully read list.'));
  // La liste précédente n'est pas effacée dans le chemin d'erreur.
  const catchBlock = PROPOSALS.slice(
    PROPOSALS.indexOf('} catch (caught: unknown) {'),
    PROPOSALS.indexOf('}, [multisigAddress'),
  );
  assert.ok(!catchBlock.includes('setList(null)'));
});

check('7. Refresh : loading toujours relâché', () => {
  assert.ok(PROPOSALS.includes("setStatus('loaded');"));
  assert.ok(PROPOSALS.includes("setStatus('error');"));
  assert.ok(LIST.includes("const busy = refreshing || proposals.status === 'loading';"));
});

check('8/9. Refresh : aucun wallet, aucun envoi', () => {
  for (const slice of [DETAILS_ACTIONS, PROPOSAL_ACTION]) {
    for (const forbidden of [
      'signAndSendTransactions',
      'signTransaction',
      'sendRawTransaction',
      'authorizeSession',
      'connect(',
      'useMobileWallet',
    ]) {
      assert.ok(!slice.includes(forbidden), `action interdite dans Refresh: ${forbidden}`);
    }
  }
});

check('10. aucun second envoi après proposition confirmée', () => {
  assert.ok(PROPOSAL.includes('if (signature === null) sendAttemptedRef.current = false;'));
  const verifiedBranch = PROPOSAL.slice(
    PROPOSAL.indexOf('if (result.verified) {'),
    PROPOSAL.indexOf('} catch (caught: unknown) {'),
  );
  assert.ok(!verifiedBranch.includes('signAndSendProposalCreation'), 'aucun renvoi');
});

// ---- E/F : bloc Simulation ---------------------------------------------
check('11. bloc principal : montant en SOL', () => {
  assert.ok(SIM_MAIN.includes('Proposal amount:'));
  assert.ok(SIM_MAIN.includes('formatSolAmount(build.request?.lamports ?? 0)'));
});

check('12. bloc principal : coût en SOL', () => {
  assert.ok(SIM_MAIN.includes('Estimated creation cost:'));
  assert.ok(SIM_MAIN.includes('formatSolAmount(Math.abs(simulation.estimatedCreatorBalanceDelta))'));
  assert.ok(SIM_MAIN.includes('The transfer will occur only after the proposal is approved and executed.'));
});

check('13/14/15. bloc principal : aucun index, PDA ni compute unit', () => {
  assert.ok(!SIM_MAIN.includes('Next index'), 'aucun Next index');
  assert.ok(!PROPOSAL.includes('Next index'));
  assert.ok(!SIM_MAIN.includes('PDA'), 'aucune PDA dans le bloc principal');
  assert.ok(!SIM_MAIN.includes('Compute units'), 'aucun compute unit dans le bloc principal');
});

check('16. Advanced diagnostics fermé par défaut', () => {
  assert.ok(PROPOSAL.includes('const [advancedOpen, setAdvancedOpen] = useState(false);'));
  assert.ok(PROPOSAL.includes("advancedOpen ? 'Hide advanced diagnostics' : 'Advanced diagnostics'"));
});

check('17. Advanced diagnostics contient les informations techniques + explications', () => {
  assert.ok(PROPOSAL.includes('Transaction index'));
  assert.ok(PROPOSAL.includes('Internal sequence number used by the multisig.'));
  assert.ok(PROPOSAL.includes('Transaction PDA'));
  assert.ok(PROPOSAL.includes('Proposal PDA'));
  assert.ok(PROPOSAL.includes('Program-derived account addresses used internally by Squads.'));
  assert.ok(PROPOSAL.includes('Compute units'));
  assert.ok(PROPOSAL.includes('Compute units measure the processing resources used by the simulated'));
  assert.ok(PROPOSAL.includes('simulation.logs'));
  // Aucun CTA dans la section : elle ne contient que du texte.
  const diagnostics = PROPOSAL.slice(PROPOSAL.indexOf('{advancedOpen ? ('));
  assert.ok(!/onPress=\{\s*\(\)\s*=>\s*runCreate/.test(diagnostics), 'aucun CTA de creation');
});

// ---- G : champ Amount ---------------------------------------------------
check('18. aucun lamport visible dans New Proposal', () => {
  assert.ok(!PROPOSAL.includes('Amount (lamports)'));
  assert.ok(!PROPOSAL.includes('} lamports'));
  assert.ok(!PROPOSAL.includes('lamports):'));
  assert.ok(!PROPOSAL.includes('lamports`'));
  assert.ok(PROPOSAL.includes('Estimated creation cost:'), 'montant monétaire en SOL');
});

check('19. Amount reste vide initialement', () => {
  assert.ok(PROPOSAL.includes("const [solText, setSolText] = useState('');"));
  assert.ok(!PROPOSAL.includes("useState('0"));
});

check('20. placeholder du montant = "e.g. 0.02" (jamais une valeur)', () => {
  assert.ok(PROPOSAL.includes('placeholder="e.g. 0.02"'));
  assert.ok(!PROPOSAL.includes('placeholder="0.02"'), 'ce n est pas une valeur preremplie');
  assert.ok(PROPOSAL.includes("const [solText, setSolText] = useState('');"));
});

check('21. aucun montant par défaut envoyé (placeholder jamais transactional)', () => {
  // Saisie vide => lamports NaN => le builder refuse, rien n'est envoyé.
  const result = buildProposalCreation({
    creator: 'GZUrVZnw4QoHf3SvXrYvWfFzVbXXHxoA9UKSajWBfUuM',
    destination: '9hvAFWYxp2mbZeF7JmvnWZqrhxNrT8tCA2PMvcshHeuR',
    lamports: Number.NaN,
    memo: null,
    multisigPda: 'DxaHm47inZWeBQmd63hSmEw43kvP9xebNo1H6wVznFXi',
    transactionIndex: 0,
  });
  assert.equal(result.readyForBuild, false);
  assert.ok(result.errors.some((error) => /InvalidLamports/.test(error)));
});

// ---- 22 : garde-fous intacts -------------------------------------------
check('22. aucun guard ni instruction Squads modifié', () => {
  assert.ok(ALLOWLIST.includes('ALLOWED_PROGRAM_IDS'));
  assert.ok(ALLOWLIST.includes('SYSTEM_PROGRAM_ID'));
  assert.ok(GATE.includes('multisig.instructions.proposalApprove'));
  const SEND = readFileSync('src/squads/signAndSendProposalCreation.ts', 'utf8');
  assert.ok(SEND.includes('confirmSignature'));
  assert.ok(SEND.includes('Proposal.fromAccountInfo'));
});

setTimeout(() => {
  console.log(`\n${passed} test(s) OK`);
  if (process.exitCode === 1) process.exit(1);
}, 50);
