import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { CONTEXTUAL_HELP, CRITICAL_PROTECTIONS, ONBOARDING_SCREENS, screensForLevel } from '../src/onboarding/content';
import {
  contentMode,
  DEFAULT_PROFILE,
  FORBIDDEN_PROFILE_KEYS,
  GOAL_LABELS,
  isQuestComplete,
  LEVEL_LABELS,
  personalizedSummary,
  sanitizeProfile,
  SIGNING_MEAN_COMPATIBILITY,
  SIGNING_MEAN_LABELS,
  signingMeanIsDistinct,
  skippedProfile,
  totalSteps,
} from '../src/onboarding/profile';

/** Onboarding v2 : aucun wallet, aucun reseau. npx tsx scripts/onboarding.test.ts */

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

const SCREEN = readFileSync('src/screens/OnboardingScreen.tsx', 'utf8');
const HOOK = readFileSync('src/onboarding/useOnboarding.ts', 'utf8');
const PROFILE = readFileSync('src/onboarding/profile.ts', 'utf8');
const CONTENT = readFileSync('src/onboarding/content.ts', 'utf8');
const HOME = readFileSync('src/screens/ConnectScreen.tsx', 'utf8');

const allText = ONBOARDING_SCREENS.flatMap((lesson) => [
  lesson.title,
  ...lesson.body,
  ...lesson.bullets,
  lesson.emphasis ?? '',
]).join('\n');

check('1. Learn visible sans wallet, avant Load multisig', () => {
  assert.ok(HOME.includes('Learn about multisig'), 'bouton present');
  assert.ok(HOME.includes('styles.helpBox'), 'zone Learn dediee');
  const learn = HOME.indexOf('Learn about multisig');
  assert.ok(learn < HOME.indexOf('Load multisig'), 'Learn doit preceder Load multisig');
  assert.ok(learn > HOME.indexOf('Connect wallet'), 'zone visible au niveau du prompt Connect');
});

check('2. Learn reste disponible apres chargement (zone permanente)', () => {
  assert.ok(HOME.split('Learn about multisig').length - 1 >= 1);
  assert.ok(!/msig\.status === 'loaded'[\s\S]{0,200}Learn about multisig/.test(HOME.split('learnZone')[0] ?? '') === true);
});

check('3/4. Next desactive sans reponse, multi-selection vide bloquee', () => {
  assert.equal(isQuestComplete(DEFAULT_PROFILE), false, 'aucune reponse par defaut');
  assert.ok(SCREEN.includes('disabled={!canAdvance}'));
  assert.ok(SCREEN.includes('Choose an option to continue.'));
  assert.equal(
    isQuestComplete({ goal: 'learn-and-test', level: 'new-to-multisig', onboardingCompleted: false, signingMeans: [] }),
    false,
    'une multi-selection vide doit bloquer',
  );
});

check('5. Back conserve les reponses deja choisies', () => {
  assert.ok(SCREEN.includes('setStep((previous) => Math.max(previous - 1, 0))'));
  assert.ok(!/onBack[\s\S]{0,120}setProfile\(DEFAULT_PROFILE\)/.test(SCREEN), 'Back ne reinitialise rien');
});

check('6. Skip disponible sans reponse et n invente rien', () => {
  assert.ok(SCREEN.includes('Skip'));
  const skipped = skippedProfile(DEFAULT_PROFILE);
  assert.equal(skipped.goal, null);
  assert.deepEqual(skipped.signingMeans, []);
  assert.equal(skipped.onboardingCompleted, true);
});

check('7/8/9. Seed Vault distinct, Ledger via Solflare, autres marques non declarees', () => {
  assert.equal(SIGNING_MEAN_LABELS['seed-vault'], 'Seed Vault Wallet');
  assert.equal(SIGNING_MEAN_LABELS['wallet-app'], 'Wallet app');
  assert.equal(signingMeanIsDistinct('seed-vault'), true);
  assert.equal(signingMeanIsDistinct('wallet-app'), true);
  assert.ok(/Ledger through Solflare/.test(SIGNING_MEAN_COMPATIBILITY['hardware-wallet']));
  assert.ok(/have not yet been tested/.test(SIGNING_MEAN_COMPATIBILITY['hardware-wallet']));
  assert.ok(!/mobile wallet/i.test(Object.values(SIGNING_MEAN_LABELS).join(' ')), 'jamais "mobile wallet"');
  assert.ok(!/hot wallet/i.test(Object.values(SIGNING_MEAN_LABELS).join(' ')), 'jamais "hot wallet" comme libelle');
  for (const brand of ['Trezor', 'Keystone', 'Tangem', 'Unruggable', 'Solflare Shield']) {
    assert.ok(!allText.includes(brand), `${brand} ne doit pas etre declare compatible`);
  }
});

check('10/11/12. parcours raccourcis et croissants', () => {
  const beginner = screensForLevel('new-to-multisig').length;
  const familiar = screensForLevel('familiar').length;
  const advanced = screensForLevel('advanced').length;
  assert.equal(beginner, 6);
  assert.equal(familiar, 4);
  assert.equal(advanced, 2);
  assert.ok(beginner > familiar && familiar > advanced);
  assert.ok(totalSteps('new-to-multisig', beginner) <= 7, 'au plus 7 etapes au total');
});

check('13. Step X of Y suit le parcours reel', () => {
  assert.ok(SCREEN.includes('Step {step + 1} of {lastStep + 1}'));
  assert.ok(SCREEN.includes('totalSteps(profile.level, lessons.length)'));
  assert.equal(totalSteps('advanced', 2), 3);
});

