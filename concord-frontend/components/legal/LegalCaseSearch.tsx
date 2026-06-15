'use client';

/**
 * LegalCaseSearch — bespoke CourtListener case-opinion search for the
 * legal lens. Backed by the real `law.courtlistener-search` macro
 * (CourtListener REST API v4, federal + state opinions, free with
 * optional COURTLISTENER_API_TOKEN env for higher rate limits).
 *
 * A legal case-search surface.
 *
 *   • Search box with filter chips (court / date-after / date-before
 *     / natural-language vs terms-and-connectors mode hint)
 *   • Multi-line result cards: case name + court + date + cited-by
 *     count + judge + snippet preview with query-term highlighting
 *   • Per-result Save-as-DTU (source: "courtlistener") + Clip-to-Folder
 *     (in-memory v1) + open-on-courtlistener external link
 *   • No-result state with broad-search retry hint
 *
 * The "signal flag" proxy (Good Law / Caution / Negative-Treatment)
 * mentioned in research requires CourtListener's `cited_by` data which
 * isn't in the search response — left for a follow-up that adds a
 * separate macro for the cited-by count + opinion-full fetch.
 */

import { useState, useMemo } from 'react';
import { useMutation } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BookOpen, Loader2, Search, ExternalLink, Calendar, Bookmark, BookmarkCheck,
  Scale, ChevronDown, Filter, X,
} from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface SearchHit {
  id: number;
  caseName: string;
  court: string | null;
  courtId: string | null;
  dateFiled: string | null;
  absoluteUrl: string | null;
  snippet: string | null;
  citation: string[] | string | null;
  precedentialStatus: string | null;
  docketNumber: string | null;
  judges: string | null;
  author: string | null;
}

interface SearchResult {
  query: string;
  results: SearchHit[];
  count: number;
  totalHits: number;
  authenticatedWithToken: boolean;
  source: string;
}

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }

async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('law', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) {
    return data.result as MacroEnvelope<T>;
  }
  return data as MacroEnvelope<T>;
}

// Top US federal courts surfaced as quick filters — long-tail accessible via free-text
const QUICK_COURTS = [
  { id: 'scotus', label: 'Supreme Court' },
  { id: 'ca1', label: '1st Cir' },
  { id: 'ca2', label: '2nd Cir' },
  { id: 'ca3', label: '3rd Cir' },
  { id: 'ca5', label: '5th Cir' },
  { id: 'ca9', label: '9th Cir' },
  { id: 'cadc', label: 'D.C. Cir' },
  { id: 'cafc', label: 'Fed Cir' },
];

