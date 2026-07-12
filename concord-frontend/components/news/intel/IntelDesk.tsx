'use client';

/**
 * IntelDesk — the News/Intelligence flagship: a research-tool console over the
 * real `news` backend. Identity: clean source attribution, skimmable
 * headlines, citation-forward. Three zones:
 *
 *   LEFT   Sources — categories drive the live GDELT query; source domains
 *          in the current result set are surfaced as attribution filters.
 *   CENTER Live feed — real GDELT headlines (news.headlines macro). Each row
 *          → open source · Pull→DTU (SaveAsDtuButton, real provenance) ·
 *          add to the analysis set.
 *   RIGHT  Briefing (news.daily-briefing) · Analysis workbench
 *          (bias/event/narrative engines) · Citation chains (pulled DTUs).
 *
 * Everything traces to a macro/route/DTU. The live feed depends on outbound
 * egress to api.gdeltproject.org; if that is unreachable the feed shows an
 * honest error/empty state — never fabricated headlines.
 */

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Radio, RefreshCw, ExternalLink, Plus, Check, Globe2, Newspaper,
  Sun, Sparkles, ChevronDown, Quote, BookOpenText,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { lensRun } from '@/lib/api/client';
import { StatusDot } from '@/components/ui/StatusDot';
import { StatTile } from '@/components/ui/StatTile';
import { DensityToggle } from '@/components/ui/DensityToggle';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';
import { AnalysisWorkbench } from './AnalysisWorkbench';
import { CitationChainPanel } from './CitationChainPanel';
import { MyReaderDesk } from '../MyReaderDesk';
import {
  fetchHeadlines, fetchDailyBriefing, NEWS_CATEGORIES,
  type NewsCategory, type Headline,
} from './intel-api';

