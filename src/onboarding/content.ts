import { contentMode, type LearningLevel } from './profile';

/**
 * Contenu pédagogique de l'onboarding. Module PUR : aucune I/O, aucun wallet,
 * aucun RPC. Le contenu est filtré par niveau (voir `screenForLevels`).
 */

export type OnboardingScreen = {
  id: string;
  title: string;
  /** Paragraphes courts, dans l'ordre d'affichage. */
  body: string[];
  /** Éléments de liste : rôle, exemple ou avertissement. */
  bullets: string[];
  /** Phrase à retenir, mise en avant. */
  emphasis?: string;
  /** Niveaux qui voient cet écran. */
  levels: LearningLevel[];
};

export const ONBOARDING_SCREENS: OnboardingScreen[] = [
  {
    body: [
      'A multisig protects funds by requiring approval from several members instead of relying on one wallet.',
      'Members are separate signers. Each one can approve or refuse.',
      'Several addresses controlled by the same seed are not a real separation of security: they count as one signer.',
    ],
    bullets: [
      'three members exist',
      'any two authorized members must approve',
      'one lost or unavailable signer does not necessarily block the vault',
    ],
    emphasis: '2 of 3',
    id: 'what-is-a-multisig',
    levels: ['new-to-multisig', 'familiar', 'advanced'],
    title: 'What is a multisig?',
  },
  {
    body: ['Two different accounts are involved, and they do not have the same job.'],
    bullets: [
      'Multisig configuration — stores members; stores roles; stores threshold; does not hold the transferable SOL.',
      'Main vault — holds the funds; is the deposit address; sends funds when an approved proposal is executed.',
    ],
    emphasis: 'Send funds to the Main vault, not to the multisig configuration address.',
    id: 'multisig-vs-main-vault',
    levels: ['new-to-multisig', 'familiar', 'advanced'],
    title: 'Multisig vs Main vault',
  },
  {
    body: [
      'Propose — a member prepares an action. No funds move yet.',
      'Approve — members review and approve the proposal. Even after the threshold is reached, no funds move yet.',
      'Execute — an authorized member executes the approved proposal. This is when the actual transfer happens.',
    ],
    bullets: [],
    emphasis: 'Approved does not mean executed.',
    id: 'proposal-lifecycle',
    levels: ['new-to-multisig', 'familiar', 'advanced'],
    title: 'The proposal lifecycle',
  },
  {
    body: ['A member can have one, several or all of these roles.'],
    bullets: [
      'Create proposals — technical role: Initiate',
      'Approve proposals — technical role: Vote',
      'Execute approved proposals — technical role: Execute',
    ],
    id: 'member-permissions',
    levels: ['new-to-multisig', 'familiar', 'advanced'],
    title: 'Member permissions',
  },
  {
    body: [
      'A multisig is more resilient when the signers do not all depend on the same device or the same seed.',
      'Losing too many signers can permanently block access: test recovery before depositing important funds.',
    ],
    bullets: [
      'Seed Vault',
      'mobile wallet',
      'Ledger hardware wallet',
      'three accounts from one seed may still be one point of failure',
    ],
    emphasis: 'This is an example, not a universal recommendation.',
    id: 'independent-signers',
    levels: ['new-to-multisig', 'familiar'],
    title: 'Independent signers',
  },
  {
    body: ['Pocket Multisig currently runs on Devnet only.'],
    bullets: [
      'Devnet — testing environment; test SOL has no real monetary value; suitable for learning and testing recovery.',
      'Mainnet — production network; transactions use real assets; mistakes can cause permanent financial loss.',
    ],
    emphasis: 'Pocket Multisig is experimental and not independently audited.',
    id: 'devnet-vs-mainnet',
    levels: ['new-to-multisig', 'familiar'],
    title: 'Devnet vs Mainnet',
  },
  {
    body: ['Before signing, check each point. Signing is the only irreversible step.'],
    bullets: [
      'verify the network',
      'verify the selected wallet',
      'verify the destination',
      'verify the amount',
      'verify the Main vault balance',
      'verify the estimated remaining balance',
      'understand whether the action is Propose, Approve or Execute',
      'never enter a seed phrase into Pocket Multisig',
    ],
    id: 'before-you-sign',
    levels: ['new-to-multisig', 'familiar'],
    title: 'Before you sign',
  },
  {
    body: ['This summary is built on your device from your answers. Nothing is sent anywhere.'],
    bullets: [],
    id: 'personalized-summary',
    levels: ['new-to-multisig', 'familiar', 'advanced'],
    title: 'Your personalized summary',
  },
];

/** Écrans visibles pour un niveau donné, dans l'ordre. */
export function screensForLevel(level: LearningLevel): OnboardingScreen[] {
  const visible = ONBOARDING_SCREENS.filter((screen) => screen.levels.includes(level));
  const mode = contentMode(level);
  // Niveau avancé : parcours raccourci (titre + éléments clés seulement).
  if (mode.summarized && level === 'advanced') {
    return visible.slice(0, mode.onboardingScreenCount);
  }
  if (mode.summarized) {
    return visible.slice(0, mode.onboardingScreenCount);
  }
  return visible;
}

/**
 * Aides contextuelles courtes. Affichées via « Learn more » plutôt que comme
 * texte permanent, sauf sur les écrans où l'explication est indispensable.
 */
export const CONTEXTUAL_HELP = {
  execute: 'This action applies the approved transaction.',
  mainVault: 'Where the funds are held',
  max: 'Uses the current confirmed vault balance. The amount is fixed when the proposal is created.',
  readyToExecute: 'The approval threshold is reached. Funds have not moved yet.',
  readOnly:
    'You can view this public on-chain multisig, but your wallet has no permissions.',
  threshold: 'Approvals required before execution',
} as const;

export type ContextualHelpKey = keyof typeof CONTEXTUAL_HELP;