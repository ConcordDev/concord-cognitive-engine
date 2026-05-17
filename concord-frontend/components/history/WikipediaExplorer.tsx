'use client';

/**
 * WikipediaExplorer — bespoke Wikipedia + On-This-Day surface for the
 * history lens. Backed by the existing macros:
 *   history.wiki-search    — opensearch typeahead
 *   history.wiki-lookup    — page summary (extract + thumbnail + URL)
 *   history.on-this-day    — events / births / deaths / holidays
 *
 * Per category-leader UX research against Wikipedia, Wikiwand, History.com,
 * Britannica, Khan Academy World History, TimelineJS:
 *
 *   • 200ms-debounced opensearch typeahead with title + description rows
 *   • Two-column article view: hero image + lead + body, with infobox
 *     sidebar (cyan-500/20 ring) carrying description / page URL / lang
 *     and a "Save as DTU" affordance
 *   • Three-tab On This Day: Events / Births / Deaths with date picker
 *     hero (prev/today/next chevrons + date input)
 *   • Save-as-DTU on every viewable surface with source: "wikipedia"
 */

import { useState, useEffect, useMemo, useRef } from 'react';
import { useMutation } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BookOpen, Search, ExternalLink, Loader2, Calendar, ChevronLeft, ChevronRight,
  GraduationCap, Skull, Users2,
} from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';
import { HistoryArticleActions } from '@/components/history/HistoryArticleActions';

interface SearchHit { title: string; description: string | null; url: string | null }

interface ArticleSummary {
  title: string;
  displayTitle?: string;
  description: string | null;
  extract: string;
  extractHtml?: string;
  thumbnail?: string;
  pageUrl?: string;
  mobilePageUrl?: string;
  lang?: string;
  revisionTimestamp?: string;
  type?: string;
  source: string;
  note?: string;
}

interface OnThisDayEntry {
  text: string;
  year?: number | string;
  pages: Array<{ title: string; extract?: string; url?: string; thumbnail?: string }>;
}

type DayKind = 'events' | 'births' | 'deaths' | 'holidays';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }

async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('history', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) {
    return data.result as MacroEnvelope<T>;
  }
  return data as MacroEnvelope<T>;
}

