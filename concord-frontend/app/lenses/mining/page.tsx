'use client';

import { useState } from 'react';
import { useLensCommand } from '@/hooks/useLensCommand';
import { LensShell } from '@/components/lens/LensShell';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { MshaLookup } from '@/components/mining/MshaLookup';
import { MiningActionPanel } from '@/components/mining/MiningActionPanel';
import { MineSiteManager } from '@/components/mining/MineSiteManager';
import { GeologyWorkbench } from '@/components/mining/GeologyWorkbench';
import { MinePlanWorkbench } from '@/components/mining/MinePlanWorkbench';
import { FleetManager } from '@/components/mining/FleetManager';
import { GisPitMap } from '@/components/mining/GisPitMap';
import { EnvironmentalCompliance } from '@/components/mining/EnvironmentalCompliance';
import { PipingProvider } from '@/components/panel-polish';
import { LensPageShell } from '@/components/lens/LensPageShell';
import { cn } from '@/lib/utils';
import {
  Hammer as Pickaxe,
  Mountain,
  Gem,
  HardHat,
  Truck,
  Map,
  Calculator,
  ShieldCheck,
} from 'lucide-react';

type ModeTab = 'Sites' | 'Geology' | 'Plan' | 'Fleet' | 'Map' | 'MSHA' | 'Environmental' | 'Calcs';

const MODE_TABS: { key: ModeTab; label: string; icon: typeof Pickaxe }[] = [
  { key: 'Sites', label: 'Sites & Safety', icon: Mountain },
  { key: 'Geology', label: 'Geology', icon: Gem },
  { key: 'Plan', label: 'Mine Plan', icon: Pickaxe },
  { key: 'Fleet', label: 'Fleet & Schedule', icon: Truck },
  { key: 'Map', label: 'GIS Map', icon: Map },
  { key: 'MSHA', label: 'MSHA Compliance', icon: HardHat },
  { key: 'Environmental', label: 'Environmental', icon: ShieldCheck },
  { key: 'Calcs', label: 'Quick Calcs', icon: Calculator },
];

export default function MiningLensPage() {
  const [activeMode, setActiveMode] = useState<ModeTab>('Sites');

  // Lens-scoped keyboard commands (auto-wired by codemod).
  useLensCommand(
    [
      { id: 'tab-sites', keys: 's', description: 'Sites & Safety', category: 'navigation', action: () => setActiveMode('Sites') },
      { id: 'tab-geology', keys: 'g', description: 'Geology', category: 'navigation', action: () => setActiveMode('Geology') },
      { id: 'tab-map', keys: 'm', description: 'GIS Map', category: 'navigation', action: () => setActiveMode('Map') },
    ],
    { lensId: 'mining' }
  );

  return (
    <LensShell lensId="mining" asMain={false}>
      <FirstRunTour lensId="mining" />
      <DepthBadge lensId="mining" size="sm" className="ml-2" />
      <LensPageShell
        domain="mining"
        title="Mining Operations"
        description="Mine sites, geology, pit planning, fleet & MSHA compliance"
        headerIcon={<Pickaxe className="w-6 h-6" />}
      >
        <div className="space-y-4">
          <div className="flex gap-1 bg-zinc-900 rounded-lg p-1 flex-wrap">
            {MODE_TABS.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                type="button"
                onClick={() => setActiveMode(key)}
                className={cn(
                  'flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium whitespace-nowrap transition-colors focus:outline-none focus:ring-2 focus:ring-amber-500',
                  activeMode === key ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-zinc-300'
                )}
              >
                <Icon className="w-4 h-4" /> {label}
              </button>
            ))}
          </div>

          {/* Sites & Safety — site registry, production, incident log, ops dashboard */}
          {activeMode === 'Sites' && <MineSiteManager />}

          {/* Geology — drill-hole database, 3D block model & grade-tonnage curve */}
          {activeMode === 'Geology' && <GeologyWorkbench />}

          {/* Mine Plan — open-pit shell design & JORC/NI 43-101 reserve reporting */}
          {activeMode === 'Plan' && <MinePlanWorkbench />}

          {/* Fleet — equipment management & production scheduling */}
          {activeMode === 'Fleet' && <FleetManager />}

          {/* GIS Map — geo-referenced sites + drill collars on a slippy map */}
          {activeMode === 'Map' && <GisPitMap />}

          {/* MSHA — real federal mine + violations lookup */}
          {activeMode === 'MSHA' && (
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
              <MshaLookup />
            </div>
          )}

          {/* Environmental — permit/inspection compliance + reclamation status */}
          {activeMode === 'Environmental' && <EnvironmentalCompliance />}

          {/* Quick Calcs — ore grade, blast design, safety metrics, resource estimate */}
          {activeMode === 'Calcs' && (
            <PipingProvider>
              <MiningActionPanel />
            </PipingProvider>
          )}
        </div>
      </LensPageShell>
    </LensShell>
  );
}
