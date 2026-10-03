import {
  DEFAULT_PROFILE,
  GOAL_LABELS,
  LEARNING_GOALS,
  LEARNING_LEVELS,
  LEVEL_LABELS,
  SIGNING_MEAN_LABELS,
  SIGNING_MEANS,
  type LearningGoal,
  type LearningLevel,
  type LearningProfile,
  type SigningMean,
} from './profile';

/**
 * Modèle de réponses de l'onboarding — logique PURE, sans I/O.
 *
 * Chaque option possède une identité STABLE et UNIQUE (`id`), un libellé
 * affiché (`label`) et sa VALEUR métier explicite (`value`). Une sélection
 * n'est jamais reconstruite depuis le texte, la position ou un index.
 *
 * Aucune valeur par défaut n'est présentée comme un choix : l'état initial est
 * vide (`level === null`, `goal === null`, `signingMeans === []`).
 */

export interface OnboardingOption<T> {
  id: string;
  label: string;
  value: T;
}

export type LevelOption = OnboardingOption<LearningLevel>;
export type GoalOption = OnboardingOption<LearningGoal>;
export type MeanOption = OnboardingOption<SigningMean>;

// `id === value` : identité stable (dérivée de la constante `as const`), jamais
// d'un index de tableau ni du libellé traduit.
export const LEVEL_OPTIONS: readonly LevelOption[] = LEARNING_LEVELS.map((value) => ({
  id: value,
  label: LEVEL_LABELS[value],
  value,
}));

export const GOAL_OPTIONS: readonly GoalOption[] = LEARNING_GOALS.map((value) => ({
  id: value,
  label: GOAL_LABELS[value],
  value,
}));

export const SIGNING_MEAN_OPTIONS: readonly MeanOption[] = SIGNING_MEANS.map((value) => ({
  id: value,
  label: SIGNING_MEAN_LABELS[value],
  value,
}));

export interface OnboardingAnswers {
  level: LearningLevel | null;
  goal: LearningGoal | null;
  signingMeans: SigningMean[];
}

/** État initial : RIEN n'est sélectionné (aucun fallback sur la première option). */
export const EMPTY_ANSWERS: OnboardingAnswers = {
  goal: null,
  level: null,
  signingMeans: [],
};

/** Sélectionne le niveau : remplace uniquement le niveau, par SA propre valeur. */
export function selectLevel(answers: OnboardingAnswers, option: LevelOption): OnboardingAnswers {
  return { ...answers, level: option.value };
}

/** Sélectionne l'objectif : remplace uniquement l'objectif. */
export function selectGoal(answers: OnboardingAnswers, option: GoalOption): OnboardingAnswers {
  return { ...answers, goal: option.value };
}

/** Bascule un moyen de signature : ne touche ni le niveau ni l'objectif. */
export function toggleSigningMean(
  answers: OnboardingAnswers,
  option: MeanOption,
): OnboardingAnswers {
  const signingMeans = answers.signingMeans.includes(option.value)
    ? answers.signingMeans.filter((mean) => mean !== option.value)
    : [...answers.signingMeans, option.value];
  return { ...answers, signingMeans };
}

/** Vrai seulement si les TROIS questions ont une réponse réellement choisie. */
export function isAnswersComplete(answers: OnboardingAnswers): boolean {
  return answers.level !== null && answers.goal !== null && answers.signingMeans.length > 0;
}

/**
 * Construit le profil à enregistrer depuis les réponses CHOISIES.
 *
 * `onboardingCompleted` est posé explicitement par l'appelant. Le niveau
 * retombe sur la valeur par défaut UNIQUEMENT quand l'utilisateur a passé
 * l'écran sans répondre (Skip) : jamais sur un choix explicite.
 */
export function buildProfile(
  answers: OnboardingAnswers,
  onboardingCompleted: boolean,
): LearningProfile {
  return {
    goal: answers.goal,
    level: answers.level ?? DEFAULT_PROFILE.level,
    onboardingCompleted,
    signingMeans: [...answers.signingMeans],
  };
}
