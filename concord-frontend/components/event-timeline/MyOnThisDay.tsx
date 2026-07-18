'use client';

/**
 * MyOnThisDay — "on this day" over the caller's REAL `dtus` history.
 *
 * Distinct from `OnThisDay.tsx` (which pulls Wikipedia's public
 * /feed/onthisday REST API — real, but external and generic-world data).
 * This panel is backed by the `event_timeline.on_this_day` macro
 * (server/domains/event-timeline.js): it queries the caller's own DTUs
 * for entries created on today's month+day in a prior year. Real rows
 * only, real dates, honest empty state — no fabricated "memories."
 *
 * This is the DTU-scoped half of the WAVE4 event-timeline "on this day"
 * gap. The full cross-source firehose version (every substrate event, not
 * just DTUs) needs a retention/storage decision — see the comment above
 * the `on_this_day` macro in server/domains/event-timeline.js — and is
 * intentionally not built here.
 */

import { useEffect, useState, useCallback } from 'react';
import { CalendarHeart, Loader2, LogIn } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface OnThisDayEntry {
  id: string;
  kind: string | null;
  title: string | null;
  createdAt: number;
  yearsAgo: number;
  preview: string;
}

interface OnThisDayResult {
  ok: boolean;
  month?: number;
  day?: number;
  count?: number;
  truncated?: boolean;
  entries?: OnThisDayEntry[];
  reason?: string;
}

function formatDate(unixSec: number): string {
  return new Date(unixSec * 1000).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export function MyOnThisDay() {
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<OnThisDayResult | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await lensRun<OnThisDayResult>('event_timeline', 'on_this_day', {});
    setResult(r.data?.result ?? null);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const entries = result?.entries || [];
  const notAuthed = result?.ok === false && result.reason === 'auth_required';

  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-center gap-2 border-b border-cyan-500/15 pb-3">
        <CalendarHeart className="h-5 w-5 text-emerald-400" />
        <h2 className="text-sm font-semibold text-white">On this day — your Concord history</h2>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">
          your dtus · same date, prior years
        </span>
      </header>

      {loading && (
        <div className="flex items-center gap-2 text-xs text-zinc-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Checking your history…
        </div>
      )}

      {!loading && notAuthed && (
        <div className="flex items-center gap-2 rounded border border-dashed border-zinc-800 p-4 text-[11px] text-zinc-400">
          <LogIn className="h-3.5 w-3.5 shrink-0" />
          Sign in to see entries you created on this date in past years.
        </div>
      )}

      {!loading && result?.ok && entries.length === 0 && (
        <div className="rounded border border-dashed border-zinc-800 p-4 text-center text-[11px] text-zinc-400">
          Nothing on this day yet — you haven&apos;t created anything on this date in a prior
          year (yet).
        </div>
      )}

      {!loading && result?.ok === false && !notAuthed && (
        <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">
          Couldn&apos;t load your history right now.
        </div>
      )}

      {!loading && entries.length > 0 && (
        <ul className="space-y-1.5">
          {entries.map((e) => (
            <li
              key={e.id}
              className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-2.5"
            >
              <div className="flex items-start gap-2">
                <span className="shrink-0 rounded bg-emerald-500/20 px-1.5 py-0.5 font-mono text-[10px] text-emerald-200">
                  {e.yearsAgo} {e.yearsAgo === 1 ? 'year' : 'years'} ago
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] text-zinc-100">{e.title || e.kind || 'Untitled'}</p>
                  {e.preview && <p className="mt-0.5 text-[11px] text-zinc-400">{e.preview}</p>}
                  <p className="mt-0.5 text-[10px] text-zinc-500">
                    {formatDate(e.createdAt)}
                    {e.kind ? ` · ${e.kind}` : ''}
                  </p>
                </div>
              </div>
            </li>
          ))}
          {result?.truncated && (
            <li className="text-center text-[10px] text-zinc-500">
              More entries exist for this date — showing the most recent.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
