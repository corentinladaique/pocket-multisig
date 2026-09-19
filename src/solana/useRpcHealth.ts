import { useCallback, useEffect, useState } from 'react';

import { pingDevnet } from './connection';

export type RpcStatus = 'checking' | 'online' | 'offline';

export interface RpcHealth {
  /** Détail brut du dernier échec, affiché tel quel (SECURITY.md §6). */
  detail: string | null;
  retry: () => void;
  /** Slot confirmé au dernier contrôle réussi. */
  slot: number | null;
  status: RpcStatus;
}

/**
 * Contrôle la disponibilité de l'endpoint devnet via un unique appel RPC léger.
 * Aucun état persistant : tout est local au composant.
 */
export function useRpcHealth(): RpcHealth {
  const [status, setStatus] = useState<RpcStatus>('checking');
  const [slot, setSlot] = useState<number | null>(null);
  const [detail, setDetail] = useState<string | null>(null);

  const check = useCallback(async () => {
    setStatus('checking');
    setDetail(null);
    try {
      const currentSlot = await pingDevnet();
      setSlot(currentSlot);
      setStatus('online');
    } catch (error: unknown) {
      setDetail(error instanceof Error ? error.message : String(error));
      setStatus('offline');
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  const retry = useCallback(() => {
    void check();
  }, [check]);

  return { detail, retry, slot, status };
}