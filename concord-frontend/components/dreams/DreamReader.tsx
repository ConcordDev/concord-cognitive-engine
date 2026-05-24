'use client';

/**
 * DreamReader — full-text reader for one dream record.
 *
 * Wraps `dreams.detail` (composed prose + fragments + summary) and
 * `dreams.interpret` (deterministic reflection linking fragments to
 * recent activity). Also surfaces tag editing and publish controls
 * (publish / reprice / unpublish) at a custom CC price.
 */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';

interface DreamFragment { kind?: string }
interface DreamSummary {
  combatHits?: number; combatTaken?: number; kills?: number;
  painCount?: number; painTotal?: number; gathered?: number;
  visited?: number; dtusCreated?: number;
}
interface DreamDetail {
  id: string;
  worldId?: string;
  dreamDtuId?: string;
  fragmentCount?: number;
  composer?: string;
  composedAt?: number;
  title?: string;
  prose?: string;
  fragments?: DreamFragment[];
  summary?: DreamSummary;
  scope?: string;
  priceCc?: number | null;
  tags?: string[];
}
interface Interpretation {
  composer?: string;
  tone?: string;
  themes?: string[];
  dominantFragment?: { kind: string; count: number } | null;
  fragmentKinds?: Record<string, number>;
  reflection?: string;
  reflections?: string[];
}

const SUMMARY_LABELS: Record<string, string> = {
  combatHits: 'Blows landed',
  combatTaken: 'Hits taken',
  kills: 'Kills',
  painCount: 'Pain signals',
  gathered: 'Gathers',
  visited: 'Thresholds crossed',
  dtusCreated: 'Thoughts formed',
};

const TONE_COLOR: Record<string, string> = {
  charged: 'text-rose-300 bg-rose-950/40 border-rose-800/50',
  tender: 'text-amber-300 bg-amber-950/40 border-amber-800/50',
  lucid: 'text-cyan-300 bg-cyan-950/40 border-cyan-800/50',
  calm: 'text-emerald-300 bg-emerald-950/40 border-emerald-800/50',
};

