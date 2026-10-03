'use client';

/**
 * Linguistics — one research-tool / language-lab app.
 *
 * Single view union. Accordion booleans for lookup/learning/workbench and
 * the inline notebook pile are extracted to components/linguistics/*Panel.tsx.
 * Page is a thin shell; panels own their macros and loading/empty/error.
 */

import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  BookOpen, FileText, Globe, GraduationCap, Hash, Languages,
  Plus, Search, Sparkles, Type, Wand2,
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
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
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

const VIEWS: { id: LinguisticsView; label: string; keys: string; title: string; hint: string; icon: typeof Languages }[] = [
  { id: 'Analyses', title: 'The utterance', label: 'Analyses', keys: '1', hint: 'Morphosyntax notes', icon: FileText },
  { id: 'Lexicon', title: 'The words', label: 'Lexicon', keys: '2', hint: 'Lexicon entries', icon: BookOpen },
  { id: 'Grammars', title: 'The rules', label: 'Grammars', keys: '3', hint: 'Grammar sketches', icon: Type },
  { id: 'Corpora', title: 'The corpus', label: 'Corpora', keys: '4', hint: 'Corpus collections', icon: Hash },
  { id: 'Translations', title: 'Side by side', label: 'Translations', keys: '5', hint: 'Parallel text', icon: Globe },
  { id: 'Dashboard', title: 'The shape of your work', label: 'Dashboard', keys: '6', hint: 'Counts overview', icon: Sparkles },
  { id: 'analyze', title: 'Read a text closely', label: 'Analyze', keys: 'a', hint: 'Quick analysis', icon: Type },
  { id: 'lookup', title: 'Look it up', label: 'Lookup', keys: 'l', hint: 'Rhyme · dictionary', icon: Search },
  { id: 'learning', title: 'Learn it', label: 'Learning', keys: 'w', hint: 'Vocab · quiz · decks', icon: GraduationCap },
  { id: 'workbench', title: 'The workbench', label: 'Workbench', keys: 'b', hint: 'Action panel', icon: Wand2 },
];

const NOTEBOOK_MODES = new Set<LinguisticsView>([
  'Analyses', 'Lexicon', 'Grammars', 'Corpora', 'Translations', 'Dashboard',
]);

export default function LinguisticsLensPage() {
  useLensNav('linguistics');
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('linguistics');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const reduceMotion = useReducedMotion();
  const [active, setActive] = useState<LinguisticsView>('Analyses');
  const searchInputRef = useRef<HTMLInputElement>(null);

  const openText = useCallback(() => {
    setActive('analyze');
    let tries = 0;
    const focus = () => {
      const el = document.querySelector<HTMLElement>('[data-lens-theme="linguistics"] main textarea, [data-lens-theme="linguistics"] textarea');
      if (el) el.focus();
      else if (tries++ < 20) requestAnimationFrame(focus);
    };
    requestAnimationFrame(focus);
  }, []);

  useLensCommand(
    [
      { id: 'open-text', keys: 'o', description: 'Open a text to analyze', category: 'actions' as const, action: openText },
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

  const current = VIEWS.find((v) => v.id === active)!;

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
      <div data-lens-theme="linguistics" className="relative min-h-full px-8 pb-28 pt-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[14px] text-zinc-500">Linguistics</p>
            <h1 className="mb-5 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">
              {current.title}{active === 'Analyses' && who ? `, ${who}` : ''}
            </h1>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-3 pt-2">
            {realtimeAlerts.length > 0 && (
              <span className="rounded-full bg-yellow-500/10 px-2.5 py-0.5 text-xs text-yellow-400">
                {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
              </span>
            )}
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            <DTUExportButton domain="linguistics" data={realtimeData || {}} compact />
          </div>
        </div>

        <nav
          className="mb-6 inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-white/10 bg-white/[0.03] p-1"
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
                title={`${v.hint} (${v.keys})`}
                className={cn(
                  'inline-flex items-center gap-2 whitespace-nowrap rounded-full px-4 py-1.5 text-[14px] transition-colors',
                  on ? 'bg-white/10 text-zinc-50' : 'text-zinc-500 hover:text-zinc-200',
                )}
                aria-current={on ? 'page' : undefined}
              >
                <Icon className="h-3.5 w-3.5" />
                {v.label}
                <kbd className="hidden rounded border border-white/10 bg-white/5 px-1 py-0.5 font-mono text-[10px] text-white/30 sm:inline-block">
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

        <CrossLensRecentsPanel lensId="linguistics" sinceDays={7} limit={6} hideWhenEmpty className="mt-8" />

        <button
          type="button"
          onClick={openText}
          title="Open a text (O)"
          className="fixed bottom-8 right-8 z-30 inline-flex items-center gap-2 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300"
        >
          <Plus className="h-4 w-4" />
          Open a text
        </button>
      </div>
    </LensShell>
  );
}