type DeskMode = 'live' | 'reader';

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function IntelDesk({ initialCategory = 'top' }: { initialCategory?: NewsCategory } = {}) {
  const [mode, setMode] = useState<DeskMode>('live');
  const [category, setCategory] = useState<NewsCategory>(initialCategory);
  const [sourceFilter, setSourceFilter] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [pullCount, setPullCount] = useState(0); // bumps to refresh the citation panel

  const feed = useQuery({
    queryKey: ['intel-headlines', category],
    queryFn: () => fetchHeadlines(category, 40),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000, // GDELT re-indexes ~every 15m; poll gently
  });

  const briefing = useQuery({
    queryKey: ['intel-briefing'],
    queryFn: fetchDailyBriefing,
    staleTime: 30 * 60_000,
  });

  const headlines: Headline[] = useMemo(
    () => (feed.data?.ok ? feed.data.result?.headlines || [] : []),
    [feed.data],
  );
  const feedError = feed.data && !feed.data.ok ? feed.data.error : null;
  const isLive = feed.isSuccess && !!feed.data?.ok && !feed.isRefetching;

  // Source-attribution set — the journalism-tool "who is reporting this" view.
  const sources = useMemo(() => {
    const counts = new Map<string, number>();
    for (const h of headlines) {
      if (!h.source) continue;
      counts.set(h.source, (counts.get(h.source) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [headlines]);

  const visible = useMemo(
    () => (sourceFilter ? headlines.filter((h) => h.source === sourceFilter) : headlines),
    [headlines, sourceFilter],
  );

  const selected = useMemo(
    () => headlines.filter((h) => selectedIds.has(h.id)),
    [headlines, selectedIds],
  );

  const countries = useMemo(
    () => new Set(headlines.map((h) => h.sourceCountry).filter(Boolean)).size,
    [headlines],
  );

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // A pulled headline becomes a DTU (provenance-carrying, citable) AND a row
  // in the personalized-reader directory (`news.article-add`) — so "My
  // Reader"'s follows/saves/search/clusters/bias-spectrum have real content
  // sourced from real Pull actions instead of requiring manual entry.
  // Best-effort: the DTU save is the primary honest artifact; if the
  // directory add fails (e.g. STATE unavailable) the pull itself still
  // succeeded, so this never blocks or fakes success.
  function addPulledHeadlineToDirectory(h: Headline) {
    void lensRun('news', 'article-add', {
      title: h.title,
      source: h.source || 'unknown',
      topic: h.category,
      summary: null,
      url: h.url,
      publishedAt: h.publishedAt,
    }).catch(() => { /* directory add is best-effort; the DTU pull already succeeded */ });
  }

  return (
    <div data-lens-theme="news" className="flex flex-col gap-4 p-4 md:p-6">
      {/* ── Header ─────────────────────────────────────────────── */}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 pb-3">
        <div className="flex items-center gap-2.5">
          <Radio className="h-6 w-6 text-cyan-400" />
          <div>
            <h1 className="text-lg font-semibold leading-tight text-white">Intelligence Desk</h1>
            <p className="text-xs text-zinc-500">
              Live global feed · pull → DTU → cite · media-literacy engines
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <nav className="flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-950/60 p-0.5">
            <button
              type="button"
              onClick={() => setMode('live')}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-cyan-500',
                mode === 'live' ? 'bg-cyan-500/20 text-cyan-200' : 'text-zinc-500 hover:text-zinc-300',
              )}
            >
              <Radio className="h-3.5 w-3.5" /> Live Desk
            </button>
            <button
              type="button"
              onClick={() => setMode('reader')}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-rose-500',
                mode === 'reader' ? 'bg-rose-500/20 text-rose-200' : 'text-zinc-500 hover:text-zinc-300',
              )}
            >
              <BookOpenText className="h-3.5 w-3.5" /> My Reader
            </button>
          </nav>
          {mode === 'live' && (
            <>
              <StatusDot
                state={feedError ? 'error' : feed.isFetching ? 'connecting' : isLive ? 'live' : 'idle'}
                label={feedError ? 'Feed offline' : feed.isFetching ? 'Fetching' : isLive ? 'GDELT live' : 'Idle'}
                showLabel
              />
              <DensityToggle variant="segmented" showLabels={false} />
              <button
                type="button"
                onClick={() => feed.refetch()}
                disabled={feed.isFetching}
                className="rounded-md border border-zinc-800 p-1.5 text-zinc-400 transition-colors hover:border-cyan-500/40 hover:text-cyan-300 disabled:opacity-50"
                title="Refresh feed"
                aria-label="Refresh feed"
              >
                <RefreshCw className={cn('h-4 w-4', feed.isFetching && 'animate-spin')} />
              </button>
            </>
          )}
        </div>
      </header>

      {mode === 'reader' ? <MyReaderDesk /> : (
      <>
      {/* ── Stat strip ─────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatTile label="Headlines" value={headlines.length} icon={<Newspaper className="h-4 w-4" />} size="sm" />
        <StatTile label="Sources" value={sources.length} icon={<Globe2 className="h-4 w-4" />} size="sm" />
        <StatTile label="Countries" value={countries} icon={<Globe2 className="h-4 w-4" />} size="sm" />
        <StatTile label="In analysis set" value={selectedIds.size} icon={<Sparkles className="h-4 w-4" />} size="sm" />
      </div>

      {/* ── Category chips ─────────────────────────────────────── */}
      <div className="flex flex-wrap gap-1.5">
        {NEWS_CATEGORIES.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => { setCategory(c); setSourceFilter(null); }}
            className={cn(
              'rounded-full border px-2.5 py-0.5 text-[11px] uppercase tracking-wide transition-colors',
              category === c
                ? 'border-cyan-500/50 bg-cyan-500/15 text-cyan-200'
                : 'border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200',
            )}
          >
            {c}
          </button>
        ))}
      </div>

      {/* ── Main grid ──────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* LEFT — sources */}
        <aside className="lg:col-span-3">
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Sources</h2>
              {sourceFilter && (
                <button
                  type="button"
                  onClick={() => setSourceFilter(null)}
                  className="text-[10px] text-cyan-400 hover:underline"
                >
                  clear
                </button>
              )}
            </div>
            {feed.isLoading ? (
              <Skeleton variant="line" lines={6} />
            ) : sources.length === 0 ? (
              <p className="py-3 text-[11px] text-zinc-500">No sources in this feed.</p>
            ) : (
              <div className="max-h-[26rem] space-y-0.5 overflow-y-auto pr-1">
                {sources.map(([src, n]) => (
                  <button
                    key={src}
                    type="button"
                    onClick={() => setSourceFilter(sourceFilter === src ? null : src)}
                    className={cn(
                      'flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-left text-xs transition-colors',
                      sourceFilter === src
                        ? 'bg-cyan-500/10 text-cyan-200'
                        : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200',
                    )}
                  >
                    <span className="truncate">{src}</span>
                    <span className="shrink-0 font-mono text-[10px] text-zinc-500">{n}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </aside>

        {/* CENTER — live feed */}
        <section className="lg:col-span-6">
          {feed.isLoading ? (
            <div className="space-y-2">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
                  <Skeleton variant="line" lines={2} />
                </div>
              ))}
            </div>
          ) : feedError ? (
            <ErrorState
              title="Live feed unavailable"
              message={`Could not reach the GDELT news feed (${feedError}). This surface shows real headlines only — no placeholders. Retry when outbound network is available.`}
              onRetry={() => feed.refetch()}
            />
          ) : visible.length === 0 ? (
            <EmptyState
              icon={<Newspaper className="h-8 w-8 text-zinc-600" />}
              title={sourceFilter ? `No headlines from ${sourceFilter}` : 'No headlines'}
              description="The live query returned nothing for this category right now."
              action={sourceFilter ? { label: 'Clear source filter', onClick: () => setSourceFilter(null) } : undefined}
            />
          ) : (
            <div className="space-y-2">
              <AnimatePresence initial={false}>
                {visible.map((h) => {
                  const isSel = selectedIds.has(h.id);
                  return (
                    <motion.article
                      key={h.id}
                      layout
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.18 }}
                      className={cn(
                        'group flex items-start gap-3 rounded-lg border bg-zinc-950/40 p-3 transition-colors',
                        isSel ? 'border-cyan-500/40 bg-cyan-500/[0.04]' : 'border-zinc-800 hover:border-zinc-700',
                      )}
                    >
                      {h.socialImageUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={h.socialImageUrl}
                          alt=""
                          loading="lazy"
                          className="h-14 w-20 shrink-0 rounded object-cover"
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <a
                          href={h.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="line-clamp-2 text-sm font-medium text-white transition-colors hover:text-cyan-300"
                        >
                          {h.title || '(untitled)'}
                        </a>
                        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-zinc-500">
                          <span className="font-medium text-zinc-400">{h.source || 'unknown'}</span>
                          {h.sourceCountry && <span className="uppercase">{h.sourceCountry}</span>}
                          <span>·</span>
                          <span>{relTime(h.publishedAt)}</span>
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-col items-center gap-1">
                        <button
                          type="button"
                          onClick={() => toggleSelect(h.id)}
                          title={isSel ? 'Remove from analysis set' : 'Add to analysis set'}
                          aria-label={isSel ? 'Remove from analysis set' : 'Add to analysis set'}
                          className={cn(
                            'flex h-6 w-6 items-center justify-center rounded transition-colors',
                            isSel
                              ? 'bg-cyan-500/20 text-cyan-300'
                              : 'text-zinc-500 hover:bg-cyan-500/10 hover:text-cyan-300',
                          )}
                        >
                          {isSel ? <Check className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                        </button>
                        <SaveAsDtuButton
                          compact
                          confirm={false}
                          apiSource="gdelt"
                          apiUrl={h.url}
                          title={h.title.slice(0, 100)}
                          content={`Title: ${h.title}\nSource: ${h.source} (${h.sourceCountry || '—'})\nPublished: ${h.publishedAt}\nURL: ${h.url}\nCategory: ${h.category}`}
                          extraTags={['news', 'gdelt', h.category, (h.sourceCountry || 'us').toLowerCase()]}
                          rawData={h}
                          onSaved={() => { setPullCount((n) => n + 1); addPulledHeadlineToDirectory(h); }}
                        />
                        <a
                          href={h.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex h-6 w-6 items-center justify-center rounded text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
                          aria-label="Open source"
                        >
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </div>
                    </motion.article>
                  );
                })}
              </AnimatePresence>
            </div>
          )}
        </section>

        {/* RIGHT — briefing · workbench · citations */}
        <aside className="space-y-4 lg:col-span-3">
          <BriefingCard briefing={briefing.data?.ok ? briefing.data.result : null} loading={briefing.isLoading} />

          <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
            <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
              Analysis workbench
            </h2>
            <AnalysisWorkbench selected={selected} />
          </div>

          <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
            <h2 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
              <Quote className="h-3 w-3" /> Pulled intelligence
            </h2>
            <CitationChainPanel refreshKey={pullCount} />
          </div>
        </aside>
      </div>
      </>
      )}
    </div>
  );
}

function BriefingCard({
  briefing,
  loading,
}: {
  briefing: import('./intel-api').DailyBriefing | null | undefined;
  loading: boolean;
}) {
  const [open, setOpen] = useState(true);
  if (loading) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
        <Skeleton variant="line" lines={4} />
      </div>
    );
  }
  if (!briefing) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
        <h2 className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
          <Sun className="h-3 w-3" /> Daily briefing
        </h2>
        <p className="text-[11px] text-zinc-500">
          Briefing needs the live feed. It builds from real GDELT stories across world, business, tech and
          science — retry when the feed is reachable.
        </p>
      </div>
    );
  }
  const sections = [briefing.topStories, briefing.business, briefing.tech, briefing.science].filter(
    (s) => s && s.bullets?.length,
  );
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between text-left"
      >
        <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
          <Sun className="h-3 w-3 text-amber-400" /> Daily briefing
        </span>
        <ChevronDown className={cn('h-3.5 w-3.5 text-zinc-500 transition-transform', !open && '-rotate-90')} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            <p className="mt-2 text-xs text-zinc-300">{briefing.greeting}</p>
            <p className="text-[10px] text-zinc-500">{briefing.date}</p>
            <div className="mt-2 space-y-2">
              {sections.map((s) => (
                <div key={s.heading}>
                  <p className="text-[10px] font-medium uppercase tracking-wider text-cyan-400/80">{s.heading}</p>
                  <ul className="mt-0.5 space-y-0.5">
                    {s.bullets.slice(0, 3).map((b, i) => (
                      <li key={i} className="line-clamp-2 text-[11px] text-zinc-400">
                        · {b}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            <p className="mt-2 border-t border-zinc-800 pt-2 text-[11px] italic text-zinc-400">{briefing.closing}</p>
            <p className="mt-1 text-[10px] text-zinc-600">Source: {briefing.source}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
