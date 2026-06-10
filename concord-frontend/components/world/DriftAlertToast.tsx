'use client';

// Phase DC7 — Drift alert toast.
// Bottom-right toast on new HIGH/CRITICAL drift alert in current world.
// Click "Resolve via constraint check" → POSTs /api/reasoning/run with
// mode=constraint_check.

import { useCallback, useEffect, useState } from 'react';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import { useClientConfig } from '@/hooks/useClientConfig';
import { AlertTriangle, Brain, X, Loader2 } from 'lucide-react';

interface Alert {
  id: string;
  type: string;
  severity: string;
  world_id?: string;
  detected_at: number;
  message?: string;
  resolved_at?: number;
}

export function DriftAlertToast() {
  // E0 — server-tunable backstop cadence (was a hardcoded 15_000).
  const POLL_MS = useClientConfig().poll.driftAlertMs;
  const [seenIds, setSeenIds] = useState<Set<string>>(new Set());
  const [activeAlert, setActiveAlert] = useState<Alert | null>(null);
  const [pending, setPending] = useState(false);
  const [resolution, setResolution] = useState<string | null>(null);
  const [worldId, setWorldId] = useState<string | null>(null);

  useEffect(() => {
    const id = typeof window !== 'undefined' ? localStorage.getItem('concordia:activeWorldId') : null;
    setWorldId(id);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const j = await fetch(`/api/drift/alerts?severity=HIGH&severity=CRITICAL${worldId ? `&worldId=${encodeURIComponent(worldId)}` : ''}`, {
        credentials: 'include',
      }).then(r => r.ok ? r.json() : null);
      if (!j?.ok) return;
      const alerts: Alert[] = (j.alerts || []).filter((a: Alert) => !a.resolved_at);
      for (const a of alerts) {
        if (seenIds.has(a.id)) continue;
        setSeenIds((prev) => new Set(prev).add(a.id));
        setActiveAlert(a);
        return; // surface one at a time
      }
    } catch { /* swallow */ }
  }, [seenIds, worldId]);

  // Push: refresh the instant the server emits a drift alert; slow backstop poll
  // self-heals missed events / reconnect gaps.
  useRealtimeRefresh(['world:drift-alert'], refresh, { backstopMs: POLL_MS });

  const resolve = useCallback(async () => {
    if (!activeAlert) return;
    setPending(true);
    setResolution(null);
    try {
      const r = await fetch('/api/reasoning/run', {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mode: 'constraint_check',
          input: { driftAlertId: activeAlert.id, driftType: activeAlert.type, severity: activeAlert.severity },
        }),
      });
      const j = await r.json();
      setResolution(j?.ok ? `trace: ${j.traceId || 'logged'}` : (j?.error || 'failed'));
    } finally { setPending(false); }
  }, [activeAlert]);

  if (!activeAlert) return null;

  const critical = activeAlert.severity === 'CRITICAL';

  return (
    <div className="concordia-hud-slide-right pointer-events-auto fixed bottom-36 right-4 z-30 w-80 rounded-lg border border-red-500/40 bg-zinc-950/95 p-3 shadow-2xl backdrop-blur">
      <header className="mb-2 flex items-center justify-between">
        <h3 className={['flex items-center gap-1 text-sm font-semibold', critical ? 'text-red-300' : 'text-amber-300'].join(' ')}>
          <AlertTriangle size={14} /> {critical ? 'Critical drift' : 'High drift'}
        </h3>
        <button aria-label="Close" onClick={() => { setActiveAlert(null); setResolution(null); }} className="text-zinc-400 hover:text-zinc-100">
          <X size={12} />
        </button>
      </header>
      <div className="mb-2 text-xs text-zinc-200">
        <div className="font-mono text-amber-200">{activeAlert.type}</div>
        {activeAlert.message && <div className="mt-1 text-zinc-400">{activeAlert.message}</div>}
      </div>
      {!resolution ? (
        <button
          onClick={resolve}
          disabled={pending}
          className="flex w-full items-center justify-center gap-1 rounded bg-cyan-500/30 px-3 py-1.5 text-xs text-cyan-100 hover:bg-cyan-500/50 disabled:opacity-50"
        >
          {pending ? <Loader2 className="animate-spin" size={11} /> : <Brain size={11} />} Resolve via constraint check
        </button>
      ) : (
        <div className="rounded bg-emerald-950/30 p-2 text-[10px] text-emerald-200">{resolution}</div>
      )}
    </div>
  );
}
