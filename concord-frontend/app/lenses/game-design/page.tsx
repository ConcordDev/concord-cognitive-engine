'use client';

import { useCallback, useState } from 'react';
import { Gamepad2, Plus, Wrench } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { GameDesignSection } from '@/components/game-design/GameDesignSection';
import { GameDevRepos } from '@/components/game-design/GameDevRepos';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { cn } from '@/lib/utils';

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
type Desk = 'studio' | 'tooling';

const DESKS: { id: Desk; label: string; keys: string; title: string; hint: string; icon: typeof Gamepad2 }[] = [
  { id: 'studio', label: 'Studio', keys: '1', title: 'The design', hint: 'Design doc, mechanics, levels, narrative, assets and playtest', icon: Gamepad2 },
  { id: 'tooling', label: 'Tooling', keys: '2', title: 'The toolbox', hint: 'Game dev tooling repositories on GitHub', icon: Wrench },
];

export default function GameDesignPage() {
  useLensNav('game-design');
  const { latestData: realtimeData, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('game-design');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [desk, setDesk] = useState<Desk>('studio');

  const newDesign = useCallback(() => {
    setDesk('studio');
    let tries = 0;
    const focus = () => {
      const el = document.getElementById('gd-new-game-title');
      if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.focus(); return; }
      if (++tries < 20) requestAnimationFrame(focus);
    };
    requestAnimationFrame(focus);
  }, []);

  useLensCommand(
    [
      ...DESKS.map((d) => ({
        id: `desk-${d.id}`,
        keys: d.keys,
        description: `${d.label} — ${d.hint}`,
        category: 'navigation' as const,
        action: () => setDesk(d.id),
      })),
      { id: 'new-game', keys: 'n', description: 'New game project', category: 'actions' as const, action: newDesign },
    ],
    { lensId: 'game-design' },
  );

  const current = DESKS.find((d) => d.id === desk)!;

  return (
    <LensShell lensId="game-design" asMain={false}>
      <FirstRunTour lensId="game-design" />
      <DepthBadge lensId="game-design" size="sm" className="ml-2" />
      <div data-lens-theme="game-design" className="relative min-h-full px-8 pb-28 pt-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[14px] text-zinc-500">Game Design</p>
            <h1 className="mb-5 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">
              {current.title}{desk === 'studio' && who ? `, ${who}` : ''}
            </h1>
          </div>
          <div className="flex shrink-0 items-center gap-3 pt-2">
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            <DTUExportButton domain="game-design" data={{}} compact />
          </div>
        </div>

        <nav className="mb-6 inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-white/10 bg-white/[0.03] p-1" aria-label="Game design desks">
          {DESKS.map((d) => {
            const Icon = d.icon;
            const on = desk === d.id;
            return (
              <button
                key={d.id}
                type="button"
                onClick={() => setDesk(d.id)}
                aria-current={on ? 'page' : undefined}
                title={`${d.hint} (${d.keys})`}
                className={cn(
                  'inline-flex items-center gap-2 whitespace-nowrap rounded-full px-4 py-1.5 text-[14px] transition-colors',
                  on ? 'bg-white/10 text-zinc-50' : 'text-zinc-500 hover:text-zinc-200',
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {d.label}
                <kbd className="hidden rounded border border-white/10 bg-white/5 px-1 py-0.5 font-mono text-[10px] text-white/30 sm:inline-block">{d.keys}</kbd>
              </button>
            );
          })}
        </nav>

        {desk === 'studio' && (
          <div className="space-y-5">
            <RealtimeDataPanel data={realtimeData} insights={realtimeInsights} compact />
            <GameDesignSection />
          </div>
        )}
        {desk === 'tooling' && (
          <section className="rounded-2xl border border-white/10 bg-[#111] p-4">
            <GameDevRepos />
          </section>
        )}

        <CrossLensRecentsPanel lensId="game-design" sinceDays={7} limit={6} hideWhenEmpty className="mt-8" />

        <button
          type="button"
          onClick={newDesign}
          title="New game project (N)"
          className="fixed bottom-8 right-8 z-30 inline-flex items-center gap-2 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300"
        >
          <Plus className="h-4 w-4" />
          New design
        </button>
      </div>
    </LensShell>
  );
}
