import { describeMwaError, type MwaErrorReport, type MwaStep } from './mwaDiagnostics';

/**
 * Machine d'état d'une opération d'écriture (création, approbation, exécution).
 *
 * Module PUR : aucune I/O, aucun RPC, aucune signature, aucun envoi. Il classe
 * ce qui s'est réellement passé et déduit ce que l'utilisateur a le droit de
 * faire ensuite — c'est ici que vit la règle « ne jamais annoncer un succès
 * sans les trois preuves ».
 *
 * Trois preuves exigées pour un succès :
 *   1. une signature a été obtenue ;
 *   2. la transaction est confirmée on-chain ;
 *   3. le compte métier a été relu et vérifié.
 *
 * Les huit états distingués sont volontairement exhaustifs et exclusifs.
 */

export const OPERATION_STATES = [
  'authorization-cancelled',
  'wallet-session-interrupted',
  'network-mismatch',
  'blockhash-expired-before-signing',
  'send-failed-before-signature',
  'signature-obtained-confirmation-pending',
  'transaction-confirmed-readback-failed',
  'operation-created-and-verified',
] as const;

export type OperationState = (typeof OPERATION_STATES)[number];

export type OperationEvidence = {
  signatureObtained: boolean;
  confirmed: boolean;
  readBackVerified: boolean;
};

export type OperationActions = {
  /** Le brouillon doit être conservé (vaultName, membres, labels, threshold). */
  keepDraft: boolean;
  /** Le verrou « une seule tentative » peut être réarmé. */
  rearmAttemptLock: boolean;
  /** L'utilisateur peut relancer une autorisation wallet. */
  allowReconnect: boolean;
  /** L'utilisateur peut reconstruire une transaction fraîche (blockhash neuf). */
  allowPrepareAndRetry: boolean;
  /** L'utilisateur peut relire la transaction et les comptes on-chain. */
  allowCheckAgain: boolean;
  /** Un second envoi immédiat est-il autorisé ? (jamais, sauf preuve du contraire) */
  allowSecondSend: boolean;
};

export type OperationReport = {
  state: OperationState;
  title: string;
  evidence: OperationEvidence;
  actions: OperationActions;
  /** Diagnostic MWA d'origine, conservé tel quel quand il existe. */
  mwa: MwaErrorReport | null;
};

const TITLES: Record<OperationState, string> = {
  'authorization-cancelled': 'Authorization cancelled — nothing was signed, nothing was sent.',
  'blockhash-expired-before-signing':
    'Blockhash expired before signing — the transaction must be rebuilt from scratch.',
  'network-mismatch':
    'Network mismatch — the wallet and the app are not on the same cluster.',
  'operation-created-and-verified': 'Created and verified on-chain.',
  'send-failed-before-signature': 'Send failed before any signature — nothing was sent.',
  'signature-obtained-confirmation-pending':
    'Transaction sent, verification pending — a signature exists.',
  'transaction-confirmed-readback-failed':
    'Transaction confirmed, but the on-chain read-back failed.',
  'wallet-session-interrupted':
    'Wallet session interrupted — treated as a cancellation, never as a success.',
};

function asText(caught: unknown): string {
  if (caught instanceof Error) return `${caught.name} ${caught.message}`;
  if (typeof caught === 'string') return caught;
  if (caught === null || caught === undefined) return '';
  try {
    return JSON.stringify(caught);
  } catch {
    return String(caught);
  }
}

/**
 * Classe un échec observé.
 *
 * La détection est TEXTUELLE, et c'est une limite assumée : les wallets
 * remontent souvent des exceptions Java (dont `CancellationException`) sous
 * forme de message, sans code exploitable. Le code du protocole reste affiché
 * par ailleurs via `describeMwaError`, jamais remplacé par cette classification.
 */
export function classifyOperationFailure(input: {
  caught: unknown;
  step: MwaStep;
  /** Contexte : vrai si l'écran et le wallet ne sont pas sur le même réseau. */
  networkMismatch?: boolean;
}): OperationState {
  const text = asText(input.caught);

  // 1. Interruption de session : priorité absolue, jamais un succès.
  if (/CancellationException/i.test(text) || /session (interrupted|terminated)/i.test(text)) {
    return 'wallet-session-interrupted';
  }
  // 2. Refus explicite de l'utilisateur au moment de l'autorisation.
  if (
    input.step === 'authorize' &&
    /cancel|reject|declin|denied|refus|dismiss/i.test(text)
  ) {
    return 'authorization-cancelled';
  }
  // 3. Mauvais réseau (signalé par le contexte ou par le message du wallet).
  if (
    input.networkMismatch === true ||
    /network mismatch|wrong (network|cluster)|cluster mismatch|mainnet|devnet/i.test(text)
  ) {
    return 'network-mismatch';
  }
  // 4. Blockhash inutilisable avant toute signature.
  if (/blockhash/i.test(text) && /expired|not ?found|invalid|stale/i.test(text)) {
    return 'blockhash-expired-before-signing';
  }
  // 5. Tout le reste : échec d'envoi sans signature.
  return 'send-failed-before-signature';
}

