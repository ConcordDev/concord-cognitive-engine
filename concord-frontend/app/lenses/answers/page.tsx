'use client';

/**
 * Answers — one Q&A / oracle app (Stack Overflow + STSVK Answers).
 *
 * Single `active` union: oracle | qa | stackoverflow. Accordion for SO search
 * and the always-stacked AnswersQA are folded into tabs. Thin shell.
 */

import { useCallback, useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Eye, MessagesSquare, Plus, Search } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { useArtifacts, useCreateArtifact } from '@/lib/hooks/use-lens-artifacts';
import { cn } from '@/lib/utils';
import { requestAskQuestion } from '@/components/answers/AnswersQA';
import { AnswersOraclePanel } from '@/components/answers/AnswersOraclePanel';
import { QaWorkbenchPanel } from '@/components/answers/QaWorkbenchPanel';
import { StackOverflowPanel } from '@/components/answers/StackOverflowPanel';

type AnswersView = 'oracle' | 'qa' | 'stackoverflow';

const VIEWS: { id: AnswersView; label: string; keys: string; title: string; hint: string; icon: typeof Eye }[] = [
  { id: 'oracle', label: 'Oracle', keys: 'o', title: 'The question', hint: '30 hard problems', icon: Eye },
  { id: 'qa', label: 'Q&A', keys: 'q', title: 'What people are asking', hint: 'Ask · answer · tags', icon: MessagesSquare },
  { id: 'stackoverflow', label: 'Stack Overflow', keys: 's', title: 'What Stack Overflow says', hint: 'External search', icon: Search },
];

export default function AnswersLensPage() {
  // Preserve prior artifact hooks (view-event logging wiring).
  const viewLog = useArtifacts<{ at: string }>('answers', { type: 'view-event', limit: 5 });
  const recordView = useCreateArtifact<{ at: string }>('answers');
  void viewLog; void recordView;

  useLensNav('answers');
  useLensIdentity('answers');
  const reduceMotion = useReducedMotion();
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [active, setActive] = useState<AnswersView>('oracle');

  const ask = useCallback(() => {
    setActive('qa');
    requestAskQuestion();
  }, []);

  useLensCommand(
    [
      ...VIEWS.map((v) => ({
        id: `view-${v.id}`,
        keys: v.keys,
        description: `${v.label} — ${v.hint}`,
        category: 'navigation' as const,
        action: () => setActive(v.id),
      })),
      { id: 'ask', keys: 'a', description: 'Ask a question', category: 'actions' as const, action: ask },
    ],
    { lensId: 'answers' },
  );

  const current = VIEWS.find((v) => v.id === active)!;

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
      <div data-lens-theme="answers" className="relative min-h-full px-8 pb-28 pt-6">
        <p className="text-[14px] text-zinc-500">The Answers</p>
        <h1 className="mb-5 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">
          {current.title}{active === 'oracle' && who ? `, ${who}` : ''}
        </h1>

        <nav className="mb-6 inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-white/10 bg-white/[0.03] p-1" aria-label="Answers views">
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

        <AnimatePresence mode="wait">
          <motion.div key={active} {...motionProps}>
            {active === 'oracle' && <AnswersOraclePanel />}
            {active === 'qa' && <QaWorkbenchPanel />}
            {active === 'stackoverflow' && <StackOverflowPanel />}
          </motion.div>
        </AnimatePresence>

        <CrossLensRecentsPanel lensId="answers" sinceDays={7} limit={6} hideWhenEmpty className="mt-8" />

        <button
          type="button"
          onClick={ask}
          title="Ask a question (A)"
          className="fixed bottom-8 right-8 z-30 inline-flex items-center gap-2 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300"
        >
          <Plus className="h-4 w-4" />
          Ask
        </button>
      </div>
    </LensShell>
  );
}
