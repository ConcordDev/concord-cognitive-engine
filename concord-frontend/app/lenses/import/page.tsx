'use client';

/**
 * Import — one Airbyte/Stitch ETL desk.
 *
 * Single view union (desk | restore | parity | tools). Accordion
 * show-booleans are gone. Page is a thin shell.
 */

import { useMemo, useState, type ComponentType } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Upload, Archive, Wrench, Layers } from 'lucide-react';
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
import { ImportDeskPanel } from '@/components/import/ImportDeskPanel';
import { RestoreDtuExport } from '@/components/import/RestoreDtuExport';
import { ImportParityWorkbench } from '@/components/import/ImportParityWorkbench';
import { ImportToolingGallery } from '@/components/import/ImportToolingGallery';

type ImportView = 'desk' | 'restore' | 'parity' | 'tools';

const VIEWS: { id: ImportView; label: string; keys: string; hint: string; icon: typeof Upload }[] = [
  { id: 'desk', label: 'Import', keys: '1', hint: 'Drop · validate · jobs', icon: Upload },
  { id: 'restore', label: 'Restore', keys: '2', hint: 'import.json · markdown', icon: Archive },
  { id: 'parity', label: 'Workbench', keys: '3', hint: 'Flatfile / Airbyte shape', icon: Layers },
  { id: 'tools', label: 'Tooling', keys: '4', hint: 'External ETL reference', icon: Wrench },
];

function RestorePanel() {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
      <RestoreDtuExport />
    </section>
  );
}

function ParityPanel() {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
      <ImportParityWorkbench />
    </section>
  );
}

function ToolsPanel() {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
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

  return (
    <LensShell lensId="import" asMain={false}>
      <FirstRunTour lensId="import" />
      <DepthBadge lensId="import" size="sm" className="ml-2" />
      <div data-lens-theme="import" className={ds.pageContainer}>
        <header className={ds.sectionHeader}>
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-lg border border-[var(--lens-accent)]/40 bg-[var(--lens-gradient)]">
              <Upload className="w-6 h-6" style={{ color: 'var(--lens-accent)' }} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className={ds.heading1}>Import</h1>
                <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
                <DTUExportButton domain="import" data={realtimeData || {}} compact />
                {realtimeAlerts.length > 0 && (
                  <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
                    {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
              <p className={ds.textMuted}>
                Airbyte / Stitch desk — drop any file, validate, restore DTUs.
              </p>
            </div>
          </div>
        </header>

        <nav
          className="flex items-center gap-1 border-b border-lattice-border overflow-x-auto"
          aria-label="Import views"
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

        <main className="min-w-0 pt-4">
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

        <CrossLensRecentsPanel lensId="import" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
      </div>
    </LensShell>
  );
}
