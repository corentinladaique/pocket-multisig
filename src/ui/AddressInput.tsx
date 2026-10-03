import { useState, type Ref } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';

import {
  ADDRESS_FIELD_HINT,
  parsePastedAddress,
  pasteErrorMessage,
} from './addressPaste';
import { readClipboardText } from './clipboard';
import { colors, radii, spacing, typography } from './theme';

/**
 * Champ d'adresse Solana partage (UI V2 sombre), avec « Paste » INTEGRE dans la
 * partie droite du champ.
 *
 * Regles de confidentialite (inchangees) :
 * - le presse-papiers n'est lu qu'apres un tap sur « Paste » (jamais au montage,
 *   jamais au focus, aucune surveillance) ;
 * - le contenu n'est jamais journalise, jamais transmis, jamais conserve
 *   ailleurs que dans le champ demande ;
 * - une valeur invalide est refusee sans correction ni troncature.
 *
 * Presentation : le champ occupe tout l'espace restant (flex: 1) et « Paste »
 * garde une largeur/taille tactile fixes a droite : il ne recouvre jamais
 * l'adresse, et le texte peut passer a la ligne sans debordement.
 *
 * API presse-papiers : centralisee dans `./clipboard` (module Clipboard du coeur
 * de React Native). Aucune dependance ajoutee, aucun rebuild natif necessaire.
 */

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
  onSubmitEditing,
  returnKeyType,
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
  /** Touche Entree du clavier : reutilise le meme handler que le bouton hote. */
  onSubmitEditing?: () => void;
  /** Apparence de la touche Entree (ex. « go »). */
  returnKeyType?: TextInputProps['returnKeyType'];
}) {
  const [error, setError] = useState<string | null>(null);

  const onPaste = async () => {
    const raw = await readClipboardText();
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
      <View
        style={[
          styles.field,
          error !== null && styles.fieldError,
          disabled && styles.fieldDisabled,
        ]}
      >
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
          onSubmitEditing={onSubmitEditing}
          placeholder={placeholder}
          placeholderTextColor={colors.textMuted}
          ref={inputRef}
          returnKeyType={returnKeyType}
          style={styles.input}
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
      </View>
      {error !== null ? <Text style={styles.error}>{error}</Text> : null}
      <Text style={styles.hint}>{ADDRESS_FIELD_HINT}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  error: { color: colors.warning, fontSize: typography.secondary, fontWeight: '700', marginTop: spacing.xs },
  // Conteneur du champ : le texte prend l'espace restant, Paste reste a droite.
  field: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.divider,
    borderRadius: radii.field,
    borderWidth: 1,
    flexDirection: 'row',
    marginTop: spacing.sm,
    minHeight: 52,
    paddingLeft: spacing.md,
    // Padding droit suffisant : l'adresse n'est jamais recouverte par Paste.
    paddingRight: spacing.xs,
    width: '100%',
  },
  fieldDisabled: { opacity: 0.6 },
  fieldError: { borderColor: colors.error, borderWidth: 2 },
  hint: { color: colors.textMuted, fontSize: typography.micro, marginTop: spacing.xs },
  input: {
    color: colors.text,
    flex: 1,
    fontSize: typography.bodySmall,
    minHeight: 48,
    paddingVertical: spacing.sm,
  },
  label: { color: colors.textMuted, fontSize: typography.secondary, fontWeight: '700' },
  // Taille tactile confortable, largeur stable, jamais de recouvrement du texte.
  paste: {
    alignItems: 'center',
    backgroundColor: colors.surfaceElevated,
    borderRadius: radii.pill,
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 64,
    paddingHorizontal: spacing.md,
  },
  pasteDisabled: { opacity: 0.5 },
  pasteText: { color: colors.mint, fontSize: typography.bodySmall, fontWeight: '700' },
  wrapper: { marginTop: spacing.md, width: '100%' },
});
