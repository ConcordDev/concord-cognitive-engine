'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Wifi, WifiOff, Timer, Loader2, RotateCw, Zap } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz';
import { dirtyDocs } from './local-store';

interface BackoffEntry {
  attempt: number;
  baseDelayMs: number;
  minDelayMs: number;
  maxDelayMs: number;
}

interface BackoffResult {
  schedule: BackoffEntry[];
  attempt: number;
  exhausted: boolean;
  nextDelayMs: number;
  nextAttempt: number;
  totalWaitMs: number;
  totalWaitSeconds: number;
  policy: { baseMs: number; capMs: number; maxAttempts: number; jitter: number };
}

/**
 * Connectivity indicator + exponential-backoff retry planner.
 *
 * Auto-detects `navigator.onLine`, and when offline-with-dirty-writes it asks
 * the `offline.backoffSchedule` macro for a jittered retry plan and counts the
 * pending queue down. The schedule is charted so the backoff curve is visible.
 */
export function BackoffPanel({ onRetryDue }: { onRetryDue?: () => void }) {
  const [online, setOnline] = useState(true);
  const [dirty, setDirty] = useState(0);
  const [plan, setPlan] = useState<BackoffResult | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [countdownMs, setCountdownMs] = useState(0);
  const [busy, setBusy] = useState(false);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refreshDirty = useCallback(async () => {
    setDirty((await dirtyDocs()).length);
  }, []);

  const loadPlan = useCallback(
    async (att: number) => {
      setBusy(true);
      try {
        const r = await lensRun<BackoffResult>('offline', 'backoffSchedule', {
          attempt: att,
          baseMs: 1000,
          capMs: 60000,
          maxAttempts: 8,
        });
        if (r.data.ok && r.data.result) {
          setPlan(r.data.result);
          setCountdownMs(r.data.result.nextDelayMs);
        }
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  useEffect(() => {
    refreshDirty();
    loadPlan(0);
    if (typeof navigator !== 'undefined') setOnline(navigator.onLine);

    const goOnline = () => {
      setOnline(true);
      setAttempt(0);
      refreshDirty();
      // Browsers without Background Sync get an explicit kick to the SW.
      if (typeof navigator !== 'undefined' && navigator.serviceWorker?.controller) {
        navigator.serviceWorker.controller.postMessage({ type: 'ONLINE' });
      }
      onRetryDue?.();
    };
    const goOffline = () => setOnline(false);

    if (typeof window !== 'undefined') {
      window.addEventListener('online', goOnline);
      window.addEventListener('offline', goOffline);
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('online', goOnline);
        window.removeEventListener('offline', goOffline);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Backoff countdown — only runs while offline with pending writes.
  useEffect(() => {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    if (online || dirty === 0 || !plan || plan.exhausted) return;
    tickRef.current = setInterval(() => {
      setCountdownMs((ms) => {
        if (ms <= 1000) {
          // Retry window elapsed — advance the attempt counter.
          setAttempt((a) => {
            const next = a + 1;
            loadPlan(next);
            onRetryDue?.();
            return next;
          });
          return 0;
        }
        return ms - 1000;
      });
    }, 1000);
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, [online, dirty, plan, loadPlan, onRetryDue]);

  const manualRetry = useCallback(() => {
    setAttempt((a) => {
      const next = a + 1;
      loadPlan(next);
      onRetryDue?.();
      return next;
    });
    refreshDirty();
  }, [loadPlan, onRetryDue, refreshDirty]);

  const chartData =
    plan?.schedule.map((e) => ({
      attempt: `#${e.attempt}`,
      base: Math.round(e.baseDelayMs / 1000),
      min: Math.round(e.minDelayMs / 1000),
      max: Math.round(e.maxDelayMs / 1000),
    })) ?? [];

  return (
    <div className="space-y-3">
      <header className="flex items-center justify-between border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          {online ? (
            <Wifi className="h-5 w-5 text-emerald-400" />
          ) : (
            <WifiOff className="h-5 w-5 text-rose-400" />
          )}
          <div>
            <h2 className="text-sm font-semibold text-white">
              Connectivity · {online ? 'Online' : 'Offline'}
            </h2>
            <p className="text-[11px] text-zinc-400">
              {online
                ? 'Network detected — queue replays automatically'
                : dirty > 0
                  ? `${dirty} write${dirty === 1 ? '' : 's'} queued — retrying with backoff`
                  : 'No pending writes'}
            </p>
          </div>
        </div>
        <button
          onClick={manualRetry}
          disabled={busy}
          className="flex items-center gap-1.5 rounded border border-zinc-700 px-2.5 py-1.5 text-xs text-zinc-300 hover:text-white disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCw className="h-3.5 w-3.5" />}
          Retry now
        </button>
      </header>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-2">
          <div className="text-[10px] uppercase tracking-wider text-zinc-400">Attempt</div>
          <div className="mt-0.5 font-mono text-lg text-zinc-200">
            {attempt} / {plan?.policy.maxAttempts ?? 8}
          </div>
        </div>
        <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-2">
          <div className="text-[10px] uppercase tracking-wider text-zinc-400">Next retry</div>
          <div className="mt-0.5 flex items-center gap-1 font-mono text-lg text-zinc-200">
            <Timer className="h-3.5 w-3.5 text-cyan-400" />
            {online || dirty === 0 ? '—' : `${Math.ceil(countdownMs / 1000)}s`}
          </div>
        </div>
        <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-2">
          <div className="text-[10px] uppercase tracking-wider text-zinc-400">Queue</div>
          <div
            className={`mt-0.5 font-mono text-lg ${dirty > 0 ? 'text-amber-400' : 'text-zinc-200'}`}
          >
            {dirty}
          </div>
        </div>
        <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-2">
          <div className="text-[10px] uppercase tracking-wider text-zinc-400">Worst case</div>
          <div className="mt-0.5 font-mono text-lg text-zinc-200">
            {plan ? `${plan.totalWaitSeconds}s` : '—'}
          </div>
        </div>
      </div>

      {plan?.exhausted && (
        <p className="flex items-center gap-1.5 rounded border border-rose-500/25 bg-rose-500/5 px-3 py-2 text-[11px] text-rose-300">
          <Zap className="h-3.5 w-3.5" />
          Backoff exhausted after {plan.policy.maxAttempts} attempts — manual retry
          required.
        </p>
      )}

      <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2">
        <div className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
          Exponential backoff curve (seconds, ±20% jitter band)
        </div>
        <ChartKit
          kind="area"
          data={chartData}
          xKey="attempt"
          series={[
            { key: 'max', label: 'jitter max', color: '#f59e0b' },
            { key: 'base', label: 'base delay', color: '#06b6d4' },
            { key: 'min', label: 'jitter min', color: '#22c55e' },
          ]}
          height={180}
        />
      </div>
    </div>
  );
}
