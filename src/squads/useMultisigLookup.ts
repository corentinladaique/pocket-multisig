import { useCallback, useState } from 'react';

import { connection } from '../solana/connection';
import {
  loadMultisig,
  MultisigLookupError,
  parseMultisigAddress,
  type MultisigView,
} from './multisig';

export type LookupStatus = 'idle' | 'loading' | 'loaded' | 'error';

export interface MultisigLookup {
  /** Efface l'adresse saisie et le résultat (aucune persistance). */
  clear: () => void;
  error: string | null;
  /** Relance la dernière recherche saisie. */
  load: (input: string) => void;
  retry: () => void;
  status: LookupStatus;
  view: MultisigView | null;
}

/**
 * État de la recherche manuelle d'un multisig. Aucune persistance :
 * l'adresse reste en mémoire locale au composant.
 */
export function useMultisigLookup(): MultisigLookup {
  const [status, setStatus] = useState<LookupStatus>('idle');
  const [view, setView] = useState<MultisigView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastInput, setLastInput] = useState<string>('');

  const load = useCallback((input: string) => {
    setLastInput(input);
    // Validation locale d'abord : aucune requête pour une saisie invalide.
    let address;
    try {
      address = parseMultisigAddress(input);
    } catch (caught: unknown) {
      setView(null);
      setError(
        caught instanceof MultisigLookupError
          ? caught.message
          : 'Enter a valid Solana multisig address.',
      );
      setStatus('error');
      return;
    }

    setStatus('loading');
    setError(null);
    setView(null);

    void (async () => {
      try {
        setView(await loadMultisig(connection, address));
        setStatus('loaded');
      } catch (caught: unknown) {
        setError(
          caught instanceof MultisigLookupError
            ? caught.message
            : `Lecture impossible : ${caught instanceof Error ? caught.message : String(caught)}`,
        );
        setStatus('error');
      }
    })();
  }, []);

  const retry = useCallback(() => {
    if (lastInput.length > 0) load(lastInput);
  }, [lastInput, load]);

  const clear = useCallback(() => {
    setStatus('idle');
    setView(null);
    setError(null);
    setLastInput('');
  }, []);

  return { clear, error, load, retry, status, view };
}