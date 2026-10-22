'use client';

/**
 * Science — one Benchling/Quartzy lab app.
 *
 * Single `active` union. Artifact CRUD, lab actions, arXiv, and the stats
 * workbench are panels under components/science/. FAB accordion removed.
 */

import { useState } from 'react';
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
  Plus,
} from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeedPanel } from '@/components/feeds/LensFeedPanel';
import LiveFeed, { adaptToLiveFeedArticles } from '@/components/lens/LiveFeed';
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

  const artifactType = ARTIFACT_FOR[active];


  return (
    <LensShell lensId="science" asMain={false}>

      <DepthBadge lensId="science" size="sm" className="ml-2" />
      <NorthStarFrame
        lensId="science"
        crumb="Science"
        subtitle="Lab notebook, samples, equipment, analysis, protocols and publications."
        actions={
          <>
            {realtimeAlerts.length > 0 && (
              <span className="rounded bg-yellow-500/10 px-2 py-0.5 text-xs text-yellow-400">
                {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
              </span>
            )}
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            <DTUExportButton domain="science" data={realtimeData || {}} compact />
          </>
        }
        tabs={VIEWS.map((v) => ({ id: v.id, label: v.label, icon: v.icon, keys: v.keys }))}
        activeTab={active}
        onTab={(id) => setActive(id as ScienceView)}
        tabsLabel="Science views"
        cta={{ label: 'New experiment', icon: Plus, onClick: () => setActive('notebook'), title: 'Open the lab notebook' }}
      >
        <div className="space-y-5">
          <div id="science-skip">
            {active === 'dashboard' && <DashboardPanel />}
            {artifactType && <ArtifactRoute type={artifactType} />}
            {active === 'lab' && <LabPanel />}
            {active === 'arxiv' && <ArxivPanel />}
            {active === 'workbench' && <WorkbenchPanel />}
          </div>

          <LensFeedPanel lensId="science" />

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
        </div>
      </NorthStarFrame>
    </LensShell>
  );
}
