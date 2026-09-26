import { useState, type Ref } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  ADDRESS_FIELD_HINT,
  parsePastedAddress,
  pasteErrorMessage,
} from './addressPaste';

/**
 * Champ d'adresse Solana partage, avec bouton « Paste » EXPLICITE.
 *
 * Regles de confidentialite :
 * - le presse-papiers n'est lu qu'apres un tap sur « Paste » (jamais au montage,
 *   jamais au focus, aucune surveillance) ;
 * - le contenu n'est jamais journalise, jamais transmis, jamais conserve
 *   ailleurs que dans le champ demande ;
 * - une valeur invalide est refusee sans correction ni troncature.
 *
 * API presse-papiers : module Clipboard embarque dans le coeur de React Native
 * 0.86, importe par son chemin interne car le typage public ne expose plus les
 * methodes. Aucune dependance ajoutee, aucun rebuild natif necessaire.
 */
type ClipboardApi = { getString(): Promise<string> };

const clipboardModule = require('react-native/Libraries/Components/Clipboard/Clipboard') as {
  default?: ClipboardApi;
} & ClipboardApi;
const Clipboard: ClipboardApi = clipboardModule.default ?? clipboardModule;

export function AddressInput({
  value,
  onChangeText,
  label,
  placeholder,
  testID,
  disabled = false,
  inputRef,
  onFocus,
  onBlur,
}: {
  value: string;
  onChangeText: (next: string) => void;
  label: string;
  placeholder?: string;
  testID?: string;
  /** Remplace `editable` : desactive la saisie ET le bouton Paste. */
  disabled?: boolean;
  /** Conserve la logique clavier existante de l'ecran hote. */
  inputRef?: Ref<TextInput>;
  onFocus?: () => void;
  onBlur?: () => void;
}) {
  const [error, setError] = useState<string | null>(null);

  const onPaste = async () => {
    let raw: string | null = null;
    try {
      raw = await Clipboard.getString();
    } catch {
      raw = null;
    }
    if (raw === null) {
      setError(pasteErrorMessage({ ok: false, reason: 'empty' }));
      return;
    }
    const result = parsePastedAddress(raw);
    if (!result.ok) {
      // Aucune correction, aucune troncature, aucun RPC.
      setError(pasteErrorMessage(result));
      return;
    }
    setError(null);
    // Remplit le champ UNIQUEMENT : aucun chargement, aucune proposition.
    onChangeText(result.address);
  };

  return (
    <View style={styles.wrapper}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        editable={!disabled}
        onBlur={onBlur}
        onChangeText={(next) => {
          setError(null);
          onChangeText(next);
        }}
        onFocus={onFocus}
        placeholder={placeholder}
        ref={inputRef}
        style={[styles.input, error !== null && styles.inputError]}
        testID={testID}
        value={value}
      />
      <Pressable
        accessibilityLabel={`Paste a Solana address into ${label}`}
        accessibilityRole="button"
        disabled={disabled}
        onPress={() => {
          void onPaste();
        }}
        style={[styles.paste, disabled && styles.pasteDisabled]}
      >
        <Text style={styles.pasteText}>Paste</Text>
      </Pressable>
      {error !== null ? <Text style={styles.error}>{error}</Text> : null}
      <Text style={styles.hint}>{ADDRESS_FIELD_HINT}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  error: { color: '#7c2d12', fontSize: 13, fontWeight: '700', marginTop: 6 },
  hint: { color: '#6b7280', fontSize: 11, marginTop: 4 },
  input: {
    backgroundColor: '#ffffff',
    borderColor: '#d1d5db',
    borderRadius: 10,
    borderWidth: 1,
    color: '#101317',
    fontSize: 14,
    marginTop: 6,
    padding: 10,
    width: '100%',
  },
  inputError: { borderColor: '#b91c1c', borderWidth: 2 },
  label: { color: '#4b5563', fontSize: 13, fontWeight: '700' },
  paste: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: '#f3f4f6',
    borderColor: '#d1d5db',
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 8,
    minHeight: 40,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  pasteDisabled: { opacity: 0.5 },
  pasteText: { color: '#1a56db', fontSize: 14, fontWeight: '700' },
  wrapper: { marginTop: 12, width: '100%' },
});