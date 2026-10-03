'use client';

/**
 * /lenses/expedition-journal — per-world expedition progress tracker.
 *
 * Server-backed (server/domains/expedition-journal.js): progress, journal
 * entries, screenshot capture, completion rewards (XP + badges) and a
 * cross-world summary all persist via the expedition-journal lens domain.
 * Tabbed by canon world; cycle with the `]` key, `S` toggles the summary.
 */

import { useCallback, useEffect, useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { BaseCampAlmanac } from '@/components/expedition-journal/BaseCampAlmanac';
import { StageCard, type StageView } from '@/components/expedition-journal/StageCard';
import { ExpeditionSummary, type SummaryData, type Badge } from '@/components/expedition-journal/ExpeditionSummary';
import { useLensCommand } from '@/hooks/useLensCommand';
import { lensRun } from '@/lib/api/client';
import { Loader2, CheckCircle2, AlertTriangle, Compass, Map as MapIcon, Trophy, SkipForward } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';

interface WorldCatalogEntry {
  worldId: string;
  stageCount: number;
  stages: Array<{ id: string; title: string; objective: string; xp: number }>;
}

interface WorldProgress {
  worldId: string;
  stages: StageView[];
  completed: number;
  total: number;
  percent: number;
  expeditionComplete: boolean;
}

const WORLD_LABELS: Record<string, string> = {
  'concordia-hub': 'Concordia Hub',
  'concord-link-frontier': 'Concord-Link Frontier',
  cyber: 'Cyber',
  fantasy: 'Fantasy',
  'lattice-crucible': 'Lattice Crucible',
  'sovereign-ruins': 'Sovereign Ruins',
};

export default function ExpeditionJournalPage() {
  const [worlds, setWorlds] = useState<WorldCatalogEntry[]>([]);
  const [activeWorld, setActiveWorld] = useState<string>('');
  const [progress, setProgress] = useState<WorldProgress | null>(null);
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [badges, setBadges] = useState<Badge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [tab, setTab] = useState<'world' | 'summary'>('world');

  const [worldsKey, setWorldsKey] = useState(0);
  const [dataKey, setDataKey] = useState(0);

  const retryWorlds = useCallback(() => {
    setLoading(true);
    setError(null);
    setWorldsKey((k) => k + 1);
  }, []);

  // Load the authored world catalog.
  useEffect(() => {
    let cancelled = false;
    lensRun('expedition-journal', 'worlds', {})
      .then((r) => {
        if (cancelled) return;
        if (r.data?.ok && r.data.result) {
          const ws = (r.data.result.worlds as WorldCatalogEntry[]) || [];
          setWorlds(ws);
          if (ws.length > 0) setActiveWorld((cur) => cur || ws[0].worldId);
        } else {
          setError(r.data?.error || 'Could not load expeditions.');
        }
      })
      .catch(() => { if (!cancelled) setError('Could not reach the expedition service.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [worldsKey]);

  useEffect(() => {
    if (!activeWorld) return;
    let cancelled = false;
    lensRun('expedition-journal', 'progress', { worldId: activeWorld })
      .then((r) => { if (!cancelled && r.data?.ok && r.data.result) setProgress(r.data.result as WorldProgress); })
      .catch(() => { /* the stage list keeps its last good state */ });
    return () => { cancelled = true; };
  }, [activeWorld, dataKey]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      lensRun('expedition-journal', 'summary', {}),
      lensRun('expedition-journal', 'rewards', {}),
    ])
      .then(([sm, rw]) => {
        if (cancelled) return;
        if (sm.data?.ok && sm.data.result) setSummary(sm.data.result as SummaryData);
        if (rw.data?.ok && rw.data.result) setBadges((rw.data.result.badges as Badge[]) || []);
      })
      .catch(() => { /* summary stays at its last good state */ });
    return () => { cancelled = true; };
  }, [dataKey]);

  const onStageChange = useCallback(() => setDataKey((k) => k + 1), []);

  const nextWorld = useCallback(() => {
    const i = worlds.findIndex((w) => w.worldId === activeWorld);
    if (worlds.length > 0) setActiveWorld(worlds[(i + 1) % worlds.length].worldId);
    setTab('world');
  }, [worlds, activeWorld]);

  useLensCommand([
    { id: 'next-world', keys: ']', description: 'Next world', category: 'navigation', action: nextWorld },
    { id: 'toggle-summary', keys: 's', description: 'Toggle summary view', category: 'navigation', action: () => {
      setTab((t) => (t === 'world' ? 'summary' : 'world'));
    } },
  ], { lensId: 'expedition-journal' });

  const doneCount = summary?.worlds?.filter((w) => w.expeditionComplete).length ?? 0;

  return (
    <LensShell lensId="expedition-journal" asMain={false}>
      <FirstRunTour lensId="expedition-journal" />
      <DepthBadge lensId="expedition-journal" size="sm" className="ml-2" />
      <NorthStarFrame
        lensId="expedition-journal"
        crumb="Expedition Journal"
        title={tab === 'world' ? `Where the road leads${who ? `, ${who}` : ''}` : 'Everything you have charted'}
        subtitle="Server-backed expedition progress per canon world: journal entries, screenshots, XP and badges. Press ] to cycle worlds, S for the summary."
        tabs={[
          { id: 'world', label: 'World expeditions', icon: MapIcon, hint: 'Per-world stages and journal' },
          { id: 'summary', label: doneCount > 0 ? `Cross-world summary (${doneCount} complete)` : 'Cross-world summary', icon: Trophy, keys: 's', hint: 'Rewards and progress across all worlds' },
        ]}
        activeTab={tab}
        onTab={(id) => setTab(id as 'world' | 'summary')}
        tabsLabel="Expedition journal views"
        cta={{ label: 'Next world', icon: SkipForward, onClick: nextWorld, disabled: worlds.length < 2, title: 'Cycle to the next canon world (])' }}
      >
      <div className="text-gray-100">
        {/* LOADING state */}
        {loading && (
          <div role="status" aria-live="polite" aria-busy="true" className="flex items-center gap-2 text-sm text-gray-400">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading expeditions…
          </div>
        )}

        {/* ERROR state */}
        {!loading && error && (
          <div role="alert" className="flex flex-col items-start gap-3 rounded-lg border border-rose-500/30 bg-rose-500/5 p-4 text-sm text-rose-200">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-rose-400" aria-hidden="true" />
              <span>{error}</span>
            </div>
            <button
              type="button"
              onClick={retryWorlds}
              className="rounded bg-rose-600/30 px-3 py-1 text-xs text-rose-100 hover:bg-rose-600/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400"
            >
              Retry
            </button>
          </div>
        )}

        {/* EMPTY state */}
        {!loading && !error && worlds.length === 0 && (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-white/10 bg-white/5 p-8 text-center text-sm text-gray-400">
            <Compass className="h-8 w-8 text-emerald-400/60" aria-hidden="true" />
            <p className="text-base text-emerald-200">No expeditions to chart yet</p>
            <p className="max-w-sm text-xs text-gray-400">
              The canon-world expedition catalog is empty. Visit a world in the World lens to begin logging your first expedition.
            </p>
          </div>
        )}

        {/* POPULATED state — world expeditions */}
        {!loading && !error && worlds.length > 0 && tab === 'world' && (
          <>
            <nav role="tablist" aria-label="Canon worlds" className="mb-5 flex gap-2 overflow-x-auto border-b border-white/10 pb-2">
              {worlds.map((w) => {
                const complete = summary?.worlds.find((sw) => sw.worldId === w.worldId)?.expeditionComplete;
                const label = WORLD_LABELS[w.worldId] || w.worldId;
                return (
                  <button
                    key={w.worldId}
                    type="button"
                    role="tab"
                    aria-selected={activeWorld === w.worldId}
                    aria-label={complete ? `${label} (expedition complete)` : label}
                    onClick={() => setActiveWorld(w.worldId)}
                    className={`flex items-center gap-1.5 whitespace-nowrap rounded px-3 py-1 text-xs transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 ${
                      activeWorld === w.worldId ? 'bg-emerald-600/30 text-emerald-200' : 'bg-white/5 text-gray-400 hover:bg-white/10'
                    }`}
                  >
                    {complete && <CheckCircle2 className="h-3 w-3 text-emerald-400" aria-hidden="true" />}
                    {label}
                  </button>
                );
              })}
            </nav>

            {progress && (
              <>
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/5 p-3">
                  <div>
                    <h2 className="text-lg font-medium text-emerald-200">{WORLD_LABELS[progress.worldId] || progress.worldId}</h2>
                    <p className="text-xs text-gray-400">
                      {progress.completed}/{progress.total} stages complete
                      {progress.expeditionComplete && <span className="ml-2 text-emerald-400">· Expedition complete</span>}
                    </p>
                  </div>
                  <div className="h-2 w-40 overflow-hidden rounded-full bg-white/10">
                    <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${progress.percent}%` }} />
                  </div>
                </div>

                <div className="space-y-3">
                  {progress.stages.map((s) => (
                    <StageCard key={s.id} worldId={progress.worldId} stage={s} onChange={onStageChange} />
                  ))}
                </div>
              </>
            )}

            <section className="mt-6 rounded-2xl border border-white/10 bg-[#111] p-4">
              <BaseCampAlmanac />
            </section>
          </>
        )}

        {!loading && !error && worlds.length > 0 && tab === 'summary' && <ExpeditionSummary data={summary} badges={badges} />}
      </div>
      </NorthStarFrame>
    </LensShell>
  );
}
