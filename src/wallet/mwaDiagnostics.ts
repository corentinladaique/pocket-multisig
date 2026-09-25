/**
 * Diagnostics MWA : rendre les échecs lisibles SANS toucher au comportement.
 *
 * Module PUR : aucun appel réseau, aucune signature, aucune transaction, aucun
 * accès wallet. Il ne fait que décrire des objets déjà en main (compte autorisé,
 * erreur remontée par le protocole) et qualifier l'étape concernée.
 *
 * Objectif : ne plus afficher « authorization request failed » tout court, mais
 * le code, le message et l'étape d'origine, plus un indice structurel — sans
 * jamais inventer de table de correspondance de codes.
 */

export const MWA_STEPS = [
  'authorize',
  'reauthorize',
  'signAndSendTransactions',
  'deauthorize',
  'readBack',
] as const;

export type MwaStep = (typeof MWA_STEPS)[number] | 'unknown';

export type MwaErrorReport = {
  /** Étape où l'échec a été observé. */
  step: MwaStep;
  /** Code du protocole MWA s'il existe (`SolanaMobileWalletAdapterProtocolError.code`). */
  code: string | null;
  /** Nom de la classe d'erreur, utile pour distinguer transport et protocole. */
  name: string | null;
  /** Message exact, jamais reformulé. */
  message: string;
  /** Charge additionnelle du protocole, sérialisée, si présente. */
  data: string | null;
  /** Indice structurel : ce que l'absence/présence d'un code permet de conclure. */
  hint: string;
};

export type WalletIdentityView = {
  label: string | null;
  address: string;
  /** URI de l'icône fournie par le wallet, `null` si le wallet n'en fournit pas. */
  iconUri: string | null;
};

const STEP_HINTS: Record<MwaStep, string> = {
  authorize:
    'The failure happened during the authorization handshake: no signature was requested and nothing was sent.',
  deauthorize: 'Only the session was being revoked: nothing was signed and nothing was sent.',
  reauthorize:
    'The stored authorization was being renewed: nothing was signed and nothing was sent.',
  readBack:
    'Reading back the on-chain result failed: this is an RPC side effect, never a signature step.',
  signAndSendTransactions:
    'A valid authorization is required before signing: a handshake failure here means nothing was signed and nothing was sent.',
  unknown: 'The failing step could not be identified.',
};

function safeStringify(value: unknown): string | null {
  if (value === undefined) return null;
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? null : serialized;
  } catch {
    return String(value);
  }
}

function readField(source: unknown, key: string): unknown {
  if (source === null || typeof source !== 'object') return undefined;
  return (source as Record<string, unknown>)[key];
}

/** Décrit le wallet réellement autorisé : label, adresse, icône si fournie. */
export function describeWalletIdentity(account: {
  address: string;
  label?: string | null;
  icon?: unknown;
}): WalletIdentityView {
  const iconValue = account.icon;
  let iconUri: string | null = null;
  if (typeof iconValue === 'string' && iconValue.length > 0) {
    iconUri = iconValue;
  } else if (iconValue !== null && typeof iconValue === 'object') {
    const uri = readField(iconValue, 'uri');
    if (typeof uri === 'string' && uri.length > 0) iconUri = uri;
  }

  return {
    address: account.address,
    iconUri,
    label:
      typeof account.label === 'string' && account.label.trim().length > 0
        ? account.label.trim()
        : null,
  };
}

/**
 * Décrit une erreur MWA sans la reformuler.
 *
 * Le message est repris tel quel ; le code n'est extrait que s'il existe
 * réellement. L'indice se limite à ce que la forme de l'erreur permet de
 * conclure : un code présent = refus au niveau du protocole ; un code absent =
 * échec côté application wallet ou transport MWA.
 */
export function describeMwaError(caught: unknown, step: MwaStep): MwaErrorReport {
  const rawCode = readField(caught, 'code');
  const code =
    typeof rawCode === 'string' || typeof rawCode === 'number' ? String(rawCode) : null;

  let message: string;
  if (caught instanceof Error) {
    message = caught.message;
  } else if (typeof caught === 'string') {
    message = caught;
  } else {
    message = safeStringify(caught) ?? 'Unknown MWA error';
  }

  const name =
    caught instanceof Error && typeof caught.name === 'string' ? caught.name : null;
  const data = safeStringify(readField(caught, 'data'));

  const codeHint =
    code === null
      ? 'No MWA protocol error code was returned: the failure came from the wallet application or the MWA transport, before any protocol-level rejection.'
      : 'A protocol-level error code was returned by the wallet: keep it verbatim when reporting.';

  return {
    code,
    data,
    hint: `${codeHint} ${STEP_HINTS[step]}`,
    message,
    name,
    step,
  };
}

/**
 * Mise en forme d'un échec sans jamais perdre l'information d'origine.
 *
 * Le message est repris VERBATIM ; le code est affiché même quand il est
 * absent (« none ») pour rendre l'absence explicite au lieu de la masquer.
 * Utilisé par les écrans pour un affichage homogène, jamais pour reformuler.
 */
export function formatMwaError(report: {
  step: MwaStep;
  code: string | null;
  message: string;
}): string {
  const message = report.message.trim().length > 0 ? report.message : '(empty message)';
  return `${report.step} failed · code: ${report.code ?? 'none'} · ${message}`;
}