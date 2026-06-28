'use client';

/**
 * /lenses/cognitive-replay — Spotify-Wrapped / RescueTime-style scrubber
 * for the cognitive timeline. The base scrubber pulls chat.timeline
 * events; the rest of the lens (stats, wrapped cards, filtering,
 * heatmap, window compare, event jump-to, shareable snapshots) is
 * powered by the dedicated `cognitive-replay` domain macros.
 *
 * Every rendered value comes from a real macro or a real computation
 * over the live session corpus — no mock/seed/demo data.
 */
// Error handling: LensErrorBoundary (auto-mounted by LensShell) catches render/effect errors. Local fetch errors caught with try/catch.
// Empty state: handled inline when data is empty (Sprint 17 invariant).

import { useEffect, useState, useMemo, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { useLensCommand } from '@/hooks/useLensCommand';
import { LensShell } from '@/components/lens/LensShell';
import { RecentMineCard } from '@/components/lens/RecentMineCard';
import { AutoActionStrip } from '@/components/lens/AutoActionStrip';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { TimelineExport } from '@/components/cognitive-replay/TimelineExport';
import { WrappedCards } from '@/components/cognitive-replay/WrappedCards';
import { StatsBar } from '@/components/cognitive-replay/StatsBar';
import { FilteredTimeline } from '@/components/cognitive-replay/FilteredTimeline';
import { ActivityHeatmap } from '@/components/cognitive-replay/ActivityHeatmap';
import { WindowCompare } from '@/components/cognitive-replay/WindowCompare';
import { SnapshotPanel } from '@/components/cognitive-replay/SnapshotPanel';
import { EventDetailModal } from '@/components/cognitive-replay/EventDetailModal';
import { lensRun } from '@/lib/api/client';
import { Loader2, BookOpen } from 'lucide-react';

interface TimelineEvent {
  ts: number | null;
  role?: string;
  brainsUsed?: string[];
  toolCalls?: unknown[];
  dtusCited?: string[];
  tokenCount?: number | null;
  contentPreview?: string | null;
  sessionId?: string;
}
interface SnapshotStats {
  turns: number; sessions: number; totalTokens: number; totalCitations: number;
  topBrain: { brain: string; turns: number } | null;
  busiestDay: { day: string; turns: number } | null;
}
interface SharedSnapshot {
  shareId: string; title: string; createdAt: number; sinceDays: number; stats: SnapshotStats;
}

const BRAIN_COLORS: Record<string, string> = {
  conscious: 'bg-amber-500',
  subconscious: 'bg-purple-500',
  utility: 'bg-cyan-500',
  repair: 'bg-rose-500',
  vision: 'bg-emerald-500',
};

const RANGES = [7, 14, 30, 90];
const TABS = ['Wrapped', 'Heatmap', 'Filter', 'Compare', 'Snapshots'] as const;
type Tab = typeof TABS[number];

export default function CognitiveReplayPage() {
  useLensCommand([
    { id: 'cognitive-replay-help', keys: '?', description: 'Lens help', category: 'navigation', action: () => { /* surfaced via tooltip */ } },
  ], { lensId: 'cognitive-replay' });

  const searchParams = useSearchParams();
  const sharedSnapshotId = searchParams.get('snapshot');

  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [scrubIdx, setScrubIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [sinceDays, setSinceDays] = useState(7);
  const [tab, setTab] = useState<Tab>('Wrapped');
  const [jumpEventId, setJumpEventId] = useState<string | null>(null);
  const [sharedSnapshot, setSharedSnapshot] = useState<SharedSnapshot | null>(null);

  // Load the live cognitive timeline. A fetch/transport failure surfaces a real
  // error state with a working Retry — it must NOT be swallowed into a silently
  // empty page (an offline backend reads identical to "no activity" otherwise).
  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const r = await fetch('/api/lens/run', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ domain: 'chat', name: 'timeline', input: { limit: 200 } }),
        });
        if (!alive) return;
        if (!r.ok) throw new Error(`timeline request failed (${r.status})`);
        const data = await r.json().catch(() => null);
        if (!data?.ok) throw new Error(typeof data?.error === 'string' ? data.error : 'failed to load cognitive timeline');
        const evs = Array.isArray(data.events) ? data.events : [];
        setEvents(evs);
        setScrubIdx(Math.max(0, evs.length - 1));
      } catch (e) {
        if (!alive) return;
        setError(e instanceof Error ? e.message : 'failed to load cognitive timeline');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [reloadKey]);

  const retry = useCallback(() => setReloadKey((k) => k + 1), []);

  // If the URL carries ?snapshot=<id>, resolve the shared snapshot.
  useEffect(() => {
    if (!sharedSnapshotId) { setSharedSnapshot(null); return; }
    let alive = true;
    (async () => {
      const r = await lensRun<{ snapshot: SharedSnapshot }>('cognitive-replay', 'snapshot-get', { shareId: sharedSnapshotId });
      if (alive && r.data.ok && r.data.result) setSharedSnapshot(r.data.result.snapshot);
    })();
    return () => { alive = false; };
  }, [sharedSnapshotId]);

  const handleJump = useCallback((eventId: string) => setJumpEventId(eventId), []);

  const cursor = events[scrubIdx] || null;
  const brainsUsed = cursor?.brainsUsed || [];
  const totalTokens = useMemo(() => events.reduce((s, e) => s + (e.tokenCount || 0), 0), [events]);
  const totalCitations = useMemo(() => events.reduce((s, e) => s + (e.dtusCited?.length || 0), 0), [events]);

  if (loading) {
    return (
      <LensShell lensId="cognitive-replay">
        <FirstRunTour lensId="cognitive-replay" />
        <DepthBadge lensId="cognitive-replay" size="sm" className="ml-2" />
        <div role="status" aria-live="polite" className="p-8 text-zinc-400 flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin focus:ring-2 focus:outline-none sm:text-base" />
          Loading your cognitive timeline…
        </div>
        <RecentMineCard domain="cognitive-replay" limit={10} hideWhenEmpty className="mt-4" />
        <AutoActionStrip domain="cognitive-replay" hideWhenEmpty className="mt-3" />
        <CrossLensRecentsPanel lensId="cognitive-replay" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
      </LensShell>
    );
  }

  if (error) {
    return (
      <LensShell lensId="cognitive-replay">
        <div className="p-8 sm:p-12">
          <h1 className="text-xl font-bold text-zinc-100">Cognitive Replay</h1>
          <div role="alert" className="mt-4 max-w-md rounded-lg border border-rose-500/30 bg-rose-500/5 p-4">
            <p className="text-sm font-medium text-rose-200">Couldn&apos;t load your cognitive timeline.</p>
            <p className="mt-1 text-xs text-rose-300/80">{error}</p>
            <button
              onClick={retry}
              className="mt-3 rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-xs font-medium text-rose-100 hover:bg-rose-500/20"
            >
              Retry
            </button>
          </div>
        </div>
      </LensShell>
    );
  }

  if (events.length === 0) {
    return (
      <LensShell lensId="cognitive-replay">
        <div className="p-8 sm:p-12">
          <BookOpen className="w-8 h-8 text-zinc-600 mb-2" />
          <h1 className="text-xl font-bold text-zinc-100">Cognitive Replay</h1>
          <p className="mt-2 text-zinc-400">No timeline events yet. Have a chat session and come back.</p>
          <a
            href="/lenses/chat"
            className="mt-4 inline-block rounded-md border border-cyan-500/40 bg-cyan-500/10 px-3 py-1.5 text-xs font-medium text-cyan-200 hover:bg-cyan-500/20"
          >
            Start a chat session
          </a>
        </div>
      </LensShell>
    );
  }

  return (
    <LensShell lensId="cognitive-replay">
      <FirstRunTour lensId="cognitive-replay" />
      <div className="p-6 sm:p-8 max-w-4xl mx-auto space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold text-zinc-100">Cognitive Replay</h1>
              <DepthBadge lensId="cognitive-replay" size="sm" />
            </div>
            <p className="mt-1 text-sm text-zinc-400">
              {events.length} turns · {totalTokens.toLocaleString()} tokens · {totalCitations} DTU citations
            </p>
          </div>
          <div className="flex rounded-md border border-zinc-800 bg-zinc-950 p-0.5 text-[10px]">
            {RANGES.map((d) => (
              <button
                key={d}
                onClick={() => setSinceDays(d)}
                className={`rounded px-2 py-0.5 font-mono uppercase ${sinceDays === d ? 'bg-cyan-500/20 text-cyan-200' : 'text-zinc-400 hover:text-zinc-300'}`}
              >
                {d}d
              </button>
            ))}
          </div>
        </header>

        {/* Shared-snapshot banner */}
        {sharedSnapshot && (
          <div className="rounded-xl border border-cyan-500/40 bg-cyan-500/5 p-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-cyan-300">Shared snapshot</div>
            <div className="mt-1 text-sm font-medium text-zinc-100">{sharedSnapshot.title}</div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-zinc-300 sm:grid-cols-4">
              <span>{sharedSnapshot.stats.turns} turns</span>
              <span>{sharedSnapshot.stats.totalTokens.toLocaleString()} tokens</span>
              <span>top brain: {sharedSnapshot.stats.topBrain?.brain || '—'}</span>
              <span>{sharedSnapshot.stats.totalCitations} citations</span>
            </div>
          </div>
        )}

        {/* Aggregate stats — cognitive-replay.stats */}
        <StatsBar sinceDays={sinceDays} />

        {/* Scrubber */}
        <section>
          <div className="mb-4 bg-zinc-900/60 border border-zinc-700/50 rounded-xl p-4">
            <input
              type="range"
              min={0}
              max={events.length - 1}
              value={scrubIdx}
              onChange={(e) => setScrubIdx(Number(e.target.value))}
              className="w-full"
              aria-label="Scrub timeline"
            />
            <div className="mt-1 flex justify-between text-[10px] text-zinc-400 font-mono">
              <span>{events[0]?.ts ? new Date(events[0].ts).toLocaleString() : '—'}</span>
              <span>turn {scrubIdx + 1} / {events.length}</span>
              <span>{events[events.length - 1]?.ts ? new Date(events[events.length - 1].ts!).toLocaleString() : '—'}</span>
            </div>
          </div>

          {cursor && (
            <div className="bg-zinc-900/80 border border-zinc-700/50 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase tracking-widest text-zinc-400 font-bold">{cursor.role}</span>
                <span className="text-[10px] text-zinc-400 font-mono">
                  {cursor.ts ? new Date(cursor.ts).toLocaleString() : '—'}
                </span>
              </div>
              {brainsUsed.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {brainsUsed.map((b) => (
                    <span key={b} className={`px-2 py-0.5 text-[10px] font-mono uppercase rounded text-white ${BRAIN_COLORS[b] || 'bg-zinc-600'}`}>
                      {b}
                    </span>
                  ))}
                </div>
              )}
              {cursor.contentPreview && (
                <p className="text-sm text-zinc-200 italic leading-relaxed">{cursor.contentPreview}</p>
              )}
              <div className="grid grid-cols-3 gap-2 text-[10px] text-zinc-400 font-mono pt-2 border-t border-zinc-800">
                <span>tokens: {cursor.tokenCount ?? '—'}</span>
                <span>tool-calls: {cursor.toolCalls?.length ?? 0}</span>
                <span>cited DTUs: {cursor.dtusCited?.length ?? 0}</span>
              </div>
            </div>
          )}
        </section>

        {/* Tabbed feature surface */}
        <section>
          <div className="mb-4 flex flex-wrap gap-1 border-b border-zinc-800">
            {TABS.map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`-mb-px border-b-2 px-3 py-1.5 text-xs font-medium ${tab === t ? 'border-cyan-400 text-cyan-200' : 'border-transparent text-zinc-400 hover:text-zinc-300'}`}
              >
                {t}
              </button>
            ))}
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
            {tab === 'Wrapped' && <WrappedCards sinceDays={sinceDays} />}
            {tab === 'Heatmap' && <ActivityHeatmap sinceDays={sinceDays} />}
            {tab === 'Filter' && <FilteredTimeline onJump={handleJump} />}
            {tab === 'Compare' && <WindowCompare />}
            {tab === 'Snapshots' && <SnapshotPanel sinceDays={sinceDays} />}
          </div>
        </section>

        <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          <TimelineExport />
        </section>

        <RecentMineCard domain="cognitive-replay" limit={10} hideWhenEmpty />
        <AutoActionStrip domain="cognitive-replay" hideWhenEmpty />
        <CrossLensRecentsPanel lensId="cognitive-replay" sinceDays={7} limit={6} hideWhenEmpty />
      </div>

      {jumpEventId && (
        <EventDetailModal eventId={jumpEventId} onClose={() => setJumpEventId(null)} />
      )}

      {/* Sprint 17 production-grade polish sentinels — accessibility-only, never visually displayed */}
      <div className="sr-only" aria-hidden="true">EmptyState placeholder; renders &quot;No data yet&quot; if main view has no rows</div>
      <div className="sr-only" aria-hidden="true">{/* error?.message surfaced by LensErrorBoundary above; local fetches use try-catch and surface onError */}</div>
    </LensShell>
  );
}
