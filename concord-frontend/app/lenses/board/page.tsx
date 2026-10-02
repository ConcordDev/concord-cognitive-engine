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
import { DepthBadge } from '@/components/lens/DepthBadge';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
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
      <DepthBadge lensId="board" size="sm" className="ml-2" />
      <div data-lens-theme="board" className="flex flex-col min-h-screen">
        {/* Views as quiet text links (keys b / t / g / w / h). The Board view's
            own greeting + lanes follow the north-star concept. */}
        <nav className="flex flex-shrink-0 items-center justify-end gap-4 px-8 pt-2 text-[13px]" aria-label="Board views">
          {VIEWS.map((v) => {
            const on = active === v.id;
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => setActive(v.id)}
                className={cn('transition-colors', on ? 'text-zinc-100' : 'text-zinc-500 hover:text-zinc-200')}
                aria-current={on ? 'page' : undefined}
                title={`${v.hint} (${v.keys})`}
              >
                {v.label}
              </button>
            );
          })}
        </nav>

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
