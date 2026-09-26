/**
 * Profil d'apprentissage FACULTATIF, stocké uniquement sur l'appareil.
 *
 * Module PUR : aucune I/O, aucun réseau, aucun wallet.
 *
 * v2 : la question « priorité » a été retirée (ses réponses ne changeaient
 * concrètement ni les écrans, ni le résumé, ni les aides). La migration depuis
 * v1 ignore proprement `priority` et ne bloque jamais Home.
 */

export const LEARNING_LEVELS = ['new-to-multisig', 'familiar', 'advanced'] as const;
export type LearningLevel = (typeof LEARNING_LEVELS)[number];

export const LEARNING_GOALS = [
  'protect-personal-funds',
  'manage-shared-funds',
  'team-or-business',
  'learn-and-test',
] as const;
export type LearningGoal = (typeof LEARNING_GOALS)[number];

/**
 * Moyens de signature, en catégories distinctes : une wallet app, le Seed Vault
 * Wallet intégré au téléphone Solana Mobile, un hardware wallet, un tiers de
 * confiance, ou plusieurs moyens indépendants. « mobile wallet » et « hot
 * wallet » ne sont PAS utilisés comme catégories.
 */
export const SIGNING_MEANS = [
  'wallet-app',
  'seed-vault',
  'hardware-wallet',
  'trusted-co-signer',
  'several-independent-methods',
] as const;
export type SigningMean = (typeof SIGNING_MEANS)[number];

export const LEVEL_LABELS: Record<LearningLevel, string> = {
  advanced: 'I already understand multisig',
  familiar: 'I already use crypto wallets',
  'new-to-multisig': 'New to multisig',
};

export const GOAL_LABELS: Record<LearningGoal, string> = {
  'learn-and-test': 'Learn and test on Devnet',
  'manage-shared-funds': 'Manage shared funds',
  'protect-personal-funds': 'Protect personal funds',
  'team-or-business': 'Manage team or business funds',
};

export const SIGNING_MEAN_LABELS: Record<SigningMean, string> = {
  'hardware-wallet': 'Hardware wallet',
  'seed-vault': 'Seed Vault Wallet',
  'several-independent-methods': 'More than one independent signing method',
  'trusted-co-signer': 'Another trusted person',
  'wallet-app': 'Wallet app',
};

export const SIGNING_MEAN_DESCRIPTIONS: Record<SigningMean, string> = {
  'hardware-wallet': 'A separate physical device that protects your keys.',
  'seed-vault': 'Built into your Solana Mobile phone.',
  'several-independent-methods': 'I can approve with different wallets, devices or co-signers.',
  'trusted-co-signer': 'A co-signer who controls their own wallet and recovery method.',
  'wallet-app': 'A wallet app such as Solflare, Phantom or Backpack.',
};

/** Compatibilités réellement testées avec Pocket Multisig, et rien de plus. */
export const SIGNING_MEAN_COMPATIBILITY = {
  'hardware-wallet': 'Tested with Pocket Multisig: Ledger through Solflare. Other Solana-compatible hardware wallets may work, but have not yet been tested with Pocket Multisig.',
  'seed-vault': 'Integrated in Solana Mobile.',
} as const;

/**
 * Les catégories restent distinctes : le Seed Vault Wallet n'est pas une wallet
 * app classique, et « hot wallet » n'est jamais un libellé de catégorie.
 */
export function signingMeanIsDistinct(mean: SigningMean): boolean {
  const label = SIGNING_MEAN_LABELS[mean];
  if (mean === 'seed-vault') return label === 'Seed Vault Wallet';
  return !/mobile wallet|hot wallet/i.test(label);
}

export type LearningProfile = {
  level: LearningLevel;
  goal: LearningGoal | null;
  signingMeans: SigningMean[];
  onboardingCompleted: boolean;
};

export const DEFAULT_PROFILE: LearningProfile = {
  goal: null,
  level: 'new-to-multisig',
  onboardingCompleted: false,
  signingMeans: [],
};

/** Anciennes valeurs v1, remappées sans perte et sans blocage. */
const LEGACY_SIGNING_MEANS: Record<string, SigningMean> = {
  'multiple-mobile-wallets': 'several-independent-methods',
  'one-mobile-wallet': 'wallet-app',
  'trusted-co-signers': 'trusted-co-signer',
};

const LEGACY_GOALS: Record<string, LearningGoal> = {
  'business-or-team': 'team-or-business',
  'learn-and-test': 'learn-and-test',
  'manage-shared-funds': 'manage-shared-funds',
  'protect-personal-savings': 'protect-personal-funds',
};

export const FORBIDDEN_PROFILE_KEYS = [
  'amount',
  'balance',
  'identity',
  'income',
  'mnemonic',
  'passphrase',
  'password',
  'pin',
  'privateKey',
  'recoveryPhrase',
  'seed',
  'seedPhrase',
  'wealth',
] as const;

function asGoal(value: unknown): LearningGoal | null {
  if (typeof value !== 'string') return null;
  if ((LEARNING_GOALS as readonly string[]).includes(value)) return value as LearningGoal;
  return LEGACY_GOALS[value] ?? null;
}

function asLevel(value: unknown): LearningLevel {
  return typeof value === 'string' && (LEARNING_LEVELS as readonly string[]).includes(value)
    ? (value as LearningLevel)
    : DEFAULT_PROFILE.level;
}

