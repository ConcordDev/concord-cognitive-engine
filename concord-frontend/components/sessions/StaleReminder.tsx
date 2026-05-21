'use client';

/**
 * StaleReminder — surfaces long-idle open/paused sessions and offers a
 * one-click bulk-close sweep.
 *
 * Real data: queries sessions.stale on mount, renders nothing when the
 * backend reports zero stale sessions. The "Close all" action calls
 * sessions.bulk_close with scope='stale'.
 */

import { useCallback, useEffect, useState } from 'react';
import { AlarmClock, X } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface StaleSession {
  id: string;
  lensId: string;
  title: string | null;
  status: string;
  idleDays: number;
}

interface StaleResult {
  ok: boolean;
  idleDays: number;
  sessions?: StaleSession[];
}

const IDLE_DAYS = 7;

export function StaleReminder({ onChanged }: { onChanged: () => void }) {
  const [stale, setStale] = useState<StaleSession[]>([]);
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await lensRun<StaleResult>('sessions', 'stale', { idleDays: IDLE_DAYS });
    if (r.data?.ok && r.data.result?.ok) {
      setStale(r.data.result.sessions || []);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (dismissed || stale.length === 0) return null;

  const closeAll = async (outcome: 'completed' | 'abandoned') => {
    setBusy(true);
    const r = await lensRun<{ ok: boolean; closed: number }>('sessions', 'bulk_close', {
      scope: 'stale', idleDays: IDLE_DAYS, outcome,
    });
    setBusy(false);
    if (r.data?.ok && r.data.result?.ok) {
      setStale([]);
      onChanged();
    }
  };

  const oldest = stale.reduce((m, s) => Math.max(m, s.idleDays), 0);

  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 mb-4">
      <div className="flex items-start gap-3">
        <AlarmClock className="w-4 h-4 text-amber-300 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-xs text-amber-200 font-medium">
            {stale.length} session{stale.length === 1 ? '' : 's'} idle for {IDLE_DAYS}+ days
            <span className="text-amber-300/60 font-normal"> · oldest {oldest}d</span>
          </p>
          <p className="text-[11px] text-amber-300/70 mt-0.5">
            {stale.slice(0, 3).map(s => s.title || `Untitled (${s.lensId})`).join(', ')}
            {stale.length > 3 && ` +${stale.length - 3} more`}
          </p>
          <div className="flex items-center gap-2 mt-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void closeAll('abandoned')}
              className="text-[11px] px-2 py-1 rounded border border-rose-500/40 text-rose-300 hover:bg-rose-500/10 disabled:opacity-40"
            >
              Abandon all stale
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void closeAll('completed')}
              className="text-[11px] px-2 py-1 rounded border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-40"
            >
              Mark all complete
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="p-1 text-amber-400/60 hover:text-amber-200 shrink-0"
          aria-label="Dismiss reminder"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
