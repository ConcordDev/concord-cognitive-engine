'use client';

/**
 * DispatchArchive — searchable history archive of goddess dispatches.
 * Free-text query + tone filter + time-range filter, with a tone
 * distribution chart over the world's full dispatch history.
 */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz/ChartKit';
import { Loader2, Search, Archive } from 'lucide-react';
import { TONE_COLOR, KNOWN_TONES, type Dispatch } from './types';

interface ArchiveResult {
  worldId: string;
  dispatches: Dispatch[];
  count: number;
  toneCounts: Record<string, number>;
}

const RANGES = [
  { id: 'all', label: 'All time', days: 0 },
  { id: '7d', label: 'Last 7 days', days: 7 },
  { id: '30d', label: 'Last 30 days', days: 30 },
  { id: '90d', label: 'Last 90 days', days: 90 },
];

export function DispatchArchive({
  worldId,
  onOpen,
}: {
  worldId: string;
  onOpen: (id: number) => void;
}) {
  const [query, setQuery] = useState('');
  const [tone, setTone] = useState<string>('');
  const [range, setRange] = useState('all');
  const [result, setResult] = useState<ArchiveResult | null>(null);
  const [loading, setLoading] = useState(true);

  const search = useCallback(async () => {
    setLoading(true);
    const params: Record<string, unknown> = { worldId, limit: 100 };
    if (query.trim()) params.query = query.trim();
    if (tone) params.tone = tone;
    const rangeDef = RANGES.find((r) => r.id === range);
    if (rangeDef && rangeDef.days > 0) {
      params.fromTs = Math.floor(Date.now() / 1000) - rangeDef.days * 86400;
    }
    const r = await lensRun('goddess', 'archive', params);
    if (r.data?.ok) setResult(r.data.result as ArchiveResult);
    else setResult(null);
    setLoading(false);
  }, [worldId, query, tone, range]);

  useEffect(() => {
    const t = window.setTimeout(() => { void search(); }, 300);
    return () => window.clearTimeout(t);
  }, [search]);

  const toneChart = result
    ? Object.entries(result.toneCounts).map(([t, n]) => ({ tone: t, dispatches: n }))
    : [];

  return (
    <div className="space-y-4">
      <header className="flex items-center gap-2">
        <Archive className="h-4 w-4 text-amber-400" />
        <h2 className="text-sm font-semibold text-zinc-100">Dispatch archive</h2>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
          <input
            type="text" value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Search the goddess's words…"
            className="w-full rounded border border-zinc-700 bg-zinc-950 py-1.5 pl-7 pr-2 text-xs text-zinc-100"
          />
        </div>
        <select
          value={tone} onChange={(e) => setTone(e.target.value)}
          className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-200"
        >
          <option value="">All tones</option>
          {KNOWN_TONES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select
          value={range} onChange={(e) => setRange(e.target.value)}
          className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-200"
        >
          {RANGES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
        </select>
      </div>

      {result && toneChart.length > 0 && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-3">
          <p className="mb-2 text-[11px] uppercase tracking-wider text-zinc-400">
            Tone distribution — full history
          </p>
          <ChartKit
            kind="bar" data={toneChart} xKey="tone"
            series={[{ key: 'dispatches', label: 'Dispatches', color: '#f59e0b' }]}
            height={160} showLegend={false}
          />
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-zinc-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Searching the archive…
        </div>
      ) : !result || result.count === 0 ? (
        <div className="rounded-xl border border-zinc-800 py-8 text-center text-xs text-zinc-400 italic">
          {query || tone || range !== 'all'
            ? 'No dispatches match these filters.'
            : 'No dispatches archived in this world yet.'}
        </div>
      ) : (
        <>
          <p className="text-[11px] text-zinc-400">{result.count} dispatch(es) found</p>
          <ul className="space-y-2">
            {result.dispatches.map((d) => (
              <li key={d.id}>
                <button
                  type="button" onClick={() => onOpen(d.id)}
                  className={`w-full border-l-4 rounded-r-lg px-3 py-2 text-left transition-opacity hover:opacity-90 ${
                    TONE_COLOR[d.tone] || TONE_COLOR.neutral
                  }`}
                >
                  <p className="text-sm italic leading-snug">{d.body}</p>
                  <p className="mt-1 font-mono text-[10px] opacity-70">
                    {d.tone}
                    {d.drift_kind ? ` · drift ${d.drift_kind}` : ''} ·{' '}
                    {new Date(d.composed_at * 1000).toLocaleString()}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
