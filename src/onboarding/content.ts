import { contentMode, type LearningLevel } from './profile';

/**
 * Contenu pédagogique v2. Module PUR : aucune I/O, aucun wallet, aucun RPC.
 *
 * Chaque leçon répond à UNE question claire. Les protections critiques
 * (Main vault détient les fonds, Approved ≠ Executed, Execute applique,
 * Devnet sans vrais fonds, aucune recovery phrase demandée) sont présentes dans
 * les TROIS parcours : c'est l'ensemble `PROTECTIONS` ci-dessous.
 */

export type OnboardingLesson = {
  id: string;
  title: string;
  body: string[];
  bullets: string[];
  emphasis?: string;
  /** Niveaux qui voient cette leçon, avec un ordre strictement croissant de longueur. */
  levels: LearningLevel[];
};

export const ONBOARDING_SCREENS: OnboardingLesson[] = [
  {
    body: [
      'A multisig protects funds by requiring approval from several members instead of relying on one wallet.',
      'A multisig does not remove every risk: it spreads the power to move funds.',
    ],
    bullets: [
      'three members exist',
      'any two authorized members must approve',
      'one unavailable signer does not necessarily block the vault',
    ],
    emphasis: '2 of 3',
    id: 'what-is-a-multisig',
    levels: ['new-to-multisig'],
    title: 'What is a multisig?',
  },
  {
    body: [
      'Two different accounts are involved, and they do not have the same job.',
      'If you send funds to the wrong one, they will not be usable by the vault.',
    ],
    bullets: [
      'Multisig configuration — stores members; stores permissions; stores the approval threshold; does not hold the transferable SOL.',
      'Main vault — holds the funds; is the address to fund; sends funds when an approved proposal is executed.',
    ],
    emphasis: 'Send funds to the Main vault, not to the multisig configuration address.',
    id: 'multisig-vs-main-vault',
    levels: ['new-to-multisig', 'familiar', 'advanced'],
    title: 'Multisig configuration vs Main vault',
  },
  {
    body: [
      'Propose — a member prepares an action. No funds move yet.',
      'Approve — members review and approve the proposal. Reaching the approval threshold does not move the funds.',
      'Execute — an authorized member applies the approved proposal. This is when the transfer happens.',
    ],
    bullets: [
      'Create proposals — technical role: Initiate',
      'Approve proposals — technical role: Vote',
      'Execute approved proposals — technical role: Execute',
    ],
    emphasis: 'Approved does not mean executed.',
    id: 'proposal-lifecycle',
    levels: ['new-to-multisig', 'familiar', 'advanced'],
    title: 'Propose → Approve → Execute',
  },
  {
    body: [
      'A multisig can protect better when the signing methods do not all depend on the same phone, the same device or the same recovery phrase.',
      'A member can have one, several or all roles.',
    ],
    bullets: [
      'Example of different signing methods: Seed Vault Wallet; a wallet app using a separate recovery phrase; a Ledger connected through Solflare.',
      'Three addresses from the same recovery phrase still count as one method.',
    ],
    emphasis: 'This is an example, not a universal recommendation.',
    id: 'signing-methods',
    levels: ['new-to-multisig'],
    title: 'Independent signing methods',
  },
  {
    body: [
      'Devnet — for learning and testing; test SOL has no real monetary value; separate from Mainnet.',
      'Before signing anything, check the same short list every time.',
    ],
    bullets: [
      'verify the network',
      'verify the selected wallet',
      'verify the destination',
      'verify the amount',
      'verify the Main vault balance',
      'understand whether the action is Propose, Approve or Execute',
      'never enter a recovery phrase into Pocket Multisig',
    ],
    emphasis: 'Pocket Multisig is experimental and not independently audited.',
    id: 'devnet-and-signing-checklist',
    levels: ['new-to-multisig', 'familiar'],
    title: 'Devnet and before you sign',
  },
  {
    body: ['If you keep only five things from this onboarding, keep these.'],
    bullets: [
      'the Main vault holds the funds; the multisig configuration does not',
      'Approved does not mean executed',
      'Execute is the action that applies the approved transaction',
      'Devnet does not use real funds',
      'Pocket Multisig never asks for your recovery phrase',
    ],
    id: 'critical-reminders',
    levels: ['familiar', 'advanced'],
    title: 'The five things to remember',
  },
  {
    body: ['This summary is built on your device from your answers. Nothing is sent anywhere.'],
    bullets: [],
    id: 'personalized-summary',
    levels: ['new-to-multisig', 'familiar', 'advanced'],
    title: 'Your personalized summary',
  },
];

/**
 * Leçons d'un niveau, dans l'ordre d'affichage. Les trois parcours contiennent
 * les protections critiques ; seul le nombre d'explications change.
 */
export function screensForLevel(level: LearningLevel): OnboardingLesson[] {
  const selected = ONBOARDING_SCREENS.filter((lesson) => lesson.levels.includes(level));
  return selected.slice(0, contentMode(level).lessonCount);
}

/** Rappels critiques, toujours affichés quel que soit le niveau. */
export const CRITICAL_PROTECTIONS = [
  'Main vault holds the funds',
  'Approved does not mean executed',
  'Execute applies the approved transaction',
  'Devnet does not use real funds',
  'Pocket Multisig never asks for your recovery phrase',
] as const;

/**
 * Aides contextuelles courtes, pour des « Learn more » ponctuels plutôt qu'un
 * texte permanent.
 */
export const CONTEXTUAL_HELP = {
  execute: 'This action applies the approved transaction.',
  hotWallet: 'A hot wallet is a software wallet whose keys are available to a connected device.',
  mainVault: 'Where the funds are held',
  max: 'Uses the current confirmed vault balance. The amount is fixed when the proposal is created.',
  readyToExecute: 'The approval threshold is reached. Funds have not moved yet.',
  readOnly:
    'You can view this public on-chain multisig, but your wallet has no permissions.',
  threshold: 'Approvals required before execution',
} as const;

export type ContextualHelpKey = keyof typeof CONTEXTUAL_HELP;