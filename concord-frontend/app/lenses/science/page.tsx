'use client';

/**
 * Science — one Benchling/Quartzy lab app.
 *
 * Single `active` union. Artifact CRUD, lab actions, arXiv, and the stats
 * workbench are panels under components/science/. FAB accordion removed.
 */

import { useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  FlaskConical,
  TestTubes,
  LineChart,
  Wrench,
  BookOpen,
  ClipboardList,
  GraduationCap,
  BarChart3,
  Sigma,
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
import { LensFeedPanel } from '@/components/feeds/LensFeedPanel';
import LiveFeed, { adaptToLiveFeedArticles } from '@/components/lens/LiveFeed';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { DashboardPanel } from '@/components/science/DashboardPanel';
import { ArtifactsPanel } from '@/components/science/ArtifactsPanel';
import { LabPanel } from '@/components/science/LabPanel';
import { ArxivPanel } from '@/components/science/ArxivPanel';
import { WorkbenchPanel } from '@/components/science/WorkbenchPanel';
import type { ArtifactType } from '@/components/science/science-types';

type ScienceView =
  | 'dashboard'
  | 'notebook'
  | 'samples'
  | 'equipment'
  | 'analysis'
  | 'protocols'
  | 'publications'
  | 'lab'
  | 'arxiv'
  | 'workbench';

const VIEWS: { id: ScienceView; label: string; keys: string; icon: typeof FlaskConical }[] = [
  { id: 'dashboard', label: 'Dashboard', keys: 'd', icon: BarChart3 },
  { id: 'notebook', label: 'Notebook', keys: '1', icon: BookOpen },
  { id: 'samples', label: 'Samples', keys: '2', icon: TestTubes },
  { id: 'equipment', label: 'Equipment', keys: '3', icon: Wrench },
  { id: 'analysis', label: 'Analysis', keys: '4', icon: LineChart },
  { id: 'protocols', label: 'Protocols', keys: '5', icon: ClipboardList },
  { id: 'publications', label: 'Publications', keys: '6', icon: GraduationCap },
  { id: 'lab', label: 'Lab', keys: 'l', icon: FlaskConical },
  { id: 'arxiv', label: 'arXiv', keys: 'x', icon: BookOpen },
  { id: 'workbench', label: 'Workbench', keys: 'w', icon: Sigma },
];

const ARTIFACT_FOR: Partial<Record<ScienceView, ArtifactType>> = {
  notebook: 'Experiment',
  samples: 'Sample',
  equipment: 'Equipment',
  analysis: 'Analysis',
  protocols: 'Protocol',
  publications: 'Publication',
};

function ArtifactRoute({ type }: { type: ArtifactType }) {
  return <ArtifactsPanel artifactType={type} />;
}

export default function ScienceLensPage() {
  useLensNav('science');
  const {
    latestData: realtimeData,
    alerts: realtimeAlerts,
    insights: realtimeInsights,
    isLive,
    lastUpdated,
  } = useRealtimeLens('science');
  const reduceMotion = useReducedMotion();
  const [active, setActive] = useState<ScienceView>('dashboard');

  useLensCommand(
    VIEWS.map((v) => ({
      id: `view-${v.id}`,
      keys: v.keys,
      description: v.label,
      category: 'navigation' as const,
      action: () => setActive(v.id),
    })),
    { lensId: 'science' },
  );

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

  const artifactType = ARTIFACT_FOR[active];

  return (
    <LensShell lensId="science" asMain={false}>
      <FirstRunTour lensId="science" />
      <DepthBadge lensId="science" size="sm" className="ml-2" />
      <div data-lens-theme="science" className={ds.pageContainer}>
        <a href="#science-skip" className="sr-only focus:not-sr-only focus:ring-2 focus:ring-amber-500 focus:outline-none">
          Skip to science content
        </a>

        <header className={ds.sectionHeader}>
          <div className="flex items-center gap-3 min-w-0">
            <FlaskConical className="w-7 h-7 text-neon-purple shrink-0" />
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className={ds.heading1}>Science Lab</h1>
                <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
                <DTUExportButton domain="science" data={realtimeData || {}} compact />
                {realtimeAlerts.length > 0 && (
                  <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
                    {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
              <p className={ds.textMuted}>
                Lab notebook, samples, equipment, analysis, protocols &amp; publications
              </p>
            </div>
          </div>
        </header>

        <nav
          className="flex items-center gap-1 border-b border-lattice-border overflow-x-auto"
          aria-label="Science views"
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
                    ? 'border-neon-purple text-neon-purple'
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

        <div id="science-skip">
          <AnimatePresence mode="wait">
            <motion.div key={active} {...motionProps} className="pt-4">
              {active === 'dashboard' && <DashboardPanel />}
              {artifactType && <ArtifactRoute type={artifactType} />}
              {active === 'lab' && <LabPanel />}
              {active === 'arxiv' && <ArxivPanel />}
              {active === 'workbench' && <WorkbenchPanel />}
            </motion.div>
          </AnimatePresence>
        </div>

        <div className="px-4 mb-2 mt-4">
          <LensFeedPanel lensId="science" />
        </div>

        <LiveFeed
          articles={adaptToLiveFeedArticles(realtimeData as Record<string, unknown> | null)}
          domain="research"
          isLive={isLive}
          lastUpdated={lastUpdated}
          limit={8}
        />
        {realtimeData && (
          <RealtimeDataPanel
            domain="science"
            data={realtimeData}
            isLive={isLive}
            lastUpdated={lastUpdated}
            insights={realtimeInsights}
            compact
          />
        )}

        <CrossLensRecentsPanel lensId="science" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
      </div>
    </LensShell>
  );
}
