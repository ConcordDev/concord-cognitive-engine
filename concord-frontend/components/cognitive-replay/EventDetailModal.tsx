'use client';

/**
 * EventDetailModal — resolves a single timeline event via the
 * `cognitive-replay.event` macro and shows full detail plus a deep-link
 * to jump to that conversation turn in the chat lens.
 */

import { useEffect, useState, useCallback } from 'react';
import { Loader2, X, ArrowRightCircle } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface EventDetail {
  eventId: string;
  sessionId: string;
  turnIndex: number;
  ts: number | null;
  role: string;
  brainsUsed: string[];
  toolCalls: unknown[];
  dtusCited: string[];
  tokenCount: number | null;
  contentPreview: string | null;
}
interface JumpTo { lens: string; sessionId: string; turnIndex: number; url: string }
interface EventResult { event: EventDetail; jumpTo: JumpTo }

const BRAIN_COLORS: Record<string, string> = {
  conscious: 'bg-amber-500', subconscious: 'bg-purple-500',
  utility: 'bg-cyan-500', repair: 'bg-rose-500', vision: 'bg-emerald-500',
};

export function EventDetailModal({ eventId, onClose }: { eventId: string; onClose: () => void }) {
  const [data, setData] = useState<EventResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const r = await lensRun<EventResult>('cognitive-replay', 'event', { eventId });
    if (r.data.ok && r.data.result) { setData(r.data.result); setError(null); }
    else { setData(null); setError(r.data.error || 'event not found'); }
    setLoading(false);
  }, [eventId]);

  useEffect(() => { load(); }, [load]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
      <div
        className="w-full max-w-md rounded-2xl border border-zinc-700 bg-zinc-950 p-5"
        onClick={(e) => e.stopPropagation()} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-zinc-100">Event detail</h3>
          <button onClick={onClose} aria-label="Close" className="text-zinc-400 hover:text-zinc-200">
            <X className="h-4 w-4" />
          </button>
        </div>
        {loading ? (
          <div role="status" aria-live="polite" className="mt-4 flex items-center gap-2 text-xs text-zinc-400"><Loader2 className="h-4 w-4 animate-spin" /> Resolving event…</div>
        ) : error ? (
          <div role="alert" className="mt-4 flex items-center justify-between gap-3 rounded border border-rose-500/20 bg-rose-500/5 px-3 py-2 text-xs text-rose-300">
            <span>{error}</span>
            <button onClick={load} className="rounded border border-rose-500/40 px-2 py-0.5 font-medium text-rose-100 hover:bg-rose-500/20">Retry</button>
          </div>
        ) : data ? (
          <div className="mt-3 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">{data.event.role}</span>
              <span className="font-mono text-[10px] text-zinc-400">
                {data.event.ts ? new Date(data.event.ts).toLocaleString() : '—'}
              </span>
            </div>
            {data.event.brainsUsed.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {data.event.brainsUsed.map((b) => (
                  <span key={b} className={`rounded px-2 py-0.5 text-[10px] font-mono uppercase text-white ${BRAIN_COLORS[b] || 'bg-zinc-600'}`}>{b}</span>
                ))}
              </div>
            )}
            {data.event.contentPreview && (
              <p className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-2.5 text-sm italic leading-relaxed text-zinc-200">
                {data.event.contentPreview}
              </p>
            )}
            <div className="grid grid-cols-3 gap-2 border-t border-zinc-800 pt-2 font-mono text-[10px] text-zinc-400">
              <span>tokens: {data.event.tokenCount ?? '—'}</span>
              <span>tools: {data.event.toolCalls.length}</span>
              <span>DTUs: {data.event.dtusCited.length}</span>
            </div>
            {data.event.dtusCited.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {data.event.dtusCited.map((d) => (
                  <span key={d} className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[9px] text-zinc-400">{d}</span>
                ))}
              </div>
            )}
            <a
              href={data.jumpTo.url}
              className="flex items-center justify-center gap-1.5 rounded-lg border border-cyan-500/40 bg-cyan-500/10 py-2 text-xs font-medium text-cyan-200 hover:bg-cyan-500/20"
            >
              <ArrowRightCircle className="h-3.5 w-3.5" />
              Jump to this conversation
            </a>
          </div>
        ) : null}
      </div>
    </div>
  );
}
