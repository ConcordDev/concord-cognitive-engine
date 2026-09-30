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
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
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
import { cn } from '@/lib/utils';
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
      <div data-lens-theme="ingest" className="p-6 space-y-4">
        <header className="flex items-center gap-3 flex-wrap">
          <Upload className="w-6 h-6 text-neon-cyan" />
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-bold">Ingest</h1>
              <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
              <DTUExportButton domain="ingest" data={realtimeData || {}} compact />
              {realtimeAlerts.length > 0 && (
                <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
                  {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
                </span>
              )}
            </div>
            <p className="text-sm text-gray-400">
              Airbyte-shaped ELT + document intake — one workbench.
            </p>
          </div>
        </header>

        <RealtimeDataPanel
          domain="ingest"
          data={realtimeData}
          isLive={isLive}
          lastUpdated={lastUpdated}
          insights={realtimeInsights}
          compact
        />

        <nav
          className="flex flex-wrap gap-1 bg-lattice-void border border-lattice-border rounded-lg p-1"
          aria-label="Ingest views"
        >
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const on = active === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActive(tab.id)}
                className={cn(
                  'flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-all',
                  on
                    ? 'bg-neon-cyan/20 text-neon-cyan border border-neon-cyan/30'
                    : 'text-gray-400 hover:text-white hover:bg-lattice-surface',
                )}
                aria-current={on ? 'page' : undefined}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
                <kbd className="hidden sm:inline text-[10px] text-white/30 bg-white/5 border border-white/10 rounded px-1 py-0.5 font-mono">
                  {tab.keys}
                </kbd>
              </button>
            );
          })}
        </nav>

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
        <CrossLensRecentsPanel lensId="ingest" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
      </div>
    </LensShell>
  );
}