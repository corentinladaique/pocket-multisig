import { PublicKey } from '@solana/web3.js';

/**
 * Règles de collage d'une adresse Solana. Module PUR : aucun accès au
 * presse-papiers, aucun réseau, aucun wallet.
 *
 * Le presse-papiers n'est lu QUE par un tap explicite sur « Paste » ; ce module
 * ne fait que valider et nettoyer la valeur fournie.
 */

export type PasteResult =
  | { ok: true; address: string }
  | { ok: false; reason: 'empty' | 'invalid' };

export const INVALID_PASTE_MESSAGE = 'Clipboard does not contain a valid Solana address.';
export const EMPTY_PASTE_MESSAGE = 'Clipboard is empty: nothing was pasted.';
export const ADDRESS_FIELD_HINT =
  'Paste a public Solana address only. Never paste a recovery phrase or private key.';

/**
 * Retire uniquement les espaces et retours a la ligne AVANT ou APRES la valeur.
 * Aucun caractere interne n'est modifie.
 */
export function trimExternalWhitespace(raw: string): string {
  return raw.replace(/^[\s\u00a0]+/, '').replace(/[\s\u00a0]+$/, '');
}

/**
 * Valide une adresse collee : nettoyage externe, puis conversion PublicKey.
 * Ne tente jamais de corriger ni de deviner une adresse, et ne tronque jamais
 * la valeur utilisee.
 */
export function parsePastedAddress(raw: string): PasteResult {
  const cleaned = trimExternalWhitespace(raw);
  if (cleaned.length === 0) return { ok: false, reason: 'empty' };
  try {
    const key = new PublicKey(cleaned);
    // `toBase58()` peut differer de l'entree si celle-ci contenait des
    // caracteres internes parasites : dans ce cas l'adresse n'est PAS acceptee.
    if (key.toBase58() !== cleaned) return { ok: false, reason: 'invalid' };
    return { address: cleaned, ok: true };
  } catch {
    return { ok: false, reason: 'invalid' };
  }
}

export function pasteErrorMessage(result: PasteResult): string | null {
  if (result.ok) return null;
  return result.reason === 'empty' ? EMPTY_PASTE_MESSAGE : INVALID_PASTE_MESSAGE;
}

/** Adresse deja presente dans la liste (doublon de membre). */
export function isDuplicateAddress(existing: string[], candidate: string): boolean {
  const target = trimExternalWhitespace(candidate);
  return existing.some((entry) => trimExternalWhitespace(entry) === target);
}

/** Ligne d'un membre deja ajoute portant la meme adresse. */
export function findMemberDuplicate(
  members: { address: string }[],
  candidate: string,
  ownIndex: number,
): number | null {
  const target = trimExternalWhitespace(candidate);
  if (target.length === 0) return null;
  const found = members.findIndex(
    (member, index) => index !== ownIndex && trimExternalWhitespace(member.address) === target,
  );
  return found === -1 ? null : found;
}

/**
 * Une adresse n'est utilisable que si elle est valide ET non vide : sert de
 * garde d'interface pour les boutons (jamais de valeur inventee).
 */
export function isUsableAddress(raw: string): boolean {
  return parsePastedAddress(raw).ok;
}