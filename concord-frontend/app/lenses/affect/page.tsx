'use client';

/**
 * Affect lens — one clinical affect/mood research desk (iMotions / Empatica).
 *
 * Single view union. ATS 7D spine + Daylio-parity mood + VAD/NLP analysis.
 * Every pixel traces to /api/affect/* or affect.* macros.
 */

import { useMemo, useState, type ComponentType } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Heart, Smile, Activity, Clock, BarChart3, Thermometer, Sparkles } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { ds } from '@/lib/design-system';
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

const VIEWS: { id: AffectView; label: string; keys: string; hint: string; icon: typeof Heart }[] = [
  { id: 'mood', label: 'Mood', keys: '1', hint: 'Check-ins and scale', icon: Smile },
  { id: 'dimensions', label: 'Dimensions', keys: '2', hint: '7D ATS radar', icon: Activity },
  { id: 'events', label: 'Event Log', keys: '3', hint: 'Affective events', icon: Clock },
  { id: 'policy', label: 'Policies', keys: '4', hint: 'Derived control signals', icon: BarChart3 },
  { id: 'health', label: 'Health', keys: '5', hint: 'Warnings and recovery', icon: Thermometer },
  { id: 'analysis', label: 'Analysis', keys: '6', hint: 'VAD / arc / empathy', icon: Sparkles },
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
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('affect');
  const reduceMotion = useReducedMotion();
  const [active, setActive] = useState<AffectView>('dimensions');

  useLensCommand(
    VIEWS.map((v) => ({
      id: `view-${v.id}`,
      keys: v.keys,
      description: `${v.label} — ${v.hint}`,
      category: 'navigation' as const,
      action: () => setActive(v.id),
    })),
    { lensId: 'affect' },
  );

  const Panel = PANELS[active];
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
    <LensShell lensId="affect" asMain={false}>
      <FirstRunTour lensId="affect" />
      <DepthBadge lensId="affect" size="sm" className="ml-2" />
      <AffectSessionProvider>
        <div data-lens-theme="affect" className={ds.pageContainer}>
          <header className={ds.sectionHeader}>
            <div className="flex items-center gap-3 min-w-0">
              <div className="p-2 rounded-lg border border-[var(--lens-accent)]/40 bg-[var(--lens-gradient)]">
                <Heart className="w-6 h-6" style={{ color: 'var(--lens-accent)' }} />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className={ds.heading1}>Affect</h1>
                  <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
                  <DTUExportButton domain="affect" data={realtimeData || {}} compact />
                  {realtimeAlerts.length > 0 && (
                    <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
                      {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
                    </span>
                  )}
                </div>
                <p className={ds.textMuted}>
                  Affective Translation Spine — 7D state, derived policy, mood research tools.
                </p>
              </div>
            </div>
          </header>

          <AffectStateStrip />

          <nav
            className="flex items-center gap-1 border-b border-lattice-border overflow-x-auto"
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
              <Panel />
            </motion.div>
          </AnimatePresence>

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
          <CrossLensRecentsPanel lensId="affect" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
        </div>
      </AffectSessionProvider>
    </LensShell>
  );
}
