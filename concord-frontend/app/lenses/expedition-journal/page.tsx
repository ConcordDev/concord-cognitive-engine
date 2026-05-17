'use client';

/**
 * /lenses/expedition-journal — Phase V dispatch target for the
 * expedition game mode. Tabbed by world. Each tab renders the 3
 * stages (arrive / act / record) with a "Mark stage complete" CTA
 * bound to gameModeOrchestrator.advanceStage().
 */

import { useEffect, useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { RecentMineCard } from '@/components/lens/RecentMineCard';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { BaseCampAlmanac } from '@/components/expedition-journal/BaseCampAlmanac';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';
import { gameModeOrchestrator } from '@/lib/concordia/game-mode-orchestrator';
import { useLensCommand } from '@/hooks/useLensCommand';

const CANON_WORLDS = [
  { id: 'concordia-hub',         name: 'Concordia Hub' },
  { id: 'concord-link-frontier', name: 'Concord-Link Frontier' },
  { id: 'cyber',                 name: 'Cyber' },
  { id: 'fantasy',               name: 'Fantasy' },
  { id: 'lattice-crucible',      name: 'Lattice Crucible' },
  { id: 'sovereign-ruins',       name: 'Sovereign Ruins' },
];

const STAGE_KEY_PREFIX = 'concordia:expedition:';

export default function ExpeditionJournalPage() {
  const [activeWorld, setActiveWorld] = useState(CANON_WORLDS[0].id);
  const [stages, setStages] = useState<Record<string, Record<string, boolean>>>({});

  useLensCommand([
    { id: 'next-world', keys: ']', description: 'Next world', category: 'navigation', action: () => {
      const i = CANON_WORLDS.findIndex(w => w.id === activeWorld);
      setActiveWorld(CANON_WORLDS[(i + 1) % CANON_WORLDS.length].id);
    } },
  ], { lensId: 'expedition-journal' });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const raw = window.localStorage.getItem(STAGE_KEY_PREFIX + 'all');
    if (raw) {
      try { setStages(JSON.parse(raw)); } catch { /* invalid */ }
    }
  }, []);

  function markStage(world: string, stage: string, done: boolean) {
    setStages((prev) => {
      const next = { ...prev, [world]: { ...(prev[world] ?? {}), [stage]: done } };
      try { window.localStorage.setItem(STAGE_KEY_PREFIX + 'all', JSON.stringify(next)); } catch { /* quota */ }
      return next;
    });
    if (done) {
      try { gameModeOrchestrator.advance(); } catch { /* mode not active */ }
    }
  }

  const STAGES = ['arrive', 'act', 'record'] as const;

  return (
    <LensShell lensId="expedition-journal" asMain={false}>
      <FirstRunTour lensId="expedition-journal" />
      <ManifestActionBar />
      <DepthBadge lensId="expedition-journal" size="sm" className="ml-2" />
      <div className="min-h-screen bg-[#0b0f17] text-gray-100 p-6">
        <header className="mb-5">
          <h1 className="text-3xl font-semibold text-emerald-300">Expedition Journal</h1>
          <p className="text-gray-400 mt-1">Three stages per canon world. Mark each as you go — the orchestrator advances on save.</p>
        </header>

        <nav className="flex gap-2 mb-5 border-b border-white/10 pb-2 overflow-x-auto">
          {CANON_WORLDS.map((w) => (
            <button
              key={w.id}
              type="button"
              onClick={() => setActiveWorld(w.id)}
              className={`px-3 py-1 text-xs rounded transition-colors ${activeWorld === w.id ? 'bg-emerald-600/30 text-emerald-200' : 'bg-white/5 text-gray-400 hover:bg-white/10'}`}
            >
              {w.name}
            </button>
          ))}
        </nav>

        <div className="space-y-3">
          {STAGES.map((s) => {
            const done = stages[activeWorld]?.[s] ?? false;
            return (
              <div key={s} className="rounded border border-white/10 bg-white/5 p-4 flex items-center justify-between">
                <div>
                  <h3 className="text-sm uppercase tracking-wide text-gray-500">Stage</h3>
                  <p className="text-lg font-medium text-emerald-200 capitalize">{s}</p>
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={done} onChange={(e) => markStage(activeWorld, s, e.target.checked)} className="accent-emerald-500" />
                  <span className="text-xs text-gray-400">Done</span>
                </label>
              </div>
            );
          })}
        </div>
        <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          <BaseCampAlmanac />
        </section>
      </div>
          <RecentMineCard domain="expedition-journal" limit={10} hideWhenEmpty className="mt-4" />
          <CrossLensRecentsPanel lensId="expedition-journal" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
