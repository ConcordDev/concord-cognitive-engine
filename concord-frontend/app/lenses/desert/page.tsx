'use client';

import { useState } from 'react';
import { useLensCommand } from '@/hooks/useLensCommand';
import { LensShell } from '@/components/lens/LensShell';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { LensVerticalHero } from '@/components/lens/LensVerticalHero';
import { WikipediaSearchPanel } from '@/components/wiki/WikipediaSearchPanel';
import { DesertWeatherWatch } from '@/components/desert/DesertWeatherWatch';
import { ExpeditionPlanner } from '@/components/desert/ExpeditionPlanner';
import { HeatUvAlerts } from '@/components/desert/HeatUvAlerts';
import { ResourceNodeMap } from '@/components/desert/ResourceNodeMap';
import { SolarCalculator } from '@/components/desert/SolarCalculator';
import { TerrainOverlay } from '@/components/desert/TerrainOverlay';
import { SurvivalKit } from '@/components/desert/SurvivalKit';
import { DesertFieldCalcPanel } from '@/components/desert/DesertFieldCalcPanel';
import { LensPageShell } from '@/components/lens/LensPageShell';
import { cn } from '@/lib/utils';
import {
  Sun,
  Thermometer,
  Droplets,
  Mountain,
  AlertTriangle,
  Compass,
  Calculator,
  CloudSun,
} from 'lucide-react';

type ModeTab = 'Weather' | 'Route' | 'HeatUv' | 'Resources' | 'Solar' | 'Terrain' | 'Kit' | 'Calcs';

const MODE_TABS: { key: ModeTab; label: string; icon: typeof Sun }[] = [
  { key: 'Weather', label: 'Live Conditions', icon: CloudSun },
  { key: 'Route', label: 'Route Planner', icon: Compass },
  { key: 'HeatUv', label: 'Heat & UV', icon: Thermometer },
  { key: 'Resources', label: 'Resource Map', icon: Droplets },
  { key: 'Solar', label: 'Solar', icon: Sun },
  { key: 'Terrain', label: 'Terrain', icon: Mountain },
  { key: 'Kit', label: 'Survival Kit', icon: AlertTriangle },
  { key: 'Calcs', label: 'Field Calcs', icon: Calculator },
];

export default function DesertLensPage() {
  const [activeMode, setActiveMode] = useState<ModeTab>('Weather');

  // Lens-scoped keyboard commands (auto-wired by codemod).
  useLensCommand(
    [
      { id: 'tab-weather', keys: 'w', description: 'Live Conditions', category: 'navigation', action: () => setActiveMode('Weather') },
      { id: 'tab-route', keys: 'r', description: 'Route Planner', category: 'navigation', action: () => setActiveMode('Route') },
      { id: 'tab-heatuv', keys: 'h', description: 'Heat & UV', category: 'navigation', action: () => setActiveMode('HeatUv') },
    ],
    { lensId: 'desert' }
  );

  return (
    <LensShell lensId="desert" asMain={false}>
      <FirstRunTour lensId="desert" />
      <DepthBadge lensId="desert" size="sm" className="ml-2" />
      <LensVerticalHero lensId="desert" className="mx-6 mt-4" />
      <LensPageShell
        domain="desert"
        title="Desert Operations"
        description="Expedition planning, heat/UV safety, resources, solar siting & survival prep for arid environments"
        headerIcon={<Sun className="w-6 h-6" />}
      >
        {/* Real Wikipedia desert-ecology reference. */}
        <WikipediaSearchPanel domain="desert" title="Wikipedia · desert ecology" />

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

        {/* Live Conditions — real-world Open-Meteo desert weather */}
        {activeMode === 'Weather' && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
            <DesertWeatherWatch />
          </div>
        )}

        {/* Route Planner — waypoint routes with per-leg water/food/time via desert.routePreview/Save/List/Delete */}
        {activeMode === 'Route' && <ExpeditionPlanner />}

        {/* Heat & UV — tracked-location live heat-index/UV alerts via desert.tracked*/}
        {activeMode === 'HeatUv' && <HeatUvAlerts />}

        {/* Resource Map — water/shade/hazard/cache nodes via desert.node* */}
        {activeMode === 'Resources' && <ResourceNodeMap />}

        {/* Solar — PV array sizing via desert.solarInstall */}
        {activeMode === 'Solar' && <SolarCalculator />}

        {/* Terrain — multi-sample terrain-class survey via desert.terrainOverlay */}
        {/* @modal-escape-ok: TerrainOverlay is an in-page map view selected by activeMode, not a trapping modal dialog. */}
        {activeMode === 'Terrain' && <TerrainOverlay />}

        {/* Survival Kit — per-expedition checklist via desert.kit* */}
        {activeMode === 'Kit' && <SurvivalKit />}

        {/* Field Calcs — one-shot water budget, heat stress, terrain class & solar potential estimators */}
        {activeMode === 'Calcs' && <DesertFieldCalcPanel />}
      </LensPageShell>
    </LensShell>
  );
}
