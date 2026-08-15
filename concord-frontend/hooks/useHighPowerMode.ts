// concord-frontend/hooks/useHighPowerMode.ts
//
// React hook for High Power Mode: mode toggle + quota status.

import { useState, useCallback, useEffect } from 'react';

interface QuotaStatus {
  callsToday: number;
  perProvider: Record<string, { calls: number; callsLimit: number; exhausted: boolean }>;
  resetsAt: number;
  providers: Array<{ provider: string; configured: boolean }>;
}

interface UseHighPowerModeResult {
  mode: 'private' | 'high_power';
  setMode: (mode: 'private' | 'high_power') => Promise<void>;
  quota: QuotaStatus | null;
  refresh: () => Promise<void>;
  loading: boolean;
  error: string | null;
}

export function useHighPowerMode(): UseHighPowerModeResult {
  const [mode, setModeState] = useState<'private' | 'high_power'>('private');
  const [quota, setQuota] = useState<QuotaStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchMode = useCallback(async () => {
    try {
      const r = await fetch('/api/brain-mode', { credentials: 'include' });
      const data = await r.json();
      if (data.ok) setModeState(data.mode);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'fetch_failed');
    }
  }, []);

  const fetchQuota = useCallback(async () => {
    try {
      const r = await fetch('/api/brain-mode/quota', { credentials: 'include' });
      const data = await r.json();
      if (data.ok) setQuota(data);
      return data;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'fetch_failed');
      return null;
    }
  }, []);

  const setMode = useCallback(async (newMode: 'private' | 'high_power') => {
    const previous = mode;
    setModeState(newMode); // optimistic
    setLoading(true);
    try {
      const r = await fetch('/api/brain-mode', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: newMode }),
      });
      const data = await r.json();
      if (!data.ok) {
        setModeState(previous); // rollback
        throw new Error(data.error || 'update_failed');
      }
      // Refresh quota after mode change
      if (newMode === 'high_power') fetchQuota();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'update_failed');
      throw err;
    } finally {
      setLoading(false);
    }
  }, [mode, fetchQuota]);

  useEffect(() => {
    fetchMode();
    fetchQuota();
    const interval = setInterval(fetchQuota, 60_000);
    return () => clearInterval(interval);
  }, [fetchMode, fetchQuota]);

  return { mode, setMode, quota, refresh: fetchQuota, loading, error };
}

export default useHighPowerMode;
