'use client';

/**
 * TimelinePanel — chronological status log for a crisis. Calls
 * crisis.timeline to read the event record and crisis.log_event to append
 * a new status update. Plots events on the shared TimelineView surface.
 */

import { useEffect, useState, useCallback } from 'react';
import { History, Loader2, Send } from 'lucide-react';
import { TimelineView, type TimelineEvent } from '@/components/viz';
import { lensRun } from '@/lib/api/client';

interface LogEntry {
  id: string;
  kind: string;
  note: string;
  by: string;
  at: number;
}
interface TimelineResult {
  crisisId: string;
  events: LogEntry[];
  count: number;
}

const KIND_TONE: Record<string, TimelineEvent['tone']> = {
  started: 'warn',
  resolved: 'good',
  assignment: 'info',
  resource: 'info',
  escalation: 'bad',
  update: 'default',
};

export function TimelinePanel({ crisisId }: { crisisId: string }) {
  const [data, setData] = useState<TimelineResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState('');
  const [kind, setKind] = useState('update');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await lensRun<TimelineResult>('crisis', 'timeline', { crisisId });
    if (r.data?.ok && r.data.result) setData(r.data.result);
    setLoading(false);
  }, [crisisId]);

  useEffect(() => { load(); }, [load]);

  const post = useCallback(async () => {
    if (!note.trim()) return;
    setBusy(true);
    const r = await lensRun('crisis', 'log_event', {
      crisisId, kind, note: note.trim(),
    });
    if (r.data?.ok) { setNote(''); await load(); }
    setBusy(false);
  }, [crisisId, kind, note, load]);

  const vizEvents: TimelineEvent[] = (data?.events || []).map((e) => ({
    id: e.id,
    label: e.kind,
    time: e.at,
    tone: KIND_TONE[e.kind] || 'default',
    detail: e.note,
  }));

  return (
    <div className="space-y-3">
      <header className="flex items-center gap-2">
        <History className="h-4 w-4 text-rose-300" />
        <h3 className="text-sm font-semibold text-white">Status log</h3>
        {data && (
          <span className="font-mono text-[11px] text-zinc-400">{data.count} events</span>
        )}
      </header>

      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-white/5 p-2">
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-white"
        >
          <option value="update">update</option>
          <option value="escalation">escalation</option>
          <option value="resource">resource</option>
          <option value="assignment">assignment</option>
        </select>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && post()}
          placeholder="Log a status update…"
          className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-white placeholder:text-zinc-400"
        />
        <button
          type="button"
          disabled={busy || !note.trim()}
          onClick={post}
          className="flex items-center gap-1 rounded bg-rose-600/30 px-2 py-1 text-xs text-rose-100 hover:bg-rose-600/50 disabled:opacity-40"
        >
          <Send className="h-3 w-3" /> Log
        </button>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-xs text-zinc-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading timeline…
        </div>
      )}

      {!loading && data && data.count > 0 && (
        <>
          <div className="rounded-lg border border-white/10 bg-black/20 p-2">
            <TimelineView events={vizEvents} height={90} />
          </div>
          <ul className="max-h-64 space-y-1.5 overflow-y-auto">
            {[...data.events].reverse().map((e) => (
              <li
                key={e.id}
                className="rounded border border-white/10 bg-white/5 px-2.5 py-1.5 text-sm"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="rounded bg-black/40 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-zinc-400">
                    {e.kind}
                  </span>
                  <span className="font-mono text-[10px] text-zinc-400">
                    {new Date(e.at).toLocaleString()}
                  </span>
                </div>
                <p className="mt-1 text-[12px] text-zinc-200">{e.note}</p>
              </li>
            ))}
          </ul>
        </>
      )}

      {!loading && data && data.count === 0 && (
        <p className="rounded border border-white/10 bg-white/5 p-3 text-center text-xs text-zinc-400">
          No events logged yet.
        </p>
      )}
    </div>
  );
}
