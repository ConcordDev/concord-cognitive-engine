'use client';

/**
 * Space — one spaceflight ops app (N2YO / Go4Liftoff shape).
 *
 * Single `active` union. Accordion booleans for news/wiki are gone — each
 * former stacked region is a tabbed panel. Page is a thin shell.
 */

import { useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  Rocket, BarChart3, Satellite, Flame, Radio, Users, Orbit, Eye, Newspaper, Bookmark, BookOpen,
} from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
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
import { MissionPlanningPanel } from '@/components/space/MissionPlanningPanel';
import { SpaceDashboardPanel } from '@/components/space/SpaceDashboardPanel';
import { SpaceArtifactPanel } from '@/components/space/SpaceArtifactPanel';
import { NewsLaunchesPanel } from '@/components/space/NewsLaunchesPanel';
import { LaunchTrackPanel } from '@/components/space/LaunchTrackPanel';
import { SpaceWikiPanel } from '@/components/space/SpaceWikiPanel';
import { ObservatoryPanel } from '@/components/space/ObservatoryPanel';
import { type SpaceView, type SpaceArtifactView } from '@/components/space/space-nav';

const VIEWS: { id: SpaceView; label: string; keys: string; icon: typeof Rocket }[] = [
  { id: 'dashboard', label: 'Dashboard', keys: 'd', icon: BarChart3 },
  { id: 'missions', label: 'Missions', keys: 'm', icon: Rocket },
  { id: 'satellites', label: 'Satellites', keys: 's', icon: Satellite },
  { id: 'launchops', label: 'Launch Ops', keys: 'l', icon: Flame },
  { id: 'telemetry', label: 'Telemetry', keys: 't', icon: Radio },
  { id: 'crew', label: 'Crew', keys: 'c', icon: Users },
  { id: 'debris', label: 'Debris', keys: 'b', icon: Orbit },
  { id: 'planning', label: 'Planning', keys: 'p', icon: Orbit },
  { id: 'observatory', label: 'Observatory', keys: 'o', icon: Eye },
  { id: 'news', label: 'News', keys: 'n', icon: Newspaper },
  { id: 'launches', label: 'Track', keys: 'w', icon: Bookmark },
  { id: 'wiki', label: 'Wiki', keys: 'k', icon: BookOpen },
];

const ARTIFACT_VIEWS = new Set<SpaceView>(['missions', 'satellites', 'launchops', 'telemetry', 'crew', 'debris']);

function SpacePane({ active }: { active: SpaceView }) {
  if (active === 'dashboard') return <SpaceDashboardPanel />;
  if (active === 'planning') return <MissionPlanningPanel />;
  if (active === 'observatory') return <ObservatoryPanel />;
  if (active === 'news') return <NewsLaunchesPanel />;
  if (active === 'launches') return <LaunchTrackPanel />;
  if (active === 'wiki') return <SpaceWikiPanel />;
  if (ARTIFACT_VIEWS.has(active)) {
    return <SpaceArtifactPanel view={active as SpaceArtifactView} />;
  }
  return <SpaceDashboardPanel />;
}

export default function SpaceLensPage() {
  useLensNav('space');
  useLensIdentity('space');
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('space');
  const reduceMotion = useReducedMotion();
  const [active, setActive] = useState<SpaceView>('dashboard');

  useLensCommand(
    VIEWS.map((v) => ({
      id: `view-${v.id}`,
      keys: v.keys,
      description: v.label,
      category: 'navigation' as const,
      action: () => setActive(v.id),
    })),
    { lensId: 'space' },
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

  return (
    <LensShell lensId="space" asMain={false}>
      <FirstRunTour lensId="space" />
      <DepthBadge lensId="space" size="sm" className="ml-2" />
      <div data-lens-theme="space" className={cn(ds.pageContainer, 'space-y-4')}>
        <header className="bg-gradient-to-r from-indigo-900/20 via-transparent to-purple-900/20 rounded-xl p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="relative w-10 h-10 flex items-center justify-center">
              <div className="absolute inset-0 rounded-full border border-indigo-500/40 animate-spin" style={{ animationDuration: '8s' }} />
              <div className="w-10 h-10 rounded-lg bg-indigo-500/20 flex items-center justify-center">
                <Rocket className="w-5 h-5 text-indigo-400" />
              </div>
            </div>
            <div>
              <h1 className="text-xl font-bold text-white">Space Operations</h1>
              <p className="text-sm text-gray-400">Missions, satellites, telemetry &amp; orbital management</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            <DTUExportButton domain="space" data={realtimeData || {}} compact />
          </div>
        </header>

        <nav className="flex gap-1 bg-zinc-900 rounded-lg p-1 flex-wrap" aria-label="Space views">
          {VIEWS.map(({ id, label, keys, icon: Icon }) => {
            const on = active === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setActive(id)}
                className={cn(
                  'flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium whitespace-nowrap transition-colors',
                  on ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-zinc-300',
                )}
                aria-current={on ? 'page' : undefined}
              >
                <Icon className="w-4 h-4" /> {label}
                <kbd className="hidden sm:inline text-[10px] text-white/30 font-mono">{keys}</kbd>
              </button>
            );
          })}
        </nav>

        <AnimatePresence mode="wait">
          <motion.div key={active} {...motionProps}>
            <SpacePane active={active} />
          </motion.div>
        </AnimatePresence>

        {insights && insights.length > 0 && (
          <RealtimeDataPanel domain="space" data={realtimeData} isLive={isLive} lastUpdated={lastUpdated} insights={insights} compact />
        )}
      </div>
    </LensShell>
  );
}
