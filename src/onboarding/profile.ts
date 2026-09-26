/**
 * Profil d'apprentissage FACULTATIF, stocké uniquement sur l'appareil.
 *
 * Module PUR : aucune I/O, aucun réseau, aucun wallet. Les réponses ne sont
 * jamais envoyées, jamais ajoutées à une transaction, et peuvent être effacées
 * par « Reset onboarding ».
 *
 * Aucune donnée financière ou personnelle sensible n'est demandée ni acceptée :
 * le type ci-dessous est la seule forme de profil que l'application sait écrire.
 */

export const LEARNING_LEVELS = ['new-to-multisig', 'familiar', 'advanced'] as const;
export type LearningLevel = (typeof LEARNING_LEVELS)[number];

export const LEARNING_GOALS = [
  'protect-personal-savings',
  'manage-shared-funds',
  'business-or-team',
  'learn-and-test',
] as const;
export type LearningGoal = (typeof LEARNING_GOALS)[number];

export const SIGNING_MEANS = [
  'one-mobile-wallet',
  'multiple-mobile-wallets',
  'seed-vault',
  'hardware-wallet',
  'trusted-co-signers',
] as const;
export type SigningMean = (typeof SIGNING_MEANS)[number];

export const PRIORITIES = [
  'simplicity',
  'recovery-and-resilience',
  'strong-separation',
  'learning-first',
] as const;
export type LearningPriority = (typeof PRIORITIES)[number];

export type LearningProfile = {
  level: LearningLevel;
  goal: LearningGoal | null;
  signingMeans: SigningMean[];
  priority: LearningPriority | null;
  onboardingCompleted: boolean;
};

/** Profil par défaut : mode pédagogique complet, aucune réponse inventée. */
export const DEFAULT_PROFILE: LearningProfile = {
  goal: null,
  level: 'new-to-multisig',
  onboardingCompleted: false,
  priority: null,
  signingMeans: [],
};

/**
 * Champs formellement INTERDITS dans le profil. Toute clé inattendue est
 * supprimée par `sanitizeProfile` : le stockage local ne peut pas contenir autre
 * chose que les préférences fonctionnelles listées ici.
 */
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
  'seed',
  'seedPhrase',
  'wealth',
] as const;

function isLevel(value: unknown): value is LearningLevel {
  return typeof value === 'string' && (LEARNING_LEVELS as readonly string[]).includes(value);
}

function isGoal(value: unknown): value is LearningGoal {
  return typeof value === 'string' && (LEARNING_GOALS as readonly string[]).includes(value);
}

function isPriority(value: unknown): value is LearningPriority {
  return typeof value === 'string' && (PRIORITIES as readonly string[]).includes(value);
}

function isSigningMean(value: unknown): value is SigningMean {
  return typeof value === 'string' && (SIGNING_MEANS as readonly string[]).includes(value);
}

/**
 * Ramène n'importe quelle entrée (stockage corrompu, ancienne version, contenu
 * inattendu) à un profil valide. Toute clé non autorisée est écartée.
 */
export function sanitizeProfile(raw: unknown): LearningProfile {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_PROFILE };
  const source = raw as Record<string, unknown>;

  const signingMeans = Array.isArray(source.signingMeans)
    ? source.signingMeans.filter(isSigningMean)
    : [];

  return {
    goal: isGoal(source.goal) ? source.goal : null,
    level: isLevel(source.level) ? source.level : DEFAULT_PROFILE.level,
    onboardingCompleted: source.onboardingCompleted === true,
    priority: isPriority(source.priority) ? source.priority : null,
    signingMeans: [...new Set(signingMeans)],
  };
}

/** Vrai si l'onboarding a déjà été terminé : il n'est alors plus réaffiché. */
export function shouldShowOnboarding(profile: LearningProfile): boolean {
  return profile.onboardingCompleted !== true;
}

/** L'utilisateur peut toujours ignorer : le profil reste valide et complet. */
export function skippedProfile(profile: LearningProfile): LearningProfile {
  return { ...sanitizeProfile(profile), onboardingCompleted: true };
}

