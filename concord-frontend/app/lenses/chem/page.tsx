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
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
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
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
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
      <NorthStarFrame
        lensId="chem"
        crumb="Chemistry"
        title={`Run a reaction${active === 'reactions' && who ? `, ${who}` : ''}`}
        subtitle="Elements, reactions, compounds, workbench, structure lab and safety."
        tabs={VIEWS}
        activeTab={active}
        onTab={(id) => setActive(id as ChemView)}
        actions={
          <>
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            <DTUExportButton domain="chem" data={{}} compact />
          </>
        }
        tabsLabel="Chemistry views"
        cta={{ label: 'Balance a reaction', icon: FlaskConical, onClick: () => setActive('reactions'), title: 'Balance and simulate a reaction (R)' }}
      >
        <div className="mb-5 flex items-start gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
          <p className="text-sm text-amber-200">
            For educational and research modeling only. Do not use simulated results for actual chemical handling. Always follow laboratory safety protocols and consult qualified chemists.
          </p>
        </div>

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

        <div className="mt-6 grid gap-5 xl:grid-cols-2">
          <ArxivPanel domain="chem" title="arXiv · Chemical Physics" />
          <PubChemPanel />
        </div>
        <div className="mt-5 space-y-5">
          <LiveFeed
            articles={adaptToLiveFeedArticles(realtimeData as Record<string, unknown> | null)}
            domain="research"
            isLive={isLive}
            lastUpdated={lastUpdated}
            limit={8}
          />
          <RealtimeDataPanel domain="chem" data={realtimeData} isLive={isLive} lastUpdated={lastUpdated} insights={insights} compact />
          <SubLensQuickNav lensId="chem" />
        </div>
      </NorthStarFrame>
    </LensShell>
  );
}
