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
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { cn } from '@/lib/utils';
import { TasksPanel } from '@/components/board/TasksPanel';
import { BoardWorkspace } from '@/components/board/BoardWorkspace';
import { BggHotList } from '@/components/board/BggHotList';
import type { BoardView } from '@/components/board/board-shared';

const VIEWS: { id: BoardView; label: string; keys: string; title: string; hint: string; icon: LucideIcon }[] = [
  { id: 'board', title: 'What’s next', label: 'Board', keys: 'b', hint: 'Kanban columns', icon: LayoutGrid },
  { id: 'timeline', title: 'What is due when', label: 'Timeline', keys: 't', hint: 'Due-date timeline', icon: BarChart3 },
  { id: 'table', title: 'Every task, side by side', label: 'Table', keys: 'g', hint: 'Flat task table', icon: Table },
  { id: 'workspace', title: 'Your boards', label: 'Workspace', keys: 'w', hint: 'Trello-parity boards', icon: Kanban },
  { id: 'bgg', title: 'What is hot in board games', label: 'BGG', keys: 'h', hint: 'BoardGameGeek hot list', icon: Rocket },
];

export default function BoardLensPage() {
  useLensNav('board');
  const reduceMotion = useReducedMotion();
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
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

  const current = VIEWS.find((v) => v.id === active)!;
  const isTaskView = active === 'board' || active === 'timeline' || active === 'table';

  return (
    <LensShell lensId="board" asMain={false}>
      <DepthBadge lensId="board" size="sm" className="ml-2" />
      <div data-lens-theme="board" className="flex min-h-screen flex-col">
        <div className="flex-shrink-0 px-8 pt-6">
          <p className="text-[14px] text-zinc-500">Board</p>
          <h1 className="font-vault mb-5 mt-1 text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">
            {current.title}{active === 'board' && who ? `, ${who}` : ''}
          </h1>
          <nav className="mb-2 inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-white/10 bg-white/[0.03] p-1" aria-label="Board views">
            {VIEWS.map((v) => {
              const Icon = v.icon;
              const on = active === v.id;
              return (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setActive(v.id)}
                  aria-current={on ? 'page' : undefined}
                  title={`${v.hint} (${v.keys})`}
                  className={cn(
                    'inline-flex items-center gap-2 whitespace-nowrap rounded-full px-4 py-1.5 text-[14px] transition-colors',
                    on ? 'bg-white/10 text-zinc-50' : 'text-zinc-500 hover:text-zinc-200',
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {v.label}
                  <kbd aria-hidden="true" className="hidden rounded border border-white/10 bg-white/5 px-1 py-0.5 font-mono text-[10px] text-white/30 sm:inline-block">{v.keys}</kbd>
                </button>
              );
            })}
          </nav>
        </div>

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
