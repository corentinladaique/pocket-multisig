import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import {
  describeAttemptOutcome,
  evaluateSignatureEvidence,
} from '../src/wallet/operationState';
import {
  deriveVaultVisibleState,
  VAULT_VISIBLE_LABELS,
} from '../src/wallet/vaultCreationState';
import {
  LOW_SECURITY_THRESHOLD_LABEL,
  lowSecurityThresholdWarning,
  recommendationFor,
  recommendedThresholdFor,
} from '../src/vault/thresholdRecommendation';
import { EMPTY_ANSWERS, isAnswersComplete } from '../src/onboarding/answers';

/**
 * UI V2 « Seeker style » — Groupe 4 : Create Vault (+ succes / mismatch).
 *
 * Migration VISUELLE uniquement : le wizard, les handlers, la machine d'etat,
 * le builder, le preflight, la simulation, la signature, la confirmation et le
 * read-back renforce sont INCHANGES. Assertions par lecture des sources + tests
 * purs des modules partages. Aucun RPC, aucun wallet, aucune transaction.
 *
 * Execution : npx tsx scripts/ui-v2-group4.test.ts
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

const CREATE = readFileSync('src/screens/CreateVaultScreen.tsx', 'utf8');
const THEME = readFileSync('src/ui/theme.ts', 'utf8');
const PRIM = readFileSync('src/ui/v2/primitives.tsx', 'utf8');
const RUNNER = readFileSync('scripts/run-pure-tests.sh', 'utf8');
const PACKAGE = readFileSync('package.json', 'utf8');
const ONBOARDING = readFileSync('src/screens/OnboardingScreen.tsx', 'utf8');
const ANSWERS = readFileSync('src/onboarding/answers.ts', 'utf8');

// Bloc du handler de relecture seule (Check transaction again).
const CHECK = CREATE.slice(
  CREATE.indexOf('const onCheckTransactionAgain = useCallback'),
  CREATE.indexOf('const onCreateOnDevnet = useCallback'),
);
// Bloc du succes terminal.
const SUCCESS = CREATE.slice(
  CREATE.indexOf('{createdAndVerified ? ('),
  CREATE.indexOf('{/* TROUBLESHOOTING'),
);

check('1. Create Vault utilise UI V2', () => {
  assert.ok(CREATE.includes("from '../ui/v2/primitives'"), 'primitives V2 importees');
  assert.ok(CREATE.includes("from '../ui/theme'"), 'theme V2 importe');
  assert.ok(CREATE.includes('<DevnetPill'), 'pastille reseau V2');
  assert.ok(CREATE.includes('<Card'), 'carte V2');
  assert.ok(CREATE.includes('<PillButton'), 'bouton pill V2 (CTA principal)');
  assert.ok(CREATE.includes('<InfoBox'), 'erreurs/avertissements en InfoBox');
  assert.ok(CREATE.includes('colors.background'), 'fond sombre applique');
  assert.ok(!/ui\/v2\/primitives\.tsx/.test(CREATE), 'aucune primitive dupliquee');
});

check('2. wizard inchange : 5 etapes, memes handlers', () => {
  assert.ok(CREATE.includes('const STEP_COUNT = 5;'), 'toujours 5 etapes');
  for (const n of [1, 2, 3, 4, 5]) {
    assert.equal(
      CREATE.split(`{step === ${n} ? (`).length - 1,
      1,
      `etape ${n} rendue une seule fois`,
    );
  }
  for (const handler of [
    'const chooseSetup = useCallback',
    'const addConnectedWallet = useCallback',
    'const addPendingMember = useCallback',
    'const removeMember = useCallback',
    'const startRename = useCallback',
    'const commitRename = useCallback',
    'const onCreateOnDevnet = useCallback',
    'const onCheckTransactionAgain = useCallback',
    'const goBack = useCallback',
    'const goNext = useCallback',
  ]) {
    assert.ok(CREATE.includes(handler), `${handler} doit rester`);
  }
  assert.ok(CREATE.includes('setStep((previous) => Math.min(previous + 1, STEP_COUNT))'));
  assert.ok(CREATE.includes('setStep((previous) => Math.max(previous - 1, 1))'));
  // Un seul CTA de creation et un seul passage Continue.
  assert.equal(CREATE.split('onPress={onCreateOnDevnet}').length - 1, 1);
  assert.equal(CREATE.split('const onCreateOnDevnet =').length - 1, 1);
  assert.equal(CREATE.split('onPress={goNext}').length - 1, 1);
});

check('3. nom obligatoire inchange', () => {
  assert.ok(
    /setupType !== null && vaultName\.trim\(\)\.length > 0/.test(CREATE),
    'la condition Continue exige le nom',
  );
  assert.ok(CREATE.includes('vaultName.trim().length > 0'), 'trim applique');
  assert.ok(CREATE.includes("useState('')"), 'le nom demarre vide');
  assert.ok(CREATE.includes('placeholder="Personal savings vault"'), 'placeholder conserve');
  assert.ok(!/setVaultName\('Personal savings vault'\)/.test(CREATE), 'jamais une valeur par defaut');
  assert.ok(CREATE.includes('Enter a vault name to continue.'), 'message utilisateur conserve');
});

check('4. membres inchanges', () => {
  assert.ok(CREATE.includes('const [members, setMembers] = useState<VaultMemberDraft[]>([])'));
  assert.ok(CREATE.includes('createMember({'), 'creation locale du membre');
  assert.ok(CREATE.includes('publicKey: address'));
  assert.ok(CREATE.includes('isValidSolanaAddress'), 'validation d adresse conservee');
  assert.ok(CREATE.includes('shortenMemberAddress'), 'adresse abregee');
  assert.ok(CREATE.includes('onChangeText={setPendingAddress}'), 'state pending conserve');
  assert.ok(CREATE.includes("registerField('pendingAddress')"), 'logique clavier conservee');
  assert.ok(CREATE.includes('onPress={addPendingMember}'), 'action ajout conservee');
});

check('5. threshold par defaut inchange', () => {
  assert.ok(CREATE.includes('const [threshold, setThreshold] = useState(1)'), 'defaut = 1');
  assert.equal(recommendedThresholdFor(2), 2);
  assert.equal(recommendedThresholdFor(3), 2);
  assert.ok(CREATE.includes('const recommended = recommendedThresholdFor(members.length)'));
  assert.ok(CREATE.includes('setThreshold(recommended)'), 'defaut recommande applique');
  assert.ok(CREATE.includes('thresholdTouched'), 'choix explicite respecte');
  assert.ok(!CREATE.includes('setThreshold(members.length)'), 'jamais 3 of 3 force');
  assert.ok(!CREATE.includes('setThreshold(2)'), 'aucun 2 fige dans l ecran');
});

check('6. warning 1-of-2 conserve (Low security configuration)', () => {
  assert.equal(lowSecurityThresholdWarning(2, 1), 'Low security configuration');
  assert.equal(LOW_SECURITY_THRESHOLD_LABEL, 'Low security configuration');
  assert.ok(CREATE.includes('lowSecurityThresholdWarning(members.length, threshold)'));
  assert.ok(CREATE.includes('setThresholdTouched(true)'), 'choix explicite jamais ecrase');
  assert.ok(CREATE.includes('To continue with this setting, confirm explicitly'));
  assert.equal(recommendationFor(2)?.label, 'Recommended: 2 of 2');
  assert.equal(recommendationFor(3)?.label, 'Recommended: 2 of 3');
  assert.ok(CREATE.includes('recommendationFor(members.length)'));
});

check('7. permissions inchangees', () => {
  assert.ok(CREATE.includes('Planned permissions'));
  assert.ok(CREATE.includes('Permissions will be configured during creation.'));
  // Aucun editeur de role ajoute dans le wizard : les permissions restent
  // lues du plan partage, jamais editees ici.
  assert.ok(!/Initiate['"]|\bVote\b|\bExecute['"]/.test(CREATE), 'aucun role code en dur');
  assert.ok(CREATE.includes('creationExpectation'), 'permissions lues depuis le plan');
});

check('8. couts reels en SOL', () => {
  assert.ok(CREATE.includes('lamportsToSolDisplay'), 'conversion par la fonction partagee');
  assert.ok(CREATE.includes('creationCost.totalLamports'), 'total issu de la simulation reelle');
  assert.ok(CREATE.includes('decomposeCreationCost'), 'decomposition rent/frais partagee');
  assert.ok(CREATE.includes('Estimated creation cost'));
  assert.ok(CREATE.includes('DEVNET_SOL_DISCLAIMER'));
  const texts = [...CREATE.matchAll(/<Text\b[^>]*>([\s\S]*?)<\/Text>/g)].map((match) => match[1]);
  const offending = texts.filter((text) => /lamport/i.test(text.replace(/\\{[^}]*\\}/g, '')));
  assert.deepEqual(offending, [], `aucun lamport a l ecran : ${offending.join(' | ')}`);
});

check('9. read-back commun inchange', () => {
  assert.ok(CREATE.includes('validateMultisigCreationReadBack'), 'validation commune');
  assert.ok(CREATE.includes('decodeMultisigCreationReadBack'), 'decodage commun');
  assert.ok(CREATE.includes('creationExpectation'), 'valeurs attendues preparees avant signature');
  assert.ok(CREATE.includes('expectedMultisigPda'), 'adresse attendue conservee');
  assert.ok(CREATE.includes('ReadBackDecodeFailed'));
  assert.ok(!CREATE.includes('sameMemberCount'), 'jamais une validation reduite');
  assert.ok(CHECK.includes('validateMultisigCreationReadBack'), 'recheck : meme fonction');
});

check('10. Check transaction again reste sans wallet', () => {
  assert.ok(CHECK.includes('confirmSignature'), 'lecture du statut');
  assert.ok(CHECK.includes('getAccountInfo'), 'read-back');
  assert.ok(
    !/signAndSendTransactions|sendRawTransaction|partialSign|prepareCreation|\bauthorize\b|useMobileWallet/.test(
      CHECK,
    ),
    'aucun envoi ni wallet dans la relecture',
  );
  assert.ok(!/Keypair\.generate|buildMultisigCreationTransaction/.test(CHECK), 'aucune nouvelle cle');
  assert.ok(CHECK.includes('if (checking) return;'), 'une seule relecture a la fois');
});

check('11. mismatch n autorise aucun renvoi', () => {
  assert.equal(
    deriveVaultVisibleState({
      confirmed: true,
      creating: false,
      hasAttempt: true,
      networkFailure: false,
      signatureObtained: true,
      verificationMismatch: true,
      verified: false,
    }),
    'confirmed-verification-mismatch',
  );
  assert.equal(describeAttemptOutcome({ signature: 'sig', verified: false }).allowNewAttempt, false);
  assert.equal(
    evaluateSignatureEvidence({ blockHeight: null, lastValidBlockHeight: 100, status: 'pending' })
      .retryAllowed,
    false,
  );
  assert.ok(CREATE.includes('Nothing needs to be sent again.'));
  assert.ok(CREATE.includes('Verification mismatch'));
  assert.ok(!CHECK.includes('sendAttemptedRef.current = false'), 'le verrou n est jamais rearme');
});

check('12. succes terminal inchange', () => {
  assert.equal(VAULT_VISIBLE_LABELS.verified, 'Vault created and verified.');
  assert.ok(CREATE.includes('Vault created and verified.'));
  assert.ok(CREATE.includes("setCheckReport('Vault created and verified.')"));
  assert.ok(SUCCESS.includes('Multisig configuration address'), 'adresse de configuration');
  assert.ok(SUCCESS.includes('Main vault address'), 'adresse du vault principal');
  assert.ok(SUCCESS.includes('mainVaultAddress'), 'vault principal derive apres verification');
  assert.ok(SUCCESS.includes('Open vault'));
  assert.ok(SUCCESS.includes('Go to Inbox'));
  assert.ok(SUCCESS.includes('onGoToInbox'));
  assert.ok(!SUCCESS.includes('onPress={onCreateOnDevnet}'), 'aucune action Create residuelle');
});

check('13. reponses explicites d onboarding conservees', () => {
  assert.equal(EMPTY_ANSWERS.level, null, 'aucun niveau par defaut');
  assert.equal(EMPTY_ANSWERS.goal, null);
  assert.deepEqual(EMPTY_ANSWERS.signingMeans, []);
  assert.equal(isAnswersComplete(EMPTY_ANSWERS), false);
  assert.ok(ANSWERS.includes('EMPTY_ANSWERS'), 'la source garde EMPTY_ANSWERS');
  assert.ok(ONBOARDING.includes('isAnswersComplete(answers)'), 'blocage tant que non repondu');
  assert.ok(ONBOARDING.includes('const canAdvance = step === 0 ? complete : true;'));
  assert.ok(!ONBOARDING.includes("'new-to-multisig'"), 'aucun niveau code en dur');
  assert.ok(!ONBOARDING.includes('LEVEL_OPTIONS[0]'), 'jamais la premiere option forcee');
});

check('14. aucun package ajoute', () => {
  assert.ok(!PACKAGE.includes('qrcode'));
  assert.ok(!/react-native-svg|vector-icons/.test(PACKAGE));
  assert.ok(!/from '@expo\/vector-icons'/.test(CREATE), 'aucun package d icones');
  assert.ok(!/from 'react-native-svg'/.test(CREATE));
});

check('15. aucun invariant metier modifie', () => {
  // 1) Preflight, simulation, signature et builder inchanges dans l ecran.
  for (const token of [
    'multisigCreationPreflight',
    'simulateMultisigCreation',
    'prepareCreation',
    'signAndSendMultisigCreation',
    'readyForInstructionBuild',
  ]) {
    assert.ok(CREATE.includes(token), `${token} doit rester`);
  }
  // 2) Aucun RPC/transaction nouveau dans l ecran.
  assert.ok(!CREATE.includes('getProgramAccounts'), 'aucun scan de programme');
  assert.ok(!/multisigCreateV2|new Multisig\(|SystemProgram/.test(CREATE), 'aucune instruction Squads');
  assert.ok(!/fetch\(|https?:\/\//.test(CREATE), 'aucun appel reseau ajoute');
  // 3) Un seul envoi possible : le verrou anti-seconde-creation reste en place.
  assert.equal(CREATE.split('sendAttemptedRef.current = true').length - 1, 1);
  assert.ok(CREATE.includes('if (signature === null) sendAttemptedRef.current = false;'));
  // 4) Registre local conserve (ecriture apres verification uniquement).
  assert.ok(CREATE.includes('registry.add('));
  // 5) Fichiers proteges strictement identiques au dernier commit.
  const protectedFiles = [
    'src/ui/theme.ts',
    'src/ui/v2/primitives.tsx',
    'App.tsx',
    'src/vault/thresholdRecommendation.ts',
    'src/screens/ReceiveScreen.tsx',
    'src/ui/clipboard.ts',
  ];
  const changed = execSync(`git diff --name-only HEAD -- ${protectedFiles.join(' ')}`, {
    encoding: 'utf8',
  })
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  assert.deepEqual(changed, [], `fichiers proteges modifies : ${changed.join(', ')}`);
  // 6) src/squads et le theme partage restent intacts sur le fond.
  assert.ok(THEME.includes("background: '#08110F'"), 'tokens du theme intacts');
  assert.ok(PRIM.includes('export function PillButton'));
  assert.ok(
    !execSync('git diff --name-only HEAD -- src/squads', { encoding: 'utf8' })
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0).length,
    'src/squads inchange',
  );
});

check('la suite Groupe 4 est enregistree dans npm test', () => {
  assert.ok(RUNNER.includes('scripts/ui-v2-group4.test.ts'), 'suite Groupe 4 dans le runner');
});

setTimeout(() => {
  console.log(`\n${passed} test(s) OK`);
  if (process.exitCode === 1) process.exit(1);
}, 50);
