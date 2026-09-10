'use client';

/**
 * Board — one Trello-shape kanban / task desk (+ BGG discovery).
 *
 * Single `active` union (board | timeline | table | workspace | bgg).
 * Personal-task surface lives in TasksPanel; Trello-parity workspace and
 * BGG hot list are existing panels. Page is a thin shell.
 */

import { useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  LayoutGrid, BarChart3, Table, Kanban, Rocket, type LucideIcon,
} from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { cn } from '@/lib/utils';
import { TasksPanel } from '@/components/board/TasksPanel';
import { BoardWorkspace } from '@/components/board/BoardWorkspace';
import { BggHotList } from '@/components/board/BggHotList';
import type { BoardView } from '@/components/board/board-shared';

const VIEWS: { id: BoardView; label: string; keys: string; hint: string; icon: LucideIcon }[] = [
  { id: 'board', label: 'Board', keys: 'b', hint: 'Kanban columns', icon: LayoutGrid },
  { id: 'timeline', label: 'Timeline', keys: 't', hint: 'Due-date timeline', icon: BarChart3 },
  { id: 'table', label: 'Table', keys: 'g', hint: 'Flat task table', icon: Table },
  { id: 'workspace', label: 'Workspace', keys: 'w', hint: 'Trello-parity boards', icon: Kanban },
  { id: 'bgg', label: 'BGG', keys: 'h', hint: 'BoardGameGeek hot list', icon: Rocket },
];

export default function BoardLensPage() {
  useLensNav('board');
  const { latestData: realtimeData, isLive, lastUpdated } = useRealtimeLens('board');
  const reduceMotion = useReducedMotion();
  const [active, setActive] = useState<BoardView>('board');

  useLensCommand(
    VIEWS.map((v) => ({
      id: `view-${v.id}`,
      keys: v.keys,
      description: `${v.label} — ${v.hint}`,
      category: 'navigation' as const,
      action: () => setActive(v.id),
    })),
    { lensId: 'board' },
  );

  const motionProps = useMemo(
    () => (reduceMotion
      ? { initial: false as const, animate: { opacity: 1 }, exit: { opacity: 1 }, transition: { duration: 0 } }
      : {
          initial: { opacity: 0, y: 8 },
          animate: { opacity: 1, y: 0 },
          exit: { opacity: 0, y: -6 },
          transition: { duration: 0.16 },
        }),
    [reduceMotion],
  );

  const isTaskView = active === 'board' || active === 'timeline' || active === 'table';

  return (
    <LensShell lensId="board" asMain={false}>
      <FirstRunTour lensId="board" />
      <DepthBadge lensId="board" size="sm" className="ml-2" />
      <div data-lens-theme="board" className="flex flex-col min-h-screen">
        <header className="flex-shrink-0 px-6 pt-5 pb-3">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3 min-w-0">
              <Kanban className="w-6 h-6 text-purple-400 shrink-0" />
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-xl font-bold text-white">Project Board</h1>
                  <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
                  <DTUExportButton domain="board" data={realtimeData || {}} compact />
                </div>
                <p className="text-xs text-gray-400">
                  Kanban desk — board, timeline, table, workspace, BGG.
                </p>
              </div>
            </div>

            <nav
              className="flex items-center gap-1 p-1 bg-white/5 rounded-lg border border-white/10 overflow-x-auto"
              aria-label="Board views"
            >
              {VIEWS.map((v) => {
                const Icon = v.icon;
                const on = active === v.id;
                return (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => setActive(v.id)}
                    className={cn(
                      'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all whitespace-nowrap',
                      on
                        ? 'bg-purple-500/20 text-purple-300 shadow-sm'
                        : 'text-gray-400 hover:text-gray-200 hover:bg-white/5',
                    )}
                    aria-current={on ? 'page' : undefined}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {v.label}
                    <kbd className="hidden sm:inline-block text-[10px] text-white/30 bg-white/5 border border-white/10 rounded px-1 py-0.5 font-mono ml-0.5">
                      {v.keys}
                    </kbd>
                  </button>
                );
              })}
            </nav>
          </div>
        </header>

        <AnimatePresence mode="wait">
          <motion.div key={active} {...motionProps} className="flex-1 flex flex-col min-h-0">
            {isTaskView && <TasksPanel mode={active} />}
            {active === 'workspace' && (
              <section className="px-6 pb-6">
                <BoardWorkspace />
              </section>
            )}
            {active === 'bgg' && (
              <section className="px-6 pb-6">
                <BggHotList />
              </section>
            )}
          </motion.div>
        </AnimatePresence>

        <CrossLensRecentsPanel lensId="board" sinceDays={7} limit={6} hideWhenEmpty className="mt-3 px-6" />
      </div>
    </LensShell>
  );
}
