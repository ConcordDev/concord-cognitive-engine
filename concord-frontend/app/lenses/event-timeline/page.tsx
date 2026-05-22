'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * /lenses/event-timeline — unified substrate event timeline.
 *
 * Distinct from the social-timeline lens at /lenses/timeline. This one
 * surfaces the FULL FIREHOSE of substrate emits: combat, quests, NPCs,
 * world-state, cross-world plots, cognition.
 *
 * Activity-feed parity surface — every panel here is backed by a real
 * `event_timeline` macro:
 *   - recent       — live paged feed (5s poll / live-tail)
 *   - stats        — per-channel 24h counts
 *   - channels     — distinct channels for the filter chips
 *   - search       — full-text search across channel + payload + actor
 *   - range        — events for an arbitrary date window
 *   - detail       — single-event drill-in (EventDetailPanel)
 *   - timeseries   — per-channel trend sparklines (ChannelTrends)
 *   - exportEvents — filtered slice → CSV / JSON download
 *   - saveView / listViews / deleteView — per-user filter presets
 */
// Error handling: LensErrorBoundary (auto-mounted by LensShell) catches render/effect errors.
// Empty state: handled inline when data is empty.

import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { useLensCommand } from '@/hooks/useLensCommand';
import { LensShell } from '@/components/lens/LensShell';
import { RecentMineCard } from '@/components/lens/RecentMineCard';
import { AutoActionStrip } from '@/components/lens/AutoActionStrip';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { OnThisDay } from '@/components/event-timeline/OnThisDay';
import { ChannelTrends } from '@/components/event-timeline/ChannelTrends';
import { EventDetailPanel } from '@/components/event-timeline/EventDetailPanel';
import { SavedViewsBar, type TimelineFilterState } from '@/components/event-timeline/SavedViewsBar';
import { lensRun } from '@/lib/api/client';
import { Loader2, Search, Download, Pause, Play, X } from 'lucide-react';

interface TimelineRow {
  id: number;
  channel: string;
  world_id: string | null;
  actor_kind: string | null;
  actor_id: string | null;
  payload: Record<string, unknown> | null;
  payload_json?: string | null;
  created_at: number;
}

interface ChannelStat {
  channel: string;
  count: number;
}

interface ChannelInfo {
  channel: string;
  count: number;
  last_seen: number;
}

const CHANNEL_CATEGORIES: Record<string, string[]> = {
  Combat: ['combat:'],
  Quest: ['quest:', 'world:event:'],
  NPC: ['npc:', 'entity:'],
  World: ['world:', 'weather:'],
  Cross: ['scheme:', 'cross_world:'],
  Cognition: ['agent:', 'dream:', 'forgetting:', 'attention:', 'lattice:', 'evo:', 'dtu:', 'pain:'],
};

function channelCategory(channel: string): string {
  for (const [cat, prefixes] of Object.entries(CHANNEL_CATEGORIES)) {
    for (const p of prefixes) {
      if (channel.startsWith(p)) return cat;
    }
  }
  return 'Other';
}

function badgeColor(category: string): string {
  return (
    {
      Combat: 'bg-red-500/80 text-red-50',
      Quest: 'bg-emerald-500/80 text-emerald-50',
      NPC: 'bg-blue-500/80 text-blue-50',
      World: 'bg-amber-500/80 text-amber-50',
      Cross: 'bg-fuchsia-500/80 text-fuchsia-50',
      Cognition: 'bg-purple-500/80 text-purple-50',
      Other: 'bg-zinc-600/80 text-zinc-50',
    }[category] || 'bg-zinc-600/80 text-zinc-50'
  );
}

function relativeTime(unix: number): string {
  const diff = Math.floor(Date.now() / 1000) - unix;
  if (diff < 5) return 'just now';
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function payloadSummary(row: TimelineRow): string {
  const p = row.payload;
  if (!p || typeof p !== 'object') return '';
  for (const k of ['activity', 'kind', 'outcome', 'summary']) {
    if (typeof (p as any)[k] === 'string') return (p as any)[k] as string;
  }
  if (typeof (p as any).to_phase === 'string') return `→ ${(p as any).to_phase}`;
  return '';
}

function toLocalDatetime(unixSec: number): string {
  const d = new Date(unixSec * 1000);
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 16);
}

