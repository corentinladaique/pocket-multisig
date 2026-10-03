import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  PROPOSAL_ACTION_LABELS,
  approvalProgress,
  deriveProposalActionState,
  deriveProposalExecuteState,
} from '../src/squads/proposalActionState';

/**
 * UI V2 Groupe 3 — Proposal Details, état Executed et Advanced transaction
 * details (lecture seule).
 *
 * Assertions par lecture des sources + tests purs des états. Aucun RPC, aucun
 * wallet, aucune signature. Execution :
 *   npx tsx scripts/ui-v2-group3-details.test.ts
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

const DETAILS = readFileSync('src/screens/ProposalDetailsScreen.tsx', 'utf8');
const TECH = readFileSync('src/screens/TransactionTechnicalDetails.tsx', 'utf8');
const REVIEW = readFileSync('src/screens/TransactionReviewScreen.tsx', 'utf8');
const THEME = readFileSync('src/ui/theme.ts', 'utf8');
const PRIM = readFileSync('src/ui/v2/primitives.tsx', 'utf8');

// Tranche du handler « Check approval again » (lecture seule).
const CHECK_AGAIN = DETAILS.slice(
  DETAILS.indexOf('const onCheckApprovalAgain'),
  DETAILS.indexOf('const runApproval'),
);

check('1. Proposal Details utilise UI V2 (theme + primitives)', () => {
  assert.ok(DETAILS.includes("from '../ui/v2/primitives'"), 'primitives V2 manquantes');
  assert.ok(DETAILS.includes("from '../ui/theme'"), 'theme V2 manquant');
  assert.ok(DETAILS.includes('DevnetPill'), 'en-tête DevnetPill manquant');
  assert.ok(DETAILS.includes('Card'), 'carte V2 manquante');
  assert.ok(!DETAILS.includes("backgroundColor: '#ffffff'"), 'fond clair legacy encore présent');
  assert.ok(THEME.includes("background: '#08110F'"), 'theme sombre attendu');
  assert.ok(PRIM.includes('export function DevnetPill'), 'primitive DevnetPill absente');
});

check('2. montant réel uniquement (aucun montant codé en dur)', () => {
  // Le montant provient TOUJOURS du modèle décodé, jamais d'une constante.
  assert.ok(DETAILS.includes('Number(model.amount.value.lamports)'), 'montant non dérivé du modèle');
  assert.ok(DETAILS.includes('formatSol(amountLamports)'), 'formatage du montant réel attendu');
  assert.ok(
    DETAILS.includes("amountLamports === null ? 'Amount unavailable'"),
    'absence de montant non gérée',
  );
  assert.ok(!/\d[\d_]*\s*SOL['`]/.test(DETAILS), 'montant SOL codé en dur détecté');
});

check('3. progression on-chain uniquement (aucun compteur local)', () => {
  assert.ok(
    DETAILS.includes('approvedCount: effectiveApprovedAddresses.length'),
    'progression non dérivée des approbations',
  );
  assert.ok(
    DETAILS.includes('onchainApproval?.approvedAddresses ?? proposal.approvedAddresses'),
    'relecture on-chain manquante',
  );
  assert.equal(approvalProgress({ approvedCount: 1, threshold: 2 }).collectedLabel, '1 of 2 approvals collected');
});

check('4. « Approved by you » inchangé fonctionnellement', () => {
  assert.equal(PROPOSAL_ACTION_LABELS.approvedByYou, '✓ Approved by you');
  assert.ok(DETAILS.includes('PROPOSAL_ACTION_LABELS.approvedByYou'), 'libellé non rendu');
  assert.ok(DETAILS.includes('accessibilityLabel="Approved by you"'), 'statut accessible manquant');
  assert.ok(DETAILS.includes('accessibilityRole="text"'), 'statut non cliquable attendu');
});

check('5. Approve conserve ses guards', () => {
  assert.ok(DETAILS.includes('const onApprove = () => {'), 'handler Approve manquant');
  assert.ok(
    DETAILS.includes('if (!canConfirm || approving || approvalAttemptedRef.current) return;'),
    'anti-double-tap Approve manquant',
  );
  assert.ok(DETAILS.includes('if (walletAlreadyApproved) {'), 'garde « déjà approuvé » manquante');
  assert.ok(DETAILS.includes('await signAndSendProposalApproval({'), 'module d’approbation non utilisé');
  // Le CTA n'apparaît que pour la famille « approbation disponible ».
  assert.ok(DETAILS.includes("actionState === 'approval-available' || approvalRetry"), 'CTA Approve non conditionné');
  assert.ok(DETAILS.includes('disabled={!canConfirm || approving}'), 'CTA Approve non désactivé pendant l’envoi');
});

check('6. Execute conserve ses guards', () => {
  assert.ok(DETAILS.includes('const onExecute = () => {'), 'handler Execute manquant');
  assert.ok(
    DETAILS.includes('if (!canExecute || insufficientBalance || executing'),
    'garde Execute manquante',
  );
  assert.ok(DETAILS.includes('executionAttemptedRef'), 'anti-double-tap Execute manquant');
  assert.ok(DETAILS.includes('await signAndSendProposalExecution({'), 'module d’exécution non utilisé');
  assert.ok(DETAILS.includes("member.roles.includes('Execute')"), 'permission Execute non vérifiée');
});

check('7. Check approval again reste lecture seule', () => {
  assert.ok(CHECK_AGAIN.includes('confirmSignature'), 'relecture du statut de signature manquante');
  assert.ok(CHECK_AGAIN.includes('refreshProposalFromChain'), 'relecture de la Proposal manquante');
  for (const forbidden of [
    'signAndSendTransactions',
    'useMobileWallet',
    'authorize',
    'sendRawTransaction',
    'signTransaction',
    'connect(',
  ]) {
    assert.ok(!CHECK_AGAIN.includes(forbidden), `action interdite dans Check approval again: ${forbidden}`);
  }
});

check('8. Executed supprime Approve', () => {
  assert.equal(
    deriveProposalActionState({
      executed: true,
      signaturePendingVerification: false,
      thresholdReached: true,
      walletAlreadyApproved: true,
    }),
    'executed',
  );
  // Le CTA Approve est conditionné à la seule famille « approval-available ».
  assert.ok(!DETAILS.includes("actionState === 'executed' || approvalRetry"), 'exécuté ne doit pas ouvrir Approve');
  assert.ok(DETAILS.includes('approveCtaVisible && canConfirm'), 'CTA Approve non gardé par le statut réel');
});

check('9. Executed supprime Execute', () => {
  assert.equal(
    deriveProposalExecuteState({ executed: true, thresholdReached: true, walletHasExecute: true }),
    'executed',
  );
  // Le gros bouton Execute n'existe que pour l'état « available ».
  assert.ok(DETAILS.includes("executeState === 'available' ? ("), 'CTA Execute non conditionné');
  assert.ok(DETAILS.includes("executeState === 'unavailable-threshold' ? ("), 'état seuil manquant');
  assert.ok(DETAILS.includes("executeState === 'no-permission' ? ("), 'état sans permission manquant');
});

check('10. signature réelle uniquement', () => {
  assert.ok(DETAILS.includes('executionResult?.signature != null'), 'signature d’exécution non conditionnée');
  assert.ok(DETAILS.includes('abbreviateAddress(executionResult.signature)'), 'signature abrégée manquante');
  assert.ok(DETAILS.includes('abbreviateAddress(approvalResult.signature)'), 'signature d’approbation abrégée manquante');
  // La signature complète reste copiable (texte sélectionnable).
  assert.ok(DETAILS.includes('selectable'), 'signature non sélectionnable');
  assert.ok(!/Signature: '[1-9A-HJ-NP-Za-km-z]{20,}'/.test(DETAILS), 'signature codée en dur détectée');
});

check('11. date absente si indisponible', () => {
  // Aucune date n'est disponible dans le modèle : aucune ne doit être inventée.
  assert.ok(!DETAILS.includes('new Date('), 'date inventée dans Proposal Details');
  assert.ok(!DETAILS.includes('toLocaleString'), 'formatage de date non souhaité');
  assert.ok(!DETAILS.includes('blockTime'), 'blockTime non disponible ne doit pas être lu');
  assert.ok(!TECH.includes('new Date('), 'date inventée dans les détails techniques');
});

check('12. Advanced details reste lecture seule', () => {
  assert.ok(TECH.includes('export function TransactionTechnicalDetails'), 'composant manquant');
  for (const forbidden of [
    'signAndSendTransactions',
    'signTransaction',
    'sendRawTransaction',
    'authorize',
    'useMobileWallet',
    'TransactionInstruction',
    'VersionedTransaction',
    'TransactionMessage',
  ]) {
    assert.ok(!TECH.includes(forbidden), `action interdite dans Advanced details: ${forbidden}`);
  }
  assert.ok(!TECH.includes('onPress={onApprove}'), 'aucun CTA Approve attendu');
  assert.ok(!TECH.includes('onPress={onExecute}'), 'aucun CTA Execute attendu');
});

check('13. aucun second chemin d’approbation', () => {
  // Un seul écran importe le module métier d'approbation.
  const importCount = [DETAILS, TECH, REVIEW].filter((source) =>
    source.includes("from '../squads/signAndSendProposalApproval'"),
  ).length;
  assert.equal(importCount, 1, 'un seul chemin d’approbation attendu');
  assert.ok(DETAILS.includes("from '../squads/signAndSendProposalApproval'"));
  assert.ok(!TECH.includes("from '../squads/signAndSendProposalApproval'"));
  assert.ok(!REVIEW.includes("from '../squads/signAndSendProposalApproval'"));
});

check('14. aucun wallet dans les détails avancés', () => {
  for (const forbidden of [
    'useMobileWallet',
    '@wallet-ui',
    'signAndSendTransactions',
    'signTransaction',
    'connect(',
    'authorize',
  ]) {
    assert.ok(!TECH.includes(forbidden), `wallet interdit dans Advanced details: ${forbidden}`);
  }
});

check('15. aucun test de sécurité affaibli', () => {
  assert.ok(DETAILS.includes('useWalletGuard(effectiveGuardContext ?? null)'), 'wallet guard retiré');
  assert.ok(DETAILS.includes('checkReviewAllowlist'), 'allowlist retirée');
  assert.ok(DETAILS.includes('approvalAttemptedRef'), 'anti-double-approbation retiré');
  assert.ok(DETAILS.includes('executionAttemptedRef'), 'anti-double-exécution retiré');
  const guard = readFileSync('src/wallet/useWalletGuard.ts', 'utf8');
  assert.ok(guard.includes("member.roles.includes('Vote')"), 'permission Vote retirée');
  assert.ok(guard.includes("network.chain !== DEVNET_CHAIN"), 'garde réseau retirée');
  const allowlist = readFileSync('src/squads/instructionAllowlist.ts', 'utf8');
  assert.ok(allowlist.includes('ALLOWED_PROGRAM_IDS'), 'allowlist program ids retirée');
});

check('16. Advanced transaction details replié par défaut', () => {
  assert.ok(DETAILS.includes('const [advancedOpen, setAdvancedOpen] = useState(false)'), 'section non repliée par défaut');
  assert.ok(DETAILS.includes("'▸ Advanced transaction details'"), 'libellé replié manquant');
  assert.ok(DETAILS.includes('setReviewOpen(true)'), 'ouverture de la vue lecture seule manquante');
  assert.ok(TECH.includes('const [rawOpen, setRawOpen] = useState(false)'), 'Raw transaction data non replié');
});

check('17. progression : une seule formulation d attente, sans duplication', () => {
  // P1-C : la carte principale ne repete plus l attente trois fois.
  assert.ok(
    !DETAILS.includes('{progress.waitingLabel}'),
    'plus de ligne d attente dupliquee',
  );
  assert.ok(!DETAILS.includes('decision.stateLabel'), 'plus de duplication stateLabel');
  // L information utile reste : progression + seuil + attente d execution.
  assert.ok(DETAILS.includes('{progress.collectedLabel}'), 'progression conservee');
  assert.ok(
    DETAILS.includes('Execution becomes available after one more approval.'),
    'attente d execution conservee',
  );
  assert.ok(
    DETAILS.includes('executionNotAvailableDetail(progress.remaining)'),
    'raison multi-approbations conservee',
  );
  // Le statut « Approved by you » reste affiche une seule fois.
  assert.equal((DETAILS.match(/PROPOSAL_ACTION_LABELS\.approvedByYouDetail/g) ?? []).length, 1);
});

setTimeout(() => {
  console.log(`\n${passed} test(s) OK`);
  if (process.exitCode === 1) process.exit(1);
}, 50);
