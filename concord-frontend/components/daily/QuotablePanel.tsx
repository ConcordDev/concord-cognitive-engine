'use client';

/**
 * QuotablePanel — real Quotable random famous quotes, drop-in for
 * daily + reflection lenses. No API key.
 *
 * Phase 4 (fifth wave) of the UX completeness sprint.
 */

import { useState, useEffect } from 'react';
import { Quote, RefreshCw, AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Q {
  /** Null for the ZenQuotes and local sources, which carry no upstream id. */
  id: string | null;
  content: string;
  author: string;
  tags: string[];
}

/** Provenance the server reports with each live_quote reply. */
interface QuoteMeta {
  source?: string;
  degraded?: boolean;
  degradedReason?: string;
  filtersIgnored?: string[];
}

/** One line per honest caveat; empty when the reply came from the primary source unfiltered. */
function quoteNotes(meta: QuoteMeta, filterAppliedLocally = false): string[] {
  const notes: string[] = [];
  if (meta.degraded) {
    notes.push(
      meta.source === 'local'
        ? "Quotable is unavailable; showing a quote from Concord's built-in list."
        : `Quotable is unavailable; showing a quote from ${meta.source ?? 'a fallback source'}.`,
    );
  }
  if (meta.filtersIgnored && meta.filtersIgnored.length > 0) {
    // FIX-daily-009: the bare 'filter not applied' line left the user
    // guessing. The panel now applies the tag filter to the fallback
    // batch itself when it can (see below); when it cannot, the note
    // says why — the fallback sources cannot filter, and none of the
    // quotes they returned carries the requested tag.
    notes.push(
      filterAppliedLocally
        ? 'Tag filter applied to the fallback quotes (the live source, which filters server-side, is unavailable).'
        : 'Author/tag filter not applied — the live source is unavailable, the fallback sources cannot filter, and no quote they returned carries the requested tag.',
    );
  }
  return notes;
}

/** FIX-daily-009: fallback quote sources cannot honour the tag filter
 * server-side, so the panel applies it to the batch it got back. */
function applyTagFilter(quotes: Q[], tag?: string): Q[] {
  if (!tag) return quotes;
  const wanted = tag.toLowerCase();
  return quotes.filter((q) => (q.tags || []).some((t) => t.toLowerCase() === wanted));
}

/** Lens-run envelope: the macro's own reply sits under `result`. */
interface LensEnvelope<T> {
  ok?: boolean;
  result?: T;
  error?: string | null;
  reason?: string;
}

type QuoteReply = QuoteMeta & { ok: boolean; quotes?: Q[]; reason?: string };

/** Unwraps the envelope; any failure (transport, envelope ok:false, result ok:false) becomes an honest reason. */
async function runMacro(domain: string, name: string, input: Record<string, unknown>): Promise<QuoteReply> {
  try {
    const r = await api.post('/api/lens/run', { domain, name, input });
    const env = r?.data as LensEnvelope<QuoteReply> | undefined;
    if (!env?.ok) return { ok: false, reason: env?.reason || env?.error || 'fetch_failed' };
    const inner = env.result;
    if (!inner?.ok) return { ok: false, reason: inner?.reason || 'fetch_failed' };
    return inner;
  } catch {
    return { ok: false, reason: 'fetch_failed' };
  }
}

export interface QuotablePanelProps {
  domain: 'daily' | 'reflection';
  /** Optional tag to bias the random sample (e.g. "wisdom", "life"). */
  tag?: string;
  className?: string;
}

export function QuotablePanel({ domain, tag, className }: QuotablePanelProps) {
  const [quotes, setQuotes] = useState<Q[]>([]);
  const [meta, setMeta] = useState<QuoteMeta>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    // With a tag bias, fetch the server's max batch so the client-side
    // fallback filter (FIX-daily-009) has something to work with.
    const r = await runMacro(domain, 'live_quote', { limit: tag ? 10 : 3, ...(tag ? { tag } : {}) });
    if (r.ok) {
      setQuotes(r.quotes || []);
      setMeta(r);
    } else setError(r.reason || 'fetch_failed');
    setLoading(false);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await runMacro(domain, 'live_quote', { limit: tag ? 10 : 3, ...(tag ? { tag } : {}) });
      if (cancelled) return;
      if (r.ok) {
        setQuotes(r.quotes || []);
        setMeta(r);
      } else setError(r.reason || 'fetch_failed');
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [domain, tag]);

  // FIX-daily-009: when the serving source ignored the tag filter, apply
  // it here over the returned batch; show applied matches (up to 3) and
  // let the footer note say the filter was applied locally. When nothing
  // matches, show the batch unfiltered with the fuller explanation.
  const filterIgnored = Boolean(meta.filtersIgnored && meta.filtersIgnored.length > 0);
  const localMatches = filterIgnored ? applyTagFilter(quotes, tag) : [];
  const filterAppliedLocally = localMatches.length > 0;
  const displayQuotes = filterAppliedLocally ? localMatches.slice(0, 3) : quotes.slice(0, 3);
  const notes = quoteNotes(meta, filterAppliedLocally);

  return (
    <section className={cn('rounded-lg border border-zinc-800 bg-zinc-950/80 overflow-hidden', className)}>
      <header className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800/80 bg-zinc-900/40">
        <Quote className="w-4 h-4 text-yellow-300" aria-hidden="true" />
        <h3 className="text-sm font-medium text-zinc-100 flex-1">Quotable · today's quotes</h3>
        <span className="text-[10px] text-emerald-400 font-mono">REAL data</span>
        <button
          type="button"
          onClick={() => void fetchData()}
          disabled={loading}
          className="p-1 text-zinc-400 hover:text-zinc-200 transition-colors"
          aria-label="Refresh"
        >
          <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
        </button>
      </header>

      {error && (
        <div className="px-3 py-3 text-xs text-rose-300/80">
          <AlertTriangle className="inline w-3.5 h-3.5 mr-1" /> Quotable unreachable ({error})
        </div>
      )}

      {!error && displayQuotes.length > 0 && (
        <ul className="divide-y divide-zinc-800/40">
          {displayQuotes.map((q, i) => (
            <li key={q.id ?? `${q.author}-${i}`} className="px-4 py-3">
              <blockquote className="text-sm text-zinc-200 italic leading-relaxed">
                &ldquo;{q.content}&rdquo;
              </blockquote>
              <div className="mt-1.5 text-xs text-zinc-400 flex items-baseline gap-2">
                <span>— {q.author}</span>
                {q.tags.length > 0 && (
                  <span className="text-[10px] text-zinc-400 truncate">{q.tags.slice(0, 3).join(' · ')}</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <footer className="px-3 py-1.5 text-[10px] text-zinc-400 border-t border-zinc-800/40 space-y-0.5">
        {notes.map((n) => (
          <p key={n}>{n}</p>
        ))}
        {meta.source && <p>Source: {meta.source}</p>}
      </footer>
    </section>
  );
}

export default QuotablePanel;
