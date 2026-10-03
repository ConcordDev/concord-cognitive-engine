'use client';


/**
 * Ingest — one ELT / document-intake workbench (Airbyte-shaped).
 *
 * Single view union. Drop+analysis share textInput inside WorkbenchPanel;
 * Pipeline / Lattice seed / Repos are tabs. Page is a thin shell.
 */

import { useState, type ComponentType } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Upload, Activity, Database, FolderGit2 } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { ConnectiveTissueBar } from '@/components/lens/ConnectiveTissueBar';
import { IngestionRepos } from '@/components/ingest/IngestionRepos';
import { PipelinePanel } from '@/components/ingest/PipelinePanel';
import { LatticeSeedPanel } from '@/components/ingest/LatticeSeedPanel';
import { WorkbenchPanel } from '@/components/ingest/WorkbenchPanel';
import type { IngestView } from '@/components/ingest/ingest-shared';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';

const TABS: { id: IngestView; label: string; keys: string; icon: typeof Upload }[] = [
  { id: 'workbench', label: 'Workbench', keys: 'w', icon: Upload },
  { id: 'pipeline', label: 'Pipeline', keys: 'p', icon: Activity },
  { id: 'seed', label: 'Lattice seed', keys: 's', icon: Database },
  { id: 'repos', label: 'Repos', keys: 'r', icon: FolderGit2 },
];

function ReposPanel() {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
      <IngestionRepos />
    </div>
  );
}

const PANELS: Record<IngestView, ComponentType> = {
  workbench: WorkbenchPanel,
  pipeline: PipelinePanel,
  seed: LatticeSeedPanel,
  repos: ReposPanel,
};

export default function IngestLensPage() {
  useLensNav('ingest');
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('ingest');
  const reduceMotion = useReducedMotion();
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [active, setActive] = useState<IngestView>('workbench');

  useLensCommand(
    TABS.map((t) => ({
      id: `view-${t.id}`,
      keys: t.keys,
      description: t.label,
      category: 'navigation' as const,
      action: () => setActive(t.id),
    })),
    { lensId: 'ingest' },
  );

  const Panel = PANELS[active];

  return (
    <LensShell lensId="ingest" asMain={false}>
      <FirstRunTour lensId="ingest" />
      <DepthBadge lensId="ingest" size="sm" className="ml-2" />
      <NorthStarFrame
        lensId="ingest"
        crumb="Ingest"
        title={`Bring something in${active === 'workbench' && who ? `, ${who}` : ''}`}
        subtitle="ELT pipelines and document intake, one workbench"
        actions={
          <>
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            <DTUExportButton domain="ingest" data={realtimeData || {}} compact />
            {realtimeAlerts.length > 0 && (
              <span className="rounded bg-yellow-500/10 px-2 py-0.5 text-xs text-yellow-400">
                {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
              </span>
            )}
          </>
        }
        tabs={TABS}
        activeTab={active}
        onTab={(id) => setActive(id as IngestView)}
        tabsLabel="Ingest views"
        cta={{ label: 'Open workbench', icon: Upload, onClick: () => setActive('workbench'), title: 'Ingest a document' }}
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={active}
            initial={reduceMotion ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? undefined : { opacity: 0, y: -6 }}
            transition={{ duration: reduceMotion ? 0 : 0.16 }}
          >
            <Panel />
          </motion.div>
        </AnimatePresence>

        <ConnectiveTissueBar lensId="ingest" />
        <RealtimeDataPanel
          domain="ingest"
          data={realtimeData}
          isLive={isLive}
          lastUpdated={lastUpdated}
          insights={realtimeInsights}
          compact
        />
      </NorthStarFrame>
    </LensShell>
  );
}