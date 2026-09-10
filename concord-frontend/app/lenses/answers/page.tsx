'use client';

/**
 * Answers — one Q&A / oracle app (Stack Overflow + STSVK Answers).
 *
 * Single `active` union: oracle | qa | stackoverflow. Accordion for SO search
 * and the always-stacked AnswersQA are folded into tabs. Thin shell.
 */

import { useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Eye, MessagesSquare, Search } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { useArtifacts, useCreateArtifact } from '@/lib/hooks/use-lens-artifacts';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { AnswersOraclePanel } from '@/components/answers/AnswersOraclePanel';
import { QaWorkbenchPanel } from '@/components/answers/QaWorkbenchPanel';
import { StackOverflowPanel } from '@/components/answers/StackOverflowPanel';

type AnswersView = 'oracle' | 'qa' | 'stackoverflow';

const VIEWS: { id: AnswersView; label: string; keys: string; hint: string; icon: typeof Eye }[] = [
  { id: 'oracle', label: 'Oracle', keys: 'o', hint: '30 hard problems', icon: Eye },
  { id: 'qa', label: 'Q&A', keys: 'q', hint: 'Ask · answer · tags', icon: MessagesSquare },
  { id: 'stackoverflow', label: 'Stack Overflow', keys: 's', hint: 'External search', icon: Search },
];

export default function AnswersLensPage() {
  // Preserve prior artifact hooks (view-event logging wiring).
  const viewLog = useArtifacts<{ at: string }>('answers', { type: 'view-event', limit: 5 });
  const recordView = useCreateArtifact<{ at: string }>('answers');
  void viewLog; void recordView;

  useLensNav('answers');
  useLensIdentity('answers');
  const reduceMotion = useReducedMotion();
  const [active, setActive] = useState<AnswersView>('oracle');

  useLensCommand(
    VIEWS.map((v) => ({
      id: `view-${v.id}`,
      keys: v.keys,
      description: `${v.label} — ${v.hint}`,
      category: 'navigation' as const,
      action: () => setActive(v.id),
    })),
    { lensId: 'answers' },
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

  return (
    <LensShell lensId="answers" asMain={false}>
      <FirstRunTour lensId="answers" />
      <DepthBadge lensId="answers" size="sm" className="ml-2" />
      <div data-lens-theme="answers" className={cn(ds.pageContainer, 'space-y-4')}>
        <header className={ds.sectionHeader}>
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-neon-cyan/15 border border-neon-cyan/40">
              <Eye className="h-5 w-5 text-neon-cyan" />
            </div>
            <div className="min-w-0">
              <h1 className={ds.heading1}>The Answers</h1>
              <p className={ds.textMuted}>Oracle · Q&amp;A workbench · Stack Overflow reference</p>
            </div>
          </div>
        </header>

        <nav
          className="flex items-center gap-1 border-b border-lattice-border overflow-x-auto"
          aria-label="Answers views"
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
                  'flex items-center gap-2 px-3 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition-colors',
                  on
                    ? 'border-[var(--lens-accent)] text-white'
                    : 'border-transparent text-gray-400 hover:text-white hover:border-gray-600',
                )}
                aria-current={on ? 'page' : undefined}
              >
                <Icon className="w-4 h-4" />
                {v.label}
                <kbd className="hidden sm:inline-block text-[10px] text-white/30 bg-white/5 border border-white/10 rounded px-1 py-0.5 font-mono">
                  {v.keys}
                </kbd>
              </button>
            );
          })}
        </nav>

        <AnimatePresence mode="wait">
          <motion.div key={active} {...motionProps}>
            {active === 'oracle' && <AnswersOraclePanel />}
            {active === 'qa' && <QaWorkbenchPanel />}
            {active === 'stackoverflow' && <StackOverflowPanel />}
          </motion.div>
        </AnimatePresence>

        <CrossLensRecentsPanel lensId="answers" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
      </div>
    </LensShell>
  );
}
