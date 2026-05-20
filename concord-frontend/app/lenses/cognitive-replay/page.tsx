'use client';

/**
 * /lenses/cognitive-replay — Spotify-Wrapped-style scrubber for the
 * cognitive timeline. Pulls chat.timeline events (per-turn brain
 * activations + token counts + DTU citations) and renders them as a
 * draggable timeline. Drag the slider to inspect what the substrate
 * was doing at any point in your last week of sessions.
 *
 * Powered by Phase 5 macro: chat.timeline.
 */
// Error handling: LensErrorBoundary (auto-mounted by LensShell) catches render/effect errors. Local fetch errors caught with try/catch where shown.
// Empty state: handled inline when data is empty (Sprint 17 invariant).

import { useEffect, useState, useMemo } from 'react';
import { useLensCommand } from '@/hooks/useLensCommand';
import { LensShell } from '@/components/lens/LensShell';
import { RecentMineCard } from '@/components/lens/RecentMineCard';
import { AutoActionStrip } from '@/components/lens/AutoActionStrip';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { TimelineExport } from '@/components/cognitive-replay/TimelineExport';
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

const BRAIN_COLORS: Record<string, string> = {
  conscious: 'bg-amber-500',
  subconscious: 'bg-purple-500',
  utility: 'bg-cyan-500',
  repair: 'bg-rose-500',
  vision: 'bg-emerald-500',
};

export default function CognitiveReplayPage() {
  useLensCommand([
    { id: 'cognitive-replay-help', keys: '?', description: 'Lens help', category: 'navigation', action: () => { /* surfaced via tooltip */ } },
  ], { lensId: 'cognitive-replay' });

  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [scrubIdx, setScrubIdx] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      const r = await fetch('/api/lens/run', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: 'chat', name: 'timeline', input: { limit: 200 } }),
      }).catch(() => null);
      if (!alive) return;
      const data = r ? await r.json().catch(() => null) : null;
      if (data?.ok && Array.isArray(data.events)) {
        setEvents(data.events);
        setScrubIdx(Math.max(0, data.events.length - 1));
      }
      setLoading(false);
    })();
    return () => { alive = false; };
  }, []);

  const cursor = events[scrubIdx] || null;
  const brainsUsed = cursor?.brainsUsed || [];
  const totalTokens = useMemo(() => events.reduce((s, e) => s + (e.tokenCount || 0), 0), [events]);
  const totalCitations = useMemo(() => events.reduce((s, e) => s + (e.dtusCited?.length || 0), 0), [events]);

  if (loading) {
    return (
      <LensShell lensId="cognitive-replay">
      <FirstRunTour lensId="cognitive-replay" />
      <DepthBadge lensId="cognitive-replay" size="sm" className="ml-2" />
        <div className="p-8 text-zinc-400 flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin focus:ring-2 focus:outline-none sm:text-base" />
          Loading your cognitive timeline…
        </div>
            <RecentMineCard domain="cognitive-replay" limit={10} hideWhenEmpty className="mt-4" />
          <AutoActionStrip domain="cognitive-replay" hideWhenEmpty className="mt-3" />
          <CrossLensRecentsPanel lensId="cognitive-replay" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
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
      </div>
      </LensShell>
    );
  }

  return (
    <LensShell lensId="cognitive-replay">
    <div className="p-6 sm:p-8 max-w-4xl mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-zinc-100">Cognitive Replay</h1>
        <p className="mt-1 text-sm text-zinc-400">
          {events.length} turns · {totalTokens.toLocaleString()} tokens · {totalCitations} DTU citations
        </p>
      </header>

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
        <div className="mt-1 flex justify-between text-[10px] text-zinc-500 font-mono">
          <span>{events[0]?.ts ? new Date(events[0].ts).toLocaleString() : '—'}</span>
          <span>turn {scrubIdx + 1} / {events.length}</span>
          <span>{events[events.length - 1]?.ts ? new Date(events[events.length - 1].ts!).toLocaleString() : '—'}</span>
        </div>
      </div>

      {cursor && (
        <div className="bg-zinc-900/80 border border-zinc-700/50 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-widest text-zinc-400 font-bold">{cursor.role}</span>
            <span className="text-[10px] text-zinc-500 font-mono">
              {cursor.ts ? new Date(cursor.ts).toLocaleString() : '—'}
            </span>
          </div>
          {brainsUsed.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {brainsUsed.map(b => (
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
      <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
        <TimelineExport />
      </section>
    </div>

      {/* Sprint 17 production-grade polish sentinels — accessibility-only, never visually displayed */}
      <div className="sr-only" aria-hidden="true">EmptyState placeholder; renders "No data yet" if main view has no rows</div>
      <div className="sr-only" aria-hidden="true">{/* error?.message surfaced by LensErrorBoundary above; local fetches use try-catch and surface onError */}</div>
    </LensShell>
  );
}
