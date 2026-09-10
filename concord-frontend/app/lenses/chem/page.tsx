'use client';

/**
 * Chem — one lab desk.
 * Single view union folds former accordion/FAB booleans (workbench, structure
 * lab, action panel) into tabs. Macros: balanceReaction, molecular-weight,
 * chem compound/reaction artifacts, plus workbench/structure/safety/action panels.
 */

import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Atom, Beaker, FlaskConical, AlertTriangle, Wrench, Boxes, Calculator, ShieldAlert,
} from 'lucide-react';
import { useLensNav } from '@/hooks/useLensNav';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { ArxivPanel } from '@/components/research/ArxivPanel';
import { PubChemPanel } from '@/components/chem/PubChemPanel';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { SubLensQuickNav } from '@/components/lens/SubLensQuickNav';
import LiveFeed, { adaptToLiveFeedArticles } from '@/components/lens/LiveFeed';
import { ElementsPanel } from '@/components/chem/ElementsPanel';
import { ReactionsPanel } from '@/components/chem/ReactionsPanel';
import { CompoundsPanel } from '@/components/chem/CompoundsPanel';
import { ChemWorkbenchPanel } from '@/components/chem/ChemWorkbenchPanel';
import { StructureLabPanel } from '@/components/chem/StructureLabPanel';
import { LabBenchPanel } from '@/components/chem/LabBenchPanel';
import { SafetyDeskPanel } from '@/components/chem/SafetyDeskPanel';
import type { ChemView } from '@/components/chem/types';
import { cn } from '@/lib/utils';

const VIEWS: { id: ChemView; label: string; keys: string; icon: typeof Atom }[] = [
  { id: 'elements', label: 'Elements', keys: 'e', icon: Atom },
  { id: 'reactions', label: 'Reactions', keys: 'r', icon: FlaskConical },
  { id: 'compounds', label: 'Compounds', keys: 'c', icon: Beaker },
  { id: 'workbench', label: 'Workbench', keys: 'w', icon: Wrench },
  { id: 'structure', label: 'Structure', keys: 's', icon: Boxes },
  { id: 'lab', label: 'Lab bench', keys: 'b', icon: Calculator },
  { id: 'safety', label: 'Safety', keys: 'a', icon: ShieldAlert },
];

function ChemPane({ active, go }: { active: ChemView; go: (v: ChemView) => void }) {
  switch (active) {
    case 'elements':
      return <ElementsPanel />;
    case 'reactions':
      return <ReactionsPanel onGotoCompounds={() => go('compounds')} />;
    case 'compounds':
      return <CompoundsPanel onGotoReactions={() => go('reactions')} />;
    case 'workbench':
      return <ChemWorkbenchPanel onClose={() => go('reactions')} />;
    case 'structure':
      return <StructureLabPanel />;
    case 'lab':
      return <LabBenchPanel />;
    case 'safety':
      return <SafetyDeskPanel />;
  }
}

export default function ChemLensPage() {
  useLensNav('chem');
  const [active, setActive] = useState<ChemView>('reactions');
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('chem');

  useLensCommand(
    VIEWS.map((v) => ({
      id: `tab-${v.id}`,
      keys: v.keys,
      description: v.label,
      category: 'navigation' as const,
      action: () => setActive(v.id),
    })),
    { lensId: 'chem' },
  );

  return (
    <LensShell lensId="chem" asMain={false}>
      <FirstRunTour lensId="chem" />
      <DepthBadge lensId="chem" size="sm" className="ml-2" />
      <div data-lens-theme="chem" className="p-6 space-y-6">
        <a href="#chem-main" className="sr-only focus:not-sr-only focus:ring-2 focus:ring-amber-500 focus:outline-none">Skip to chem content</a>

        <ArxivPanel domain="chem" title="arXiv · Chemical Physics" />
        <PubChemPanel />
        <SubLensQuickNav lensId="chem" />

        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg px-4 py-3 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-400 mt-0.5 shrink-0" />
          <p className="text-sm text-amber-200">
            For educational and research modeling only. Do not use simulated results for actual chemical handling. Always follow laboratory safety protocols and consult qualified chemists.
          </p>
        </div>

        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl">⚗️</span>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold">Chem Lens</h1>
                <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} />
              </div>
              <p className="text-sm text-gray-400">Chemical reaction simulation and compound synthesis</p>
            </div>
          </div>
        </header>

        <LiveFeed
          articles={adaptToLiveFeedArticles(realtimeData as Record<string, unknown> | null)}
          domain="research"
          isLive={isLive}
          lastUpdated={lastUpdated}
          limit={8}
        />
        <RealtimeDataPanel domain="chem" data={realtimeData} isLive={isLive} lastUpdated={lastUpdated} insights={insights} compact />
        <DTUExportButton domain="chem" data={{}} compact />

        <nav className="flex gap-1 bg-black/30 border border-white/10 rounded-lg p-1 overflow-x-auto" aria-label="Chem views">
          {VIEWS.map((tab) => {
            const Icon = tab.icon;
            const on = active === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActive(tab.id)}
                className={cn(
                  'flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors flex-1 justify-center whitespace-nowrap',
                  on ? 'bg-teal-500/20 text-teal-400' : 'text-gray-400 hover:text-white',
                )}
              >
                <Icon className="w-4 h-4" /> {tab.label}
                <kbd className="hidden sm:inline text-[10px] opacity-50">{tab.keys}</kbd>
              </button>
            );
          })}
        </nav>

        <main id="chem-main">
          <AnimatePresence mode="wait">
            <motion.div
              key={active}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <ChemPane active={active} go={setActive} />
            </motion.div>
          </AnimatePresence>
        </main>

        <CrossLensRecentsPanel lensId="chem" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
      </div>
    </LensShell>
  );
}
