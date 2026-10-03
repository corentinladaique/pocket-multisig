import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { screensForLevel } from '../onboarding/content';
import {
  buildProfile,
  EMPTY_ANSWERS,
  GOAL_OPTIONS,
  isAnswersComplete,
  LEVEL_OPTIONS,
  selectGoal,
  selectLevel,
  SIGNING_MEAN_OPTIONS,
  toggleSigningMean,
  type OnboardingAnswers,
} from '../onboarding/answers';
import {
  personalizedSummary,
  SIGNING_MEAN_COMPATIBILITY,
  SIGNING_MEAN_DESCRIPTIONS,
  totalSteps,
  type LearningProfile,
} from '../onboarding/profile';
import { SAFE_TOP_PADDING } from '../ui/safeAreaPadding';
import { colors, radii, spacing, typography } from '../ui/theme';
import { DevnetPill, InfoText } from '../ui/v2/primitives';

/**
 * Onboarding pédagogique (UI V2 sombre) : AUCUN wallet, aucune signature, aucune
 * transaction, aucun appel RPC. Le profil reste sur l'appareil.
 *
 * Étape unique de profil (3 questions) puis les leçons du niveau choisi ; le
 * compteur « Step X of Y » utilise le parcours réellement sélectionné.
 *
 * Chaque option porte une identité STABLE (`option.id`), un libellé et SA
 * propre valeur : `onPress` enregistre `option.value`. Aucune option n'est
 * présélectionnée : ouvrir l'écran ne choisit jamais à la place de
 * l'utilisateur, et aucune réponse ne retombe silencieusement sur la première.
 */
