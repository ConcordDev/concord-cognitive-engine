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
import { RecentMineCard } from '@/components/lens/RecentMineCard';
import { AutoActionStrip } from '@/components/lens/AutoActionStrip';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';
import { BaseCampAlmanac } from '@/components/expedition-journal/BaseCampAlmanac';
import { StageCard, type StageView } from '@/components/expedition-journal/StageCard';
import { ExpeditionSummary, type SummaryData, type Badge } from '@/components/expedition-journal/ExpeditionSummary';
import { useLensCommand } from '@/hooks/useLensCommand';
import { lensRun } from '@/lib/api/client';
import { Loader2, CheckCircle2, AlertTriangle, Compass } from 'lucide-react';

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
  const [tab, setTab] = useState<'world' | 'summary'>('world');

  // Load the authored world catalog once.
  const loadWorlds = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await lensRun('expedition-journal', 'worlds', {});
      if (r.data?.ok && r.data.result) {
        const ws = (r.data.result.worlds as WorldCatalogEntry[]) || [];
        setWorlds(ws);
        if (ws.length > 0) setActiveWorld((cur) => cur || ws[0].worldId);
      } else {
        setError(r.data?.error || 'Could not load expeditions.');
      }
    } catch {
      setError('Could not reach the expedition service.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadWorlds(); }, [loadWorlds]);

  const loadProgress = useCallback(async (worldId: string) => {
    if (!worldId) return;
    const r = await lensRun('expedition-journal', 'progress', { worldId });
    if (r.data?.ok && r.data.result) setProgress(r.data.result as WorldProgress);
  }, []);

  const loadSummary = useCallback(async () => {
    const [s, rw] = await Promise.all([
      lensRun('expedition-journal', 'summary', {}),
      lensRun('expedition-journal', 'rewards', {}),
    ]);
    if (s.data?.ok && s.data.result) setSummary(s.data.result as SummaryData);
    if (rw.data?.ok && rw.data.result) setBadges((rw.data.result.badges as Badge[]) || []);
  }, []);

  useEffect(() => { if (activeWorld) void loadProgress(activeWorld); }, [activeWorld, loadProgress]);
  useEffect(() => { void loadSummary(); }, [loadSummary]);

  const onStageChange = useCallback(() => {
    void loadProgress(activeWorld);
    void loadSummary();
  }, [activeWorld, loadProgress, loadSummary]);

  useLensCommand([
    { id: 'next-world', keys: ']', description: 'Next world', category: 'navigation', action: () => {
      const i = worlds.findIndex((w) => w.worldId === activeWorld);
      if (worlds.length > 0) setActiveWorld(worlds[(i + 1) % worlds.length].worldId);
    } },
    { id: 'toggle-summary', keys: 's', description: 'Toggle summary view', category: 'navigation', action: () => {
      setTab((t) => (t === 'world' ? 'summary' : 'world'));
    } },
  ], { lensId: 'expedition-journal' });

  return (
    <LensShell lensId="expedition-journal" asMain={false}>
      <FirstRunTour lensId="expedition-journal" />
      <ManifestActionBar />
      <DepthBadge lensId="expedition-journal" size="sm" className="ml-2" />
      <div className="min-h-screen bg-[#0b0f17] p-6 text-gray-100">
        <header className="mb-5">
          <h1 className="text-3xl font-semibold text-emerald-300">Expedition Journal</h1>
          <p className="mt-1 text-gray-400">
            Server-backed expedition progress per canon world — journal entries, screenshots, XP and badges. Press <kbd className="rounded bg-white/10 px-1">]</kbd> to cycle worlds, <kbd className="rounded bg-white/10 px-1">S</kbd> for the summary.
          </p>
        </header>

        <nav role="tablist" aria-label="Expedition journal views" className="mb-4 flex gap-2 border-b border-white/10 pb-2">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'world'}
            onClick={() => setTab('world')}
            className={`rounded px-3 py-1 text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 ${tab === 'world' ? 'bg-emerald-600/30 text-emerald-200' : 'bg-white/5 text-gray-400 hover:bg-white/10'}`}
          >
            World expeditions
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'summary'}
            onClick={() => setTab('summary')}
            className={`rounded px-3 py-1 text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 ${tab === 'summary' ? 'bg-emerald-600/30 text-emerald-200' : 'bg-white/5 text-gray-400 hover:bg-white/10'}`}
          >
            Cross-world summary
          </button>
        </nav>

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
              onClick={() => void loadWorlds()}
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

            <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
              <BaseCampAlmanac />
            </section>
          </>
        )}

        {!loading && !error && worlds.length > 0 && tab === 'summary' && <ExpeditionSummary data={summary} badges={badges} />}
      </div>
      <RecentMineCard domain="expedition-journal" limit={10} hideWhenEmpty className="mt-4" />
      <AutoActionStrip domain="expedition-journal" hideWhenEmpty className="mt-3" />
      <CrossLensRecentsPanel lensId="expedition-journal" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
