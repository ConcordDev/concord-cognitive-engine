'use client';

import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { History, Loader2, BarChart3 } from 'lucide-react';
import { api } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface TimelineEvent {
  ts: number | null;
  role?: string;
  brainsUsed?: string[];
  toolCalls?: unknown[];
  dtusCited?: string[];
  tokenCount?: number | null;
  contentPreview?: string | null;
  sessionId?: string;
}

const WINDOWS = [
  { id: 50, label: '50' },
  { id: 200, label: '200' },
  { id: 500, label: '500' },
] as const;

export function TimelineExport() {
  const [limit, setLimit] = useState<typeof WINDOWS[number]['id']>(200);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useMutation({
    mutationFn: async () => {
      setError(null);
      try {
        const r = await api.post('/api/lens/run', { domain: 'chat', name: 'timeline', input: { limit } });
        const data = r.data as { ok: boolean; events?: TimelineEvent[]; result?: { events?: TimelineEvent[] } };
        const ev = data.events || data.result?.events || [];
        setEvents(ev as TimelineEvent[]);
      } catch (e) { setEvents([]); setError(e instanceof Error ? e.message : 'request failed'); }
    },
  });

  useEffect(() => {
    load.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [limit]);

  const brainUseCounts: Record<string, number> = {};
  let totalTokens = 0;
  let citationCount = 0;
  for (const e of events) {
    for (const b of (e.brainsUsed || [])) brainUseCounts[b] = (brainUseCounts[b] || 0) + 1;
    if (e.tokenCount) totalTokens += e.tokenCount;
    citationCount += (e.dtusCited || []).length;
  }
  const sessions = new Set(events.map((e) => e.sessionId).filter(Boolean)).size;
  const maxBrain = Math.max(1, ...Object.values(brainUseCounts));

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <History className="h-5 w-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">Timeline export &amp; stats</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">chat.timeline macro · real cognitive trace</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border border-zinc-800 bg-zinc-950 p-0.5 text-[10px]">
            {WINDOWS.map((w) => (
              <button key={w.id} onClick={() => setLimit(w.id)} className={`rounded px-2 py-0.5 font-mono uppercase ${limit === w.id ? 'bg-cyan-500/20 text-cyan-200' : 'text-zinc-400 hover:text-zinc-300'}`}>{w.label}</button>
            ))}
          </div>
          {events.length > 0 && (
            <SaveAsDtuButton
              compact
              apiSource="concord-cognitive-replay"
              title={`Cognitive timeline — last ${events.length} turns`}
              content={`Sessions: ${sessions}\nTurns: ${events.length}\nTotal tokens: ${totalTokens.toLocaleString()}\nDTU citations: ${citationCount}\n\nBrain usage:\n${Object.entries(brainUseCounts).sort((a, b) => b[1] - a[1]).map(([k, n]) => `  ${k}: ${n}`).join('\n')}\n\nLast 20 turns:\n${events.slice(0, 20).map((e) => `  ${e.ts ? new Date(e.ts).toISOString() : '?'} · ${e.role} · brains=${(e.brainsUsed || []).join('+')} · tok=${e.tokenCount ?? '-'} · cites=${(e.dtusCited || []).length}`).join('\n')}`}
              extraTags={['cognitive-replay', 'chat-timeline', 'cognition']}
              rawData={{ limit, events }}
            />
          )}
        </div>
      </header>
      {error && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">{error}</div>}
      {load.isPending && <div className="flex items-center gap-2 text-xs text-zinc-400"><Loader2 className="h-4 w-4 animate-spin" /> Loading timeline…</div>}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Cell label="Turns" value={events.length.toString()} />
        <Cell label="Sessions" value={sessions.toString()} />
        <Cell label="Tokens" value={totalTokens.toLocaleString()} />
        <Cell label="DTU citations" value={citationCount.toString()} />
      </div>
      {Object.keys(brainUseCounts).length > 0 && (
        <div className="rounded-md border border-zinc-800 bg-zinc-950/40 p-3">
          <div className="mb-2 flex items-center gap-1 text-xs font-semibold text-zinc-200"><BarChart3 className="h-3.5 w-3.5 text-cyan-400" /> Brain usage</div>
          <div className="space-y-1">
            {Object.entries(brainUseCounts).sort((a, b) => b[1] - a[1]).map(([k, n]) => (
              <div key={k} className="flex items-center gap-2 text-[11px]">
                <span className="w-20 font-mono text-zinc-400">{k}</span>
                <div className="flex-1 rounded-full bg-zinc-800">
                  <div className="h-2 rounded-full bg-cyan-500/60" style={{ width: `${(n / maxBrain) * 100}%` }} />
                </div>
                <span className="w-12 text-right font-mono text-cyan-300">{n}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5">
      <div className="text-[10px] uppercase tracking-wider text-zinc-400">{label}</div>
      <div className="mt-0.5 font-mono text-lg text-cyan-300">{value}</div>
    </div>
  );
}
