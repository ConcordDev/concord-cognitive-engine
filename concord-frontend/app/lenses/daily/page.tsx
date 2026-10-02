'use client';

import { useState } from 'react';
import { BookOpen, PenLine, Quote } from 'lucide-react';
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

const TABS: { id: DailyView; label: string; icon: typeof BookOpen; keys: string }[] = [
  { id: 'journal', label: 'Today', icon: BookOpen, keys: 'j' },
  { id: 'studio', label: 'Studio', icon: PenLine, keys: 's' },
  { id: 'inspiration', label: 'Inspiration', icon: Quote, keys: 'i' },
];

export default function DailyLensPage() {
  useLensNav('daily');
  useLensIdentity('daily');
  const reduceMotion = useReducedMotion();
  const [view, setView] = useState<DailyView>('journal');

  useLensCommand(
    TABS.map((t) => ({
      id: `goto-${t.id}`,
      keys: t.keys,
      description: t.label,
      category: 'navigation' as const,
      action: () => setView(t.id),
    })),
    { lensId: 'daily' },
  );

  return (
    <LensShell lensId="daily" asMain={false}>
      <FirstRunTour lensId="daily" />
      <div data-lens-theme="daily" className="h-[calc(100vh-4rem)] flex flex-col bg-lattice-deep text-white overflow-hidden">
        <header className="shrink-0 px-4 pt-3 pb-2 border-b border-lattice-border flex items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight text-amber-100">Daily</h1>
              <DepthBadge lensId="daily" size="sm" />
            </div>
            <p className="text-xs text-white/45 mt-0.5">Journal, mood, habits — one desk.</p>
          </div>
          <nav aria-label="Daily views" className="flex items-center gap-1">
            {TABS.map((t) => {
              const Icon = t.icon;
              const active = view === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setView(t.id)}
                  className={cn(
                    'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
                    active
                      ? 'bg-amber-500/15 text-amber-200 border border-amber-500/30'
                      : 'text-white/55 hover:text-white hover:bg-white/5 border border-transparent',
                  )}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {t.label}
                  <kbd className="hidden sm:inline font-mono text-[10px] text-white/30">{t.keys}</kbd>
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
              <div className="h-full overflow-y-auto p-4">
                <JournalStudio />
              </div>
            )}
            {view === 'inspiration' && (
              <div className="h-full overflow-y-auto p-4 max-w-3xl">
                <DailyInspiration />
              </div>
            )}
          </motion.div>
        </AnimatePresence>
        <div className="shrink-0 px-4 py-2">
          <CrossLensRecentsPanel lensId="daily" sinceDays={7} limit={6} hideWhenEmpty />
        </div>
      </div>
    </LensShell>
  );
}
