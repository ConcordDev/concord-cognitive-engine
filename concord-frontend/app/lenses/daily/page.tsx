'use client';

import { useState } from 'react';
import { BookOpen, PenLine, Quote } from 'lucide-react';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { DailyTodayPanel } from '@/components/daily/DailyTodayPanel';
import { JournalStudio } from '@/components/daily/JournalStudio';
import { DailyInspiration } from '@/components/daily/DailyInspiration';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { cn } from '@/lib/utils';

type DailyView = 'journal' | 'studio' | 'inspiration';

const TABS: { id: DailyView; label: string; title: string; hint: string; icon: typeof BookOpen; keys: string }[] = [
  { id: 'journal', label: 'Today', title: 'Today', hint: 'Mood, habits, reminders and the day journal', icon: BookOpen, keys: 'j' },
  { id: 'studio', label: 'Studio', title: 'Write it down', hint: 'Journal studio', icon: PenLine, keys: 's' },
  { id: 'inspiration', label: 'Inspiration', title: 'Something to start from', hint: 'Quotes and prompts', icon: Quote, keys: 'i' },
];

export default function DailyLensPage() {
  useLensNav('daily');
  useLensIdentity('daily');
  const reduceMotion = useReducedMotion();
  const { isLive, lastUpdated } = useRealtimeLens('daily');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [view, setView] = useState<DailyView>('journal');
  const dateTitle = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  const current = TABS.find((t) => t.id === view)!;

  useLensCommand(
    [
      ...TABS.map((t) => ({
        id: `goto-${t.id}`,
        keys: t.keys,
        description: t.label,
        category: 'navigation' as const,
        action: () => setView(t.id),
      })),
      { id: 'daily-write', keys: 'w', description: 'Write today', category: 'actions' as const, action: () => setView('studio') },
    ],
    { lensId: 'daily' },
  );

  return (
    <LensShell lensId="daily" asMain={false}>
      <FirstRunTour lensId="daily" />
      <DepthBadge lensId="daily" size="sm" className="ml-2" />
      <div data-lens-theme="daily" className="relative flex h-[calc(100vh-4rem)] flex-col overflow-hidden text-white">
        <header className="shrink-0 px-8 pt-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[14px] text-zinc-500">Daily · {current.title}</p>
              <h1 className="mb-5 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">
                {view === 'journal' ? dateTitle : current.title}
              </h1>
            </div>
            <div className="flex shrink-0 items-center gap-3 pt-2">
              {who && <span className="hidden text-[13px] text-zinc-500 sm:inline">{who}</span>}
              <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
              <DTUExportButton domain="daily" data={{}} compact />
            </div>
          </div>
          <nav aria-label="Daily views" className="mb-4 inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-white/10 bg-white/[0.03] p-1">
            {TABS.map((t) => {
              const Icon = t.icon;
              const active = view === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setView(t.id)}
                  aria-current={active ? 'page' : undefined}
                  title={`${t.hint} (${t.keys})`}
                  className={cn(
                    'inline-flex items-center gap-2 whitespace-nowrap rounded-full px-4 py-1.5 text-[14px] transition-colors',
                    active ? 'bg-white/10 text-zinc-50' : 'text-zinc-500 hover:text-zinc-200',
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {t.label}
                  <kbd aria-hidden="true" className="hidden rounded border border-white/10 bg-white/5 px-1 py-0.5 font-mono text-[10px] text-white/30 sm:inline-block">{t.keys}</kbd>
                </button>
              );
            })}
          </nav>
        </header>
        <AnimatePresence mode="wait">
          <motion.div
            key={view}
            className="flex-1 min-h-0 overflow-hidden"
            initial={reduceMotion ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? undefined : { opacity: 0 }}
            transition={{ duration: 0.18 }}
          >
            {view === 'journal' && <DailyTodayPanel />}
            {view === 'studio' && (
              <div className="h-full overflow-y-auto px-8 py-2">
                <JournalStudio />
              </div>
            )}
            {view === 'inspiration' && (
              <div className="h-full max-w-3xl overflow-y-auto px-8 py-2">
                <DailyInspiration />
              </div>
            )}
          </motion.div>
        </AnimatePresence>
        <div className="shrink-0 px-8 py-2">
          <CrossLensRecentsPanel lensId="daily" sinceDays={7} limit={6} hideWhenEmpty />
        </div>

        <button
          type="button"
          onClick={() => setView('studio')}
          title="Write today (W)"
          className="fixed bottom-8 right-8 z-30 inline-flex items-center gap-2 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300"
        >
          <PenLine className="h-4 w-4" />
          Write
        </button>
      </div>
    </LensShell>
  );
}
