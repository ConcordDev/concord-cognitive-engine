'use client';

import { useCallback, useEffect, useState } from 'react';
import { lensRun, isForbidden } from '@/lib/api/client';
import {
  AUTO_REFRESH_KEY, AUTO_REFRESH_MS,
  type Escalation, type HealthEntry, type LoadState, type MemStats,
} from './types';

/** Shared loader for repair.health_log / escalations / memory + resolve_escalation. */
export function useRepairTelemetry() {
  const [log, setLog] = useState<HealthEntry[]>([]);
  const [escalations, setEscalations] = useState<Escalation[]>([]);
  const [mem, setMem] = useState<MemStats | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [state, setState] = useState<LoadState>('loading');
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [pendingEscalationId, setPendingEscalationId] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(() => {
    if (typeof window === 'undefined') return true;
    try { return window.localStorage.getItem(AUTO_REFRESH_KEY) !== '0'; } catch { return true; }
  });

  const refresh = useCallback(async (isBackground = false) => {
    if (isBackground) setRefreshing(true); else setState('loading');
    setErrorBanner(null);
    try {
      const [l, e, m] = await Promise.all([
        lensRun('repair', 'health_log', { limit: 150 }),
        lensRun('repair', 'escalations', {}),
        lensRun('repair', 'memory', {}),
      ]);
      if ([l, e, m].some((r) => isForbidden(r.data))) { setForbidden(true); return; }
      if (!l.data?.ok || !e.data?.ok || !m.data?.ok) {
        if (isBackground) setErrorBanner('Background refresh failed — showing last known telemetry.');
        else setState('error');
        return;
      }
      setLog((l.data.result as { entries: HealthEntry[] }).entries || []);
      setEscalations((e.data.result as { escalations: Escalation[] }).escalations || []);
      setMem((m.data.result as { stats: MemStats }).stats || null);
      setLastRefresh(new Date());
      setState('ready');
    } catch {
      if (isBackground) setErrorBanner('Background refresh failed — showing last known telemetry.');
      else setState('error');
    } finally {
      if (isBackground) setRefreshing(false);
    }
  }, []);

  useEffect(() => { void refresh(false); }, [refresh]);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') void refresh(true);
    }, AUTO_REFRESH_MS);
    return () => clearInterval(id);
  }, [autoRefresh, refresh]);

  useEffect(() => {
    try { window.localStorage.setItem(AUTO_REFRESH_KEY, autoRefresh ? '1' : '0'); } catch { /* best-effort */ }
  }, [autoRefresh]);

  const resolve = useCallback(async (id: string, resolution: 'approved' | 'dismissed') => {
    setPendingEscalationId(id);
    const prev = escalations;
    setEscalations((cur) => cur.filter((e) => e.id !== id));
    try {
      const r = await lensRun('repair', 'resolve_escalation', { id, resolution });
      const ok = r.data?.ok && (r.data.result as { ok?: boolean } | null)?.ok;
      if (!ok) {
        setEscalations(prev);
        setErrorBanner(`Could not ${resolution === 'approved' ? 'approve' : 'dismiss'} escalation — restored.`);
      }
    } catch {
      setEscalations(prev);
      setErrorBanner(`Could not ${resolution === 'approved' ? 'approve' : 'dismiss'} escalation — restored.`);
    } finally {
      setPendingEscalationId(null);
    }
  }, [escalations]);

  return {
    log, escalations, mem, forbidden, state, refreshing, lastRefresh, errorBanner, setErrorBanner,
    pendingEscalationId, autoRefresh, setAutoRefresh, refresh, resolve, setEscalations,
  };
}
