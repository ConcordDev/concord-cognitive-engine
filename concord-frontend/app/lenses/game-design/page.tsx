'use client';

import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { GameDesignSection } from '@/components/game-design/GameDesignSection';
import { GameDevRepos } from '@/components/game-design/GameDevRepos';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { useState } from 'react';
import { Gamepad2, ChevronDown, ChevronRight } from 'lucide-react';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';

/**
 * Game Design lens — a Tiled + LDtk + Nuclino-shape workbench, backed by
 * the 98-macro `game-design` domain (server/domains/gamedesign.js).
 *
 * The full designed surface is `GameDesignSection` (project roster +
 * 12 real tabs: Design Doc, Mechanics, Loops, Entities, Levels,
 * Narrative, Assets, Animation, Behavior, Play & Test, Collab,
 * Analysis) — every tab reads and writes through real `lensRun()`
 * calls into `getGdState()`. This page used to also carry a duplicate,
 * disconnected "Projects/GDD/Mechanics/Narrative/Levels/Balance"
 * scaffold below it (the pre-rebuild generic template): its "Narrative"
 * and "Levels" tabs kept pure client-side React state that was never
 * persisted anywhere (added a "character" or "level", it vanished on
 * refresh), its "Projects"/"Mechanics" tabs wrote through the generic
 * artifact CRUD store (a second, parallel data model the real engine
 * never reads), and its "Design Analysis" buttons always operated on
 * that same empty parallel store — so 3 of 4 analysis buttons could
 * only ever render "add X to analyze," permanently. See
 * docs/lens-specs/game-design-capability-map.md for the full audit;
 * that entire scaffold was removed rather than fixed in place.
 */
export default function GameDesignPage() {
  useLensNav('game-design');
  const { latestData: realtimeData, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('game-design');
  const [showRepos, setShowRepos] = useState(false);

  useLensCommand(
    [{ id: 'new-game', keys: 'n', description: 'New game project', category: 'actions', action: () => {
      document.getElementById('gd-new-game-title')?.focus();
    } }],
    { lensId: 'game-design' },
  );

  return (
    <LensShell lensId="game-design" asMain={false}>
      <FirstRunTour lensId="game-design" />
      <DepthBadge lensId="game-design" size="sm" className="ml-2" />

      <div data-lens-theme="game-design" className="min-h-screen">
        <div className="max-w-7xl mx-auto px-6 py-6 space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-pink-500/20 border border-pink-500/30 flex items-center justify-center">
                <Gamepad2 className="w-6 h-6 text-pink-500" />
              </div>
              <h1 className="text-2xl font-bold">Game Design</h1>
              <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} />
            </div>
            <div className="flex items-center gap-2">
              <DTUExportButton domain="game-design" data={{}} compact />
            </div>
          </div>

          <RealtimeDataPanel data={realtimeData} insights={realtimeInsights} />

          <GameDesignSection />

          <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
            <button
              type="button"
              onClick={() => setShowRepos(v => !v)}
              className="flex w-full items-center justify-between text-left text-sm font-semibold text-white"
            >
              <span>Game dev tooling (GitHub)</span>
              {showRepos ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
            {showRepos && (
              <div className="mt-3">
                <GameDevRepos />
              </div>
            )}
          </section>
          <CrossLensRecentsPanel lensId="game-design" sinceDays={7} limit={6} hideWhenEmpty />
        </div>
      </div>
    </LensShell>
  );
}
