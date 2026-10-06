'use client';

/**
 * Import — one Airbyte/Stitch ETL desk.
 *
 * Single view union (desk | restore | parity | tools). Accordion
 * show-booleans are gone. Page is a thin shell.
 */

import { useMemo, useState, type ComponentType } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Upload, Archive, Wrench, Layers, Plus } from 'lucide-react';
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
import { ImportDeskPanel } from '@/components/import/ImportDeskPanel';
import { RestoreDtuExport } from '@/components/import/RestoreDtuExport';
import { ImportParityWorkbench } from '@/components/import/ImportParityWorkbench';
import { ImportToolingGallery } from '@/components/import/ImportToolingGallery';

type ImportView = 'desk' | 'restore' | 'parity' | 'tools';

const VIEWS: { id: ImportView; label: string; keys: string; hint: string; icon: typeof Upload }[] = [
  { id: 'desk', label: 'Import', keys: '1', hint: 'Drop · validate · jobs', icon: Upload },
  { id: 'restore', label: 'Restore', keys: '2', hint: 'import.json · markdown', icon: Archive },
  { id: 'parity', label: 'Workbench', keys: '3', hint: 'Map, validate and transform imports', icon: Layers },
  { id: 'tools', label: 'Tooling', keys: '4', hint: 'External ETL reference', icon: Wrench },
];

function RestorePanel() {
  return (
    <section className="rounded-2xl border border-white/10 bg-[#111] p-4">
      <RestoreDtuExport />
    </section>
  );
}

function ParityPanel() {
  return (
    <section className="rounded-2xl border border-white/10 bg-[#111] p-4">
      <ImportParityWorkbench />
    </section>
  );
}

function ToolsPanel() {
  return (
    <section className="rounded-2xl border border-white/10 bg-[#111] p-4">
      <ImportToolingGallery />
    </section>
  );
}

const PANELS: Record<ImportView, ComponentType> = {
  desk: ImportDeskPanel,
  restore: RestorePanel,
  parity: ParityPanel,
  tools: ToolsPanel,
};

export default function ImportLensPage() {
  useLensNav('import');
  useLensIdentity('import');
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('import');
  const reduceMotion = useReducedMotion();
  const [active, setActive] = useState<ImportView>('desk');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);

  useLensCommand(
    [
      ...VIEWS.map((v) => ({
        id: `import-${v.id}`,
        keys: v.keys,
        description: `${v.label} — ${v.hint}`,
        category: 'navigation' as const,
        action: () => setActive(v.id),
      })),
      { id: 'mode-merge', keys: 'm', description: 'Import desk (merge mode lives on desk)', category: 'view' as const, action: () => setActive('desk') },
      { id: 'mode-replace', keys: 'r', description: 'Import desk', category: 'view' as const, action: () => setActive('desk') },
      { id: 'mode-skip', keys: 's', description: 'Import desk', category: 'view' as const, action: () => setActive('desk') },
    ],
    { lensId: 'import' },
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

  const titles: Record<ImportView, string> = {
    desk: `Bring it in${who ? `, ${who}` : ''}`,
    restore: 'Restore what you exported',
    parity: 'Map and shape the data',
    tools: 'Reach for the right ETL tool',
  };

  return (
    <LensShell lensId="import" asMain={false}>
      <FirstRunTour lensId="import" />
      <DepthBadge lensId="import" size="sm" className="ml-2" />
      <NorthStarFrame
        lensId="import"
        crumb="Import"
        title={titles[active]}
        subtitle="Airbyte / Stitch desk: drop any file, validate, restore DTUs."
        actions={(
          <>
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            <DTUExportButton domain="import" data={realtimeData || {}} compact />
            {realtimeAlerts.length > 0 && (
              <span className="rounded-full bg-yellow-500/10 px-2.5 py-0.5 text-xs text-yellow-400">
                {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
              </span>
            )}
          </>
        )}
        tabs={VIEWS.map((v) => ({ id: v.id, label: v.label, icon: v.icon, keys: v.keys, hint: v.hint }))}
        activeTab={active}
        onTab={(id) => setActive(id as ImportView)}
        tabsLabel="Import views"
        cta={{ label: 'New import', icon: Plus, onClick: () => setActive('desk'), title: 'Open the import desk (1)' }}
      >
        <main className="min-w-0">
          <AnimatePresence mode="wait">
            <motion.div key={active} {...motionProps}>
              <Panel />
            </motion.div>
          </AnimatePresence>
        </main>

        {realtimeData && (
          <RealtimeDataPanel
            domain="import"
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
