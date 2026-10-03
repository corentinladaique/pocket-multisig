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

/**
 * Onboarding pédagogique : AUCUN wallet, aucune signature, aucune transaction,
 * aucun appel RPC. Le profil reste sur l'appareil.
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
        <Text style={styles.badge}>DEVNET · LEARNING</Text>
        <Text style={styles.title}>
          {step === 0 ? 'Quick questions' : (lesson?.title ?? 'Learn about multisig')}
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
                  <View style={styles.optionRow}>
                    <Text style={styles.optionText}>{option.label}</Text>
                    {selected ? <Text style={styles.optionCheck}>✓</Text> : null}
                  </View>
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
                  <View style={styles.optionRow}>
                    <Text style={styles.optionText}>{option.label}</Text>
                    {selected ? <Text style={styles.optionCheck}>✓</Text> : null}
                  </View>
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
              style={styles.button}
            >
              <Text style={styles.buttonText}>Finish</Text>
            </Pressable>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Next"
              accessibilityState={{ disabled: !canAdvance }}
              disabled={!canAdvance}
              onPress={onNext}
              style={[styles.button, !canAdvance && styles.buttonDisabled]}
            >
              <Text style={!canAdvance ? styles.buttonTextDisabled : styles.buttonText}>Next</Text>
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
  actions: { flexDirection: 'row', gap: 8, marginTop: 16, width: '100%' },
  badge: { color: '#1a56db', fontSize: 12, fontWeight: '800', letterSpacing: 1 },
  block: { marginTop: 12, width: '100%' },
  bullet: { color: '#374151', fontSize: 14, marginTop: 6 },
  button: {
    alignItems: 'center',
    backgroundColor: '#1a56db',
    borderRadius: 10,
    flexGrow: 1,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: 16,
  },
  // Contraste verifie : texte sombre sur fond desactive clair.
  buttonDisabled: { backgroundColor: '#e5e7eb' },
  buttonText: { color: '#ffffff', fontSize: 15, fontWeight: '700' },
  buttonTextDisabled: { color: '#6b7280', fontSize: 15, fontWeight: '700' },
  container: { alignItems: 'center', padding: 24, paddingBottom: 96 },
  emphasis: {
    backgroundColor: '#eef2ff',
    borderRadius: 8,
    color: '#3730a3',
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 10,
    padding: 10,
    textAlign: 'center',
  },
  fieldLabel: { color: '#4b5563', fontSize: 13, fontWeight: '700', marginTop: 16 },
  footNote: { color: '#6b7280', fontSize: 12, marginTop: 16, textAlign: 'center' },
  option: {
    backgroundColor: '#f9fafb',
    borderColor: '#d1d5db',
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 8,
    padding: 12,
    width: '100%',
  },
  // Coche en plus du style : l'etat selectionne ne depend pas de la couleur seule.
  optionCheck: { color: '#1a56db', fontSize: 16, fontWeight: '800', marginLeft: 8 },
  optionNote: { color: '#6b7280', fontSize: 12, marginTop: 4 },
  optionRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  optionSelected: { backgroundColor: '#e8f0fe', borderColor: '#1a56db', borderWidth: 2 },
  optionText: { color: '#101317', flexShrink: 1, fontSize: 15 },
  paragraph: { color: '#101317', fontSize: 15, marginTop: 8 },
  progress: { color: '#4b5563', fontSize: 13, marginTop: 6 },
  screen: { backgroundColor: '#ffffff', flex: 1, width: '100%' },
  secondary: { backgroundColor: '#f3f4f6', borderColor: '#d1d5db', borderWidth: 1 },
  secondaryText: { color: '#101317', fontSize: 15, fontWeight: '700' },
  title: { color: '#101317', fontSize: 22, fontWeight: '800', marginTop: 10, textAlign: 'center' },
  warning: { color: '#7c2d12', fontSize: 13, fontWeight: '700', marginTop: 12 },
});