export function completedProfile(profile: LearningProfile): LearningProfile {
  return { ...sanitizeProfile(profile), onboardingCompleted: true };
}

/**
 * Contenu affiché selon le niveau. Le niveau n'agit QUE sur la quantité
 * d'explications : jamais sur les guards, les confirmations, la simulation, les
 * permissions ou le nombre d'actions autorisées.
 */
export function contentMode(level: LearningLevel): {
  fullExplanations: boolean;
  showChecklists: boolean;
  summarized: boolean;
  onboardingScreenCount: number;
} {
  if (level === 'advanced') {
    return {
      fullExplanations: false,
      onboardingScreenCount: 4,
      showChecklists: false,
      summarized: true,
    };
  }
  if (level === 'familiar') {
    return {
      fullExplanations: false,
      onboardingScreenCount: 6,
      showChecklists: true,
      summarized: true,
    };
  }
  return {
    fullExplanations: true,
    onboardingScreenCount: 8,
    showChecklists: true,
    summarized: false,
  };
}

/**
 * Résumé personnalisé, construit LOCALEMENT. Jamais de score de sécurité, jamais
 * de promesse de protection absolue, jamais de conseil financier : uniquement des
 * rappels liés aux réponses données.
 */
export function personalizedSummary(profile: LearningProfile): string[] {
  const lines: string[] = [];

  if (profile.level === 'new-to-multisig') {
    lines.push(
      'Start on Devnet. Learn the full Propose → Approve → Execute cycle before protecting real assets.',
    );
  }
  if (profile.level === 'familiar') {
    lines.push(
      'You already know wallets: focus on who can reach the threshold, and on the difference between the multisig configuration and the Main vault.',
    );
  }
  if (profile.level === 'advanced') {
    lines.push(
      'Skip the basics: review the on-chain roles and threshold in Technical details, and keep testing recovery on Devnet.',
    );
  }

  if (profile.signingMeans.includes('hardware-wallet')) {
    lines.push(
      'You can test independent approvals using a mobile wallet and your hardware wallet.',
    );
  }
  if (profile.signingMeans.includes('seed-vault')) {
    lines.push('Seed Vault can act as one of your independent signers.');
  }
  if (profile.signingMeans.includes('one-mobile-wallet')) {
    lines.push(
      'With a single mobile wallet, a 2 of 3 setup still needs two other independent signers to be useful.',
    );
  }
  if (profile.signingMeans.includes('multiple-mobile-wallets')) {
    lines.push(
      'Check that your mobile wallets do not all depend on the same seed, otherwise they count as one signer.',
    );
  }
  if (profile.signingMeans.includes('trusted-co-signers')) {
    lines.push('Agree with your co-signers on how to reach each other when a proposal waits.');
  }

  if (profile.goal === 'protect-personal-savings') {
    lines.push(
      'For personal savings, test recovery before depositing anything important, and keep enough signers reachable.',
    );
  }
  if (profile.goal === 'manage-shared-funds' || profile.goal === 'business-or-team') {
    lines.push(
      'Make sure every member understands their role and that enough signers remain available to reach the threshold.',
    );
  }
  if (profile.goal === 'learn-and-test') {
    lines.push('Devnet is made for this: test, break things, and test recovery again.');
  }

  if (profile.priority === 'simplicity') {
    lines.push('Keep the configuration small and explicit; fewer members means fewer moving parts.');
  }
  if (profile.priority === 'recovery-and-resilience') {
    lines.push(
      'Resilience means no single device, seed or person can block the vault: spread the signers.',
    );
  }
  if (profile.priority === 'strong-separation') {
    lines.push('Separate signers by device and by seed, not only by address.');
  }
  if (profile.priority === 'learning-first') {
    lines.push('Take the full cycle once on Devnet before protecting real assets.');
  }

  lines.push('Pocket Multisig is experimental, runs on Devnet and is not independently audited.');
  return lines;
}