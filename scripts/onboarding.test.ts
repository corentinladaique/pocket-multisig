import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { CONTEXTUAL_HELP, ONBOARDING_SCREENS, screensForLevel } from '../src/onboarding/content';
import {
  completedProfile,
  contentMode,
  DEFAULT_PROFILE,
  FORBIDDEN_PROFILE_KEYS,
  personalizedSummary,
  sanitizeProfile,
  shouldShowOnboarding,
  skippedProfile,
} from '../src/onboarding/profile';

/**
 * Tests de l'onboarding : aucun wallet, aucun reseau, aucun stockage reel.
 * Execution : npx tsx scripts/onboarding.test.ts
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
const HOOK = readFileSync('src/onboarding/useOnboarding.ts', 'utf8');
const PROFILE = readFileSync('src/onboarding/profile.ts', 'utf8');
const CONTENT = readFileSync('src/onboarding/content.ts', 'utf8');
const HOME = readFileSync('src/screens/ConnectScreen.tsx', 'utf8');

check('1/4. premiere utilisation affiche l onboarding, puis plus apres completion', () => {
  assert.equal(shouldShowOnboarding(DEFAULT_PROFILE), true, 'premier lancement');
  const done = completedProfile(DEFAULT_PROFILE);
  assert.equal(done.onboardingCompleted, true);
  assert.equal(shouldShowOnboarding(done), false, 'plus de reaffichage apres completion');
  assert.ok(HOME.includes('if (onboarding.ready && onboarding.show)'), 'Home doit afficher l onboarding');
});

check('2/15. Skip rend l application utilisable et ne bloque pas si le stockage echoue', () => {
  const skipped = skippedProfile(DEFAULT_PROFILE);
  assert.equal(skipped.onboardingCompleted, true);
  assert.equal(shouldShowOnboarding(skipped), false);
  // Le mode pedagogique par defaut reste complet.
  assert.equal(skipped.level, 'new-to-multisig');
  assert.ok(HOOK.includes('catch {'), "l'echec de stockage doit etre rattrape");
  assert.ok(
    HOOK.includes('setShow(true)'),
    'en cas de stockage indisponible, le mode pedagogique est propose',
  );
  assert.ok(HOME.includes('could not be saved on this device'), 'message non bloquant');
});

check('3. Finish enregistre onboardingCompleted localement', () => {
  assert.ok(HOOK.includes('AsyncStorage.setItem(ONBOARDING_STORAGE_KEY'));
  assert.ok(HOOK.includes('ONBOARDING_STORAGE_KEY ='));
  assert.ok(!/https?:|fetch\(|axios/.test(HOOK), 'aucun envoi reseau du profil');
});

check('5. Reset onboarding reaffiche le parcours et efface le profil', () => {
  assert.ok(HOOK.includes('AsyncStorage.removeItem(ONBOARDING_STORAGE_KEY)'));
  assert.ok(HOOK.includes('setShow(true)'));
  assert.ok(HOME.includes('Reset onboarding'));
});

check('6/7. aucun wallet, aucune signature, aucun envoi dans l onboarding', () => {
  for (const [name, source] of [
    ['OnboardingScreen', SCREEN],
    ['useOnboarding', HOOK],
    ['profile', PROFILE],
    ['content', CONTENT],
  ] as const) {
    assert.ok(
      !/useMobileWallet|signAndSendTransactions|signTransaction|authorizeSession|MobileWalletProvider/.test(
        source,
      ),
      `${name} ne doit pas toucher au wallet`,
    );
    assert.ok(!/connection\.|getBalance|getAccountInfo/.test(source), `${name} sans RPC`);
  }
  assert.ok(!/useMobileWallet/.test(HOME.slice(HOME.indexOf('OnboardingScreen'), HOME.indexOf('OnboardingScreen') + 400)));
});

check('8. aucun secret demande ni accepte', () => {
  for (const key of ['seed', 'mnemonic', 'privateKey', 'password', 'pin']) {
    assert.ok(
      FORBIDDEN_PROFILE_KEYS.includes(key as (typeof FORBIDDEN_PROFILE_KEYS)[number]),
      `${key} doit rester interdit`,
    );
  }
  assert.ok(!/seed phrase\?|enter your seed|mnemonic/i.test(SCREEN), 'jamais demande a l utilisateur');
  // Un contenu inattendu est nettoye.
  const dirty = sanitizeProfile({
    amount: 12,
    mnemonic: 'x',
    onboardingCompleted: true,
    privateKey: 'x',
  });
  assert.equal(Object.keys(dirty).includes('mnemonic'), false);
  assert.equal(Object.keys(dirty).includes('amount'), false);
  assert.equal(dirty.onboardingCompleted, true);
});

check('9/10. niveau debutant complet, niveau avance condense, protections inchangees', () => {
  const beginner = contentMode('new-to-multisig');
  const advanced = contentMode('advanced');
  assert.equal(beginner.fullExplanations, true);
  assert.equal(beginner.showChecklists, true);
  assert.equal(beginner.onboardingScreenCount, 8);
  assert.equal(advanced.summarized, true);
  assert.ok(advanced.onboardingScreenCount < beginner.onboardingScreenCount);
  assert.ok(
    screensForLevel('advanced').length < screensForLevel('new-to-multisig').length,
    'le niveau avance voit moins d ecrans',
  );
  // Le niveau ne touche ni aux guards ni aux confirmations : aucun de ces
  // fichiers n'est importe par l'onboarding.
  for (const source of [SCREEN, PROFILE, CONTENT]) {
    assert.ok(!/useWalletGuard|evaluateReviewGuard|checkReviewAllowlist|computeCanConfirm/.test(source));
  }
});

check('11/12/13. contenu pedagogique cle present', () => {
  const texts = ONBOARDING_SCREENS.flatMap((screen) => [
    screen.title,
    ...screen.body,
    ...screen.bullets,
    screen.emphasis ?? '',
  ]).join('\n');
  assert.ok(/Multisig configuration/.test(texts) && /Main vault/.test(texts));
  assert.ok(/does not hold the transferable SOL/.test(texts));
  assert.ok(/Send funds to the Main vault/.test(texts));
  assert.ok(/Propose —/.test(texts) && /Approve —/.test(texts) && /Execute —/.test(texts));
  assert.ok(/Approved does not mean executed\./.test(texts), 'phrase forte visible');
  assert.ok(/technical role: Initiate/.test(texts));
  assert.ok(/technical role: Vote/.test(texts));
  assert.ok(/technical role: Execute/.test(texts));
  assert.ok(/This is an example, not a universal recommendation\./.test(texts));
  assert.ok(/not independently audited/.test(texts));
  assert.ok(CONTENT.includes('Vault index 0') === false, 'pas de jargon Vault index 0');
});

check('14. les reponses restent locales et le resume est construit sur l appareil', () => {
  const summary = personalizedSummary({
    goal: 'business-or-team',
    level: 'new-to-multisig',
    onboardingCompleted: false,
    priority: 'recovery-and-resilience',
    signingMeans: ['hardware-wallet'],
  });
  assert.ok(summary.some((line) => /hardware wallet/.test(line)));
  assert.ok(summary.some((line) => /reach the threshold/.test(line)));
  assert.ok(summary.some((line) => /Devnet/.test(line)));
  // Aucun score, aucune promesse.
  for (const line of summary) {
    assert.ok(!/score|guaranteed|100%|rating/i.test(line), `ligne interdite: ${line}`);
  }
  assert.ok(CONTENT.includes('built on your device'), 'le resume est local');
});

check('aides contextuelles courtes disponibles', () => {
  assert.equal(CONTEXTUAL_HELP.threshold, 'Approvals required before execution');
  assert.equal(CONTEXTUAL_HELP.mainVault, 'Where the funds are held');
  assert.equal(CONTEXTUAL_HELP.execute, 'This action applies the approved transaction.');
  assert.ok(/threshold is reached/.test(CONTEXTUAL_HELP.readyToExecute));
  assert.ok(/no permissions/.test(CONTEXTUAL_HELP.readOnly));
  assert.ok(/confirmed vault balance/.test(CONTEXTUAL_HELP.max));
});

check('navigation Skip / Back / Next / Finish presente', () => {
  for (const label of ['Skip', 'Back', 'Next', 'Finish']) {
    assert.ok(SCREEN.includes(`>${label}<`), `bouton ${label} manquant`);
  }
  assert.ok(SCREEN.includes('SAFE_TOP_PADDING'), 'safe area respectee');
  assert.ok(SCREEN.includes('Step {step + 1} of {totalSteps}'), 'progression visible');
  assert.ok(HOME.includes('Learn about multisig'), 'reouverture depuis Home');
});

setTimeout(() => {
  console.log(`\n${passed} test(s) OK`);
  if (process.exitCode === 1) process.exit(1);
}, 50);