export function DreamReader({
  dreamId,
  onClose,
  onChanged,
}: {
  dreamId: string;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const [dream, setDream] = useState<DreamDetail | null>(null);
  const [interpretation, setInterpretation] = useState<Interpretation | null>(null);
  const [loading, setLoading] = useState(true);
  const [interpreting, setInterpreting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tagDraft, setTagDraft] = useState('');
  const [priceDraft, setPriceDraft] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const r = await lensRun<{ ok: boolean; dream?: DreamDetail }>('dreams', 'detail', { dreamId });
    if (r.data.ok && r.data.result?.dream) {
      setDream(r.data.result.dream);
      setTagDraft((r.data.result.dream.tags || []).join(', '));
      setPriceDraft(String(r.data.result.dream.priceCc ?? ''));
    } else {
      setError(r.data.error || 'Dream not found.');
    }
    setLoading(false);
  }, [dreamId]);

  useEffect(() => { void load(); }, [load]);

  const interpret = async (refresh = false) => {
    setInterpreting(true);
    const r = await lensRun<{ ok: boolean; interpretation?: Interpretation }>(
      'dreams', 'interpret', { dreamId, refresh },
    );
    if (r.data.ok && r.data.result?.interpretation) {
      setInterpretation(r.data.result.interpretation);
    }
    setInterpreting(false);
  };

  const saveTags = async () => {
    setBusy(true);
    const tags = tagDraft.split(',').map((t) => t.trim()).filter(Boolean);
    const r = await lensRun('dreams', 'tag', { dreamId, tags });
    if (r.data.ok) { await load(); onChanged?.(); }
    setBusy(false);
  };

  const doPublish = async () => {
    const priceCc = Math.round(Number(priceDraft));
    if (!Number.isFinite(priceCc) || priceCc < 1) { setError('Enter a price of at least 1 CC.'); return; }
    setBusy(true);
    setError(null);
    const r = await lensRun('dreams', 'publish', { dreamId, priceCc });
    if (r.data.ok) { await load(); onChanged?.(); } else { setError(r.data.error || 'Publish failed.'); }
    setBusy(false);
  };

  const doReprice = async () => {
    const priceCc = Math.round(Number(priceDraft));
    if (!Number.isFinite(priceCc) || priceCc < 1) { setError('Enter a price of at least 1 CC.'); return; }
    setBusy(true);
    setError(null);
    const r = await lensRun('dreams', 'reprice', { dreamId, priceCc });
    if (r.data.ok) { await load(); onChanged?.(); } else { setError(r.data.error || 'Reprice failed.'); }
    setBusy(false);
  };

  const doUnpublish = async () => {
    setBusy(true);
    setError(null);
    const r = await lensRun('dreams', 'unpublish', { dreamId });
    if (r.data.ok) { await load(); onChanged?.(); } else { setError(r.data.error || 'Unpublish failed.'); }
    setBusy(false);
  };

  const isPublished = dream?.scope === 'public';
  const summary = dream?.summary || {};
  const summaryRows = Object.entries(SUMMARY_LABELS)
    .map(([key, label]) => ({ key, label, value: Number((summary as Record<string, number>)[key] || 0) }))
    .filter((r) => r.value > 0);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 sm:p-8">
      <div className="w-full max-w-2xl rounded-2xl border border-purple-800/40 bg-zinc-950 shadow-2xl">
        <header className="flex items-center justify-between gap-3 border-b border-zinc-800 px-5 py-4">
          <h2 className="text-base font-bold text-zinc-100">
            {dream?.title || 'Dream'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2 py-1 text-sm text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          >
            Close
          </button>
        </header>

        <div className="space-y-5 px-5 py-5">
          {loading && <p className="text-sm text-zinc-400">Loading dream…</p>}
          {error && (
            <div className="rounded-lg border border-rose-800/50 bg-rose-950/40 px-3 py-2 text-sm text-rose-200">
              {error}
            </div>
          )}

          {dream && !loading && (
            <>
              <p className="text-[11px] font-mono text-zinc-400">
                {dream.fragmentCount ?? 0} fragments · {dream.composer} ·{' '}
                {dream.composedAt ? new Date(dream.composedAt * 1000).toLocaleString() : '—'}
                {dream.worldId ? ` · ${dream.worldId}` : ''}
              </p>

              {/* Full composed prose */}
              <article className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-4">
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-200">
                  {dream.prose || 'No prose recorded for this dream.'}
                </p>
              </article>

              {/* Substrate summary */}
              {summaryRows.length > 0 && (
                <section>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
                    Substrate that night
                  </h3>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {summaryRows.map((r) => (
                      <div key={r.key} className="rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-1.5">
                        <div className="text-[10px] uppercase tracking-wider text-zinc-400">{r.label}</div>
                        <div className="mt-0.5 font-mono text-lg text-purple-300">{r.value}</div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Interpretation */}
              <section>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                    Interpretation
                  </h3>
                  <button
                    type="button"
                    onClick={() => interpret(!!interpretation)}
                    disabled={interpreting}
                    className="rounded bg-indigo-700 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-600 disabled:opacity-50"
                  >
                    {interpreting ? 'Reflecting…' : interpretation ? 'Re-interpret' : 'Interpret this dream'}
                  </button>
                </div>
                {interpretation ? (
                  <div className={`rounded-xl border px-4 py-3 ${TONE_COLOR[interpretation.tone || 'calm'] || TONE_COLOR.calm}`}>
                    <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                      <span className="rounded bg-black/30 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider">
                        tone: {interpretation.tone}
                      </span>
                      {(interpretation.themes || []).map((t) => (
                        <span key={t} className="rounded bg-black/30 px-1.5 py-0.5 font-mono text-[10px]">
                          {t}
                        </span>
                      ))}
                    </div>
                    <p className="text-sm leading-relaxed">{interpretation.reflection}</p>
                    {interpretation.dominantFragment && (
                      <p className="mt-2 text-[11px] opacity-80">
                        Dominant fragment: {interpretation.dominantFragment.kind} (×{interpretation.dominantFragment.count})
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-zinc-400">
                    A deterministic reflection links this dream&apos;s fragments to your recent activity.
                  </p>
                )}
              </section>

              {/* Tags */}
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">Tags</h3>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={tagDraft}
                    onChange={(e) => setTagDraft(e.target.value)}
                    placeholder="comma-separated tags"
                    className="flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-600"
                  />
                  <button
                    type="button"
                    onClick={saveTags}
                    disabled={busy}
                    className="rounded-lg bg-zinc-700 px-3 py-1.5 text-sm font-medium text-zinc-100 hover:bg-zinc-600 disabled:opacity-50"
                  >
                    Save tags
                  </button>
                </div>
              </section>

              {/* Publish controls */}
              <section className="rounded-xl border border-purple-900/40 bg-purple-950/20 px-4 py-3">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-purple-300">
                  Marketplace {isPublished && <span className="text-emerald-400">· published</span>}
                </h3>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="text-xs text-zinc-400" htmlFor="dream-price">Price</label>
                  <input
                    id="dream-price"
                    type="number"
                    min={1}
                    value={priceDraft}
                    onChange={(e) => setPriceDraft(e.target.value)}
                    placeholder="CC"
                    className="w-24 rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-600"
                  />
                  <span className="text-xs text-zinc-400">CC</span>
                  {isPublished ? (
                    <>
                      <button
                        type="button"
                        onClick={doReprice}
                        disabled={busy}
                        className="rounded-lg bg-purple-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-purple-600 disabled:opacity-50"
                      >
                        Reprice
                      </button>
                      <button
                        type="button"
                        onClick={doUnpublish}
                        disabled={busy}
                        className="rounded-lg bg-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-100 hover:bg-zinc-600 disabled:opacity-50"
                      >
                        Unpublish
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={doPublish}
                      disabled={busy}
                      className="rounded-lg bg-purple-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-purple-600 disabled:opacity-50"
                    >
                      Publish
                    </button>
                  )}
                </div>
                <p className="mt-1.5 text-[11px] text-zinc-400">
                  Royalty cascade pays you on every purchase. Currency: CC.
                </p>
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
