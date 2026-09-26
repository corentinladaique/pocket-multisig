import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { screensForLevel } from '../onboarding/content';
import {
  DEFAULT_PROFILE,
  GOAL_LABELS,
  isQuestComplete,
  LEARNING_GOALS,
  LEVEL_LABELS,
  LEARNING_LEVELS,
  personalizedSummary,
  SIGNING_MEAN_COMPATIBILITY,
  SIGNING_MEAN_DESCRIPTIONS,
  SIGNING_MEAN_LABELS,
  SIGNING_MEANS,
  totalSteps,
  type LearningGoal,
  type LearningLevel,
  type LearningProfile,
  type SigningMean,
} from '../onboarding/profile';
import { SAFE_TOP_PADDING } from '../ui/safeAreaPadding';

/**
 * Onboarding pédagogique : AUCUN wallet, aucune signature, aucune transaction,
 * aucun appel RPC. Le profil reste sur l'appareil.
 *
 * Étape unique de profil (3 questions) puis les leçons du niveau choisi ; le
 * compteur « Step X of Y » utilise le parcours réellement sélectionné.
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
  const [profile, setProfile] = useState<LearningProfile>(
    initialProfile.onboardingCompleted ? DEFAULT_PROFILE : initialProfile,
  );
  // Rien n'est présélectionné : tant que l'utilisateur n'a pas choisi, la
  // sélection est absente et le bouton Next reste désactivé.
  const [touched, setTouched] = useState(false);

  const lessons = useMemo(() => screensForLevel(profile.level), [profile.level]);
  const lastStep = totalSteps(profile.level, lessons.length) - 1;
  const profileComplete = isQuestComplete(profile);
  const summaryLines = useMemo(() => personalizedSummary(profile), [profile]);

  const canAdvance = step === 0 ? profileComplete : true;
  const isLast = step === lastStep;

  const onNext = () => setStep((previous) => Math.min(previous + 1, lastStep));
  const onBack = () => setStep((previous) => Math.max(previous - 1, 0));

  const pickLevel = (level: LearningLevel) => {
    setTouched(true);
    setProfile((previous) => ({ ...previous, level }));
  };
  const pickGoal = (goal: LearningGoal) => {
    setTouched(true);
    setProfile((previous) => ({ ...previous, goal }));
  };
  const toggleMean = (mean: SigningMean) => {
    setTouched(true);
    setProfile((previous) => ({
      ...previous,
      signingMeans: previous.signingMeans.includes(mean)
        ? previous.signingMeans.filter((entry) => entry !== mean)
        : [...previous.signingMeans, mean],
    }));
  };

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
            {LEARNING_LEVELS.map((level) => (
              <Pressable
                accessibilityRole="button"
                key={level}
                onPress={() => pickLevel(level)}
                style={[styles.option, profile.level === level && touched && styles.optionSelected]}
              >
                <Text style={styles.optionText}>{LEVEL_LABELS[level]}</Text>
              </Pressable>
            ))}

            <Text style={styles.fieldLabel}>What do you want to do?</Text>
            {LEARNING_GOALS.map((goal) => (
              <Pressable
                accessibilityRole="button"
                key={goal}
                onPress={() => pickGoal(goal)}
                style={[styles.option, profile.goal === goal && styles.optionSelected]}
              >
                <Text style={styles.optionText}>{GOAL_LABELS[goal]}</Text>
              </Pressable>
            ))}

            <Text style={styles.fieldLabel}>Which signing methods can you use?</Text>
            {SIGNING_MEANS.map((mean) => (
              <Pressable
                accessibilityRole="button"
                key={mean}
                onPress={() => toggleMean(mean)}
                style={[
                  styles.option,
                  profile.signingMeans.includes(mean) && styles.optionSelected,
                ]}
              >
                <Text style={styles.optionText}>{SIGNING_MEAN_LABELS[mean]}</Text>
                <Text style={styles.optionNote}>{SIGNING_MEAN_DESCRIPTIONS[mean]}</Text>
                {mean === 'hardware-wallet' || mean === 'seed-vault' ? (
                  <Text style={styles.optionNote}>
                    {SIGNING_MEAN_COMPATIBILITY[mean]}
                  </Text>
                ) : null}
              </Pressable>
            ))}

            {!profileComplete ? (
              <Text style={styles.warning}>Choose an option to continue.</Text>
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
            onPress={() => onSkip(profile)}
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
              onPress={() => onFinish(profile)}
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
  optionNote: { color: '#6b7280', fontSize: 12, marginTop: 4 },
  optionSelected: { backgroundColor: '#e8f0fe', borderColor: '#1a56db', borderWidth: 2 },
  optionText: { color: '#101317', fontSize: 15 },
  paragraph: { color: '#101317', fontSize: 15, marginTop: 8 },
  progress: { color: '#4b5563', fontSize: 13, marginTop: 6 },
  screen: { backgroundColor: '#ffffff', flex: 1, width: '100%' },
  secondary: { backgroundColor: '#f3f4f6', borderColor: '#d1d5db', borderWidth: 1 },
  secondaryText: { color: '#101317', fontSize: 15, fontWeight: '700' },
  title: { color: '#101317', fontSize: 22, fontWeight: '800', marginTop: 10, textAlign: 'center' },
  warning: { color: '#7c2d12', fontSize: 13, fontWeight: '700', marginTop: 12 },
});