'use client';

/**
 * EventFeed — the Defense domain event feed (S3).
 *
 * Backed by defense.activity-feed: the events are derived server-side
 * from the records this workspace itself writes (mission tasks, assets,
 * threats, personnel, supply, comms, map markers). This is the lens's
 * own event log — not an external telemetry stream, and it says so.
 */

import { useState, useEffect, useCallback } from 'react';
import { lensRun } from '@/lib/api/client';
import { Loader2, RefreshCw, Satellite } from 'lucide-react';

interface FeedEvent {
  at: string;
  kind: string;
  text: string;
}

interface FeedResult {
  events: FeedEvent[];
  total: number;
}

const KIND_TONE: Record<string, string> = {
  asset: 'text-green-400',
  threat: 'text-red-400',
  mission: 'text-amber-400',
  personnel: 'text-sky-400',
  supply: 'text-orange-400',
  comms: 'text-purple-400',
  map: 'text-cyan-400',
};

function formatTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export function EventFeed() {
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const r = await lensRun<FeedResult>('defense', 'activity-feed', { limit: 50 });
    if (r.data?.ok && r.data.result) {
      setEvents(r.data.result.events || []);
      setTotal(r.data.result.total || 0);
    } else {
      setError(r.data?.error || 'Failed to load the event feed');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4 space-y-3">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Satellite className="w-4 h-4 text-cyan-400" />
          <h3 className="text-sm font-semibold text-white">Workspace Events</h3>
        </div>
        <div className="flex items-center gap-2">
          {total > 0 && <span className="text-[11px] text-zinc-400">{total} events</span>}
          <button
            onClick={refresh}
            disabled={loading}
            aria-label="Refresh event feed"
            className="p-1 text-zinc-400 hover:text-cyan-400 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </header>

      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs text-red-400">
          {error}
        </div>
      )}

      {loading && events.length === 0 ? (
        <div className="flex items-center justify-center py-12 text-zinc-400">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      ) : events.length === 0 ? (
        error ? null : (
          <p className="py-6 text-center text-xs text-zinc-500">
            No events yet. Actions taken in this brief — mission tasks, assets, threats, personnel,
            supply, comms, map markers — appear here as they happen.
          </p>
        )
      ) : (
        <div className="space-y-1 max-h-96 overflow-y-auto">
          {events.map((e, i) => (
            <div
              key={`${e.at}-${i}`}
              className="flex items-baseline gap-2 rounded border border-zinc-800 bg-zinc-900/60 px-2.5 py-1.5"
            >
              <span
                className={`shrink-0 text-[10px] font-semibold uppercase tracking-wider ${KIND_TONE[e.kind] || 'text-zinc-400'}`}
              >
                {e.kind}
              </span>
              <span className="flex-1 text-xs text-zinc-200">{e.text}</span>
              <time className="shrink-0 font-mono text-[10px] text-zinc-500">{formatTime(e.at)}</time>
            </div>
          ))}
        </div>
      )}

      {total > events.length && (
        <p className="text-[10px] text-zinc-500">
          Showing the {events.length} most recent of {total} events.
        </p>
      )}
    </section>
  );
}
