import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ONBOARDING_SCREENS, screensForLevel } from '../onboarding/content';
import {
  LEARNING_GOALS,
  LEARNING_LEVELS,
  PRIORITIES,
  SIGNING_MEANS,
  DEFAULT_PROFILE,
  personalizedSummary,
  type LearningGoal,
  type LearningLevel,
  type LearningPriority,
  type LearningProfile,
  type SigningMean,
} from '../onboarding/profile';
import { SAFE_TOP_PADDING } from '../ui/safeAreaPadding';

/**
 * Onboarding pédagogique. AUCUN wallet, aucune signature, aucune transaction,
 * aucun appel RPC : cet écran ne fait que lire et écrire un profil local.
 */

const LEVEL_LABELS: Record<LearningLevel, string> = {
  advanced: 'Advanced user',
  familiar: 'Familiar with crypto wallets',
  'new-to-multisig': 'New to multisig',
};

const GOAL_LABELS: Record<LearningGoal, string> = {
  'business-or-team': 'Business or team treasury',
  'learn-and-test': 'Learn and test on Devnet',
  'manage-shared-funds': 'Manage shared funds',
  'protect-personal-savings': 'Protect personal savings',
};

const MEAN_LABELS: Record<SigningMean, string> = {
  'hardware-wallet': 'Hardware wallet',
  'multiple-mobile-wallets': 'Multiple mobile wallets',
  'one-mobile-wallet': 'One mobile wallet',
  'seed-vault': 'Seed Vault',
  'trusted-co-signers': 'Trusted co-signers',
};

const PRIORITY_LABELS: Record<LearningPriority, string> = {
  'learning-first': 'Learning first',
  'recovery-and-resilience': 'Recovery and resilience',
  simplicity: 'Simplicity',
  'strong-separation': 'Strong separation of signers',
};

export function OnboardingScreen({
  initialProfile,
  onSkip,
  onFinish,
}: {
  initialProfile: LearningProfile;
  /** « Skip » : l'application reste utilisable immédiatement. */
  onSkip: (profile: LearningProfile) => void;
  /** « Finish » : profil enregistré localement. */
  onFinish: (profile: LearningProfile) => void;
}) {
  const [step, setStep] = useState(0);
  const [profile, setProfile] = useState<LearningProfile>(
    initialProfile.onboardingCompleted ? DEFAULT_PROFILE : initialProfile,
  );

  const lessons = useMemo(() => screensForLevel(profile.level), [profile.level]);
  // 4 questions + les ecrans pedagogiques du niveau choisi.
  const totalSteps = 4 + lessons.length;
  const summaryLines = useMemo(() => personalizedSummary(profile), [profile]);

  const onNext = () => setStep((previous) => Math.min(previous + 1, totalSteps - 1));
  const onBack = () => setStep((previous) => Math.max(previous - 1, 0));

  const toggleMean = (mean: SigningMean) => {
    setProfile((previous) => ({
      ...previous,
      signingMeans: previous.signingMeans.includes(mean)
        ? previous.signingMeans.filter((entry) => entry !== mean)
        : [...previous.signingMeans, mean],
    }));
  };

  const lesson = step >= 4 ? lessons[step - 4] : null;
  const isLast = step === totalSteps - 1;

  return (
    <View style={[styles.screen, SAFE_TOP_PADDING]}>
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.badge}>DEVNET · LEARNING</Text>
        <Text style={styles.title}>
          {step < 4 ? "Let's set up your learning experience" : (lesson?.title ?? 'Learn')}
        </Text>
        <Text style={styles.progress}>
          Step {step + 1} of {totalSteps}
        </Text>

        {step === 0 ? (
          <View style={styles.block}>
            <Text style={styles.fieldLabel}>How comfortable are you with multisigs?</Text>
            {LEARNING_LEVELS.map((level) => (
              <Pressable
                accessibilityRole="button"
                key={level}
                onPress={() => setProfile((previous) => ({ ...previous, level }))}
                style={[styles.option, profile.level === level && styles.optionSelected]}
              >
                <Text style={styles.optionText}>{LEVEL_LABELS[level]}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        {step === 1 ? (
          <View style={styles.block}>
            <Text style={styles.fieldLabel}>What is your main goal?</Text>
            {LEARNING_GOALS.map((goal) => (
              <Pressable
                accessibilityRole="button"
                key={goal}
                onPress={() => setProfile((previous) => ({ ...previous, goal }))}
                style={[styles.option, profile.goal === goal && styles.optionSelected]}
              >
                <Text style={styles.optionText}>{GOAL_LABELS[goal]}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        {step === 2 ? (
          <View style={styles.block}>
            <Text style={styles.fieldLabel}>Which signing means do you have?</Text>
            {SIGNING_MEANS.map((mean) => (
              <Pressable
                accessibilityRole="button"
                key={mean}
                onPress={() => toggleMean(mean)}
                style={[styles.option, profile.signingMeans.includes(mean) && styles.optionSelected]}
              >
                <Text style={styles.optionText}>{MEAN_LABELS[mean]}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        {step === 3 ? (
          <View style={styles.block}>
            <Text style={styles.fieldLabel}>What matters most to you?</Text>
            {PRIORITIES.map((priority) => (
              <Pressable
                accessibilityRole="button"
                key={priority}
                onPress={() => setProfile((previous) => ({ ...previous, priority }))}
                style={[styles.option, profile.priority === priority && styles.optionSelected]}
              >
                <Text style={styles.optionText}>{PRIORITY_LABELS[priority]}</Text>
              </Pressable>
            ))}
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
            onPress={() => onSkip(profile)}
            style={[styles.button, styles.secondary]}
          >
            <Text style={styles.secondaryText}>Skip</Text>
          </Pressable>
          {step > 0 ? (
            <Pressable accessibilityRole="button" onPress={onBack} style={[styles.button, styles.secondary]}>
              <Text style={styles.secondaryText}>Back</Text>
            </Pressable>
          ) : null}
          {isLast ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => onFinish(profile)}
              style={styles.button}
            >
              <Text style={styles.buttonText}>Finish</Text>
            </Pressable>
          ) : (
            <Pressable accessibilityRole="button" onPress={onNext} style={styles.button}>
              <Text style={styles.buttonText}>Next</Text>
            </Pressable>
          )}
        </View>

        <Text style={styles.footNote}>
          {ONBOARDING_SCREENS.length} lessons available. Your answers stay on this device and are
          never sent anywhere. You can reopen this from « Learn about multisig ».
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
  buttonText: { color: '#ffffff', fontSize: 15, fontWeight: '700' },
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
  fieldLabel: { color: '#6b7280', fontSize: 12, fontWeight: '700', marginTop: 12 },
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
  optionSelected: { backgroundColor: '#e8f0fe', borderColor: '#1a56db', borderWidth: 2 },
  optionText: { color: '#101317', fontSize: 15 },
  paragraph: { color: '#101317', fontSize: 15, marginTop: 8 },
  progress: { color: '#6b7280', fontSize: 13, marginTop: 6 },
  screen: { backgroundColor: '#ffffff', flex: 1, width: '100%' },
  secondary: { backgroundColor: '#f3f4f6', borderColor: '#d1d5db', borderWidth: 1 },
  secondaryText: { color: '#101317', fontSize: 15, fontWeight: '700' },
  title: { color: '#101317', fontSize: 22, fontWeight: '800', marginTop: 10, textAlign: 'center' },
});