/** État déduit des preuves disponibles — jamais optimiste. */
export function classifyOperationResult(evidence: OperationEvidence): OperationState {
  if (!evidence.signatureObtained) return 'send-failed-before-signature';
  if (!evidence.confirmed) return 'signature-obtained-confirmation-pending';
  if (!evidence.readBackVerified) return 'transaction-confirmed-readback-failed';
  return 'operation-created-and-verified';
}

/** Actions autorisées, dérivées de l'état et des preuves. */
export function actionsForState(
  state: OperationState,
  evidence: OperationEvidence,
): OperationActions {
  const noProof: OperationActions = {
    allowCheckAgain: false,
    allowPrepareAndRetry: true,
    allowReconnect: true,
    allowSecondSend: false,
    keepDraft: true,
    rearmAttemptLock: true,
  };

  // Cohérence : un état « post-signature » sans signature prouvée retombe sur
  // le comportement d'un échec d'envoi. On ne fait jamais avancer l'état sur
  // une preuve manquante.
  const postSignature =
    state === 'signature-obtained-confirmation-pending' ||
    state === 'transaction-confirmed-readback-failed' ||
    state === 'operation-created-and-verified';
  if (postSignature && !evidence.signatureObtained) return noProof;

  switch (state) {
    case 'authorization-cancelled':
    case 'wallet-session-interrupted':
    case 'network-mismatch':
    case 'blockhash-expired-before-signing':
    case 'send-failed-before-signature':
      return noProof;
    case 'signature-obtained-confirmation-pending':
      // Une signature existe : jamais de second envoi, seulement une relecture.
      return {
        allowCheckAgain: true,
        allowPrepareAndRetry: false,
        allowReconnect: false,
        allowSecondSend: false,
        keepDraft: true,
        rearmAttemptLock: false,
      };
    case 'transaction-confirmed-readback-failed':
      return {
        allowCheckAgain: true,
        allowPrepareAndRetry: false,
        allowReconnect: false,
        allowSecondSend: false,
        keepDraft: true,
        rearmAttemptLock: false,
      };
    case 'operation-created-and-verified':
      return {
        allowCheckAgain: false,
        allowPrepareAndRetry: false,
        allowReconnect: false,
        allowSecondSend: false,
        keepDraft: false,
        rearmAttemptLock: false,
      };
    default:
      return noProof;
  }
}

export function buildOperationReport(input: {
  state: OperationState;
  caught?: unknown;
  step?: MwaStep;
  evidence?: OperationEvidence;
}): OperationReport {
  const evidence = input.evidence ?? {
    confirmed: false,
    readBackVerified: false,
    signatureObtained: false,
  };
  return {
    actions: actionsForState(input.state, evidence),
    evidence,
    mwa:
      input.caught === undefined
        ? null
        : describeMwaError(input.caught, input.step ?? 'unknown'),
    state: input.state,
    title: TITLES[input.state],
  };
}

export type SignatureConfirmationStatus = 'confirmed' | 'pending' | 'failed' | 'notFound';

/**
 * Décide si un nouvel envoi est permis après qu'une signature a existé.
 *
 * Autorisé uniquement s'il est PROUVÉ que la transaction est absente et
 * définitivement expirée, ou qu'elle a échoué. Tant qu'elle peut encore être
 * traitée, un second envoi est refusé : le risque est un doublon, pas un
 * raté — c'est le sens de la règle B.
 */
export function evaluateSignatureEvidence(input: {
  status: SignatureConfirmationStatus;
  blockHeight: number | null;
  lastValidBlockHeight: number | null;
}): { retryAllowed: boolean; reason: string } {
  if (input.status === 'confirmed') {
    return {
      reason: 'The transaction is confirmed on-chain: it must not be sent again.',
      retryAllowed: false,
    };
  }
  if (input.status === 'pending') {
    return {
      reason: 'The transaction is still pending: wait and check again before any retry.',
      retryAllowed: false,
    };
  }
  if (input.status === 'failed') {
    return {
      reason: 'The transaction is confirmed as failed on-chain: a new attempt is allowed.',
      retryAllowed: true,
    };
  }

  const expired =
    input.blockHeight !== null &&
    input.lastValidBlockHeight !== null &&
    input.blockHeight > input.lastValidBlockHeight;
  if (expired) {
    return {
      reason:
        'The blockhash is expired and the signature is unknown to the cluster: a fresh attempt is allowed.',
      retryAllowed: true,
    };
  }
  return {
    reason:
      'The signature is not found yet but the blockhash is still valid: it may still land, so no retry is allowed.',
    retryAllowed: false,
  };
}