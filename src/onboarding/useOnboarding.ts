import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

import {
  completedProfile,
  DEFAULT_PROFILE,
  sanitizeProfile,
  shouldShowOnboarding,
  skippedProfile,
  type LearningProfile,
} from './profile';

/**
 * Stockage LOCAL du profil d'apprentissage. Aucune I/O réseau, aucun wallet.
 *
 * Si le stockage échoue : l'application n'est jamais bloquée, le mode
 * pédagogique par défaut est utilisé, « Skip » fonctionne en mémoire et les
 * réponses ne partent nulle part.
 */
export const ONBOARDING_STORAGE_KEY = 'pocket-multisig:onboarding-profile:v1';

export function useOnboarding(): {
  profile: LearningProfile;
  ready: boolean;
  show: boolean;
  storageFailed: boolean;
  persist: (profile: LearningProfile) => Promise<void>;
  complete: (profile: LearningProfile) => Promise<void>;
  skip: (profile: LearningProfile) => Promise<void>;
  reset: () => Promise<void>;
  open: () => void;
  close: () => void;
} {
  const [profile, setProfile] = useState<LearningProfile>(DEFAULT_PROFILE);
  const [ready, setReady] = useState(false);
  const [show, setShow] = useState(false);
  const [storageFailed, setStorageFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const stored = await AsyncStorage.getItem(ONBOARDING_STORAGE_KEY);
        if (cancelled) return;
        const loaded = stored === null ? DEFAULT_PROFILE : sanitizeProfile(JSON.parse(stored));
        setProfile(loaded);
        setShow(shouldShowOnboarding(loaded));
      } catch {
        // Stockage indisponible : on continue avec le mode par defaut.
        if (cancelled) return;
        setStorageFailed(true);
        setProfile(DEFAULT_PROFILE);
        setShow(true);
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const persist = useCallback(async (next: LearningProfile) => {
    const clean = sanitizeProfile(next);
    setProfile(clean);
    try {
      await AsyncStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(clean));
      setStorageFailed(false);
    } catch {
      // L'echec d'ecriture ne bloque rien : l'etat en memoire fait foi.
      setStorageFailed(true);
    }
  }, []);

  const complete = useCallback(
    async (next: LearningProfile) => {
      await persist(completedProfile(next));
      setShow(false);
    },
    [persist],
  );

  const skip = useCallback(
    async (next: LearningProfile) => {
      await persist(skippedProfile(next));
      setShow(false);
    },
    [persist],
  );

  const reset = useCallback(async () => {
    try {
      await AsyncStorage.removeItem(ONBOARDING_STORAGE_KEY);
    } catch {
      setStorageFailed(true);
    }
    setProfile(DEFAULT_PROFILE);
    setShow(true);
  }, []);

  const open = useCallback(() => setShow(true), []);
  const close = useCallback(() => setShow(false), []);

  return {
    close,
    complete,
    open,
    persist,
    profile,
    ready,
    reset,
    show,
    skip,
    storageFailed,
  };
}