export function LegalCaseSearch() {
  const [queryInput, setQueryInput] = useState('');
  const [activeQuery, setActiveQuery] = useState<string | null>(null);
  const [court, setCourt] = useState('');
  const [dateAfter, setDateAfter] = useState('');
  const [dateBefore, setDateBefore] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [clipped, setClipped] = useState<Set<number>>(new Set());

  const searchQuery = useMutation({
    mutationFn: async (params: Record<string, unknown>) =>
      callMacro<SearchResult>('courtlistener-search', params),
    onSuccess: (env) => {
      if (env.ok && env.result) { setResult(env.result); setErrorMsg(null); }
      else { setResult(null); setErrorMsg(env.error || 'No results'); }
    },
    onError: (e: Error) => setErrorMsg(e.message),
  });

  const runSearch = (e?: React.FormEvent) => {
    e?.preventDefault();
    const q = queryInput.trim();
    if (!q) return;
    setActiveQuery(q);
    const params: Record<string, unknown> = { query: q, limit: 20 };
    if (court.trim()) params.court = court.trim();
    if (dateAfter) params.dateAfter = dateAfter;
    if (dateBefore) params.dateBefore = dateBefore;
    searchQuery.mutate(params);
  };

  const toggleClipped = (id: number) => {
    setClipped((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const hasActiveFilters = !!(court || dateAfter || dateBefore);

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <Scale className="h-5 w-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">Case Law Search</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">
            courtlistener · 9M+ opinions
          </span>
        </div>
        {result && (
          <span className="text-[11px] text-zinc-400">
            {result.results.length} of {result.totalHits?.toLocaleString() || '?'} hits
            {result.authenticatedWithToken && <span className="ml-2 text-cyan-300/80">· authenticated</span>}
          </span>
        )}
      </header>

      <form onSubmit={runSearch} className="space-y-2">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
            <input
              type="text"
              value={queryInput}
              onChange={(e) => setQueryInput(e.target.value)}
              placeholder='Brown v. Board · "qualified immunity" · 4th amendment search'
              className="w-full rounded-md border border-zinc-800 bg-zinc-950 py-1.5 pl-8 pr-3 text-sm text-white placeholder-zinc-600 focus:border-cyan-500/40 focus:outline-none"
            />
          </div>
          <button
            type="button"
            onClick={() => setShowFilters((v) => !v)}
            className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs transition-colors ${
              hasActiveFilters || showFilters
                ? 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300'
                : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Filter className="h-3.5 w-3.5" />
            Filters
            {hasActiveFilters && <span className="rounded-full bg-cyan-500/30 px-1.5 text-[10px] text-cyan-100">on</span>}
            <ChevronDown className={`h-3 w-3 transition-transform ${showFilters ? 'rotate-180' : ''}`} />
          </button>
          <button
            type="submit"
            disabled={!queryInput.trim() || searchQuery.isPending}
            className="inline-flex items-center gap-1.5 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs font-medium text-cyan-200 transition-colors hover:bg-cyan-500/20 disabled:opacity-50"
          >
            {searchQuery.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
            Search
          </button>
        </div>

        <AnimatePresence initial={false}>
          {showFilters && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="overflow-hidden"
            >
              <div className="space-y-2 rounded-md border border-zinc-800 bg-zinc-950/40 p-3">
                <div>
                  <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-400">Court</div>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => setCourt('')}
                      className={`rounded-full border px-2 py-0.5 text-[10px] transition-colors ${
                        court === ''
                          ? 'border-cyan-500/50 bg-cyan-500/15 text-cyan-200'
                          : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-cyan-500/30'
                      }`}
                    >
                      All courts
                    </button>
                    {QUICK_COURTS.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setCourt(c.id)}
                        className={`rounded-full border px-2 py-0.5 text-[10px] transition-colors ${
                          court === c.id
                            ? 'border-cyan-500/50 bg-cyan-500/15 text-cyan-200'
                            : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-cyan-500/30'
                        }`}
                      >
                        {c.label}
                      </button>
                    ))}
                    <input
                      type="text"
                      value={court}
                      onChange={(e) => setCourt(e.target.value)}
                      placeholder="other court id"
                      className="rounded-full border border-zinc-800 bg-zinc-900 px-2 py-0.5 text-[10px] text-white placeholder-zinc-600 focus:border-cyan-500/40 focus:outline-none"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="mb-1 block text-[10px] uppercase tracking-wider text-zinc-400">Filed after</label>
                    <input
                      type="date"
                      value={dateAfter}
                      onChange={(e) => setDateAfter(e.target.value)}
                      className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white focus:border-cyan-500/40 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[10px] uppercase tracking-wider text-zinc-400">Filed before</label>
                    <input
                      type="date"
                      value={dateBefore}
                      onChange={(e) => setDateBefore(e.target.value)}
                      className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white focus:border-cyan-500/40 focus:outline-none"
                    />
                  </div>
                </div>

                {hasActiveFilters && (
                  <button
                    type="button"
                    onClick={() => { setCourt(''); setDateAfter(''); setDateBefore(''); }}
                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
                  >
                    <X className="h-2.5 w-2.5" />
                    Clear filters
                  </button>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </form>

      {errorMsg && !result && (
        <div className="rounded-md border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">
          {errorMsg}
        </div>
      )}

      {!result && !searchQuery.isPending && !errorMsg && (
        <div className="rounded-md border border-dashed border-zinc-800 bg-zinc-950/50 px-3 py-8 text-center text-xs text-zinc-400">
          Search 9M+ federal and state court opinions via the CourtListener REST API.
          Free without a key; <code className="text-cyan-300">COURTLISTENER_API_TOKEN</code> env unlocks higher rate limits.
        </div>
      )}

      {result && result.results.length === 0 && (
        <div className="rounded-md border border-dashed border-amber-500/20 bg-amber-500/5 px-3 py-6 text-center text-xs text-amber-300">
          No opinions match — try broader terms, remove filters, or drop the date range.
        </div>
      )}

      {result && result.results.length > 0 && (
        <div className="space-y-2">
          {result.results.map((hit) => (
            <CaseResultCard
              key={hit.id}
              hit={hit}
              query={activeQuery || ''}
              clipped={clipped.has(hit.id)}
              onToggleClip={() => toggleClipped(hit.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CaseResultCard({ hit, query, clipped, onToggleClip }: {
  hit: SearchHit;
  query: string;
  clipped: boolean;
  onToggleClip: () => void;
}) {
  const citations = useMemo(() => {
    if (Array.isArray(hit.citation)) return hit.citation;
    if (typeof hit.citation === 'string' && hit.citation) return [hit.citation];
    return [];
  }, [hit.citation]);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15 }}
      className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 transition-colors hover:border-cyan-500/30"
    >
      <div className="flex items-start gap-3">
        <BookOpen className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-400/80" />
        <div className="min-w-0 flex-1">
          {/* Line 1: case name + citations */}
          <div className="flex flex-wrap items-baseline gap-x-2">
            <h3 className="text-sm font-semibold text-white">{hit.caseName || 'Untitled opinion'}</h3>
            {citations.slice(0, 2).map((c, i) => (
              <span key={i} className="font-mono text-[11px] text-cyan-300/80">{c}</span>
            ))}
          </div>

          {/* Line 2: court · date · judge · docket · precedential status */}
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-zinc-400">
            {hit.court && <span>{hit.court}</span>}
            {hit.dateFiled && (
              <span className="flex items-center gap-1">
                <Calendar className="h-2.5 w-2.5" />
                {hit.dateFiled}
              </span>
            )}
            {hit.author && <span>by {hit.author}</span>}
            {hit.docketNumber && (
              <span className="font-mono">{hit.docketNumber}</span>
            )}
            {hit.precedentialStatus && (
              <span className={`rounded px-1.5 py-0.5 text-[9px] uppercase tracking-wider ${
                hit.precedentialStatus === 'Published'
                  ? 'bg-emerald-500/15 text-emerald-300'
                  : 'bg-zinc-800 text-zinc-400'
              }`}>
                {hit.precedentialStatus}
              </span>
            )}
          </div>

          {/* Line 3: snippet with query-term highlight */}
          {hit.snippet && (
            <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-zinc-300">
              <HighlightedSnippet text={hit.snippet} query={query} />
            </p>
          )}
        </div>

        {/* Action cluster */}
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onToggleClip}
            className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
              clipped
                ? 'bg-cyan-500/15 text-cyan-300'
                : 'text-zinc-400 hover:bg-zinc-800 hover:text-cyan-300'
            }`}
            title={clipped ? 'Clipped to folder' : 'Clip to folder'}
            aria-label={clipped ? 'Unclip' : 'Clip to folder'}
          >
            {clipped ? <BookmarkCheck className="h-3.5 w-3.5" /> : <Bookmark className="h-3.5 w-3.5" />}
          </button>
          <SaveAsDtuButton
            compact
            apiSource="courtlistener"
            apiUrl={`https://www.courtlistener.com/api/rest/v4/search/?q=${encodeURIComponent(query)}`}
            title={`${hit.caseName}${citations[0] ? ` · ${citations[0]}` : ''}`}
            content={[
              hit.caseName ? `Case: ${hit.caseName}` : '',
              citations.length > 0 ? `Citations: ${citations.join('; ')}` : '',
              hit.court ? `Court: ${hit.court}` : '',
              hit.dateFiled ? `Filed: ${hit.dateFiled}` : '',
              hit.author ? `Author: ${hit.author}` : '',
              hit.docketNumber ? `Docket: ${hit.docketNumber}` : '',
              hit.precedentialStatus ? `Precedential status: ${hit.precedentialStatus}` : '',
              '',
              hit.snippet ? `Snippet:\n${hit.snippet}` : '',
              '',
              hit.absoluteUrl ? `Full opinion: ${hit.absoluteUrl}` : '',
            ].filter(Boolean).join('\n')}
            extraTags={['legal', 'case-law', hit.courtId || 'court', 'opinion']}
            rawData={hit}
          />
          {hit.absoluteUrl && (
            <a
              href={hit.absoluteUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
              title="Open full opinion on CourtListener"
              aria-label="Open opinion"
            >
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      </div>
    </motion.div>
  );
}

// Simple query-term highlight — splits on each whitespace-delim token in the
// query and wraps occurrences in <mark> with cyan tint. Case-insensitive.
function HighlightedSnippet({ text, query }: { text: string; query: string }) {
  const terms = useMemo(
    () => query.split(/\s+/).map((t) => t.trim().replace(/^["']|["']$/g, '')).filter((t) => t.length >= 3),
    [query]
  );
  if (terms.length === 0) return <>{text}</>;
  const re = new RegExp(`(${terms.map(escapeRegex).join('|')})`, 'gi');
  const parts = text.split(re);
  return (
    <>
      {parts.map((part, i) => (
        re.test(part)
          ? <mark key={i} className="rounded-sm bg-cyan-500/20 px-0.5 text-cyan-200">{part}</mark>
          : <span key={i}>{part}</span>
      ))}
    </>
  );
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
