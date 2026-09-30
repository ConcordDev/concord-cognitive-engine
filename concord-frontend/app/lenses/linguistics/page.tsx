'use client';

/**
 * Linguistics — one research-tool / language-lab app.
 *
 * Single view union. Accordion booleans for lookup/learning/workbench and
 * the inline notebook pile are extracted to components/linguistics/*Panel.tsx.
 * Page is a thin shell; panels own their macros and loading/empty/error.
 */

import { useMemo, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  BookOpen, FileText, Globe, GraduationCap, Hash, Languages,
  Search, Sparkles, Type, Wand2,
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
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { cn } from '@/lib/utils';
import { NotebookPanel } from '@/components/linguistics/NotebookPanel';
import { AnalyzePanel } from '@/components/linguistics/AnalyzePanel';
import { LookupToolsPanel } from '@/components/linguistics/LookupToolsPanel';
import { LearningPanel } from '@/components/linguistics/LearningPanel';
import { WorkbenchPanel } from '@/components/linguistics/WorkbenchPanel';
import {
  type LinguisticsView,
  type ModeTab,
} from '@/components/linguistics/linguistics-shared';

const VIEWS: { id: LinguisticsView; label: string; keys: string; hint: string; icon: typeof Languages }[] = [
  { id: 'Analyses', label: 'Analyses', keys: '1', hint: 'Morphosyntax notes', icon: FileText },
  { id: 'Lexicon', label: 'Lexicon', keys: '2', hint: 'Lexicon entries', icon: BookOpen },
  { id: 'Grammars', label: 'Grammars', keys: '3', hint: 'Grammar sketches', icon: Type },
  { id: 'Corpora', label: 'Corpora', keys: '4', hint: 'Corpus collections', icon: Hash },
  { id: 'Translations', label: 'Translations', keys: '5', hint: 'Parallel text', icon: Globe },
  { id: 'Dashboard', label: 'Dashboard', keys: '6', hint: 'Counts overview', icon: Sparkles },
  { id: 'analyze', label: 'Analyze', keys: 'a', hint: 'Quick analysis', icon: Type },
  { id: 'lookup', label: 'Lookup', keys: 'l', hint: 'Rhyme · dictionary', icon: Search },
  { id: 'learning', label: 'Learning', keys: 'w', hint: 'Vocab · quiz · decks', icon: GraduationCap },
  { id: 'workbench', label: 'Workbench', keys: 'b', hint: 'Action panel', icon: Wand2 },
];

const NOTEBOOK_MODES = new Set<LinguisticsView>([
  'Analyses', 'Lexicon', 'Grammars', 'Corpora', 'Translations', 'Dashboard',
]);

export default function LinguisticsLensPage() {
  useLensNav('linguistics');
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('linguistics');
  const reduceMotion = useReducedMotion();
  const [active, setActive] = useState<LinguisticsView>('Analyses');
  const searchInputRef = useRef<HTMLInputElement>(null);

  useLensCommand(
    [
      ...VIEWS.map((v) => ({
        id: `view-${v.id}`,
        keys: v.keys,
        description: `${v.label} — ${v.hint}`,
        category: 'navigation' as const,
        action: () => setActive(v.id),
      })),
      {
        id: 'focus-search',
        keys: '/',
        description: 'Focus search',
        category: 'navigation' as const,
        action: () => {
          if (NOTEBOOK_MODES.has(active)) searchInputRef.current?.focus();
          else setActive('Analyses');
        },
      },
    ],
    { lensId: 'linguistics' },
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

  let body: ReactNode = null;
  if (NOTEBOOK_MODES.has(active)) {
    body = <NotebookPanel mode={active as ModeTab} searchInputRef={searchInputRef} />;
  } else if (active === 'analyze') {
    body = <AnalyzePanel />;
  } else if (active === 'lookup') {
    body = <LookupToolsPanel />;
  } else if (active === 'learning') {
    body = <LearningPanel />;
  } else {
    body = <WorkbenchPanel />;
  }

  return (
    <LensShell lensId="linguistics" asMain={false}>
      <FirstRunTour lensId="linguistics" />
      <DepthBadge lensId="linguistics" size="sm" className="ml-2" />
      <div data-lens-theme="linguistics" className="p-6 space-y-6">
        <header className="flex items-center gap-3">
          <Languages className="w-6 h-6 text-pink-400" />
          <div>
            <h1 className="text-xl font-bold">Linguistics</h1>
            <p className="text-sm text-gray-400">
              Language analysis, lexicon, grammars, corpora, and translations
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap ml-auto">
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            <DTUExportButton domain="linguistics" data={realtimeData || {}} compact />
            {realtimeAlerts.length > 0 && (
              <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
                {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </header>

        <nav
          className="flex items-center gap-1 border-b border-lattice-border overflow-x-auto"
          aria-label="Linguistics views"
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
                    ? 'border-pink-400 text-pink-300'
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
            {body}
          </motion.div>
        </AnimatePresence>

        {realtimeData && (
          <RealtimeDataPanel
            domain="linguistics"
            data={realtimeData}
            isLive={isLive}
            lastUpdated={lastUpdated}
            insights={realtimeInsights}
            compact
          />
        )}
      </div>
      <CrossLensRecentsPanel lensId="linguistics" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