export function WikipediaExplorer() {
  const [mode, setMode] = useState<'search' | 'on-this-day'>('search');
  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <BookOpen className="h-5 w-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">Wikipedia Explorer</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">
            wikipedia · open
          </span>
        </div>
        <div className="flex items-center gap-1 rounded-md border border-zinc-800 bg-zinc-950 p-0.5">
          {(['search', 'on-this-day'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`rounded px-2.5 py-1 text-[11px] font-medium transition-colors ${
                mode === m ? 'bg-cyan-500/15 text-cyan-300' : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {m === 'search' ? 'Articles' : 'On This Day'}
            </button>
          ))}
        </div>
      </header>
      {mode === 'search' ? <ArticleSearch /> : <OnThisDay />}
    </div>
  );
}

// ── Article search + reader ─────────────────────────────────────────────

function ArticleSearch() {
  const [queryInput, setQueryInput] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [article, setArticle] = useState<ArticleSummary | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const searchMutation = useMutation({
    mutationFn: async (q: string) => callMacro<{ results: SearchHit[] }>('wiki-search', { query: q, limit: 8 }),
    onSuccess: (env) => {
      if (env.ok && env.result) setHits(env.result.results);
      else setHits([]);
    },
  });
  const lookupMutation = useMutation({
    mutationFn: async (title: string) => callMacro<ArticleSummary>('wiki-lookup', { title }),
    onSuccess: (env) => {
      if (env.ok && env.result) setArticle(env.result);
    },
  });

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (queryInput.trim().length < 2) { setHits([]); return; }
    debounceRef.current = setTimeout(() => {
      setDebouncedQuery(queryInput.trim());
    }, 200);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [queryInput]);

  useEffect(() => {
    if (debouncedQuery.length >= 2) searchMutation.mutate(debouncedQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mutate stable
  }, [debouncedQuery]);

  const openArticle = (title: string) => {
    setShowSuggestions(false);
    setArticle(null);
    setQueryInput(title);
    lookupMutation.mutate(title);
  };

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
        <input
          type="text"
          value={queryInput}
          onChange={(e) => { setQueryInput(e.target.value); setShowSuggestions(true); }}
          onFocus={() => setShowSuggestions(true)}
          onBlur={() => window.setTimeout(() => setShowSuggestions(false), 150)}
          placeholder="Type a topic — Lincoln, Renaissance, Apollo 11, Marie Curie…"
          className="w-full rounded-md border border-zinc-800 bg-zinc-950 py-1.5 pl-8 pr-3 text-sm text-white placeholder-zinc-600 focus:border-cyan-500/40 focus:outline-none"
        />
        {showSuggestions && hits.length > 0 && (
          <div className="absolute z-10 mt-1 w-full max-h-72 overflow-y-auto rounded-md border border-cyan-500/20 bg-zinc-950 shadow-2xl">
            {hits.map((h) => (
              <button
                key={h.title}
                type="button"
                onMouseDown={(e) => { e.preventDefault(); openArticle(h.title); }}
                className="block w-full border-b border-zinc-800 px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-cyan-500/10"
              >
                <div className="text-sm font-medium text-white">{h.title}</div>
                {h.description && <div className="line-clamp-1 text-[11px] text-zinc-500">{h.description}</div>}
              </button>
            ))}
          </div>
        )}
      </div>

      {lookupMutation.isPending && (
        <div className="flex items-center justify-center py-6 text-xs text-zinc-500">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading article…
        </div>
      )}

      {!article && !lookupMutation.isPending && (
        <div className="rounded-md border border-dashed border-zinc-800 bg-zinc-950/40 px-3 py-6 text-center text-xs text-zinc-500">
          Start typing — Wikipedia opensearch fires after 2 characters with 200ms debounce.
        </div>
      )}

      {article && <ArticleReader article={article} />}
    </div>
  );
}

function ArticleReader({ article }: { article: ArticleSummary }) {
  const isDisambiguation = article.type === 'disambiguation';

  return (
    <motion.article
      key={article.title}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="grid grid-cols-1 gap-3 lg:grid-cols-3"
    >
      {/* Main column */}
      <div className="space-y-3 lg:col-span-2">
        {article.thumbnail && (
          <div className="overflow-hidden rounded-md border border-zinc-800">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={article.thumbnail}
              alt={article.title}
              className="aspect-video w-full object-cover"
            />
          </div>
        )}
        <div>
          <h3 className="text-xl font-semibold text-white">{article.displayTitle || article.title}</h3>
          {article.description && (
            <p className="mt-1 text-xs italic text-zinc-400">{article.description}</p>
          )}
        </div>
        {isDisambiguation && (
          <div className="rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-300">
            {article.note || 'This title refers to multiple subjects — try a more specific query.'}
          </div>
        )}
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-200">{article.extract}</p>
      </div>

      {/* Infobox sidebar */}
      <aside className="lg:sticky lg:top-4 lg:self-start">
        <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-cyan-300">Infobox</span>
            <SaveAsDtuButton
              compact
              apiSource="wikipedia"
              apiUrl={article.pageUrl || `https://en.wikipedia.org/wiki/${encodeURIComponent(article.title)}`}
              title={article.title}
              content={[
                `Title: ${article.displayTitle || article.title}`,
                article.description ? `Description: ${article.description}` : '',
                '',
                article.extract,
                '',
                article.pageUrl ? `Source: ${article.pageUrl}` : '',
              ].filter(Boolean).join('\n')}
              extraTags={['history', 'wikipedia', 'article']}
              rawData={article}
            />
          </div>
          <dl className="space-y-1.5 text-xs">
            <div className="flex justify-between gap-2">
              <dt className="text-zinc-500">Title</dt>
              <dd className="truncate font-mono text-zinc-200">{article.title}</dd>
            </div>
            {article.lang && (
              <div className="flex justify-between gap-2">
                <dt className="text-zinc-500">Language</dt>
                <dd className="font-mono text-zinc-200">{article.lang}</dd>
              </div>
            )}
            {article.revisionTimestamp && (
              <div className="flex justify-between gap-2">
                <dt className="text-zinc-500">Last revision</dt>
                <dd className="font-mono text-zinc-200">{article.revisionTimestamp.slice(0, 10)}</dd>
              </div>
            )}
          </dl>
          {article.pageUrl && (
            <a
              href={article.pageUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 flex w-full items-center justify-center gap-1 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-2 py-1.5 text-[11px] font-medium text-cyan-200 transition-colors hover:bg-cyan-500/20"
            >
              <ExternalLink className="h-3 w-3" />
              Read on Wikipedia
            </a>
          )}
          <HistoryArticleActions article={article} />
        </div>
      </aside>
    </motion.article>
  );
}

// ── On This Day ──────────────────────────────────────────────────────────

function OnThisDay() {
  const now = useMemo(() => new Date(), []);
  const [date, setDate] = useState<Date>(now);
  const [kind, setKind] = useState<DayKind>('events');
  const [entries, setEntries] = useState<OnThisDayEntry[]>([]);
  const month = date.getMonth() + 1;
  const day = date.getDate();

  const lookupMutation = useMutation({
    mutationFn: async (params: { month: number; day: number; kind: DayKind }) => callMacro<{ events?: OnThisDayEntry[]; births?: OnThisDayEntry[]; deaths?: OnThisDayEntry[]; holidays?: OnThisDayEntry[]; selected?: OnThisDayEntry[] }>('on-this-day', params),
    onSuccess: (env) => {
      if (!env.ok || !env.result) { setEntries([]); return; }
      const r = env.result;
      const list = r.events || r.births || r.deaths || r.holidays || r.selected || [];
      setEntries(list);
    },
  });

  useEffect(() => {
    lookupMutation.mutate({ month, day, kind });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, day, kind]);

  const shift = (days: number) => {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    setDate(d);
  };
  const isToday = month === (now.getMonth() + 1) && day === now.getDate();

  return (
    <div className="space-y-3">
      {/* Date control bar */}
      <div className="flex items-center justify-between gap-2 rounded-md border border-cyan-500/15 bg-cyan-500/5 p-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => shift(-1)}
            className="rounded-md p-1 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-cyan-300"
            aria-label="Previous day"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <input
            type="date"
            value={`${date.getFullYear()}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`}
            onChange={(e) => { if (e.target.value) setDate(new Date(e.target.value)); }}
            className="rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white focus:border-cyan-500/40 focus:outline-none"
          />
          <button
            type="button"
            onClick={() => shift(1)}
            className="rounded-md p-1 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-cyan-300"
            aria-label="Next day"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          {!isToday && (
            <button
              type="button"
              onClick={() => setDate(new Date())}
              className="ml-1 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-cyan-200 transition-colors hover:bg-cyan-500/20"
            >
              Today
            </button>
          )}
        </div>
        <Calendar className="h-4 w-4 text-cyan-400/70" />
      </div>

      {/* Kind tabs */}
      <div className="flex gap-1 border-b border-zinc-800">
        {([
          { id: 'events' as const, label: 'Events', icon: Calendar },
          { id: 'births' as const, label: 'Births', icon: Users2 },
          { id: 'deaths' as const, label: 'Deaths', icon: Skull },
          { id: 'holidays' as const, label: 'Holidays', icon: GraduationCap },
        ]).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setKind(t.id)}
            className={`flex items-center gap-1.5 border-b-2 px-3 py-1.5 text-xs font-medium transition-colors ${
              kind === t.id ? 'border-cyan-400 text-cyan-300' : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <t.icon className="h-3 w-3" />
            {t.label}
          </button>
        ))}
      </div>

      {lookupMutation.isPending && (
        <div className="flex items-center justify-center py-8 text-xs text-zinc-500">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading {kind}…
        </div>
      )}

      {!lookupMutation.isPending && entries.length === 0 && (
        <div className="rounded-md border border-dashed border-zinc-800 bg-zinc-950/40 px-3 py-6 text-center text-xs text-zinc-500">
          No {kind} indexed for this date.
        </div>
      )}

      <AnimatePresence mode="wait">
        <motion.div
          key={`${month}-${day}-${kind}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="space-y-2"
        >
          {entries.map((e, i) => <OnThisDayCard key={`${e.year}-${i}`} entry={e} kind={kind} month={month} day={day} />)}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function OnThisDayCard({ entry, kind, month, day }: { entry: OnThisDayEntry; kind: DayKind; month: number; day: number }) {
  const primary = entry.pages?.[0];
  return (
    <div className="flex items-start gap-3 rounded-md border border-zinc-800 bg-zinc-950/40 p-3 transition-colors hover:border-cyan-500/30">
      {primary?.thumbnail ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={primary.thumbnail} alt="" className="h-14 w-14 shrink-0 rounded object-cover" />
      ) : (
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded border border-zinc-800 bg-zinc-900">
          {kind === 'births' ? <Users2 className="h-5 w-5 text-cyan-400/70" />
            : kind === 'deaths' ? <Skull className="h-5 w-5 text-cyan-400/70" />
            : kind === 'holidays' ? <GraduationCap className="h-5 w-5 text-cyan-400/70" />
            : <Calendar className="h-5 w-5 text-cyan-400/70" />}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          {entry.year != null && (
            <span className="font-mono text-sm font-bold text-cyan-300">{entry.year}</span>
          )}
          <span className="text-sm text-zinc-200">{entry.text}</span>
        </div>
        {primary?.extract && (
          <p className="mt-1 line-clamp-2 text-[11px] text-zinc-500">{primary.extract}</p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <SaveAsDtuButton
          compact
          apiSource="wikipedia"
          apiUrl={`https://en.wikipedia.org/api/rest_v1/feed/onthisday/${kind}/${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}`}
          title={`${entry.year} — ${entry.text.slice(0, 80)}`}
          content={[
            entry.year != null ? `Year: ${entry.year}` : '',
            `Event: ${entry.text}`,
            '',
            primary?.title ? `Related: ${primary.title}` : '',
            primary?.extract ? `\n${primary.extract}` : '',
            primary?.url ? `\nSource: ${primary.url}` : '',
          ].filter(Boolean).join('\n')}
          extraTags={['history', 'on-this-day', kind, String(entry.year || '')]}
          rawData={entry}
        />
        {primary?.url && (
          <a
            href={primary.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
            aria-label="Open on Wikipedia"
            title="Open on Wikipedia"
          >
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
    </div>
  );
}

