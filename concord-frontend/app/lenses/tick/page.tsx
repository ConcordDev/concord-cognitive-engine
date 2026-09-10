'use client';

/**
 * Tick — one Datadog-style heartbeat / tick-stream app.
 *
 * Single view union (stream | stats | timeline | health | monitor | rate).
 * Shared /api/events stream lives in TickStreamProvider. Page is a thin shell.
 */

import { useMemo, useState, type ComponentType } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  Activity, BarChart3, Timer, Heart, Eye, Gauge, Pause, Play,
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
import { TickStreamProvider, useTickStream } from '@/components/tick/TickStreamContext';
import { HeartbeatPulse, type TickViewTab } from '@/components/tick/tick-model';
import { TickQuickStats } from '@/components/tick/TickQuickStats';
import { StreamPanel } from '@/components/tick/StreamPanel';
import { StatsPanel } from '@/components/tick/StatsPanel';
import { TimelinePanel } from '@/components/tick/TimelinePanel';
import { HealthPanel } from '@/components/tick/HealthPanel';
import { TickActionsPanel } from '@/components/tick/TickActionsPanel';
import { MonitorPanel } from '@/components/tick/MonitorPanel';
import { TickRate } from '@/components/tick/TickRate';

const VIEWS: { id: TickViewTab; label: string; keys: string; hint: string; icon: typeof Activity }[] = [
  { id: 'stream', label: 'Stream', keys: 's', hint: 'Live tick metrics', icon: Activity },
  { id: 'stats', label: 'Statistics', keys: 't', hint: 'Signal / stress / organs', icon: BarChart3 },
  { id: 'timeline', label: 'Timeline', keys: 'i', hint: 'Chronological events', icon: Timer },
  { id: 'health', label: 'Health', keys: 'h', hint: 'Derived health score', icon: Heart },
  { id: 'monitor', label: 'Monitor', keys: 'm', hint: 'Heartbeat modules', icon: Eye },
  { id: 'rate', label: 'Tick Rate', keys: 'r', hint: '/api/perf/metrics', icon: Gauge },
];

const PANELS: Record<TickViewTab, ComponentType> = {
  stream: StreamPanel,
  stats: StatsPanel,
  timeline: TimelinePanel,
  health: HealthPanel,
  monitor: MonitorPanel,
  rate: TickRate,
};

function TickLensInner() {
  useLensNav('tick');
  useLensIdentity('tick');
  const { latestData: realtimeData, isLive: rtIsLive, lastUpdated, insights } = useRealtimeLens('tick');
  const { isLive, setIsLive, lastTickTime } = useTickStream();
  const reduceMotion = useReducedMotion();
  const [active, setActive] = useState<TickViewTab>('stream');

  useLensCommand(
    VIEWS.map((v) => ({
      id: `view-${v.id}`,
      keys: v.keys,
      description: `${v.label} — ${v.hint}`,
      category: 'navigation' as const,
      action: () => setActive(v.id),
    })),
    { lensId: 'tick' },
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
    <LensShell lensId="tick" asMain={false}>
      <FirstRunTour lensId="tick" />
      <DepthBadge lensId="tick" size="sm" className="ml-2" />
      <div data-lens-theme="tick" className={ds.pageContainer}>
        <header className={ds.sectionHeader}>
          <div className="flex items-center gap-4 min-w-0">
            <HeartbeatPulse isLive={isLive} lastTickTime={lastTickTime} />
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className={ds.heading1}>Tick Lens</h1>
                <LiveIndicator isLive={rtIsLive} lastUpdated={lastUpdated} compact />
                <DTUExportButton domain="tick" data={realtimeData || {}} compact />
              </div>
              <p className={ds.textMuted}>
                Real-time kernel tick stream and system health monitoring
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setIsLive(!isLive)}
            className={cn('btn-neon', isLive && 'green')}
          >
            {isLive ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            <span className="ml-2">{isLive ? 'Live' : 'Paused'}</span>
          </button>
        </header>

        {realtimeData && (
          <RealtimeDataPanel
            domain="tick"
            data={realtimeData}
            isLive={rtIsLive}
            lastUpdated={lastUpdated}
            insights={insights}
            compact
          />
        )}

        <TickQuickStats />

        <nav
          className="flex items-center gap-1 border-b border-lattice-border overflow-x-auto"
          aria-label="Tick views"
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
          <motion.div key={active} {...motionProps} className="pt-4">
            {active === 'monitor' || active === 'rate' ? (
              <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
                <Panel />
              </section>
            ) : (
              <Panel />
            )}
          </motion.div>
        </AnimatePresence>

        <TickActionsPanel />

        <a href="#tick-skip" className="sr-only focus:not-sr-only focus:ring-2 focus:ring-amber-500 focus:outline-none">Skip to tick content</a>
        <CrossLensRecentsPanel lensId="tick" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
      </div>
    </LensShell>
  );
}

export default function TickLensPage() {
  return (
    <TickStreamProvider>
      <TickLensInner />
    </TickStreamProvider>
  );
}
