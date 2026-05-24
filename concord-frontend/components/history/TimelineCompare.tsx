'use client';

/**
 * TimelineCompare — parallel multi-track view: stacks two or more of the
 * user's timelines on a shared time axis so eras and events line up across
 * regions. Data comes from history.timeline-compare. No hardcoded data.
 */

import { useCallback, useState } from 'react';
import { GitCompareArrows } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface TLMeta { id: string; title: string }
interface CmpEvent { id: string; title: string; year: number; dateLabel: string; category: string }
interface CmpEra { id: string; name: string; startYear: number | null; endYear: number | null; color: string }
interface CmpTrack {
  timelineId: string;
  title: string;
  events: CmpEvent[];
  eras: CmpEra[];
  span: { minYear: number; maxYear: number } | null;
  eventCount: number;
}
interface CmpResult {
  tracks: CmpTrack[];
  combinedSpan: { minYear: number; maxYear: number } | null;
  trackCount: number;
}

export function TimelineCompare({ timelines }: { timelines: TLMeta[] }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [result, setResult] = useState<CmpResult | null>(null);
  const [error, setError] = useState('');

  const toggle = useCallback((id: string) => {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id].slice(0, 6)));
  }, []);

  const compare = useCallback(async () => {
    setError('');
    if (selected.length < 2) { setError('Select at least 2 timelines'); return; }
    const r = await lensRun<CmpResult>('history', 'timeline-compare', { timelineIds: selected });
    if (r.data?.ok && r.data.result) setResult(r.data.result);
    else { setError(r.data?.error || 'Compare failed'); setResult(null); }
  }, [selected]);

  const span = result?.combinedSpan;
  const pct = (year: number): number => {
    if (!span) return 0;
    const range = Math.max(1, span.maxYear - span.minYear);
    return ((year - span.minYear) / range) * 100;
  };

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-zinc-400">Pick 2–6 timelines to stack on one axis.</p>
      <div className="flex flex-wrap gap-1.5">
        {timelines.length === 0 && <span className="text-[11px] text-zinc-400 italic">No timelines yet.</span>}
        {timelines.map((t) => (
          <button key={t.id} onClick={() => toggle(t.id)}
            className={cn('px-2.5 py-1 text-[11px] rounded-lg border',
              selected.includes(t.id)
                ? 'bg-amber-600/15 border-amber-700/50 text-amber-200'
                : 'bg-zinc-900/60 border-zinc-800 text-zinc-300 hover:border-zinc-700')}>
            {t.title}
          </button>
        ))}
        <button onClick={compare} disabled={selected.length < 2}
          className="px-2.5 py-1 text-[11px] rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-semibold disabled:opacity-40 inline-flex items-center gap-1">
          <GitCompareArrows className="w-3.5 h-3.5" /> Compare
        </button>
      </div>
      {error && <p className="text-[10px] text-rose-400">{error}</p>}

      {result && span && (
        <div className="space-y-2.5">
          <div className="flex justify-between text-[10px] font-mono text-zinc-400">
            <span>{span.minYear}</span>
            <span>{span.maxYear}</span>
          </div>
          {result.tracks.map((tr) => (
            <div key={tr.timelineId}>
              <p className="text-[11px] font-semibold text-zinc-200 mb-0.5">
                {tr.title} <span className="text-zinc-600">· {tr.eventCount} events</span>
              </p>
              <div className="relative h-9 rounded bg-zinc-950/80 border border-zinc-800 overflow-hidden">
                {tr.eras.map((era) => {
                  if (era.startYear == null || era.endYear == null) return null;
                  const left = pct(era.startYear);
                  const width = pct(era.endYear) - left;
                  return (
                    <div key={era.id} className="absolute top-0 bottom-0"
                      style={{ left: `${Math.max(0, left)}%`, width: `${Math.max(1, width)}%`, backgroundColor: `${era.color}26` }} />
                  );
                })}
                <div className="absolute left-0 right-0 top-1/2 h-px bg-zinc-700" />
                {tr.events.map((e) => (
                  <span key={e.id}
                    className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-amber-400 border border-zinc-950"
                    style={{ left: `${pct(e.year)}%` }}
                    title={`${e.dateLabel} — ${e.title}`} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
