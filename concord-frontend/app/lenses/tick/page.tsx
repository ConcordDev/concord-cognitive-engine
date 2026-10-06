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
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
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
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);

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

  const titles: Record<TickViewTab, string> = {
    stream: `Feel the pulse${who ? `, ${who}` : ''}`,
    stats: 'Read the signal',
    timeline: 'Replay what happened',
    health: 'Check the vital signs',
    monitor: 'Watch every module',
    rate: 'Measure the rhythm',
  };

  return (
    <LensShell lensId="tick" asMain={false}>
      <FirstRunTour lensId="tick" />
      <DepthBadge lensId="tick" size="sm" className="ml-2" />
      <NorthStarFrame
        lensId="tick"
        crumb="Tick"
        title={titles[active]}
        subtitle="Real-time kernel tick stream and system health monitoring"
        actions={(
          <>
            <HeartbeatPulse isLive={isLive} lastTickTime={lastTickTime} />
            <LiveIndicator isLive={rtIsLive} lastUpdated={lastUpdated} compact />
            <DTUExportButton domain="tick" data={realtimeData || {}} compact />
          </>
        )}
        tabs={VIEWS.map((v) => ({ id: v.id, label: v.label, icon: v.icon, keys: v.keys, hint: v.hint }))}
        activeTab={active}
        onTab={(id) => setActive(id as TickViewTab)}
        tabsLabel="Tick views"
        cta={{
          label: isLive ? 'Pause stream' : 'Resume stream',
          icon: isLive ? Pause : Play,
          onClick: () => setIsLive(!isLive),
          title: isLive ? 'Pause the live tick stream' : 'Resume the live tick stream',
        }}
      >
        <div className="space-y-4">
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

        <AnimatePresence mode="wait">
          <motion.div key={active} {...motionProps}>
            {active === 'monitor' || active === 'rate' ? (
              <section className="rounded-2xl border border-white/10 bg-[#111] p-4">
                <Panel />
              </section>
            ) : (
              <Panel />
            )}
          </motion.div>
        </AnimatePresence>

        <TickActionsPanel />

        </div>
      </NorthStarFrame>
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
