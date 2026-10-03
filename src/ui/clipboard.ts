/**
 * Presse-papiers — SEUL fichier du projet qui touche à l'API Clipboard.
 *
 * Réutilise le module Clipboard embarqué dans le coeur de React Native 0.86,
 * importé par son chemin interne car le typage public n'expose plus les
 * méthodes. Aucune dépendance ajoutée, aucun rebuild natif.
 *
 * Aucun accès réseau, aucun wallet. La lecture n'a lieu QUE sur un tap
 * explicite « Paste » ; l'écriture uniquement sur un tap explicite « Copy ».
 * Rien n'est journalisé ni transmis.
 */

type ClipboardApi = {
  getString(): Promise<string>;
  setString(text: string): void;
};

const clipboardModule = require('react-native/Libraries/Components/Clipboard/Clipboard') as {
  default?: ClipboardApi;
} & ClipboardApi;

const Clipboard: ClipboardApi = clipboardModule.default ?? clipboardModule;

/** Message de confirmation affiché après une copie réussie. */
export const COPIED_MESSAGE = 'Address copied.';

/** Message affiché quand la copie lève une erreur (jamais silencieuse). */
export const COPY_FAILED_MESSAGE = 'Copy failed on this device. Select the address instead.';

/**
 * Lit le presse-papiers. Retourne `null` si la lecture échoue : l'appelant
 * décide du message, rien n'est avalé silencieusement.
 */
export async function readClipboardText(): Promise<string | null> {
  try {
    return await Clipboard.getString();
  } catch {
    return null;
  }
}

/**
 * Copie une valeur dans le presse-papiers. Retourne `true` en cas de succès,
 * `false` sinon : l'appelant décide du feedback.
 */
export function copyToClipboard(text: string): boolean {
  try {
    Clipboard.setString(text);
    return true;
  } catch {
    return false;
  }
}
