import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useMobileWallet } from '@wallet-ui/react-native-web3js';

import {
  createEmptyDraft,
  createMember,
  evaluateDraft,
  isDraftReady,
  isValidSolanaAddress,
  minMembersFor,
  SETUP_PRESETS,
  shortenMemberAddress,
  type SetupType,
  type VaultDraftInput,
  type VaultMemberDraft,
} from '../vault/vaultDraft';

/**
 * Assistant LOCAL de configuration d'un vault Squads personnel.
 *
 * Aucun RPC, aucune signature, aucune API de creation Squads, aucune
 * transaction. Le brouillon ne contient que des adresses publiques et des
 * labels : jamais de cle privee, de seed phrase ou de PIN.
 */

const STEP_COUNT = 5;
// Marge de confort au-dessus du clavier (aucune dimension d'ecran codee).
const FIELD_KEYBOARD_MARGIN = 24;

type MeasurableInput = TextInput & {
  measureInWindow?: (
    callback: (x: number, y: number, width: number, height: number) => void,
  ) => void;
};

export function CreateVaultScreen({ onCancel }: { onCancel: () => void }) {
  const { account } = useMobileWallet();

  const [step, setStep] = useState(1);
  const [vaultName, setVaultName] = useState('');
  const [setupType, setSetupType] = useState<SetupType | null>(null);
  const [members, setMembers] = useState<VaultMemberDraft[]>([]);
  const [threshold, setThreshold] = useState(1);

  const [pendingAddress, setPendingAddress] = useState('');
  const [pendingLabel, setPendingLabel] = useState('');
  const [pendingError, setPendingError] = useState<string | null>(null);

  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const memberCounter = useRef(0);

  // Suppression d'un signer : realigne le threshold sur le nombre de membres
  // restant pour ne jamais afficher un seuil inatteignable.
  useEffect(() => {
    setThreshold((current) => {
      const max = Math.max(members.length, 1);
      return current > max ? max : current;
    });
  }, [members.length]);

  const draftInput = useMemo<VaultDraftInput>(
    () => ({ ...createEmptyDraft(), vaultName, setupType: setupType ?? 'custom', members, threshold }),
    [members, setupType, threshold, vaultName],
  );
  const draft = useMemo(() => evaluateDraft(draftInput), [draftInput]);
  const ready = isDraftReady(draft);

  const walletAddress = account === undefined ? null : account.address.toString();
  const walletAlreadyMember =
    walletAddress !== null && members.some((member) => member.publicKey === walletAddress);

  // --- Clavier : meme mecanisme que l'ecran principal (evenement reel +
  // position mesuree). En edge-to-edge la fenetre n'est plus redimensionnee
  // par l'IME, le KeyboardAvoidingView "padding" fait le travail.
  const scrollViewRef = useRef<ScrollView>(null);
  const scrollOffsetRef = useRef(0);
  const fieldRefs = useRef<Record<string, TextInput | null>>({});
  const focusedFieldRef = useRef<string | null>(null);

  const registerField = useCallback(
    (key: string) => (instance: TextInput | null) => {
      fieldRefs.current[key] = instance;
    },
    [],
  );

  const onFieldFocus = useCallback(
    (key: string) => () => {
      focusedFieldRef.current = key;
    },
    [],
  );

  const onFieldBlur = useCallback(() => {
    focusedFieldRef.current = null;
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const subscription = Keyboard.addListener('keyboardDidShow', () => {
      const key = focusedFieldRef.current;
      const scroller = scrollViewRef.current;
      const field = key === null ? null : (fieldRefs.current[key] as MeasurableInput | null);
      if (key === null || scroller === null || field === null || field === undefined) return;
      // measureInWindow n'est pas expose par les types publics de ScrollView.
      const measurableScroller = scroller as unknown as MeasurableInput;
      measurableScroller.measureInWindow?.((_viewX, viewY) => {
        field.measureInWindow?.((_fieldX, fieldY) => {
          const targetY = Math.max(
            scrollOffsetRef.current + fieldY - viewY - FIELD_KEYBOARD_MARGIN,
            0,
          );
          if (__DEV__) {
            console.log('[vault] keyboardDidShow ; champ =', key, '; scrollTo.y =', targetY);
          }
          scroller.scrollTo({ animated: true, y: targetY });
        });
      });
    });
    return () => subscription.remove();
  }, []);

  // --- Actions du brouillon (aucun appel reseau).
  const chooseSetup = useCallback((type: SetupType, presetThreshold: number) => {
    setSetupType(type);
    setThreshold(presetThreshold);
  }, []);

  const addConnectedWallet = useCallback(() => {
    if (walletAddress === null) return;
    memberCounter.current += 1;
    const label = account?.label ?? 'Seeker wallet';
    setMembers((previous) => [
      ...previous,
      createMember({
        index: memberCounter.current,
        label,
        publicKey: walletAddress,
      }),
    ]);
  }, [account?.label, walletAddress]);

  const addPendingMember = useCallback(() => {
    const address = pendingAddress.trim();
    const label = pendingLabel.trim().length > 0 ? pendingLabel.trim() : 'Unlabelled signer';
    if (!isValidSolanaAddress(address)) {
      setPendingError('Invalid Solana public address.');
      return;
    }
    if (members.some((member) => member.publicKey === address)) {
      setPendingError('This public address is already a member.');
      return;
    }
    memberCounter.current += 1;
    setMembers((previous) => [
      ...previous,
      createMember({ index: memberCounter.current, label, publicKey: address }),
    ]);
    setPendingAddress('');
    setPendingLabel('');
    setPendingError(null);
  }, [members, pendingAddress, pendingLabel]);

  const removeMember = useCallback((id: string) => {
    setMembers((previous) => previous.filter((member) => member.id !== id));
    setRenameId((current) => (current === id ? null : current));
  }, []);

  const startRename = useCallback((member: VaultMemberDraft) => {
    setRenameId(member.id);
    setRenameValue(member.label);
  }, []);

  const commitRename = useCallback(() => {
    const id = renameId;
    if (id === null) return;
    const label = renameValue.trim();
    setMembers((previous) =>
      previous.map((member) =>
        member.id === id ? { ...member, label: label.length > 0 ? label : member.label } : member,
      ),
    );
    setRenameId(null);
  }, [renameId, renameValue]);

  const onScroll = useCallback((event: { nativeEvent: { contentOffset: { y: number } } }) => {
    scrollOffsetRef.current = event.nativeEvent.contentOffset.y;
  }, []);

  const goBack = useCallback(() => {
    setStep((previous) => Math.max(previous - 1, 1));
  }, []);

  const goNext = useCallback(() => {
    setStep((previous) => Math.min(previous + 1, STEP_COUNT));
  }, []);

  const requiredMembers = minMembersFor(setupType ?? 'custom');

  const canContinue =
    step === 1
      ? setupType !== null
      : step === 2
        ? members.length >= requiredMembers
        : step === 3
          ? threshold >= 1 && threshold <= members.length
          : step === 4
            ? draft.validationErrors.length === 0
            : true;

  return (
    <KeyboardAvoidingView behavior="padding" style={styles.keyboardAvoider}>
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        onScroll={onScroll}
        ref={scrollViewRef}
        scrollEventThrottle={16}
        style={styles.scrollView}
      >
        <View style={styles.headerRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cancel vault creation"
            hitSlop={{ bottom: 8, left: 8, right: 8, top: 8 }}
            onPress={onCancel}
            style={styles.headerCancel}
          >
            <Text style={styles.retryText}>Cancel and back to inbox</Text>
          </Pressable>
        </View>

        <Text style={styles.badge}>DEVNET</Text>
        <Text style={styles.title}>Create a vault</Text>
        <Text style={styles.stepBar}>Step {step} of {STEP_COUNT}</Text>

        {step === 1 ? (
          <View style={styles.block}>
            <Text style={styles.blockTitle}>Choose your setup</Text>
            {SETUP_PRESETS.map((preset) => (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: setupType === preset.type }}
                key={preset.type}
                onPress={() => chooseSetup(preset.type, preset.threshold)}
                style={[styles.option, setupType === preset.type && styles.optionSelected]}
              >
                <Text style={styles.optionTitle}>{preset.title}</Text>
                <Text style={styles.optionDetail}>{preset.detail}</Text>
              </Pressable>
            ))}

            <Text style={styles.fieldLabel}>Vault name</Text>
            <TextInput
              autoCapitalize="words"
              onChangeText={setVaultName}
              onBlur={onFieldBlur}
              onFocus={onFieldFocus('vaultName')}
              placeholder="Personal vault"
              placeholderTextColor="#9ca3af"
              ref={registerField('vaultName')}
              style={styles.input}
              value={vaultName}
            />
          </View>
        ) : null}

        {step === 2 ? (
          <View style={styles.block}>
            <Text style={styles.blockTitle}>Add signers</Text>

            {walletAddress !== null ? (
              walletAlreadyMember ? (
                <Text style={styles.hint}>Your connected wallet is already a signer.</Text>
              ) : (
                <Pressable
                  accessibilityRole="button"
                  onPress={addConnectedWallet}
                  style={[styles.button, styles.secondary]}
                >
                  <Text style={styles.secondaryText}>
                    Add connected wallet ({shortenMemberAddress(walletAddress)})
                  </Text>
                </Pressable>
              )
            ) : (
              <Text style={styles.hint}>
                No wallet connected: add signers manually below.
              </Text>
            )}

            <Text style={styles.fieldLabel}>Public address</Text>
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={setPendingAddress}
              onBlur={onFieldBlur}
              onFocus={onFieldFocus('pendingAddress')}
              placeholder="Solana public address"
              placeholderTextColor="#9ca3af"
              ref={registerField('pendingAddress')}
              style={styles.input}
              value={pendingAddress}
            />

            <Text style={styles.fieldLabel}>Label</Text>
            <TextInput
              autoCapitalize="words"
              onChangeText={setPendingLabel}
              onBlur={onFieldBlur}
              onFocus={onFieldFocus('pendingLabel')}
              placeholder="Ledger at home"
              placeholderTextColor="#9ca3af"
              ref={registerField('pendingLabel')}
              style={styles.input}
              value={pendingLabel}
            />

            <Pressable
              accessibilityRole="button"
              onPress={addPendingMember}
              style={[styles.button, styles.secondary]}
            >
              <Text style={styles.secondaryText}>Add signer</Text>
            </Pressable>

            {pendingError !== null ? <Text style={styles.errorText}>{pendingError}</Text> : null}

            <Text style={styles.blockTitle}>
              Signers ({members.length} of {requiredMembers} required)
            </Text>
            {members.length < requiredMembers ? (
              <Text style={styles.warningText}>
                {setupType === 'recommended'
                  ? 'Recommended setup requires 3 signers.'
                  : `At least ${requiredMembers} signers are required.`}
              </Text>
            ) : null}
            {members.map((member) => (
              <View key={member.id} style={styles.memberRow}>
                {renameId === member.id ? (
                  <View style={styles.renameBlock}>
                    <TextInput
                      autoCapitalize="words"
                      onChangeText={setRenameValue}
                      onBlur={onFieldBlur}
                      onFocus={onFieldFocus(`rename-${member.id}`)}
                      ref={registerField(`rename-${member.id}`)}
                      style={styles.input}
                      value={renameValue}
                    />
                    <Pressable accessibilityRole="button" onPress={commitRename} style={styles.retry}>
                      <Text style={styles.retryText}>Save label</Text>
                    </Pressable>
                  </View>
                ) : (
                  <>
                    <Text style={styles.memberLabel}>{member.label}</Text>
                    <Text style={styles.memberAddress}>
                      {shortenMemberAddress(member.publicKey)}
                    </Text>
                    <View style={styles.memberActions}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Rename ${member.label}`}
                        onPress={() => startRename(member)}
                        style={styles.retry}
                      >
                        <Text style={styles.retryText}>Rename</Text>
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Remove ${member.label}`}
                        onPress={() => removeMember(member.id)}
                        style={styles.retry}
                      >
                        <Text style={styles.retryText}>Remove</Text>
                      </Pressable>
                    </View>
                  </>
                )}
              </View>
            ))}

            {draft.validationErrors.length > 0 ? (
              <View style={styles.errorBox}>
                {draft.validationErrors.map((message) => (
                  <Text key={message} style={styles.errorText}>{message}</Text>
                ))}
              </View>
            ) : null}
          </View>
        ) : null}

        {step === 3 ? (
          <View style={styles.block}>
            <Text style={styles.blockTitle}>Threshold</Text>
            <Text style={styles.hint}>
              How many signers must approve before anything can move?
            </Text>
            {members.length === 0 ? (
              <Text style={styles.hint}>Add signers first.</Text>
            ) : (
              <View style={styles.kindRow}>
                {Array.from({ length: members.length }, (_entry, index) => index + 1).map((value) => (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ selected: threshold === value }}
                    key={value}
                    onPress={() => setThreshold(value)}
                    style={[styles.kindChip, threshold === value && styles.kindChipSelected]}
                  >
                    <Text style={styles.kindChipText}>{value}</Text>
                  </Pressable>
                ))}
              </View>
            )}
            <Text style={styles.fieldValue}>
              {threshold} of {members.length} approvals required.
            </Text>
            <Text style={styles.hint}>
              Example: 2 of 3 means any two signers can approve, so one lost signer is
              survivable. 2 of 2 is stricter: both signers are always needed.
            </Text>
          </View>
        ) : null}

        {step === 4 ? (
          <View style={styles.block}>
            <Text style={styles.blockTitle}>Security check</Text>

            <Text style={styles.checkLine}>
              {draft.validationErrors.length === 0 ? '✓ ' : '✗ '}
              Public addresses valid, no duplicates
            </Text>
            <Text style={styles.checkLine}>
              {members.length >= 2 ? '✓ ' : '✗ '}
              At least two members ({members.length})
            </Text>
            <Text style={styles.checkLine}>
              {threshold >= 1 && threshold <= members.length ? '✓ ' : '✗ '}
              Threshold {threshold} within 1..{members.length}
            </Text>

            {draft.validationErrors.map((message) => (
              <Text key={message} style={styles.errorText}>{message}</Text>
            ))}
            {draft.validationWarnings.map((message) => (
              <Text key={message} style={styles.warningText}>{message}</Text>
            ))}

            <View style={styles.noticeBox}>
              <Text style={styles.noticeText}>
                Verify every hardware wallet address on the device itself.
              </Text>
              <Text style={styles.noticeText}>
                Pocket Multisig never asks for recovery phrases or private keys.
              </Text>
            </View>
          </View>
        ) : null}

        {step === 5 ? (
          <View style={styles.block}>
            <Text style={styles.blockTitle}>Review</Text>

            <Text style={styles.fieldLabel}>Vault name</Text>
            <Text style={styles.fieldValue}>
              {vaultName.trim().length > 0 ? vaultName.trim() : 'Untitled vault'}
            </Text>

            <Text style={styles.fieldLabel}>Members ({members.length})</Text>
            {members.map((member) => (
              <View key={member.id} style={styles.reviewMember}>
                <Text style={styles.memberLabel}>
                  {member.label}
                </Text>
                <Text selectable style={styles.fieldValue}>{member.publicKey}</Text>
              </View>
            ))}

            <Text style={styles.fieldLabel}>Threshold</Text>
            <Text style={styles.fieldValue}>
              {threshold} of {members.length}
            </Text>

            <Text style={styles.fieldLabel}>Planned permissions</Text>
            <Text style={styles.fieldValue}>
              Permissions will be configured during creation.
            </Text>

            <Text style={styles.fieldLabel}>Network</Text>
            <Text style={styles.fieldValue}>Devnet</Text>

            <Text style={styles.fieldLabel}>Status</Text>
            <Text style={ready ? styles.statusReady : styles.warningText}>
              {ready ? 'Ready to create' : 'Not ready yet — see below'}
            </Text>

            {/* Erreurs bloquantes et avertissements rappeles ici : la revue doit
                rester lisible sans revenir a l'etape Security check. */}
            {draft.validationErrors.length > 0 ? (
              <View style={styles.errorBox}>
                {draft.validationErrors.map((message) => (
                  <Text key={message} style={styles.errorText}>{message}</Text>
                ))}
              </View>
            ) : null}

            {draft.validationWarnings.length > 0 ? (
              <View style={styles.noticeBox}>
                {draft.validationWarnings.map((message) => (
                  <Text key={message} style={styles.warningText}>{message}</Text>
                ))}
              </View>
            ) : null}

            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: true }}
              disabled
              style={[styles.button, styles.disabled]}
            >
              <Text style={styles.buttonText}>Create on Devnet — not available yet</Text>
            </Pressable>

            <Text style={styles.hint}>
              Nothing is sent on-chain in this phase: no RPC call, no signature.
            </Text>
          </View>
        ) : null}

        <View style={styles.navRow}>
          {step > 1 ? (
            <Pressable
              accessibilityRole="button"
              onPress={goBack}
              style={[styles.navButton, styles.secondary]}
            >
              <Text style={styles.secondaryText}>Back</Text>
            </Pressable>
          ) : null}
          {step < STEP_COUNT ? (
            <Pressable
              accessibilityRole="button"
              disabled={!canContinue}
              onPress={goNext}
              style={[styles.navButton, !canContinue && styles.disabled]}
            >
              <Text style={styles.buttonText}>Continue</Text>
            </Pressable>
          ) : null}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  keyboardAvoider: {
    flex: 1,
    width: '100%',
  },
  scrollView: {
    flex: 1,
    width: '100%',
  },
  container: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    flexGrow: 1,
    padding: 24,
    paddingBottom: 96,
  },
  // En-tete du wizard : Cancel reste accessible sans scroller.
  headerRow: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    justifyContent: 'flex-start',
  },
  headerCancel: {
    paddingVertical: 8,
  },
  badge: {
    backgroundColor: '#e8f0fe',
    borderRadius: 999,
    color: '#1a56db',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 8,
    overflow: 'hidden',
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 4,
  },
  stepBar: {
    color: '#6b7280',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 20,
    textTransform: 'uppercase',
  },
  block: {
    alignSelf: 'stretch',
  },
  blockTitle: {
    color: '#111827',
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 8,
    marginTop: 16,
  },
  option: {
    backgroundColor: '#f9fafb',
    borderColor: '#e5e7eb',
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 8,
    padding: 14,
  },
  optionSelected: {
    borderColor: '#1a56db',
    borderWidth: 2,
  },
  optionTitle: {
    color: '#111827',
    fontSize: 15,
    fontWeight: '800',
  },
  optionDetail: {
    color: '#4b5563',
    fontSize: 13,
    marginTop: 2,
  },
  fieldLabel: {
    color: '#6b7280',
    fontSize: 11,
    marginTop: 12,
    textTransform: 'uppercase',
  },
  fieldValue: {
    color: '#101317',
    fontSize: 13,
    marginTop: 2,
  },
  input: {
    borderColor: '#d1d5db',
    borderRadius: 10,
    borderWidth: 1,
    color: '#101317',
    fontSize: 13,
    marginTop: 6,
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  kindRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  kindChip: {
    alignItems: 'center',
    borderColor: '#d1d5db',
    borderRadius: 999,
    borderWidth: 1,
    minHeight: 40,
    minWidth: 64,
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  kindChipSelected: {
    backgroundColor: '#e8f0fe',
    borderColor: '#1a56db',
  },
  kindChipText: {
    color: '#111827',
    fontSize: 13,
    fontWeight: '700',
  },
  button: {
    alignItems: 'center',
    backgroundColor: '#1a56db',
    borderRadius: 10,
    justifyContent: 'center',
    marginTop: 12,
    minHeight: 48,
    paddingHorizontal: 24,
    width: '100%',
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'center',
  },
  secondary: {
    backgroundColor: '#f3f4f6',
    borderColor: '#d1d5db',
    borderWidth: 1,
  },
  secondaryText: {
    color: '#101317',
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'center',
  },
  disabled: {
    opacity: 0.5,
  },
  navRow: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    gap: 12,
    marginTop: 24,
  },
  navButton: {
    alignItems: 'center',
    backgroundColor: '#1a56db',
    borderRadius: 10,
    flex: 1,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: 16,
  },
  hint: {
    color: '#6b7280',
    fontSize: 13,
    marginTop: 8,
  },
  memberRow: {
    alignSelf: 'stretch',
    backgroundColor: '#f9fafb',
    borderColor: '#e5e7eb',
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 8,
    padding: 12,
  },
  memberLabel: {
    color: '#111827',
    fontSize: 14,
    fontWeight: '700',
  },
  memberAddress: {
    color: '#4b5563',
    fontFamily: 'monospace',
    fontSize: 12,
    marginTop: 2,
  },
  memberActions: {
    flexDirection: 'row',
    gap: 16,
  },
  renameBlock: {
    alignSelf: 'stretch',
  },
  reviewMember: {
    borderTopColor: '#e5e7eb',
    borderTopWidth: 1,
    marginTop: 8,
    paddingTop: 8,
  },
  checkLine: {
    color: '#111827',
    fontSize: 14,
    marginTop: 6,
  },
  noticeBox: {
    backgroundColor: '#eef2ff',
    borderColor: '#c7d2fe',
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 16,
    padding: 12,
  },
  noticeText: {
    color: '#312e81',
    fontSize: 13,
    marginTop: 4,
  },
  errorBox: {
    backgroundColor: '#fef2f2',
    borderColor: '#fecaca',
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 12,
    padding: 12,
  },
  errorText: {
    color: '#991b1b',
    fontSize: 13,
    marginTop: 4,
  },
  warningText: {
    color: '#92400e',
    fontSize: 13,
    marginTop: 4,
  },
  statusReady: {
    color: '#065f46',
    fontSize: 14,
    fontWeight: '800',
    marginTop: 2,
  },
  retry: {
    alignItems: 'center',
    marginTop: 12,
    paddingVertical: 8,
  },
  retryText: {
    color: '#1a56db',
    fontSize: 15,
    fontWeight: '600',
  },
});