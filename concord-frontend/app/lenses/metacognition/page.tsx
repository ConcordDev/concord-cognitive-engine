'use client';

/**
 * Metacognition — one reflective desk (calibration / introspection / journal).
 *
 * Single view union (awareness | introspection | predictions | learning |
 * journal | practice). Page is a thin shell; each view owns its hooks.
 */

import { useState, type ComponentType } from 'react';
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
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
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
  title: string;
  icon: typeof Brain;
}[] = [
  { id: 'awareness', label: 'Self-Awareness', keys: 'd', hint: 'Calibration · blind spots · knowledge map', title: 'How well you know yourself', icon: Eye },
  { id: 'introspection', label: 'Introspection', keys: 'i', hint: 'Failure patterns · recommendations', title: 'Where your thinking slips', icon: Lightbulb },
  { id: 'predictions', label: 'Predictions', keys: 'p', hint: 'Log · resolve · Brier / learning curve', title: 'What you expect to happen', icon: Crosshair },
  { id: 'learning', label: 'Learning', keys: 'l', hint: 'Assess · skill timeline · patterns', title: 'How you learn', icon: BookOpen },
  { id: 'journal', label: 'Decision Journal', keys: 'j', hint: 'Journal · calibration report', title: 'Decisions, written down', icon: NotebookPen },
  { id: 'practice', label: 'Practice', keys: 'r', hint: 'Bias · accuracy · strategies · toolkit', title: 'Train the habit', icon: Sparkles },
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
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
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
  const current = VIEWS.find((v) => v.id === active)!;

  return (
    <LensShell lensId="metacognition" asMain={false}>
      <FirstRunTour lensId="metacognition" />
      <DepthBadge lensId="metacognition" size="sm" className="ml-2" />
      <div data-lens-theme="metacognition" className="relative min-h-full px-8 pb-28 pt-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[14px] text-zinc-500">Metacognition</p>
            <h1 className="mb-5 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">
              {current.title}{active === 'awareness' && who ? `, ${who}` : ''}
            </h1>
          </div>
          <div className="flex shrink-0 items-center gap-3 pt-2">
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            {realtimeAlerts.length > 0 && (
              <span className="rounded-full bg-yellow-500/10 px-2 py-0.5 text-[11px] text-yellow-400">
                {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
              </span>
            )}
            <DTUExportButton domain="metacognition" data={realtimeData || {}} compact />
          </div>
        </div>

        <nav className="mb-6 inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-white/10 bg-white/[0.03] p-1" aria-label="Metacognition views">
          {VIEWS.map((v) => {
            const Icon = v.icon;
            const on = active === v.id;
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => setActive(v.id)}
                aria-current={on ? 'page' : undefined}
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

        <section key={active} className="min-w-0">
          <Panel />
        </section>

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

        <CrossLensRecentsPanel lensId="metacognition" sinceDays={7} limit={6} hideWhenEmpty className="mt-8" />

        <button
          type="button"
          onClick={() => setActive('predictions')}
          title="Log a prediction"
          className="fixed bottom-8 right-8 z-30 inline-flex items-center gap-2 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300"
        >
          <Crosshair className="h-4 w-4" />
          Log a prediction
        </button>
      </div>
    </LensShell>
  );
}