export function OnboardingScreen({
  initialProfile,
  onSkip,
  onFinish,
}: {
  initialProfile: LearningProfile;
  onSkip: (profile: LearningProfile) => void;
  onFinish: (profile: LearningProfile) => void;
}) {
  const [step, setStep] = useState(0);
  // Réponses RÉELLEMENT choisies dans cette session. `null` = pas encore
  // répondu : rien n'est affiché comme sélectionné tant que l'utilisateur n'a
  // pas touché l'option. Réouverture depuis Home ⇒ questions à zéro.
  const [answers, setAnswers] = useState<OnboardingAnswers>(() =>
    initialProfile.onboardingCompleted
      ? { ...EMPTY_ANSWERS }
      : {
          goal: initialProfile.goal,
          level: null,
          signingMeans: [...initialProfile.signingMeans],
        },
  );
  // Concepts techniques : repliés par défaut (aucun PDA/blockhash au 1er niveau).
  const [conceptsOpen, setConceptsOpen] = useState(false);

  // Le niveau n'est JAMAIS pré-rempli : il ne sert au parcours (nombre d'étapes
  // et contenu) qu'après un choix explicite.
  const profile = useMemo(() => buildProfile(answers, false), [answers]);
  const lessons = useMemo(() => screensForLevel(profile.level), [profile.level]);
  const lastStep = totalSteps(profile.level, lessons.length) - 1;
  const complete = isAnswersComplete(answers);
  const summaryLines = useMemo(() => personalizedSummary(profile), [profile]);

  const canAdvance = step === 0 ? complete : true;
  const isLast = step === lastStep;

  const onNext = () => setStep((previous) => Math.min(previous + 1, lastStep));
  const onBack = () => setStep((previous) => Math.max(previous - 1, 0));

  // Profil transmis à Finish/Skip : construit depuis les réponses choisies.
  const publishProfile = () => buildProfile(answers, true);

  const lesson = step >= 1 ? lessons[step - 1] : null;

  return (
    <View style={[styles.screen, SAFE_TOP_PADDING]}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.headerRow}>
          {step > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Back"
              onPress={onBack}
              style={({ pressed }) => [styles.backButton, pressed && styles.backButtonPressed]}
            >
              <Text style={styles.backGlyph}>‹</Text>
            </Pressable>
          ) : (
            <View style={styles.backSpacer} />
          )}
          <DevnetPill />
        </View>

        <Text style={styles.title}>
          {step === 0 ? 'Learn about multisig' : (lesson?.title ?? 'Learn about multisig')}
        </Text>
        <Text style={styles.progress}>
          Step {step + 1} of {lastStep + 1}
        </Text>

        {step === 0 ? (
          <View style={styles.block}>
            <Text style={styles.fieldLabel}>How familiar are you with multisig?</Text>
            {LEVEL_OPTIONS.map((option) => {
              const selected = answers.level === option.value;
              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={option.label}
                  accessibilityState={{ selected }}
                  key={option.id}
                  onPress={() => setAnswers((previous) => selectLevel(previous, option))}
                  style={[styles.option, selected && styles.optionSelected]}
                >
                  <Text style={styles.optionText}>{option.label}</Text>
                  {selected ? <Text style={styles.optionCheck}>✓</Text> : null}
                </Pressable>
              );
            })}

            <Text style={styles.fieldLabel}>What do you want to do?</Text>
            {GOAL_OPTIONS.map((option) => {
              const selected = answers.goal === option.value;
              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={option.label}
                  accessibilityState={{ selected }}
                  key={option.id}
                  onPress={() => setAnswers((previous) => selectGoal(previous, option))}
                  style={[styles.option, selected && styles.optionSelected]}
                >
                  <Text style={styles.optionText}>{option.label}</Text>
                  {selected ? <Text style={styles.optionCheck}>✓</Text> : null}
                </Pressable>
              );
            })}

            <Text style={styles.fieldLabel}>Which signing methods can you use?</Text>
            {SIGNING_MEAN_OPTIONS.map((option) => {
              const selected = answers.signingMeans.includes(option.value);
              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={option.label}
                  accessibilityState={{ selected }}
                  key={option.id}
                  onPress={() => setAnswers((previous) => toggleSigningMean(previous, option))}
                  style={[styles.option, selected && styles.optionSelected]}
                >
                  <View style={styles.optionRow}>
                    <Text style={styles.optionText}>{option.label}</Text>
                    {selected ? <Text style={styles.optionCheck}>✓</Text> : null}
                  </View>
                  <Text style={styles.optionNote}>{SIGNING_MEAN_DESCRIPTIONS[option.value]}</Text>
                  {option.value === 'hardware-wallet' || option.value === 'seed-vault' ? (
                    <Text style={styles.optionNote}>
                      {SIGNING_MEAN_COMPATIBILITY[option.value]}
                    </Text>
                  ) : null}
                </Pressable>
              );
            })}

            {!complete ? <Text style={styles.warning}>Choose an option to continue.</Text> : null}

            {/* Concepts techniques : repliés par défaut, jamais au premier niveau. */}
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: conceptsOpen }}
              accessibilityLabel="Toggle technical concepts"
              onPress={() => setConceptsOpen((previous) => !previous)}
              style={styles.conceptsToggle}
            >
              <Text style={styles.conceptsToggleText}>
                {conceptsOpen ? '▾ Technical concepts' : '▸ Technical concepts'}
              </Text>
            </Pressable>
            {conceptsOpen ? (
              <View style={styles.conceptsBody}>
                <Text style={styles.conceptsHeading}>What is a multisig?</Text>
                <Text style={styles.paragraph}>A shared vault controlled by several wallets.</Text>
                <Text style={styles.paragraph}>Propose. Approve. Execute.</Text>
                <InfoText>
                  Example: two approvals can protect the treasury while one unavailable member
                  does not block the team. This is an example, not a universal rule.
                </InfoText>
              </View>
            ) : null}
          </View>
        ) : null}

        {lesson !== null ? (
          <View style={styles.block}>
            {lesson.emphasis !== undefined ? (
              <Text style={styles.emphasis}>{lesson.emphasis}</Text>
            ) : null}
            {lesson.body.map((paragraph) => (
              <Text key={paragraph} style={styles.paragraph}>
                {paragraph}
              </Text>
            ))}
            {lesson.bullets.map((bullet) => (
              <Text key={bullet} style={styles.bullet}>
                · {bullet}
              </Text>
            ))}
            {lesson.id === 'personalized-summary' ? (
              <>
                <Text style={styles.fieldLabel}>Your summary</Text>
                {summaryLines.map((line) => (
                  <Text key={line} style={styles.bullet}>
                    · {line}
                  </Text>
                ))}
              </>
            ) : null}
          </View>
        ) : null}

        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Skip onboarding"
            onPress={() => onSkip(publishProfile())}
            style={[styles.button, styles.secondary]}
          >
            <Text style={styles.secondaryText}>Skip</Text>
          </Pressable>
          {step > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Back"
              onPress={onBack}
              style={[styles.button, styles.secondary]}
            >
              <Text style={styles.secondaryText}>Back</Text>
            </Pressable>
          ) : null}
          {isLast ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Finish onboarding"
              onPress={() => onFinish(publishProfile())}
              style={[styles.button, styles.primary]}
            >
              <Text style={styles.primaryText}>Finish</Text>
            </Pressable>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Next"
              accessibilityState={{ disabled: !canAdvance }}
              disabled={!canAdvance}
              onPress={onNext}
              style={[styles.button, canAdvance ? styles.primary : styles.buttonDisabled]}
            >
              <Text style={canAdvance ? styles.primaryText : styles.buttonTextDisabled}>Next</Text>
            </Pressable>
          )}
        </View>

        <Text style={styles.footNote}>
          Your answers stay on this device and are never sent anywhere. You can reopen this from
          « Learn about multisig » on Home.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg, width: '100%' },
  backButton: {
    alignItems: 'center',
    backgroundColor: colors.surfaceElevated,
    borderRadius: radii.pill,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  backButtonPressed: { backgroundColor: colors.surface },
  backGlyph: { color: colors.text, fontSize: 24, lineHeight: 26 },
  backSpacer: { height: 40, width: 40 },
  block: { marginTop: spacing.md, width: '100%' },
  bullet: { color: colors.textSecondary, fontSize: typography.bodySmall, marginTop: spacing.sm },
  button: {
    alignItems: 'center',
    borderRadius: radii.button,
    flexGrow: 1,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: spacing.lg,
  },
  buttonDisabled: { backgroundColor: colors.disabled },
  buttonTextDisabled: { color: colors.disabledText, fontSize: typography.body, fontWeight: '700' },
  conceptsBody: {
    borderColor: colors.divider,
    borderRadius: 8,
    borderWidth: 1,
    marginTop: spacing.sm,
    padding: spacing.md,
  },
  conceptsHeading: {
    color: colors.text,
    fontSize: typography.bodySmall,
    fontWeight: '800',
    marginBottom: spacing.xs,
  },
  conceptsToggle: {
    alignItems: 'center',
    borderColor: colors.divider,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.xl,
    minHeight: 48,
    paddingHorizontal: spacing.lg - 2,
    paddingVertical: spacing.md,
  },
  conceptsToggleText: {
    color: colors.textSecondary,
    fontSize: typography.secondary,
    fontWeight: '700',
  },
  container: {
    alignItems: 'stretch',
    backgroundColor: colors.background,
    flexGrow: 1,
    padding: spacing.lg,
    paddingBottom: spacing.xxl * 2,
  },
  emphasis: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: 8,
    color: colors.mint,
    fontSize: typography.body,
    fontWeight: '800',
    marginBottom: spacing.sm,
    padding: spacing.md,
    textAlign: 'center',
  },
  fieldLabel: { color: colors.textMuted, fontSize: typography.secondary, fontWeight: '700', marginTop: spacing.lg },
  footNote: { color: colors.textMuted, fontSize: typography.caption, marginTop: spacing.lg, textAlign: 'center' },
  headerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.lg,
  },
  option: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.divider,
    borderRadius: radii.field,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
    minHeight: 52,
    padding: spacing.md,
    width: '100%',
  },
  // Coche en plus du style : l'etat selectionne ne depend pas de la couleur seule.
  optionCheck: { color: colors.mint, fontSize: 16, fontWeight: '800', marginLeft: spacing.sm },
  optionNote: { color: colors.textSecondary, fontSize: typography.secondary, marginTop: spacing.xs },
  optionRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  optionSelected: { backgroundColor: colors.surfaceElevated, borderColor: colors.mint },
  optionText: { color: colors.text, flexShrink: 1, fontSize: typography.body },
  paragraph: { color: colors.text, fontSize: typography.body, marginTop: spacing.sm },
  primary: { backgroundColor: colors.text },
  primaryText: { color: colors.onLight, fontSize: typography.body, fontWeight: '700' },
  progress: { color: colors.textMuted, fontSize: typography.caption, marginTop: spacing.xs },
  screen: { backgroundColor: colors.background, flex: 1, width: '100%' },
  secondary: { backgroundColor: colors.surface, borderColor: colors.divider, borderWidth: 1 },
  secondaryText: { color: colors.text, fontSize: typography.body, fontWeight: '700' },
  title: { color: colors.text, fontSize: typography.screenTitle - 10, fontWeight: '800', marginTop: spacing.sm },
  warning: { color: colors.warning, fontSize: typography.secondary, fontWeight: '700', marginTop: spacing.md },
});
