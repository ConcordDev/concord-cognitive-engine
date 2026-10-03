'use client';

/**
 * Affect lens — one clinical affect/mood research desk (iMotions / Empatica).
 *
 * Single view union. ATS 7D spine + Daylio-parity mood + VAD/NLP analysis.
 * Every pixel traces to /api/affect/* or affect.* macros.
 */

import { useState, type ComponentType } from 'react';
import { Smile, Activity, Clock, BarChart3, Thermometer, Sparkles, Plus } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { cn } from '@/lib/utils';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { AffectSessionProvider } from '@/components/affect/AffectSessionContext';
import { AffectStateStrip } from '@/components/affect/AffectStateStrip';
import { MoodPanel } from '@/components/affect/MoodPanel';
import { DimensionsPanel } from '@/components/affect/DimensionsPanel';
import { EventLogPanel } from '@/components/affect/EventLogPanel';
import { PolicyPanel } from '@/components/affect/PolicyPanel';
import { HealthPanel } from '@/components/affect/HealthPanel';
import { AnalysisToolsPanel } from '@/components/affect/AnalysisToolsPanel';

type AffectView = 'mood' | 'dimensions' | 'events' | 'policy' | 'health' | 'analysis';

const VIEWS: { id: AffectView; label: string; keys: string; title: string; hint: string; icon: typeof Smile }[] = [
  { id: 'mood', title: 'How you feel', label: 'Mood', keys: '1', hint: 'Check-ins and scale', icon: Smile },
  { id: 'dimensions', title: 'Your seven dimensions', label: 'Dimensions', keys: '2', hint: '7D ATS radar', icon: Activity },
  { id: 'events', title: 'What moved you', label: 'Event Log', keys: '3', hint: 'Affective events', icon: Clock },
  { id: 'policy', title: 'What it changes', label: 'Policies', keys: '4', hint: 'Derived control signals', icon: BarChart3 },
  { id: 'health', title: 'How you are holding up', label: 'Health', keys: '5', hint: 'Warnings and recovery', icon: Thermometer },
  { id: 'analysis', title: 'Read the tone', label: 'Analysis', keys: '6', hint: 'VAD / arc / empathy', icon: Sparkles },
];

const PANELS: Record<AffectView, ComponentType> = {
  mood: MoodPanel,
  dimensions: DimensionsPanel,
  events: EventLogPanel,
  policy: PolicyPanel,
  health: HealthPanel,
  analysis: AnalysisToolsPanel,
};

export default function AffectLensPage() {
  useLensNav('affect');
  useLensIdentity('affect');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('affect');
  const [active, setActive] = useState<AffectView>('dimensions');

  useLensCommand(
    [
      ...VIEWS.map((v) => ({
        id: `view-${v.id}`,
        keys: v.keys,
        description: `${v.label} — ${v.hint}`,
        category: 'navigation' as const,
        action: () => setActive(v.id),
      })),
      { id: 'check-in', keys: 'n', description: 'Log a mood check-in', category: 'actions' as const, action: () => setActive('mood') },
    ],
    { lensId: 'affect' },
  );

  const Panel = PANELS[active];
  const current = VIEWS.find((v) => v.id === active)!;

  return (
    <LensShell lensId="affect" asMain={false}>
      <FirstRunTour lensId="affect" />
      <DepthBadge lensId="affect" size="sm" className="ml-2" />
      <AffectSessionProvider>
        <div data-lens-theme="affect" className="relative min-h-full space-y-6 px-8 pb-28 pt-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[14px] text-zinc-500">Affect</p>
              <h1 className="mb-1 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">
                {current.title}{active === 'dimensions' && who ? `, ${who}` : ''}
              </h1>
              <p className="max-w-2xl text-[14px] text-zinc-500">
                Affective Translation Spine: 7D state, derived policy, mood research tools.
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-3 pt-2">
              <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
              <DTUExportButton domain="affect" data={realtimeData || {}} compact />
              {realtimeAlerts.length > 0 && (
                <span className="rounded-full bg-yellow-500/10 px-2.5 py-0.5 text-xs text-yellow-400">
                  {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
                </span>
              )}
            </div>
          </div>

          <AffectStateStrip />

          <nav
            className="inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-white/10 bg-white/[0.03] p-1"
            aria-label="Affect views"
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

          <section key={active}>
            <Panel />
          </section>

          {realtimeData && (
            <RealtimeDataPanel
              domain="affect"
              data={realtimeData}
              isLive={isLive}
              lastUpdated={lastUpdated}
              insights={realtimeInsights}
              compact
            />
          )}
          <CrossLensRecentsPanel lensId="affect" sinceDays={7} limit={6} hideWhenEmpty className="mt-8" />

          <button
            type="button"
            onClick={() => setActive('mood')}
            title="Log a mood check-in (N)"
            className="fixed bottom-8 right-8 z-30 inline-flex items-center gap-2 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300"
          >
            <Plus className="h-4 w-4" />
            Check in
          </button>
        </div>
      </AffectSessionProvider>
    </LensShell>
  );
}
