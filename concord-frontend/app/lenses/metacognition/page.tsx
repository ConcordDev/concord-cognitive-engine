'use client';

/**
 * Metacognition — one reflective desk (calibration / introspection / journal).
 *
 * Single view union (awareness | introspection | predictions | learning |
 * journal | practice). Page is a thin shell; each view owns its hooks.
 */

import { useMemo, useState, type ComponentType } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  Brain,
  Eye,
  Lightbulb,
  Crosshair,
  BookOpen,
  Sparkles,
  NotebookPen,
} from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { AwarenessPanel } from '@/components/metacognition/AwarenessPanel';
import { IntrospectionPanel } from '@/components/metacognition/IntrospectionPanel';
import { PredictionsPanel } from '@/components/metacognition/PredictionsPanel';
import { LearningPanel } from '@/components/metacognition/LearningPanel';
import { JournalPanel } from '@/components/metacognition/JournalPanel';
import { PracticePanel } from '@/components/metacognition/PracticePanel';

type MetacogView =
  | 'awareness'
  | 'introspection'
  | 'predictions'
  | 'learning'
  | 'journal'
  | 'practice';

const VIEWS: {
  id: MetacogView;
  label: string;
  keys: string;
  hint: string;
  icon: typeof Brain;
}[] = [
  { id: 'awareness', label: 'Self-Awareness', keys: 'd', hint: 'Calibration · blind spots · knowledge map', icon: Eye },
  { id: 'introspection', label: 'Introspection', keys: 'i', hint: 'Failure patterns · recommendations', icon: Lightbulb },
  { id: 'predictions', label: 'Predictions', keys: 'p', hint: 'Log · resolve · Brier / learning curve', icon: Crosshair },
  { id: 'learning', label: 'Learning', keys: 'l', hint: 'Assess · skill timeline · patterns', icon: BookOpen },
  { id: 'journal', label: 'Decision Journal', keys: 'j', hint: 'Journal · calibration report', icon: NotebookPen },
  { id: 'practice', label: 'Practice', keys: 'r', hint: 'Bias · accuracy · strategies · toolkit', icon: Sparkles },
];

const PANELS: Record<MetacogView, ComponentType> = {
  awareness: AwarenessPanel,
  introspection: IntrospectionPanel,
  predictions: PredictionsPanel,
  learning: LearningPanel,
  journal: JournalPanel,
  practice: PracticePanel,
};

export default function MetacognitionLensPage() {
  useLensNav('metacognition');
  useLensIdentity('metacognition');
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } =
    useRealtimeLens('metacognition');
  const reduceMotion = useReducedMotion();
  const [active, setActive] = useState<MetacogView>('awareness');

  useLensCommand(
    VIEWS.map((v) => ({
      id: `view-${v.id}`,
      keys: v.keys,
      description: `${v.label} — ${v.hint}`,
      category: 'navigation' as const,
      action: () => setActive(v.id),
    })),
    { lensId: 'metacognition' },
  );

  const Panel = PANELS[active];
  const motionProps = useMemo(
    () =>
      reduceMotion
        ? { initial: false as const, animate: { opacity: 1 }, exit: { opacity: 1 }, transition: { duration: 0 } }
        : {
            initial: { opacity: 0, y: 8 },
            animate: { opacity: 1, y: 0 },
            exit: { opacity: 0, y: -6 },
            transition: { duration: 0.16 },
          },
    [reduceMotion],
  );

  return (
    <LensShell lensId="metacognition" asMain={false}>
      <FirstRunTour lensId="metacognition" />
      <DepthBadge lensId="metacognition" size="sm" className="ml-2" />
      <div data-lens-theme="metacognition" className={ds.pageContainer}>
        <header className={ds.sectionHeader}>
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-lg border border-[var(--lens-accent)]/40 bg-[var(--lens-gradient)]">
              <Brain className="w-6 h-6" style={{ color: 'var(--lens-accent)' }} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className={ds.heading1}>Metacognition</h1>
                <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
                <DTUExportButton domain="metacognition" data={realtimeData || {}} compact />
                {realtimeAlerts.length > 0 && (
                  <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
                    {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
              <p className={ds.textMuted}>
                Reflective desk — calibration, introspection, decision journal, practice.
              </p>
            </div>
          </div>
        </header>

        <nav
          className="flex items-center gap-1 border-b border-lattice-border overflow-x-auto"
          aria-label="Metacognition views"
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

        <main className="min-w-0 pt-4">
          <AnimatePresence mode="wait">
            <motion.div key={active} {...motionProps}>
              <Panel />
            </motion.div>
          </AnimatePresence>
        </main>

        {realtimeData && (
          <RealtimeDataPanel
            domain="metacognition"
            data={realtimeData}
            isLive={isLive}
            lastUpdated={lastUpdated}
            insights={realtimeInsights}
            compact
          />
        )}

        <CrossLensRecentsPanel lensId="metacognition" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
      </div>
    </LensShell>
  );
}
