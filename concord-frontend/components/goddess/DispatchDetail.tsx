'use client';

/**
 * DispatchDetail — permalink / drill-in view for a single goddess
 * dispatch. Surfaces the full body, prev/next navigation, the commune
 * (react) mechanic, and the correlated triggering world event.
 */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { Loader2, ChevronLeft, ChevronRight, Link2, CalendarClock } from 'lucide-react';
import {
  TONE_COLOR, COMMUNE_KINDS,
  type Dispatch, type DispatchStub, type ReactionsResult, type CorrelateResult,
} from './types';

interface DetailResult {
  dispatch: Dispatch;
  prev: DispatchStub | null;
  next: DispatchStub | null;
  reactionCount: number;
}

function fmtOffset(seconds: number): string {
  const abs = Math.abs(seconds);
  const mins = Math.round(abs / 60);
  const rel = mins < 60 ? `${mins}m` : `${Math.round(mins / 60)}h`;
  if (seconds === 0) return 'at compose time';
  return seconds < 0 ? `${rel} before` : `${rel} after`;
}

export function DispatchDetail({
  dispatchId,
  onNavigate,
  onClose,
}: {
  dispatchId: number;
  onNavigate: (id: number) => void;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<DetailResult | null>(null);
  const [reactions, setReactions] = useState<ReactionsResult | null>(null);
  const [correlation, setCorrelation] = useState<CorrelateResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadReactions = useCallback(async () => {
    const r = await lensRun('goddess', 'reactions', { dispatchId });
    if (r.data?.ok) setReactions(r.data.result as ReactionsResult);
  }, [dispatchId]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    void (async () => {
      const d = await lensRun('goddess', 'detail', { dispatchId });
      if (!alive) return;
      if (d.data?.ok) {
        setDetail(d.data.result as DetailResult);
      } else {
        setError(d.data?.error || 'Dispatch not found.');
      }
      const c = await lensRun('goddess', 'correlate', { dispatchId, windowSeconds: 7200 });
      if (alive && c.data?.ok) setCorrelation(c.data.result as CorrelateResult);
      await loadReactions();
      if (alive) setLoading(false);
    })();
    return () => { alive = false; };
  }, [dispatchId, loadReactions]);

  const react = async (kind: string) => {
    setSubmitting(true);
    const r = await lensRun('goddess', 'react', { dispatchId, kind, note: note.trim() });
    if (r.data?.ok) {
      setNote('');
      await loadReactions();
    } else {
      setError(r.data?.error || 'Could not commune.');
    }
    setSubmitting(false);
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-950/60 p-6 text-sm text-zinc-400">
        <Loader2 className="h-4 w-4 animate-spin" /> Resolving dispatch…
      </div>
    );
  }
  if (error && !detail) {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-6 text-sm text-red-300">
        {error}
        <button type="button" onClick={onClose} className="ml-3 underline">Back to feed</button>
      </div>
    );
  }
  if (!detail) return null;

  const d = detail.dispatch;
  const tone = TONE_COLOR[d.tone] || TONE_COLOR.neutral;
  const cand = correlation?.candidate || null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button
          type="button" onClick={onClose}
          className="text-xs text-zinc-400 hover:text-zinc-200"
        >
          ← Back to feed
        </button>
        <span className="flex items-center gap-1 font-mono text-[10px] text-zinc-400">
          <Link2 className="h-3 w-3" /> dispatch #{d.id}
        </span>
      </div>

      <article className={`border-l-4 rounded-r-xl px-5 py-4 ${tone}`}>
        <p className="text-lg italic leading-relaxed">{d.body}</p>
        <p className="mt-3 font-mono text-[11px] opacity-70">
          {d.tone} · ecosystem {d.ecosystem_score?.toFixed(2) ?? '—'} · refusal{' '}
          {d.refusal_strength?.toFixed(1) ?? '—'}
          {d.drift_kind ? ` · drift ${d.drift_kind}` : ''}
        </p>
        <p className="mt-1 font-mono text-[11px] opacity-60">
          {new Date(d.composed_at * 1000).toLocaleString()}
        </p>
      </article>

      <div className="flex items-center justify-between gap-2">
        <button
          type="button" disabled={!detail.prev}
          onClick={() => detail.prev && onNavigate(detail.prev.id)}
          className="flex items-center gap-1 rounded border border-zinc-800 px-2.5 py-1.5 text-xs text-zinc-300 enabled:hover:border-zinc-600 disabled:opacity-30"
        >
          <ChevronLeft className="h-3.5 w-3.5" /> Earlier
        </button>
        <button
          type="button" disabled={!detail.next}
          onClick={() => detail.next && onNavigate(detail.next.id)}
          className="flex items-center gap-1 rounded border border-zinc-800 px-2.5 py-1.5 text-xs text-zinc-300 enabled:hover:border-zinc-600 disabled:opacity-30"
        >
          Later <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Correlated triggering world event */}
      <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-400">
          <CalendarClock className="h-3.5 w-3.5" /> Triggering world event
        </h3>
        {cand ? (
          <div className="mt-2 rounded-lg border border-cyan-500/20 bg-cyan-500/5 px-3 py-2">
            <p className="text-sm text-zinc-100">{cand.title || `Event #${cand.id}`}</p>
            <p className="mt-0.5 font-mono text-[11px] text-cyan-300">
              {cand.event_type ? `${cand.event_type} · ` : ''}{fmtOffset(cand.offsetSeconds)} the dispatch
            </p>
          </div>
        ) : (
          <p className="mt-2 text-xs text-zinc-400 italic">
            No world event found near this dispatch&apos;s compose time.
          </p>
        )}
        {correlation && correlation.nearby.length > 1 && (
          <ul className="mt-2 space-y-1">
            {correlation.nearby.filter((e) => e.id !== cand?.id).slice(0, 4).map((e) => (
              <li key={e.id} className="font-mono text-[11px] text-zinc-400">
                {e.title || `Event #${e.id}`} — {fmtOffset(e.offsetSeconds)}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Commune (react) */}
      <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
          Commune with this dispatch
        </h3>
        <textarea
          value={note} onChange={(e) => setNote(e.target.value)} maxLength={280}
          placeholder="Add a word to the commune (optional)…"
          className="mt-2 w-full resize-none rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-100"
          rows={2}
        />
        <div className="mt-2 flex flex-wrap gap-1.5">
          {COMMUNE_KINDS.map((k) => (
            <button
              key={k.id} type="button" disabled={submitting}
              onClick={() => react(k.id)}
              className={`rounded-full border px-3 py-1 text-[11px] transition-colors disabled:opacity-40 ${
                reactions?.mine?.kind === k.id
                  ? 'border-amber-500 bg-amber-500/20 text-amber-200'
                  : 'border-zinc-700 bg-zinc-950 text-zinc-300 hover:border-zinc-500'
              }`}
            >
              {k.label}
              {reactions?.byKind[k.id] ? ` · ${reactions.byKind[k.id]}` : ''}
            </button>
          ))}
        </div>
        {reactions && reactions.total > 0 ? (
          <p className="mt-2 text-[11px] text-zinc-400">
            {reactions.total} {reactions.total === 1 ? 'soul has' : 'souls have'} communed.
          </p>
        ) : (
          <p className="mt-2 text-[11px] text-zinc-400 italic">No one has communed here yet.</p>
        )}
        {reactions && reactions.notes.length > 0 && (
          <ul className="mt-2 space-y-1.5 border-t border-zinc-800 pt-2">
            {reactions.notes.map((n, i) => (
              <li key={i} className={`text-xs ${n.mine ? 'text-amber-200' : 'text-zinc-300'}`}>
                <span className="font-mono text-[10px] uppercase opacity-60">{n.kind}</span>{' '}
                {n.note}
              </li>
            ))}
          </ul>
        )}
      </section>

      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
