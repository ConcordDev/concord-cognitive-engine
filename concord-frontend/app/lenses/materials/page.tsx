'use client';

/**
 * Materials — one MatWeb/Granta-shaped selection desk.
 *
 * Single active union: catalog modes + tool panels. Form sprawl extracted
 * into MaterialsLibraryPanel. Existing toolkit panels preserved.
 */

import { useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { MpSearch } from '@/components/materials/MpSearch';
import { PeriodicTable } from '@/components/materials/PeriodicTable';
import { CorrosionThermalPanel } from '@/components/materials/CorrosionThermalPanel';
import { MaterialShortlist } from '@/components/materials/MaterialShortlist';
import { MaterialsToolkit } from '@/components/materials/MaterialsToolkit';
import { CrystalViewer } from '@/components/materials/CrystalViewer';
import {
  MaterialsLibraryPanel,
  type MaterialsCatalogMode,
} from '@/components/materials/MaterialsLibraryPanel';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { Box, Atom, Search, Thermometer, ListChecks, Wrench, Gem, Database } from 'lucide-react';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';

type MaterialsView =
  | MaterialsCatalogMode
  | 'periodic'
  | 'mp'
  | 'corrosion'
  | 'shortlist'
  | 'toolkit'
  | 'crystal';

const CATALOG: MaterialsCatalogMode[] = ['overview', 'library', 'tests', 'comparisons', 'suppliers', 'composites', 'standards'];

const VIEWS: { id: MaterialsView; label: string; keys: string; icon: typeof Box }[] = [
  { id: 'overview', label: 'Overview', keys: '0', icon: Database },
  { id: 'library', label: 'Library', keys: '1', icon: Box },
  { id: 'tests', label: 'Tests', keys: '2', icon: Box },
  { id: 'comparisons', label: 'Compare', keys: '3', icon: Box },
  { id: 'suppliers', label: 'Suppliers', keys: '4', icon: Box },
  { id: 'composites', label: 'Composites', keys: '5', icon: Box },
  { id: 'standards', label: 'Standards', keys: '6', icon: Box },
  { id: 'periodic', label: 'Periodic', keys: 'p', icon: Atom },
  { id: 'mp', label: 'MP search', keys: 'm', icon: Search },
  { id: 'corrosion', label: 'Corrosion', keys: 'c', icon: Thermometer },
  { id: 'shortlist', label: 'Shortlist', keys: 's', icon: ListChecks },
  { id: 'toolkit', label: 'Toolkit', keys: 't', icon: Wrench },
  { id: 'crystal', label: 'Crystal', keys: 'x', icon: Gem },
];

function ToolPane({ active }: { active: MaterialsView }) {
  if (active === 'periodic') return <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4"><PeriodicTable /></section>;
  if (active === 'mp') return <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4"><MpSearch /></section>;
  if (active === 'corrosion') return <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4"><CorrosionThermalPanel /></section>;
  if (active === 'shortlist') return <section><MaterialShortlist /></section>;
  if (active === 'toolkit') return <section><MaterialsToolkit /></section>;
  if (active === 'crystal') return <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4"><CrystalViewer /></section>;
  return null;
}

export default function MaterialsLensPage() {
  useLensNav('materials');
  const reduceMotion = useReducedMotion();
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('materials');
  const [active, setActive] = useState<MaterialsView>('library');

  useLensCommand(
    VIEWS.map((v) => ({
      id: `mat-${v.id}`,
      keys: v.keys,
      description: v.label,
      category: 'navigation' as const,
      action: () => setActive(v.id),
    })),
    { lensId: 'materials' },
  );

  const isCatalog = (CATALOG as string[]).includes(active);

  return (
    <LensShell lensId="materials" asMain={false}>
      <FirstRunTour lensId="materials" />
      <DepthBadge lensId="materials" size="sm" className="ml-2" />
      <div data-lens-theme="materials" className="space-y-6 p-6">
        <a href="#materials-main" className="sr-only focus:not-sr-only focus:ring-2 focus:ring-amber-500 focus:outline-none">Skip to materials content</a>
        <header className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-zinc-400 to-slate-600 flex items-center justify-center"><Box className="w-5 h-5 text-white" /></div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className={ds.heading1}>Materials Science</h1>
                <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} />
              </div>
              <p className={ds.textMuted}>MatWeb density — library, tests, MP search, corrosion, crystal.</p>
            </div>
          </div>
          <DTUExportButton domain="materials" data={{}} compact />
        </header>
        <RealtimeDataPanel domain="materials" data={realtimeData} isLive={isLive} lastUpdated={lastUpdated} insights={insights} compact />

        <nav className="flex items-center gap-1 border-b border-lattice-border overflow-x-auto pb-1" aria-label="Materials views">
          {VIEWS.map((v) => {
            const Icon = v.icon;
            const on = active === v.id;
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => setActive(v.id)}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md whitespace-nowrap transition-colors',
                  on ? 'bg-zinc-300/20 text-zinc-200' : 'text-gray-400 hover:text-white hover:bg-lattice-elevated',
                )}
              >
                <Icon className="w-3.5 h-3.5" />
                {v.label}
              </button>
            );
          })}
        </nav>

        <main id="materials-main">
          <AnimatePresence mode="wait">
            <motion.div
              key={active}
              initial={reduceMotion ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduceMotion ? undefined : { opacity: 0 }}
              transition={{ duration: reduceMotion ? 0 : 0.16 }}
            >
              {isCatalog ? (
                <MaterialsLibraryPanel
                  mode={active as MaterialsCatalogMode}
                  onModeChange={(m) => setActive(m)}
                />
              ) : (
                <ToolPane active={active} />
              )}
            </motion.div>
          </AnimatePresence>
        </main>

        <CrossLensRecentsPanel lensId="materials" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
      </div>
    </LensShell>
  );
}