check('14. ancienne step 9 supprimee et remplacee par une lecon concrete', () => {
  assert.ok(!ONBOARDING_SCREENS.some((lesson) => lesson.id === 'independent-signers'));
  const methods = ONBOARDING_SCREENS.find((lesson) => lesson.id === 'signing-methods');
  assert.ok(methods !== undefined, 'lecon de remplacement presente');
  assert.ok(/same recovery phrase/.test(methods.body.join(' ')));
  assert.ok(/A multisig can protect better/.test(methods.body.join(' ')));
  assert.ok(
    !/Separate signers by device and by seed/.test(PROFILE),
    'la phrase abstraite a ete supprimee du resume',
  );
});

check('15. resume dependant des reponses', () => {
  const devnet = personalizedSummary({
    goal: 'learn-and-test',
    level: 'new-to-multisig',
    onboardingCompleted: false,
    signingMeans: ['seed-vault'],
  });
  assert.ok(devnet.some((line) => /Start on Devnet and practise the complete cycle/.test(line)));
  const team = personalizedSummary({
    goal: 'team-or-business',
    level: 'familiar',
    onboardingCompleted: false,
    signingMeans: ['trusted-co-signer'],
  });
  assert.ok(team.some((line) => /Document each member/.test(line)));
  assert.ok(team.some((line) => /reach the threshold/.test(line)));
  for (const line of [...devnet, ...team]) {
    assert.ok(!/score|guaranteed|perfect|rating/i.test(line));
  }
});

check('16/17. protections critiques dans les trois parcours', () => {
  for (const lesson of ONBOARDING_SCREENS) {
    if (lesson.id === 'critical-reminders' || lesson.id === 'proposal-lifecycle' || lesson.id === 'multisig-vs-main-vault') {
      assert.ok(lesson.levels.length >= 2, `${lesson.id} doit couvrir plusieurs niveaux`);
    }
  }
  assert.ok(/does not hold the transferable SOL/.test(allText));
  assert.ok(/Send funds to the Main vault/.test(allText));
  assert.ok(/Approved does not mean executed\./.test(allText));
  assert.ok(CRITICAL_PROTECTIONS.length === 5);
  const advanced = screensForLevel('advanced').map((lesson) => lesson.id);
  assert.ok(advanced.includes('multisig-vs-main-vault') || advanced.includes('critical-reminders'));
});

check('18. Reset ne supprime pas le registre des multisigs', () => {
  assert.ok(HOOK.includes('removeItem(ONBOARDING_STORAGE_KEY)'));
  assert.ok(!/multisig-registry|registry/i.test(HOOK), 'aucune touche au registre local');
});

check('19/20. aucun wallet, RPC, fetch, signature ou transaction', () => {
  for (const [name, source] of [
    ['OnboardingScreen', SCREEN],
    ['useOnboarding', HOOK],
    ['profile', PROFILE],
    ['content', CONTENT],
  ] as const) {
    assert.ok(!/useMobileWallet|signAndSendTransactions|signTransaction|authorizeSession/.test(source), name);
    assert.ok(!/connection\.|getBalance|getAccountInfo|fetch\(|https?:/.test(source), name);
  }
});

check('21. echec de stockage non bloquant', () => {
  assert.ok(HOOK.includes('catch {'));
  assert.ok(HOOK.includes('setStorageFailed(true)'));
  assert.ok(HOME.includes('could not be saved on this device'));
});

check('22. ancien profil v1 migre sans crash', () => {
  const migrated = sanitizeProfile({
    goal: 'protect-personal-savings',
    level: 'familiar',
    onboardingCompleted: true,
    priority: 'strong-separation',
    signingMeans: ['one-mobile-wallet', 'seed-vault', 'trusted-co-signers'],
  });
  assert.equal(migrated.goal, 'protect-personal-funds');
  assert.deepEqual(migrated.signingMeans, ['wallet-app', 'seed-vault', 'trusted-co-signer']);
  assert.equal(migrated.onboardingCompleted, true);
  assert.equal(Object.keys(migrated).includes('priority'), false);
  assert.equal(sanitizeProfile('broken').onboardingCompleted, false);
  assert.equal(sanitizeProfile(null).level, 'new-to-multisig');
});

check('aucun secret demande ou stocke', () => {
  for (const key of ['seed', 'mnemonic', 'privateKey', 'password', 'pin', 'recoveryPhrase']) {
    assert.ok(FORBIDDEN_PROFILE_KEYS.includes(key as (typeof FORBIDDEN_PROFILE_KEYS)[number]));
  }
  assert.ok(/{'never enter a recovery phrase into Pocket Multisig'}/.test(SCREEN) || allText.includes('never enter a recovery phrase'));
  assert.ok(Object.keys(CONTEXTUAL_HELP).includes('hotWallet'), 'hot wallet seulement explique');
});

check('libelles de profil conformes', () => {
  assert.equal(LEVEL_LABELS['new-to-multisig'], 'New to multisig');
  assert.equal(LEVEL_LABELS.familiar, 'I already use crypto wallets');
  assert.equal(LEVEL_LABELS.advanced, 'I already understand multisig');
  assert.equal(GOAL_LABELS['protect-personal-funds'], 'Protect personal funds');
  assert.equal(GOAL_LABELS['team-or-business'], 'Manage team or business funds');
  assert.equal(contentMode('new-to-multisig').lessonCount, 6);
});

setTimeout(() => {
  console.log(`\n${passed} test(s) OK`);
  if (process.exitCode === 1) process.exit(1);
}, 50);