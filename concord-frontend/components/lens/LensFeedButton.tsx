'use client';

/**
 * LensFeedButton — pulls a lens's real external data feed (free legal
 * API) and ingests each item as a visible DTU via the domain's `feed`
 * macro. The created DTUs surface in Recent, cross-lens discovery and
 * the feed lens.
 */

import { useState } from 'react';
import { Rss, Loader2, Check } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface FeedResult { ingested: number; skipped: number; source: string; dtuIds: string[] }

/**
 * `compact` renders an inline header button (result/error in its tooltip and a
 * small status line) instead of the full-width banner card.
 */
export function LensFeedButton({ domain, label, compact = false }: { domain: string; label?: string; compact?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<FeedResult | null>(null);
  const [err, setErr] = useState('');

  async function pull() {
    setBusy(true); setErr(''); setResult(null);
    const r = await lensRun(domain, 'feed', {});
    if (r.data?.ok) setResult(r.data.result as FeedResult);
    else setErr(r.data?.error || 'Feed unavailable.');
    setBusy(false);
  }

  if (compact) {
    const status = err
      ? err
      : result
        ? `Ingested ${result.ingested} new DTU${result.ingested === 1 ? '' : 's'} from ${result.source}${result.skipped > 0 ? ` · ${result.skipped} already seen` : ''}`
        : 'Ingest real items from a free public source as DTUs';
    return (
      <span className="inline-flex items-center gap-1.5">
        <button
          onClick={pull}
          disabled={busy}
          title={status}
          className="inline-flex items-center gap-1.5 rounded-md border border-white/10 px-2.5 py-1 text-[12px] text-zinc-300 hover:border-white/20 hover:text-white disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Rss className="h-3.5 w-3.5 text-emerald-400" />}
          {label || 'Pull feed'}
        </button>
        {(result || err) && (
          <span className={`text-[11px] ${err ? 'text-rose-400' : 'text-emerald-300'}`} role="status">
            {err ? 'Feed unavailable' : `+${result!.ingested}`}
          </span>
        )}
      </span>
    );
  }

  return (
    <div className="rounded-xl border border-emerald-900/40 bg-emerald-950/15 p-3">
      <div className="flex items-center gap-2">
        <Rss className="w-4 h-4 text-emerald-400" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold text-zinc-100">{label || 'Live data feed'}</p>
          <p className="text-[10px] text-zinc-400">Ingests real items from a free public source as DTUs.</p>
        </div>
        <button onClick={pull} disabled={busy}
          className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50 inline-flex items-center gap-1">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Rss className="w-3.5 h-3.5" />}
          Pull feed
        </button>
      </div>
      {result && (
        <p className="mt-2 text-[11px] text-emerald-300 inline-flex items-center gap-1">
          <Check className="w-3 h-3" />
          Ingested {result.ingested} new DTU{result.ingested === 1 ? '' : 's'} from {result.source}
          {result.skipped > 0 && <span className="text-zinc-400"> · {result.skipped} already seen</span>}
        </p>
      )}
      {err && <p className="mt-2 text-[11px] text-rose-400">{err}</p>}
    </div>
  );
}
