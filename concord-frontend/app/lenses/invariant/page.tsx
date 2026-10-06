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
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
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
      <NorthStarFrame
        lensId="invariant"
        crumb="Invariant"
        title={`What must always hold${active === 'overview' && who ? `, ${who}` : ''}`}
        subtitle="Rules, tester and workbench for system invariants"
        actions={
          <>
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            <DTUExportButton domain="invariant" data={realtimeData || {}} compact />
            {realtimeAlerts.length > 0 && (
              <span className="rounded bg-yellow-500/10 px-2 py-0.5 text-xs text-yellow-400">
                {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
              </span>
            )}
          </>
        }
        tabs={VIEWS}
        activeTab={active}
        onTab={(id) => setActive(id as InvariantView)}
        tabsLabel="Invariant views"
        cta={{ label: 'Test an action', icon: Zap, onClick: () => setActive('tester'), title: 'Run the action tester' }}
      >
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
      </NorthStarFrame>
    </LensShell>
  );
}
