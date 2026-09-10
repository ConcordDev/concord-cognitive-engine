'use client';

import { useState } from 'react';
import { useLensCommand } from '@/hooks/useLensCommand';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { FireIncidents } from '@/components/forestry/FireIncidents';
import { ForestryActionPanel } from '@/components/forestry/ForestryActionPanel';
import { StandManager } from '@/components/forestry/StandManager';
import { GrowthProjectionPanel } from '@/components/forestry/GrowthProjectionPanel';
import { StandPolygonPanel } from '@/components/forestry/StandPolygonPanel';
import { CruisePanel } from '@/components/forestry/CruisePanel';
import { PestPanel } from '@/components/forestry/PestPanel';
import { ReplantingPanel } from '@/components/forestry/ReplantingPanel';
import { CarbonCreditPanel } from '@/components/forestry/CarbonCreditPanel';
import { GbifPanel } from '@/components/environment/GbifPanel';
import { PipingProvider } from '@/components/panel-polish';
import { cn } from '@/lib/utils';
import { LensPageShell } from '@/components/lens/LensPageShell';
import {
  TreePine,
  Calculator,
  Flame,
  Ruler,
  Bug,
  Coins,
  Map,
} from 'lucide-react';

type ForestryTab = 'stands' | 'calculators' | 'fire' | 'growth' | 'pests' | 'carbon' | 'map';

const TABS: { key: ForestryTab; label: string; icon: typeof TreePine }[] = [
  { key: 'stands', label: 'Stands', icon: TreePine },
  { key: 'calculators', label: 'Calculators', icon: Calculator },
  { key: 'fire', label: 'Fire Watch', icon: Flame },
  { key: 'growth', label: 'Growth & Inventory', icon: Ruler },
  { key: 'pests', label: 'Pests & Replanting', icon: Bug },
  { key: 'carbon', label: 'Carbon Credits', icon: Coins },
  { key: 'map', label: 'Map & Wildlife', icon: Map },
];

export default function ForestryLensPage() {
  const [activeTab, setActiveTab] = useState<ForestryTab>('stands');

  // Lens-scoped keyboard commands (auto-wired by codemod).
  useLensCommand(
    [
      { id: 'tab-stands', keys: 's', description: 'Stands', category: 'navigation', action: () => setActiveTab('stands') },
      { id: 'tab-calculators', keys: 'c', description: 'Calculators', category: 'navigation', action: () => setActiveTab('calculators') },
      { id: 'tab-fire', keys: 'f', description: 'Fire watch', category: 'navigation', action: () => setActiveTab('fire') },
      { id: 'tab-growth', keys: 'g', description: 'Growth & inventory', category: 'navigation', action: () => setActiveTab('growth') },
      { id: 'tab-pests', keys: 'p', description: 'Pests & replanting', category: 'navigation', action: () => setActiveTab('pests') },
      { id: 'tab-map', keys: 'm', description: 'Map & wildlife', category: 'navigation', action: () => setActiveTab('map') },
    ],
    { lensId: 'forestry' }
  );

  return (
    <LensShell lensId="forestry" asMain={false}>
      <FirstRunTour lensId="forestry" />      <DepthBadge lensId="forestry" size="sm" className="ml-2" />
      <LensPageShell
        domain="forestry"
        title="Forestry Management"
        description="Timber stands, harvest planning, fire management, growth & yield, pests, and carbon credits"
        headerIcon={<TreePine className="w-6 h-6" />}
      >
        <div className="space-y-4">
          <div className="flex gap-1 bg-zinc-900 rounded-lg p-1 flex-wrap">
            {TABS.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={cn(
                  'flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium whitespace-nowrap transition-colors',
                  activeTab === key ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-zinc-300'
                )}
              >
                <Icon className="w-4 h-4" /> {label}
              </button>
            ))}
          </div>

          {activeTab === 'stands' && <StandManager />}

          {activeTab === 'calculators' && (
            <PipingProvider>
              <ForestryActionPanel />
            </PipingProvider>
          )}

          {activeTab === 'fire' && (
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
              <FireIncidents />
            </div>
          )}

          {activeTab === 'growth' && (
            <div className="space-y-4">
              <GrowthProjectionPanel />
              <CruisePanel />
            </div>
          )}

          {activeTab === 'pests' && (
            <div className="space-y-4">
              <PestPanel />
              <ReplantingPanel />
            </div>
          )}

          {activeTab === 'carbon' && <CarbonCreditPanel />}

          {activeTab === 'map' && (
            <div className="space-y-4">
              <StandPolygonPanel />
              {/* Real GBIF biodiversity occurrence search. */}
              <GbifPanel domain="forestry" />
            </div>
          )}
        </div>
      </LensPageShell>

      <a href="#forestry-skip" className="sr-only focus:not-sr-only focus:ring-2 focus:ring-amber-500 focus:outline-none">Skip to forestry content</a>      <CrossLensRecentsPanel lensId="forestry" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
