import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  buildProfile,
  EMPTY_ANSWERS,
  GOAL_OPTIONS,
  isAnswersComplete,
  LEVEL_OPTIONS,
  selectGoal,
  selectLevel,
  SIGNING_MEAN_OPTIONS,
  toggleSigningMean,
  type OnboardingAnswers,
} from '../src/onboarding/answers';

/**
 * Hotfix fonctionnel Learn : chaque réponse enregistre SA propre valeur.
 *
 * Tests comportementaux sur la logique PURE (aucun renderer) + assertions de
 * source pour le cablage UI (identite, handler, etat selected).
 * Execution : npx tsx scripts/onboarding-answers.test.ts
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

const SCREEN = readFileSync('src/screens/OnboardingScreen.tsx', 'utf8');
const ANSWERS = readFileSync('src/onboarding/answers.ts', 'utf8');
const PACKAGE = readFileSync('package.json', 'utf8');

check('1. Reponse 1 → valeur 1', () => {
  const next = selectLevel(EMPTY_ANSWERS, LEVEL_OPTIONS[0]);
  assert.equal(next.level, LEVEL_OPTIONS[0].value);
  assert.equal(next.level, 'new-to-multisig');
});

check('2. Reponse 2 → valeur 2', () => {
  const next = selectLevel(EMPTY_ANSWERS, LEVEL_OPTIONS[1]);
  assert.equal(next.level, LEVEL_OPTIONS[1].value);
  assert.equal(next.level, 'familiar');
});

check('3. Reponse 3 → valeur 3', () => {
  const next = selectLevel(EMPTY_ANSWERS, LEVEL_OPTIONS[2]);
  assert.equal(next.level, LEVEL_OPTIONS[2].value);
  assert.equal(next.level, 'advanced');
});

check('4. Reponse 2 ne produit jamais "New to multisig"', () => {
  const option2 = LEVEL_OPTIONS[1];
  assert.notEqual(option2.value, 'new-to-multisig');
  assert.equal(
    selectLevel(EMPTY_ANSWERS, option2).level,
    option2.value,
    'la reponse 2 enregistre sa propre valeur',
  );
});

check('5. Chaque option possede une identite unique et stable', () => {
  for (const [name, options] of [
    ['LEVEL', LEVEL_OPTIONS],
    ['GOAL', GOAL_OPTIONS],
    ['MEANS', SIGNING_MEAN_OPTIONS],
  ] as const) {
    const ids = options.map((option) => option.id);
    assert.equal(new Set(ids).size, ids.length, `${name}: ids dupliques`);
    for (const option of options) {
      assert.equal(option.id, option.value, `${name}: id doit egaler la valeur (stable)`);
    }
  }
});

check('6. Chaque option possede un handler lie a sa propre valeur', () => {
  for (const option of LEVEL_OPTIONS) {
    assert.equal(selectLevel(EMPTY_ANSWERS, option).level, option.value);
  }
  for (const option of GOAL_OPTIONS) {
    assert.equal(selectGoal(EMPTY_ANSWERS, option).goal, option.value);
  }
  for (const option of SIGNING_MEAN_OPTIONS) {
    assert.deepEqual(toggleSigningMean(EMPTY_ANSWERS, option).signingMeans, [option.value]);
  }
  // Cablage UI : l'option transmet SA valeur, jamais un index ni un libelle.
  assert.ok(SCREEN.includes('setAnswers((previous) => selectLevel(previous, option))'));
  assert.ok(SCREEN.includes('setAnswers((previous) => selectGoal(previous, option))'));
  assert.ok(SCREEN.includes('setAnswers((previous) => toggleSigningMean(previous, option))'));
  assert.ok(!/pickLevel\(|pickGoal\(|toggleMean\(/.test(SCREEN), 'anciens handlers retires');
});

check('7. Une seule option selected par question', () => {
  const answers = selectLevel(EMPTY_ANSWERS, LEVEL_OPTIONS[1]);
  assert.equal(LEVEL_OPTIONS.filter((option) => answers.level === option.value).length, 1);
  const means = toggleSigningMean(toggleSigningMean(EMPTY_ANSWERS, SIGNING_MEAN_OPTIONS[0]), SIGNING_MEAN_OPTIONS[2]);
  assert.equal(answers.goal, null, 'aucune autre question touchee');
  assert.deepEqual(means.signingMeans, [SIGNING_MEAN_OPTIONS[0].value, SIGNING_MEAN_OPTIONS[2].value]);
});

check('8. accessibilityState.selected correspond a la vraie valeur', () => {
  assert.ok(SCREEN.includes('const selected = answers.level === option.value;'));
  assert.ok(SCREEN.includes('const selected = answers.goal === option.value;'));
  assert.ok(SCREEN.includes('const selected = answers.signingMeans.includes(option.value);'));
  assert.ok(SCREEN.includes('accessibilityState={{ selected }}'));
  // Aucun label d'accessibilite partage entre plusieurs options.
  assert.ok(SCREEN.includes('accessibilityLabel={option.label}'));
});

check('9. Changer de reponse remplace l ancienne selection', () => {
  const first = selectLevel(EMPTY_ANSWERS, LEVEL_OPTIONS[0]);
  const second = selectLevel(first, LEVEL_OPTIONS[1]);
  assert.equal(second.level, LEVEL_OPTIONS[1].value);
  assert.equal(LEVEL_OPTIONS.filter((option) => second.level === option.value).length, 1);
  assert.notEqual(second.level, LEVEL_OPTIONS[0].value);
});

check('10. Une question ne modifie pas la reponse d une autre', () => {
  const base: OnboardingAnswers = selectLevel(EMPTY_ANSWERS, LEVEL_OPTIONS[2]);
  const withGoal = selectGoal(base, GOAL_OPTIONS[3]);
  assert.equal(withGoal.level, base.level, 'le niveau ne bouge pas');
  assert.deepEqual(withGoal.signingMeans, base.signingMeans);
  const withMean = toggleSigningMean(withGoal, SIGNING_MEAN_OPTIONS[1]);
  assert.equal(withMean.level, withGoal.level);
  assert.equal(withMean.goal, withGoal.goal);
});

check('11. Continue utilise les reponses choisies', () => {
  const answers: OnboardingAnswers = toggleSigningMean(
    selectGoal(selectLevel(EMPTY_ANSWERS, LEVEL_OPTIONS[1]), GOAL_OPTIONS[2]),
    SIGNING_MEAN_OPTIONS[0],
  );
  const profile = buildProfile(answers, true);
  assert.equal(profile.level, LEVEL_OPTIONS[1].value);
  assert.equal(profile.goal, GOAL_OPTIONS[2].value);
  assert.deepEqual(profile.signingMeans, [SIGNING_MEAN_OPTIONS[0].value]);
  assert.equal(profile.onboardingCompleted, true);
  assert.ok(SCREEN.includes('onFinish(publishProfile())'));
});

check('12. Retour sur l ecran restaure les reponses exactes', () => {
  // Les reponses vivent dans un state unique non reinitialise par Back.
  assert.ok(SCREEN.includes('useState<OnboardingAnswers>'));
  assert.ok(SCREEN.includes('setStep((previous) => Math.max(previous - 1, 0))'));
  assert.ok(!/onBack[\s\S]{0,120}EMPTY_ANSWERS/.test(SCREEN), 'Back ne vide pas les reponses');
  assert.ok(!SCREEN.includes('setProfile('), 'aucun reset de profil pendant le parcours');
});

check('13. Aucun fallback silencieux sur la premiere option', () => {
  assert.equal(EMPTY_ANSWERS.level, null, 'aucun niveau par defaut');
  assert.equal(EMPTY_ANSWERS.goal, null);
  assert.deepEqual(EMPTY_ANSWERS.signingMeans, []);
  assert.equal(isAnswersComplete(EMPTY_ANSWERS), false);
  assert.ok(SCREEN.includes('const canAdvance = step === 0 ? complete : true;'));
  assert.ok(SCREEN.includes('isAnswersComplete(answers)'));
  assert.ok(!SCREEN.includes("'new-to-multisig'"), 'aucun niveau code en dur dans l ecran');
  assert.ok(!SCREEN.includes('LEVEL_OPTIONS[0]'), 'jamais la premiere option forcee');
  assert.ok(!SCREEN.includes('touched'), 'flag global supprime (cause du bug)');
});

check('14/15/16. Aucun wallet, RPC, transaction', () => {
  for (const [name, source] of [
    ['OnboardingScreen', SCREEN],
    ['answers', ANSWERS],
  ] as const) {
    assert.ok(!/useMobileWallet|signAndSendTransactions|signTransaction|sendRawTransaction/.test(source), name);
    assert.ok(!/authorizeSession|connection\.|getBalance|getAccountInfo|fetch\(|https?:/.test(source), name);
  }
});

check('17. Aucun package ajoute', () => {
  assert.ok(!PACKAGE.includes('qrcode'));
  assert.ok(!/react-native-svg|vector-icons/.test(PACKAGE));
});

check('coche visible : etat selectionne non dependant de la couleur seule', () => {
  assert.ok(SCREEN.includes('styles.optionCheck'));
  assert.ok(SCREEN.includes(">✓<") || SCREEN.includes("'✓'") || SCREEN.includes('✓'));
  assert.ok(SCREEN.includes('styles.optionSelected'));
});

setTimeout(() => {
  console.log(`\n${passed} test(s) OK`);
  if (process.exitCode === 1) process.exit(1);
}, 50);