function asMean(value: unknown): SigningMean | null {
  if (typeof value !== 'string') return null;
  if ((SIGNING_MEANS as readonly string[]).includes(value)) return value as SigningMean;
  return LEGACY_SIGNING_MEANS[value] ?? null;
}

/**
 * Ramène n'importe quelle entrée (profil v1, stockage corrompu) à un profil v2
 * valide. `priority` est ignoré, toute clé non autorisée est écartée, et un
 * profil illisible retombe sur les valeurs par défaut : Home n'est jamais bloqué.
 */
export function sanitizeProfile(raw: unknown): LearningProfile {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_PROFILE };
  const source = raw as Record<string, unknown>;
  const signingMeans = Array.isArray(source.signingMeans)
    ? source.signingMeans.map(asMean).filter((mean): mean is SigningMean => mean !== null)
    : [];

  return {
    goal: asGoal(source.goal),
    level: asLevel(source.level),
    onboardingCompleted: source.onboardingCompleted === true,
    signingMeans: [...new Set(signingMeans)],
  };
}

export function shouldShowOnboarding(profile: LearningProfile): boolean {
  return profile.onboardingCompleted !== true;
}

export function completedProfile(profile: LearningProfile): LearningProfile {
  return { ...sanitizeProfile(profile), onboardingCompleted: true };
}

export function skippedProfile(profile: LearningProfile): LearningProfile {
  return { ...sanitizeProfile(profile), onboardingCompleted: true };
}

/** Le profil n'est valide pour avancer que si les trois questions ont une réponse. */
export function isQuestComplete(profile: LearningProfile): boolean {
  return (
    profile.goal !== null &&
    profile.signingMeans.length > 0 &&
    (LEARNING_LEVELS as readonly string[]).includes(profile.level)
  );
}

/**
 * Nombre d'étapes réellement affichées : 1 étape de profil + les leçons du
 * niveau. `Step X of Y` doit toujours utiliser cette valeur, jamais un total
 * théorique.
 */
export function totalSteps(level: LearningLevel, lessonCount: number): number {
  // `lessonCount < 0` : l'appelant n'a pas de liste sous la main, le mode du
  // niveau fait foi. Jamais de total théorique affiche a l'utilisateur.
  const count = lessonCount >= 0 ? lessonCount : contentMode(level).lessonCount;
  return 1 + count;
}

/** Contenu affiché selon le niveau : jamais plus de 7 étapes au total. */
export function contentMode(level: LearningLevel): {
  fullExplanations: boolean;
  showChecklists: boolean;
  summarized: boolean;
  lessonCount: number;
} {
  if (level === 'advanced') {
    return { fullExplanations: false, lessonCount: 2, showChecklists: false, summarized: true };
  }
  if (level === 'familiar') {
    return { fullExplanations: false, lessonCount: 4, showChecklists: true, summarized: true };
  }
  return { fullExplanations: true, lessonCount: 6, showChecklists: true, summarized: false };
}

/**
 * Résumé construit LOCALEMENT à partir des seules réponses données.
 * Jamais de score, jamais de promesse de protection absolue, jamais de conseil
 * financier personnalisé.
 */
export function personalizedSummary(profile: LearningProfile): string[] {
  const lines: string[] = [];

  if (profile.goal === 'learn-and-test') {
    lines.push('Start on Devnet and practise the complete cycle: Propose, Approve, then Execute.');
  }
  if (profile.goal === 'protect-personal-funds') {
    lines.push(
      'For personal funds, check that each signing method can still be accessed and recovered before you deposit.',
    );
  }
  if (profile.goal === 'manage-shared-funds') {
    lines.push(
      'Agree in advance on who can create, approve and execute proposals. Make sure enough members remain available to reach the threshold.',
    );
  }
  if (profile.goal === 'team-or-business') {
    lines.push(
      "Document each member's role and test the approval process before depositing funds.",
    );
  }

  const hasHardware = profile.signingMeans.includes('hardware-wallet');
  const hasSeedVault = profile.signingMeans.includes('seed-vault');
  const hasWalletApp = profile.signingMeans.includes('wallet-app');

  if (hasHardware && (hasSeedVault || hasWalletApp)) {
    lines.push(
      'You have different signing methods available. Before funding a vault, confirm that each method can still be accessed and recovered.',
    );
  }
  if (hasWalletApp && hasSeedVault) {
    lines.push('Make sure the wallet app and Seed Vault do not depend on the same recovery setup.');
  }
  if (hasWalletApp && !hasSeedVault && !hasHardware) {
    lines.push(
      'With a single wallet app, one lost recovery phrase can block the vault: consider a second independent signing method.',
    );
  }
  if (profile.signingMeans.includes('several-independent-methods')) {
    lines.push(
      'You said you can approve with different methods: keep them truly independent (different recovery phrase or device).',
    );
  }
  if (profile.signingMeans.includes('trusted-co-signer')) {
    lines.push(
      'Make sure enough members remain available to reach the threshold, and test that each co-signer can approve.',
    );
  }
  if (profile.level === 'advanced') {
    lines.push('Jump straight to Technical details for roles, threshold and on-chain addresses.');
  }

  lines.push(
    'Pocket Multisig runs on Devnet only, is experimental and has not been independently audited.',
  );
  return lines;
}