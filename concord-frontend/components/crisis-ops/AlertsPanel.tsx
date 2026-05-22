'use client';

/**
 * AlertsPanel — push feed of new / escalated crises. Polls crisis.alerts
 * on an interval (passing the prior cursor) and surfaces unacknowledged
 * escalations; crisis.acknowledge_alert clears them.
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { BellRing, Loader2, Check } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface Alert {
  alertId: string;
  crisisId: string;
  type: string;
  description: string;
  worldId: string;
  startedAt: number;
  priority: 'critical' | 'high' | 'moderate' | 'low';
  score: number;
  isNew: boolean;
  escalated: boolean;
  acknowledged: boolean;
}
interface AlertsResult {
  alerts: Alert[];
  unacknowledged: number;
  cursor: number;
}

const PRIORITY_TONE: Record<string, string> = {
  critical: 'border-rose-500/50 bg-rose-900/25 text-rose-200',
  high: 'border-orange-500/40 bg-orange-900/20 text-orange-200',
  moderate: 'border-amber-500/30 bg-amber-900/15 text-amber-200',
  low: 'border-zinc-600/30 bg-zinc-800/30 text-zinc-300',
};
const POLL_MS = 30_000;

export function AlertsPanel({ worldId }: { worldId: string }) {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [unack, setUnack] = useState(0);
  const [loading, setLoading] = useState(true);
  const cursorRef = useRef(0);

  const poll = useCallback(async () => {
    const r = await lensRun<AlertsResult>('crisis', 'alerts', {
      worldId, sinceMs: cursorRef.current,
    });
    if (r.data?.ok && r.data.result) {
      setAlerts(r.data.result.alerts || []);
      setUnack(r.data.result.unacknowledged || 0);
      cursorRef.current = r.data.result.cursor || cursorRef.current;
    }
    setLoading(false);
  }, [worldId]);

  useEffect(() => {
    poll();
    const t = setInterval(poll, POLL_MS);
    return () => clearInterval(t);
  }, [poll]);

  const acknowledge = useCallback(async (alertId: string) => {
    const r = await lensRun('crisis', 'acknowledge_alert', { alertId });
    if (r.data?.ok) {
      setAlerts((prev) => prev.map((a) => a.alertId === alertId ? { ...a, acknowledged: true } : a));
      setUnack((n) => Math.max(0, n - 1));
    }
  }, []);

  return (
    <div className="space-y-3">
      <header className="flex items-center gap-2">
        <BellRing className={`h-4 w-4 ${unack > 0 ? 'animate-pulse text-rose-400' : 'text-rose-300'}`} />
        <h3 className="text-sm font-semibold text-white">Alert feed</h3>
        {unack > 0 && (
          <span className="rounded-full bg-rose-600 px-1.5 py-0.5 font-mono text-[10px] font-bold text-white">
            {unack}
          </span>
        )}
        <span className="ml-auto font-mono text-[10px] text-zinc-600">polls every 30s</span>
      </header>

      {loading && (
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Listening for alerts…
        </div>
      )}

      {!loading && alerts.length === 0 && (
        <p className="rounded border border-white/10 bg-white/5 p-3 text-center text-xs text-zinc-500">
          No new or escalated crises.
        </p>
      )}

      {!loading && alerts.length > 0 && (
        <ul className="max-h-72 space-y-1.5 overflow-y-auto">
          {alerts.map((a) => (
            <li
              key={a.alertId}
              className={`rounded-lg border p-2.5 transition ${PRIORITY_TONE[a.priority]} ${
                a.acknowledged ? 'opacity-50' : ''
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-semibold">{a.type}</span>
                    {a.isNew && (
                      <span className="rounded bg-black/40 px-1 py-0.5 font-mono text-[8px] uppercase">new</span>
                    )}
                    {a.escalated && (
                      <span className="rounded bg-black/40 px-1 py-0.5 font-mono text-[8px] uppercase">escalated</span>
                    )}
                  </div>
                  <p className="truncate text-[11px] opacity-75">{a.description}</p>
                  <span className="text-[10px] opacity-60">priority {a.score} · {a.priority}</span>
                </div>
                {!a.acknowledged && (
                  <button
                    type="button"
                    onClick={() => acknowledge(a.alertId)}
                    className="flex shrink-0 items-center gap-1 rounded bg-black/30 px-1.5 py-1 text-[10px] hover:bg-black/50"
                  >
                    <Check className="h-3 w-3" /> Ack
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
