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

import { useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Radio, RefreshCw, ExternalLink, Plus, Check, Globe2, Newspaper,
  Sun, Sparkles, Quote, BookOpenText,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
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

function hhmm(iso?: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function relTime(iso: string | null): string {
  if (!iso) return 'time unknown';
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

  // Rotation cursor per category. "Refresh feed" passes the server's nextCursor so the user
  // pages the pooled last-N pulls (different/newer items) without any upstream call. A ref (not
  // part of the query key) keeps the key stable per category; switching category shows that
  // category's own pool and cursor.
  const cursors = useRef<Partial<Record<NewsCategory, number>>>({});

  const feed = useQuery({
    queryKey: ['intel-headlines', category],
    queryFn: () => fetchHeadlines(category, 40, cursors.current[category]),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000, // GDELT re-indexes ~every 15m; poll gently
    retry: false,
  });

  const briefing = useQuery({
    queryKey: ['intel-briefing'],
    queryFn: fetchDailyBriefing,
    staleTime: 30 * 60_000,
    retry: false,
  });

  const headlines: Headline[] = useMemo(
    () => (feed.data?.ok ? feed.data.result?.headlines || [] : []),
    [feed.data],
  );
  const feedError = feed.data && !feed.data.ok ? feed.data.error : null;
  // Freshness metadata (absent on older responses => behaves exactly as before).
  const meta = feed.data?.ok ? feed.data.result : undefined;
  const asOf = hhmm(meta?.fetchedAt);
  const sourceUnavailable = meta?.status === 'unavailable' && headlines.length === 0;
  const lastUpdated = hhmm(meta?.lastOkAt);
  const unavailableReason = meta?.reason || meta?.degradedReason || 'unknown';
  const isWarming = unavailableReason === 'warming';

  function refreshFeed() {
    // Older servers return no nextCursor: then this is a plain refetch, exactly as before.
    if (typeof meta?.nextCursor === 'number') cursors.current[category] = meta.nextCursor;
    void feed.refetch();
  }
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
      publishedAt: h.publishedAt ?? undefined,
    }).catch(() => { /* directory add is best-effort; the DTU pull already succeeded */ });
  }

  return (
    <NorthStarFrame
      lensId="news"
      theme="news"
      crumb="News"
      subtitle={mode === 'live'
        ? 'Live GDELT headlines with source attribution, a daily briefing, bias / event / narrative analysis and citable pulled intelligence.'
        : 'Your followed topics and sources, saved stories, story clusters and bias spectrum.'}
      tabs={[
        { id: 'live', label: 'Live desk', icon: Radio, hint: 'Live headlines, briefing and analysis' },
        { id: 'reader', label: 'My reader', icon: BookOpenText, hint: 'Follows, saves, clusters and bias spectrum' },
      ]}
      activeTab={mode}
      onTab={(id) => setMode(id as DeskMode)}
      tabsLabel="News views"
      actions={mode === 'live' ? (
        <div className="flex items-center gap-3">
          <StatusDot
            state={feedError ? 'error' : feed.isFetching ? 'connecting' : isLive ? 'live' : 'idle'}
            label={feedError ? 'Feed offline' : feed.isFetching ? 'Fetching' : isLive ? 'Live' : 'Idle'}
            showLabel
          />
          <DensityToggle variant="segmented" showLabels={false} />
        </div>
      ) : undefined}
      cta={mode === 'live'
        ? { label: feed.isFetching ? 'Fetching…' : 'Refresh feed', icon: RefreshCw, onClick: refreshFeed, disabled: feed.isFetching, title: 'Refresh feed' }
        : undefined}
    >
    <div className="flex flex-col gap-4">
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
          ) : sourceUnavailable ? (
            <ErrorState
              title={isWarming ? 'Warming up' : 'Source temporarily unavailable'}
              message={isWarming
                ? 'The first pull for this category is still in flight — headlines appear as soon as it lands. Real headlines only; nothing is substituted.'
                : `Source temporarily unavailable — ${lastUpdated ? `last updated ${lastUpdated}` : 'no successful update yet'} (${unavailableReason}). Real headlines only — nothing is substituted.`}
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
              {(asOf || meta?.stale) && (
                <div className="flex items-center gap-2 text-[11px] text-zinc-500">
                  {asOf && <span>as of {asOf}</span>}
                  {meta?.stale && (
                    <span
                      className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-amber-300"
                      title={meta.degradedReason ? `Refresh pending (${meta.degradedReason})` : 'Showing the last good copy while a refresh is pending'}
                    >
                      stale
                    </span>
                  )}
                </div>
              )}
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
                          <span className="font-medium text-zinc-400" title={h.attribution || undefined}>{h.source || 'unknown'}</span>
                          {h.sourceCountry && <span className="uppercase">{h.sourceCountry}</span>}
                          <span>·</span>
                          <span title={h.publishedAt || undefined}>{relTime(h.publishedAt)}</span>
                        </div>
                        {/* Full-display outlets: the feed's own short snippet, unmodified. */}
                        {h.contentPolicy === 'full' && h.snippet && (
                          <p className="mt-1 line-clamp-3 text-[11px] text-zinc-400">{h.snippet}</p>
                        )}
                        {/* Summary-only outlets: ONLY Concord's own summary (never the outlet's text), labelled as such. */}
                        {h.contentPolicy !== 'full' && h.summary && (
                          <p className="mt-1 line-clamp-3 text-[11px] text-zinc-400">
                            <span className="mr-1 rounded border border-cyan-500/30 bg-cyan-500/10 px-1 py-px text-[9px] uppercase tracking-wide text-cyan-300">Concord summary</span>
                            {h.summary}
                          </p>
                        )}
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
                          apiSource={h.attribution?.startsWith('GDELT') === false ? 'news-rss' : 'gdelt'}
                          apiUrl={h.url}
                          title={h.title.slice(0, 100)}
                          content={[
                            `Title: ${h.title}`,
                            `Source: ${h.source}${h.sourceCountry ? ` (${h.sourceCountry})` : ''}`,
                            `Published: ${h.publishedAt ?? 'unknown'}`,
                            `URL: ${h.url}`,
                            `Category: ${h.category}`,
                            // only text we are allowed to keep: Concord's own summary (summary-only) or the short snippet (full)
                            h.contentPolicy === 'full' ? (h.snippet ? `Snippet: ${h.snippet}` : '') : (h.summary ? `Concord summary: ${h.summary}` : ''),
                          ].filter(Boolean).join('\n')}
                          extraTags={['news', h.attribution?.startsWith('GDELT') === false ? 'rss' : 'gdelt', h.category, (h.sourceCountry || 'us').toLowerCase()]}
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
    </NorthStarFrame>
  );
}

function BriefingCard({
  briefing,
  loading,
}: {
  briefing: import('./intel-api').DailyBriefing | null | undefined;
  loading: boolean;
}) {
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
      <h2 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
        <Sun className="h-3 w-3 text-amber-400" /> Daily briefing
      </h2>
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
    </div>
  );
}
