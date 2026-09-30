'use client';

import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';

interface FarmDeskValue {
  handleAction: (action: string, artifactId?: string) => Promise<void>;
  actionResult: Record<string, unknown> | null;
  clearResult: () => void;
  pending: boolean;
}

const FarmDeskContext = createContext<FarmDeskValue | null>(null);

export function FarmDeskProvider({ children }: { children: React.ReactNode }) {
  const runAction = useRunArtifact('agriculture');
  const [actionResult, setActionResult] = useState<Record<string, unknown> | null>(null);

  const handleAction = useCallback(
    async (action: string, artifactId?: string): Promise<void> => {
      if (!artifactId) return;
      let current = action;
      try {
        for (let hop = 0; hop < 4; hop++) {
          const result = await runAction.mutateAsync({ id: artifactId, action: current });
          if (result.ok === false) {
            setActionResult({
              message: `Action failed: ${(result as Record<string, unknown>).error || 'Unknown error'}`,
            });
            return;
          }
          const payload = (result.result || {}) as Record<string, unknown>;
          const dispatched = typeof payload.dispatched === 'string' ? payload.dispatched : null;
          // Follow analyze → plan-crop (and any future dispatcher hop).
          if (dispatched && dispatched !== current) {
            current = dispatched;
            continue;
          }
          if (dispatched && dispatched !== current) {
            current = dispatched;
            continue;
          }
          setActionResult(payload);
          return;
        }
      } catch (err) {
        console.error('Action failed:', err);
        setActionResult({ message: 'Action failed: request error' });
      }
    },
    [runAction],
  );

  const value = useMemo(
    () => ({
      handleAction,
      actionResult,
      clearResult: () => setActionResult(null),
      pending: runAction.isPending,
    }),
    [handleAction, actionResult, runAction.isPending],
  );

  return <FarmDeskContext.Provider value={value}>{children}</FarmDeskContext.Provider>;
}

export function useFarmDesk() {
  const ctx = useContext(FarmDeskContext);
  if (!ctx) throw new Error('useFarmDesk must be used inside FarmDeskProvider');
  return ctx;
}