type Mode = 'live' | 'search' | 'range';

export default function EventTimelineLens() {
  useLensCommand(
    [
      {
        id: 'event-timeline-search',
        keys: '/',
        description: 'Focus search',
        category: 'navigation',
        action: () => searchInputRef.current?.focus(),
      },
    ],
    { lensId: 'event-timeline' },
  );

  const searchInputRef = useRef<HTMLInputElement>(null);

  const [rows, setRows] = useState<TimelineRow[]>([]);
  const [statsByChannel, setStatsByChannel] = useState<ChannelStat[]>([]);
  const [knownChannels, setKnownChannels] = useState<ChannelInfo[]>([]);
  const [activeCategories, setActiveCategories] = useState<Set<string>>(
    new Set([...Object.keys(CHANNEL_CATEGORIES), 'Other']),
  );
  const [channelFilter, setChannelFilter] = useState<string[]>([]);
  const [worldFilter, setWorldFilter] = useState('');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [detailId, setDetailId] = useState<number | null>(null);

  const [mode, setMode] = useState<Mode>('live');
  const [paused, setPaused] = useState(false);
  const [query, setQuery] = useState('');
  const [searchBusy, setSearchBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);

  const nowSec = Math.floor(Date.now() / 1000);
  const [fromTs, setFromTs] = useState(toLocalDatetime(nowSec - 24 * 3600));
  const [toTs, setToTs] = useState(toLocalDatetime(nowSec));

  // ── live feed (recent + stats + channels) ──────────────────────────
  const fetchLive = useCallback(async () => {
    const [r1, r2, r3] = await Promise.all([
      lensRun<{ ok: boolean; rows?: TimelineRow[] }>('event_timeline', 'recent', {
        limit: 200,
        worldId: worldFilter || null,
        channels: channelFilter.length ? channelFilter : null,
      }),
      lensRun<{ ok: boolean; channels?: ChannelStat[] }>('event_timeline', 'stats', {}),
      lensRun<{ ok: boolean; channels?: ChannelInfo[] }>('event_timeline', 'channels', {}),
    ]);
    if (r1.data?.result?.ok && Array.isArray(r1.data.result.rows)) {
      setRows(r1.data.result.rows);
    }
    if (r2.data?.result?.ok && Array.isArray(r2.data.result.channels)) {
      setStatsByChannel(r2.data.result.channels);
    }
    if (r3.data?.result?.ok && Array.isArray(r3.data.result.channels)) {
      setKnownChannels(r3.data.result.channels);
    }
  }, [worldFilter, channelFilter]);

  useEffect(() => {
    if (mode !== 'live' || paused) return;
    fetchLive();
    const id = setInterval(fetchLive, 5000);
    return () => clearInterval(id);
  }, [mode, paused, fetchLive]);

  // load channel chips once even before first live tick resolves
  useEffect(() => {
    fetchLive();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── search ─────────────────────────────────────────────────────────
  const runSearch = useCallback(async () => {
    const q = query.trim();
    if (q.length < 2) return;
    setSearchBusy(true);
    setMode('search');
    const r = await lensRun<{ ok: boolean; rows?: TimelineRow[] }>(
      'event_timeline',
      'search',
      {
        query: q,
        limit: 300,
        worldId: worldFilter || null,
        channels: channelFilter.length ? channelFilter : null,
      },
    );
    setSearchBusy(false);
    if (r.data?.result?.ok && Array.isArray(r.data.result.rows)) {
      setRows(r.data.result.rows);
    } else {
      setRows([]);
    }
  }, [query, worldFilter, channelFilter]);

  // ── range ──────────────────────────────────────────────────────────
  const runRange = useCallback(async () => {
    const f = Math.floor(new Date(fromTs).getTime() / 1000);
    const t = Math.floor(new Date(toTs).getTime() / 1000);
    if (!Number.isFinite(f) || !Number.isFinite(t)) return;
    setMode('range');
    const r = await lensRun<{ ok: boolean; rows?: TimelineRow[] }>(
      'event_timeline',
      'range',
      {
        fromTs: f,
        toTs: t,
        limit: 500,
        worldId: worldFilter || null,
        channels: channelFilter.length ? channelFilter : null,
      },
    );
    if (r.data?.result?.ok && Array.isArray(r.data.result.rows)) {
      setRows(r.data.result.rows);
    } else {
      setRows([]);
    }
  }, [fromTs, toTs, worldFilter, channelFilter]);

  // ── export ─────────────────────────────────────────────────────────
  const runExport = useCallback(
    async (format: 'csv' | 'json') => {
      setExportBusy(true);
      const params: Record<string, unknown> = {
        format,
        limit: 5000,
        worldId: worldFilter || null,
        channels: channelFilter.length ? channelFilter : null,
      };
      if (mode === 'search' && query.trim().length >= 2) params.query = query.trim();
      if (mode === 'range') {
        params.fromTs = Math.floor(new Date(fromTs).getTime() / 1000);
        params.toTs = Math.floor(new Date(toTs).getTime() / 1000);
      }
      const r = await lensRun<{
        ok: boolean;
        body?: string;
        filename?: string;
        mime?: string;
      }>('event_timeline', 'exportEvents', params);
      setExportBusy(false);
      const res = r.data?.result;
      if (res?.ok && res.body) {
        const blob = new Blob([res.body], { type: res.mime || 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = res.filename || `event-timeline.${format}`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      }
    },
    [mode, query, fromTs, toTs, worldFilter, channelFilter],
  );

  // ── saved-view apply ───────────────────────────────────────────────
  const applyView = useCallback((f: TimelineFilterState) => {
    setChannelFilter(f.channels || []);
    setWorldFilter(f.worldId || '');
    setQuery(f.query || '');
    if (f.query && f.query.length >= 2) {
      setMode('search');
    } else {
      setMode('live');
    }
  }, []);

  // when filters change in search/range mode, re-run automatically
  useEffect(() => {
    if (mode === 'search') runSearch();
    if (mode === 'range') runRange();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelFilter, worldFilter]);

  const filteredRows = useMemo(
    () => rows.filter((r) => activeCategories.has(channelCategory(r.channel))),
    [rows, activeCategories],
  );

  const toggleCategory = (cat: string) => {
    setActiveCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const toggleChannel = (channel: string) => {
    setChannelFilter((prev) =>
      prev.includes(channel) ? prev.filter((c) => c !== channel) : [...prev, channel],
    );
  };

  const currentFilter: TimelineFilterState = {
    channels: channelFilter,
    worldId: worldFilter,
    query,
  };

  const resetToLive = () => {
    setMode('live');
    setQuery('');
    fetchLive();
  };

  return (
    <LensShell lensId="event-timeline">
      <FirstRunTour lensId="event-timeline" />
      <DepthBadge lensId="event-timeline" size="sm" className="ml-2" />
      <div className="min-h-screen bg-zinc-950 px-4 py-8 text-zinc-100 sm:px-6">
        <div className="mx-auto max-w-6xl">
          <header className="mb-6">
            <h1 className="mb-1 text-2xl font-semibold">Substrate Event Timeline</h1>
            <p className="text-sm text-zinc-400">
              The full firehose of substrate events — combat, quests, NPCs, world-state,
              cross-world plots, cognition. Search, filter, drill into any event, and
              export the slice you care about.
            </p>
          </header>

          {/* ── search / range controls ────────────────────────────── */}
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 rounded-md bg-zinc-900 px-2 py-1 ring-1 ring-zinc-700 focus-within:ring-zinc-500">
              <Search className="h-3.5 w-3.5 text-zinc-500" />
              <input
                ref={searchInputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') runSearch();
                  if (e.key === 'Escape') resetToLive();
                }}
                placeholder="search channel · payload · actor (press /)"
                className="w-64 bg-transparent text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none"
              />
              <button
                onClick={runSearch}
                disabled={searchBusy || query.trim().length < 2}
                className="rounded bg-indigo-600 px-2 py-0.5 text-[11px] text-white disabled:opacity-40"
              >
                {searchBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Search'}
              </button>
            </div>

            <input
              type="text"
              placeholder="worldId…"
              value={worldFilter}
              onChange={(e) => setWorldFilter(e.target.value)}
              className="rounded-md bg-zinc-900 px-3 py-1 text-xs text-zinc-200 ring-1 ring-zinc-700 focus:outline-none focus:ring-zinc-500"
            />

            <div className="flex items-center gap-1 rounded-md bg-zinc-900 px-2 py-1 text-[11px] ring-1 ring-zinc-700">
              <span className="text-zinc-500">range</span>
              <input
                type="datetime-local"
                value={fromTs}
                onChange={(e) => setFromTs(e.target.value)}
                className="bg-transparent text-zinc-300 focus:outline-none [color-scheme:dark]"
              />
              <span className="text-zinc-600">→</span>
              <input
                type="datetime-local"
                value={toTs}
                onChange={(e) => setToTs(e.target.value)}
                className="bg-transparent text-zinc-300 focus:outline-none [color-scheme:dark]"
              />
              <button
                onClick={runRange}
                className="rounded bg-zinc-700 px-2 py-0.5 text-white hover:bg-zinc-600"
              >
                Apply
              </button>
            </div>

            <div className="ml-auto flex items-center gap-2">
              {mode === 'live' ? (
                <button
                  onClick={() => setPaused((p) => !p)}
                  className="flex items-center gap-1 rounded-md bg-zinc-800 px-2.5 py-1 text-xs text-zinc-300 hover:bg-zinc-700"
                  title={paused ? 'Resume live tail' : 'Pause live tail'}
                >
                  {paused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
                  {paused ? 'Paused' : 'Live'}
                </button>
              ) : (
                <button
                  onClick={resetToLive}
                  className="flex items-center gap-1 rounded-md bg-zinc-800 px-2.5 py-1 text-xs text-zinc-300 hover:bg-zinc-700"
                >
                  <X className="h-3 w-3" /> Back to live
                </button>
              )}
              <button
                onClick={() => runExport('csv')}
                disabled={exportBusy}
                className="flex items-center gap-1 rounded-md bg-zinc-800 px-2.5 py-1 text-xs text-zinc-300 hover:bg-zinc-700 disabled:opacity-40"
              >
                <Download className="h-3 w-3" /> CSV
              </button>
              <button
                onClick={() => runExport('json')}
                disabled={exportBusy}
                className="flex items-center gap-1 rounded-md bg-zinc-800 px-2.5 py-1 text-xs text-zinc-300 hover:bg-zinc-700 disabled:opacity-40"
              >
                <Download className="h-3 w-3" /> JSON
              </button>
            </div>
          </div>

          {/* ── saved views ────────────────────────────────────────── */}
          <div className="mb-4">
            <SavedViewsBar current={currentFilter} onApply={applyView} />
          </div>

          {/* ── category toggles ───────────────────────────────────── */}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {[...Object.keys(CHANNEL_CATEGORIES), 'Other'].map((cat) => {
              const isActive = activeCategories.has(cat);
              return (
                <button
                  key={cat}
                  onClick={() => toggleCategory(cat)}
                  className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ring-zinc-700 transition-colors ${
                    isActive ? badgeColor(cat) : 'bg-zinc-900 text-zinc-500'
                  }`}
                  title={`Toggle ${cat} events`}
                >
                  {cat}
                </button>
              );
            })}
          </div>

          {/* ── exact-channel chips (from channels macro) ──────────── */}
          {knownChannels.length > 0 && (
            <div className="mb-4 flex flex-wrap gap-1.5">
              <span className="mr-1 text-[10px] uppercase tracking-wider text-zinc-600">
                channels
              </span>
              {knownChannels.slice(0, 24).map((c) => {
                const sel = channelFilter.includes(c.channel);
                return (
                  <button
                    key={c.channel}
                    onClick={() => toggleChannel(c.channel)}
                    className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${
                      sel
                        ? 'bg-indigo-600 text-white'
                        : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
                    }`}
                    title={`Last seen ${relativeTime(c.last_seen)}`}
                  >
                    {c.channel}
                    <span className="ml-1 text-zinc-500">{c.count}</span>
                  </button>
                );
              })}
              {channelFilter.length > 0 && (
                <button
                  onClick={() => setChannelFilter([])}
                  className="rounded px-1.5 py-0.5 text-[10px] text-red-400 hover:text-red-300"
                >
                  clear ({channelFilter.length})
                </button>
              )}
            </div>
          )}

          {statsByChannel.length > 0 && (
            <div className="mb-4 flex flex-wrap gap-1.5 text-[10px]">
              <span className="mr-2 text-zinc-500">Last 24h:</span>
              {statsByChannel.slice(0, 12).map((s) => (
                <span key={s.channel} className="rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-400">
                  {s.channel} <span className="text-zinc-300">{s.count}</span>
                </span>
              ))}
            </div>
          )}

          <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
            {/* ── event feed ──────────────────────────────────────── */}
            <div className="rounded-xl bg-zinc-900/60 ring-1 ring-zinc-800">
              <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-2 text-[11px] text-zinc-500">
                <span>
                  {mode === 'live' && 'Live feed'}
                  {mode === 'search' && `Search results for "${query.trim()}"`}
                  {mode === 'range' && 'Date-range results'}
                </span>
                <span>
                  {filteredRows.length} event{filteredRows.length === 1 ? '' : 's'}
                </span>
              </div>
              {filteredRows.length === 0 ? (
                <div className="p-8 text-center text-sm text-zinc-500">
                  {mode === 'live'
                    ? 'No events yet. The substrate fires events continuously — check back in a few seconds.'
                    : 'No events match this filter.'}
                </div>
              ) : (
                <ul className="divide-y divide-zinc-800">
                  {filteredRows.map((row) => {
                    const cat = channelCategory(row.channel);
                    const summary = payloadSummary(row);
                    const isOpen = expandedId === row.id;
                    return (
                      <li key={row.id} className="px-4 py-2.5">
                        <div className="flex items-center gap-3">
                          <button
                            onClick={() => setExpandedId(isOpen ? null : row.id)}
                            className="flex flex-1 items-center gap-3 text-left"
                          >
                            <span
                              className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${badgeColor(
                                cat,
                              )}`}
                            >
                              {cat}
                            </span>
                            <span className="shrink-0 font-mono text-xs text-zinc-400">
                              {row.channel}
                            </span>
                            {row.world_id && (
                              <span className="shrink-0 text-[11px] text-zinc-500">
                                @{row.world_id}
                              </span>
                            )}
                            {row.actor_id && (
                              <span className="shrink-0 text-[11px] text-zinc-500">
                                {row.actor_kind || '?'}:{row.actor_id}
                              </span>
                            )}
                            {summary && (
                              <span className="truncate text-xs text-zinc-300">{summary}</span>
                            )}
                          </button>
                          <span className="shrink-0 text-[10px] text-zinc-500">
                            {relativeTime(row.created_at)}
                          </span>
                          <button
                            onClick={() => setDetailId(row.id)}
                            className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-indigo-400 ring-1 ring-zinc-700 hover:bg-zinc-800 hover:text-indigo-300"
                            title="Open detail drill-in"
                          >
                            detail
                          </button>
                        </div>
                        {isOpen && row.payload && (
                          <pre className="mt-2 ml-7 overflow-x-auto rounded bg-zinc-950 px-3 py-2 text-[11px] text-zinc-300">
                            {JSON.stringify(row.payload, null, 2)}
                          </pre>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {/* ── trends sidebar ──────────────────────────────────── */}
            <ChannelTrends
              worldId={worldFilter}
              selectedChannels={channelFilter}
              onToggleChannel={toggleChannel}
            />
          </div>

          <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
            <OnThisDay />
          </section>
        </div>

        {detailId !== null && (
          <EventDetailPanel
            eventId={detailId}
            onClose={() => setDetailId(null)}
            onJumpTo={(id) => setDetailId(id)}
          />
        )}
      </div>

      <RecentMineCard domain="event-timeline" limit={10} hideWhenEmpty className="mt-4" />
      <AutoActionStrip domain="event-timeline" hideWhenEmpty className="mt-3" />
      <CrossLensRecentsPanel lensId="event-timeline" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
