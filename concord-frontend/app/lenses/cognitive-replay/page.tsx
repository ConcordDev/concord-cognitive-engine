'use client';

/**
 * /lenses/cognitive-replay — north-star look (serif title, pill tabs, teal CTA). Spotify-Wrapped / RescueTime-style scrubber
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
import Link from 'next/link';
import { useLensCommand } from '@/hooks/useLensCommand';
import { LensShell } from '@/components/lens/LensShell';
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
import { Loader2, BookOpen, Flame, Grid3x3, Filter, GitCompare, Camera, Crosshair, MessageSquare } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { cn } from '@/lib/utils';

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
const TABS = [
  { id: 'Wrapped', keys: '1', icon: Flame, hint: 'Wrapped-style highlight cards' },
  { id: 'Heatmap', keys: '2', icon: Grid3x3, hint: 'Activity heatmap' },
  { id: 'Filter', keys: '3', icon: Filter, hint: 'Filter and jump to events' },
  { id: 'Compare', keys: '4', icon: GitCompare, hint: 'Compare two windows' },
  { id: 'Snapshots', keys: '5', icon: Camera, hint: 'Shareable snapshots' },
] as const;
type Tab = typeof TABS[number]['id'];

const FRAME = 'relative min-h-full px-8 pb-28 pt-6';
const CTA = 'fixed bottom-8 right-8 z-30 inline-flex items-center gap-2 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300';

function Title({ children }: { children: React.ReactNode }) {
  return (
    <>
      <p className="text-[14px] text-zinc-500">Cognitive Replay</p>
      <h1 className="mb-5 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">{children}</h1>
    </>
  );
}

export default function CognitiveReplayPage() {
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
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);

  const chooseMoment = useCallback(() => {
    const el = document.querySelector<HTMLInputElement>('[data-lens-theme="cognitive-replay"] input[aria-label="Scrub timeline"]');
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el?.focus();
  }, []);

  useLensCommand([
    ...TABS.map((t) => ({
      id: `tab-${t.id}`,
      keys: t.keys,
      description: `${t.id} — ${t.hint}`,
      category: 'navigation' as const,
      action: () => setTab(t.id),
    })),
    { id: 'choose-moment', keys: 'm', description: 'Choose a moment on the scrubber', category: 'actions' as const, action: chooseMoment },
  ], { lensId: 'cognitive-replay' });

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
        const json = await r.json().catch(() => null);
        // The outer `ok` from POST /api/lens/run is just a transport flag —
        // chat.timeline's real payload (ok/events/error) lives under `.result`.
        const data = json?.result ?? json;
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
    if (!sharedSnapshotId) return;
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
      <LensShell lensId="cognitive-replay" asMain={false}>
        <FirstRunTour lensId="cognitive-replay" />
        <DepthBadge lensId="cognitive-replay" size="sm" className="ml-2" />
        <div data-lens-theme="cognitive-replay" className={FRAME}>
          <Title>Replay the moment{who ? `, ${who}` : ''}</Title>
          <div role="status" aria-live="polite" className="flex items-center gap-2 rounded-2xl border border-white/10 bg-[#111] p-8 text-zinc-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading your cognitive timeline…
          </div>
          <CrossLensRecentsPanel lensId="cognitive-replay" sinceDays={7} limit={6} hideWhenEmpty className="mt-8" />
        </div>
      </LensShell>
    );
  }

  if (error) {
    return (
      <LensShell lensId="cognitive-replay" asMain={false}>
        <div data-lens-theme="cognitive-replay" className={FRAME}>
          <Title>Replay the moment{who ? `, ${who}` : ''}</Title>
          <div role="alert" className="max-w-md rounded-2xl border border-rose-500/30 bg-rose-500/5 p-4">
            <p className="text-sm font-medium text-rose-200">Couldn&apos;t load your cognitive timeline.</p>
            <p className="mt-1 text-xs text-rose-300/80">{error}</p>
            <button
              onClick={retry}
              className="mt-3 rounded-full border border-rose-500/40 bg-rose-500/10 px-4 py-1.5 text-xs font-medium text-rose-100 hover:bg-rose-500/20"
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
      <LensShell lensId="cognitive-replay" asMain={false}>
        <div data-lens-theme="cognitive-replay" className={FRAME}>
          <Title>Replay the moment{who ? `, ${who}` : ''}</Title>
          <div className="flex min-h-[18rem] flex-col items-center justify-center rounded-2xl border border-white/10 bg-[#111] p-8 text-center">
            <BookOpen className="mb-2 h-8 w-8 text-zinc-600" />
            <p className="text-zinc-400">No timeline events yet. Have a chat session and come back.</p>
          </div>
          <Link href="/lenses/chat" className={CTA}>
            <MessageSquare className="h-4 w-4" />
            Start a chat session
          </Link>
        </div>
      </LensShell>
    );
  }

  return (
    <LensShell lensId="cognitive-replay" asMain={false}>
      <FirstRunTour lensId="cognitive-replay" />
      <DepthBadge lensId="cognitive-replay" size="sm" className="ml-2" />
      <div data-lens-theme="cognitive-replay" className={FRAME}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <Title>Replay the moment{who ? `, ${who}` : ''}</Title>
          </div>
          <div className="flex shrink-0 items-center gap-3 pt-2">
            <p className="text-[13px] text-zinc-500">
              {events.length} turns · {totalTokens.toLocaleString()} tokens · {totalCitations} DTU citations
            </p>
            <div className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.03] p-1 text-[12px]">
              {RANGES.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setSinceDays(d)}
                  aria-pressed={sinceDays === d}
                  className={cn('rounded-full px-3 py-1 font-mono uppercase transition-colors', sinceDays === d ? 'bg-white/10 text-zinc-50' : 'text-zinc-500 hover:text-zinc-200')}
                >
                  {d}d
                </button>
              ))}
            </div>
          </div>
        </div>

        {sharedSnapshotId && sharedSnapshot && (
          <div className="mb-5 rounded-2xl border border-teal-400/30 bg-teal-400/5 p-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-teal-300">Shared snapshot</div>
            <div className="mt-1 text-sm font-medium text-zinc-100">{sharedSnapshot.title}</div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-zinc-300 sm:grid-cols-4">
              <span>{sharedSnapshot.stats.turns} turns</span>
              <span>{sharedSnapshot.stats.totalTokens.toLocaleString()} tokens</span>
              <span>top brain: {sharedSnapshot.stats.topBrain?.brain || '—'}</span>
              <span>{sharedSnapshot.stats.totalCitations} citations</span>
            </div>
          </div>
        )}

        <StatsBar sinceDays={sinceDays} />

        <section className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="rounded-2xl border border-white/10 bg-[#111] p-5">
            <input
              type="range"
              min={0}
              max={events.length - 1}
              value={scrubIdx}
              onChange={(e) => setScrubIdx(Number(e.target.value))}
              className="w-full accent-teal-400"
              aria-label="Scrub timeline"
            />
            <div className="mt-1 flex justify-between font-mono text-[10px] text-zinc-400">
              <span>{events[0]?.ts ? new Date(events[0].ts).toLocaleString() : '—'}</span>
              <span>turn {scrubIdx + 1} / {events.length}</span>
              <span>{events[events.length - 1]?.ts ? new Date(events[events.length - 1].ts!).toLocaleString() : '—'}</span>
            </div>
          </div>

          {cursor && (
            <div className="space-y-3 rounded-2xl border border-white/10 bg-[#111] p-5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-widest text-zinc-400">{cursor.role}</span>
                <span className="font-mono text-[10px] text-zinc-400">
                  {cursor.ts ? new Date(cursor.ts).toLocaleString() : '—'}
                </span>
              </div>
              {brainsUsed.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {brainsUsed.map((b) => (
                    <span key={b} className={`rounded px-2 py-0.5 font-mono text-[10px] uppercase text-white ${BRAIN_COLORS[b] || 'bg-zinc-600'}`}>
                      {b}
                    </span>
                  ))}
                </div>
              )}
              {cursor.contentPreview && (
                <p className="text-sm italic leading-relaxed text-zinc-200">{cursor.contentPreview}</p>
              )}
              <div className="grid grid-cols-3 gap-2 border-t border-white/10 pt-2 font-mono text-[10px] text-zinc-400">
                <span>tokens: {cursor.tokenCount ?? '—'}</span>
                <span>tool-calls: {cursor.toolCalls?.length ?? 0}</span>
                <span>cited DTUs: {cursor.dtusCited?.length ?? 0}</span>
              </div>
            </div>
          )}
        </section>

        <nav className="mb-5 mt-6 inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-white/10 bg-white/[0.03] p-1" aria-label="Replay views">
          {TABS.map((t) => {
            const Icon = t.icon;
            const on = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                aria-current={on ? 'page' : undefined}
                title={`${t.hint} (${t.keys})`}
                className={cn(
                  'inline-flex items-center gap-2 whitespace-nowrap rounded-full px-4 py-1.5 text-[14px] transition-colors',
                  on ? 'bg-white/10 text-zinc-50' : 'text-zinc-500 hover:text-zinc-200',
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {t.id}
                <kbd className="hidden rounded border border-white/10 bg-white/5 px-1 py-0.5 font-mono text-[10px] text-white/30 sm:inline-block">{t.keys}</kbd>
              </button>
            );
          })}
        </nav>

        <div className="rounded-2xl border border-white/10 bg-[#111] p-4">
          {tab === 'Wrapped' && <WrappedCards sinceDays={sinceDays} />}
          {tab === 'Heatmap' && <ActivityHeatmap sinceDays={sinceDays} />}
          {tab === 'Filter' && <FilteredTimeline onJump={handleJump} />}
          {tab === 'Compare' && <WindowCompare />}
          {tab === 'Snapshots' && <SnapshotPanel sinceDays={sinceDays} />}
        </div>

        <section className="mt-5 rounded-2xl border border-white/10 bg-[#111] p-4">
          <TimelineExport />
        </section>

        <CrossLensRecentsPanel lensId="cognitive-replay" sinceDays={7} limit={6} hideWhenEmpty className="mt-8" />

        <button type="button" onClick={chooseMoment} title="Choose a moment (M)" className={CTA}>
          <Crosshair className="h-4 w-4" />
          Choose a moment
        </button>
      </div>

      {jumpEventId && (
        <EventDetailModal eventId={jumpEventId} onClose={() => setJumpEventId(null)} />
      )}
    </LensShell>
  );
}
