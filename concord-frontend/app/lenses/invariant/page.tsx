'use client';

/**
 * Invariant — one formal-verification / ethos-enforcer app.
 *
 * Single `active` union. Stacked tester / workbench / dashboard / analysis /
 * repos folded into tabs. Thin shell.
 */

import { useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Shield, ListChecks, Zap, Gauge, Play, FolderGit2 } from 'lucide-react';
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
import { OverviewPanel } from '@/components/invariant/OverviewPanel';
import { RulesPanel } from '@/components/invariant/RulesPanel';
import { ActionTesterPanel } from '@/components/invariant/ActionTesterPanel';
import { WorkbenchPanel } from '@/components/invariant/WorkbenchPanel';
import { AnalysisPanel } from '@/components/invariant/AnalysisPanel';
import { ReposPanel } from '@/components/invariant/ReposPanel';

type InvariantView = 'overview' | 'rules' | 'tester' | 'workbench' | 'analysis' | 'repos';

const VIEWS: { id: InvariantView; label: string; keys: string; icon: typeof Shield }[] = [
  { id: 'overview', label: 'Overview', keys: 'o', icon: Shield },
  { id: 'rules', label: 'Rules', keys: 'r', icon: ListChecks },
  { id: 'tester', label: 'Tester', keys: 'i', icon: Zap },
  { id: 'workbench', label: 'Workbench', keys: 'w', icon: Gauge },
  { id: 'analysis', label: 'Analysis', keys: 'a', icon: Play },
  { id: 'repos', label: 'Repos', keys: 'e', icon: FolderGit2 },
];

export default function InvariantLensPage() {
  useLensNav('invariant');
  useLensIdentity('invariant');
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('invariant');
  const reduceMotion = useReducedMotion();
  const [active, setActive] = useState<InvariantView>('overview');

  useLensCommand(
    VIEWS.map((v) => ({
      id: `view-${v.id}`,
      keys: v.keys,
      description: v.label,
      category: 'navigation' as const,
      action: () => setActive(v.id),
    })),
    { lensId: 'invariant' },
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
    <LensShell lensId="invariant" asMain={false}>
      <FirstRunTour lensId="invariant" />
      <DepthBadge lensId="invariant" size="sm" className="ml-2" />
      <div data-lens-theme="invariant" className={cn(ds.pageContainer, 'space-y-4')}>
        <header className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <span className="text-2xl" aria-hidden="true">🛡️</span>
            <div>
              <h1 className="text-xl font-bold">Invariant Lens</h1>
              <p className="text-sm text-gray-400">Interactive ethos enforcer and capability tester</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            <DTUExportButton domain="invariant" data={realtimeData || {}} compact />
            {realtimeAlerts.length > 0 && (
              <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
                {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </header>

        <nav className="flex gap-1 border-b border-lattice-border overflow-x-auto" aria-label="Invariant views">
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
                <kbd className="hidden sm:inline text-[10px] text-white/30 font-mono">{v.keys}</kbd>
              </button>
            );
          })}
        </nav>

        <AnimatePresence mode="wait">
          <motion.div key={active} {...motionProps}>
            {active === 'overview' && <OverviewPanel />}
            {active === 'rules' && <RulesPanel />}
            {active === 'tester' && <ActionTesterPanel />}
            {active === 'workbench' && <WorkbenchPanel />}
            {active === 'analysis' && <AnalysisPanel />}
            {active === 'repos' && <ReposPanel />}
          </motion.div>
        </AnimatePresence>

        {realtimeData && (
          <RealtimeDataPanel
            domain="invariant"
            data={realtimeData}
            isLive={isLive}
            lastUpdated={lastUpdated}
            insights={realtimeInsights}
            compact
          />
        )}

        <CrossLensRecentsPanel lensId="invariant" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
      </div>
    </LensShell>
  );
}
