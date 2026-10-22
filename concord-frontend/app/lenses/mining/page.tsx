'use client';

/**
 * Mining lens: north-star chrome over site registry, geology, mine planning,
 * fleet, GIS, MSHA lookup, environmental compliance and quick calculators.
 * Every tab is a purpose-built workbench over the real `mining` macros.
 */

import { useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { MshaLookup } from '@/components/mining/MshaLookup';
import { MiningActionPanel } from '@/components/mining/MiningActionPanel';
import { MineSiteManager } from '@/components/mining/MineSiteManager';
import { GeologyWorkbench } from '@/components/mining/GeologyWorkbench';
import { MinePlanWorkbench } from '@/components/mining/MinePlanWorkbench';
import { FleetManager } from '@/components/mining/FleetManager';
import { GisPitMap } from '@/components/mining/GisPitMap';
import { EnvironmentalCompliance } from '@/components/mining/EnvironmentalCompliance';
import { PipingProvider } from '@/components/panel-polish';
import { useLensCommand } from '@/hooks/useLensCommand';
import { Hammer as Pickaxe, Mountain, Gem, HardHat, Truck, Map, Calculator, ShieldCheck } from 'lucide-react';

type ModeTab = 'Sites' | 'Geology' | 'Plan' | 'Fleet' | 'Map' | 'MSHA' | 'Environmental' | 'Calcs';

const MODE_TABS: {key: ModeTab; label: string; keys: string; hint: string; icon: typeof Pickaxe }[] = [
  { key: 'Sites', label: 'Sites & Safety', keys: 's', hint: 'Site registry, production, incident log, ops dashboard', icon: Mountain },
  { key: 'Geology', label: 'Geology', keys: 'g', hint: 'Drill-hole database, 3D block model, grade-tonnage curve', icon: Gem },
  { key: 'Plan', label: 'Mine Plan', keys: 'p', hint: 'Open-pit shell design and JORC / NI 43-101 reserve reporting', icon: Pickaxe },
  { key: 'Fleet', label: 'Fleet & Schedule', keys: 'f', hint: 'Equipment management and production scheduling', icon: Truck },
  { key: 'Map', label: 'GIS Map', keys: 'm', hint: 'Geo-referenced sites and drill collars', icon: Map },
  { key: 'MSHA', label: 'MSHA Compliance', keys: 'h', hint: 'Real federal mine and violations lookup', icon: HardHat },
  { key: 'Environmental', label: 'Environmental', keys: 'e', hint: 'Permit / inspection compliance and reclamation status', icon: ShieldCheck },
  { key: 'Calcs', label: 'Quick Calcs', keys: 'c', hint: 'Ore grade, blast design, safety metrics, resource estimate', icon: Calculator },
];

export default function MiningLensPage() {
  const [activeMode, setActiveMode] = useState<ModeTab>('Sites');

  useLensCommand(
    [
      ...MODE_TABS.map((t) => ({
        id: `tab-${t.key}`,
        keys: t.keys,
        description: `${t.label} — ${t.hint}`,
        category: 'navigation' as const,
        action: () => setActiveMode(t.key),
      })),
      { id: 'mining-new-site', keys: 'n', description: 'Add a mine site', category: 'actions' as const, action: () => setActiveMode('Sites') },
    ],
    { lensId: 'mining' },
  );


  return (
    <LensShell lensId="mining" asMain={false}>

      <DepthBadge lensId="mining" size="sm" className="ml-2" />
      <NorthStarFrame
        lensId="mining"
        crumb="Mining Operations"
        subtitle="Mine sites, geology, pit planning, fleet and MSHA compliance."
        tabs={MODE_TABS.map((t) => ({ id: t.key, label: t.label, keys: t.keys, hint: t.hint, icon: t.icon }))}
        activeTab={activeMode}
        onTab={(id) => setActiveMode(id as ModeTab)}
        cta={{ label: 'Add a site', icon: Mountain, onClick: () => setActiveMode('Sites'), title: 'Add a mine site (N)' }}
      >
        {activeMode === 'Sites' && <MineSiteManager />}
        {activeMode === 'Geology' && <GeologyWorkbench />}
        {activeMode === 'Plan' && <MinePlanWorkbench />}
        {activeMode === 'Fleet' && <FleetManager />}
        {activeMode === 'Map' && <GisPitMap />}
        {activeMode === 'MSHA' && (
          <div className="rounded-2xl border border-white/10 bg-[#111] p-4">
            <MshaLookup />
          </div>
        )}
        {activeMode === 'Environmental' && <EnvironmentalCompliance />}
        {activeMode === 'Calcs' && (
          <PipingProvider>
            <MiningActionPanel />
          </PipingProvider>
        )}
      </NorthStarFrame>
    </LensShell>
  );
}
