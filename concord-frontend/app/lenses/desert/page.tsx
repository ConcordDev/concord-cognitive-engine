'use client';

import { useState } from 'react';
import { useLensCommand } from '@/hooks/useLensCommand';
import { LensShell } from '@/components/lens/LensShell';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { WikipediaSearchPanel } from '@/components/wiki/WikipediaSearchPanel';
import { DesertWeatherWatch } from '@/components/desert/DesertWeatherWatch';
import { ExpeditionPlanner } from '@/components/desert/ExpeditionPlanner';
import { HeatUvAlerts } from '@/components/desert/HeatUvAlerts';
import { ResourceNodeMap } from '@/components/desert/ResourceNodeMap';
import { SolarCalculator } from '@/components/desert/SolarCalculator';
import { TerrainOverlay } from '@/components/desert/TerrainOverlay';
import { SurvivalKit } from '@/components/desert/SurvivalKit';
import { DesertFieldCalcPanel } from '@/components/desert/DesertFieldCalcPanel';
import { WildlifeSightingLog } from '@/components/desert/WildlifeSightingLog';
import { IncidentReportPanel } from '@/components/desert/IncidentReportPanel';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { useLensNav } from '@/hooks/useLensNav';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import {
  Sun,
  Thermometer,
  Droplets,
  Mountain,
  AlertTriangle,
  Compass,
  Calculator,
  CloudSun,
  PawPrint,
  AlertOctagon,
} from 'lucide-react';

type ModeTab = 'Weather' | 'Route' | 'HeatUv' | 'Resources' | 'Wildlife' | 'Incidents' | 'Solar' | 'Terrain' | 'Kit' | 'Calcs';

const MODE_TABS: { key: ModeTab; label: string; icon: typeof Sun }[] = [
  { key: 'Weather', label: 'Live Conditions', icon: CloudSun },
  { key: 'Route', label: 'Route Planner', icon: Compass },
  { key: 'HeatUv', label: 'Heat & UV', icon: Thermometer },
  { key: 'Resources', label: 'Resource Map', icon: Droplets },
  { key: 'Wildlife', label: 'Wildlife', icon: PawPrint },
  { key: 'Incidents', label: 'Incident Reports', icon: AlertOctagon },
  { key: 'Solar', label: 'Solar', icon: Sun },
  { key: 'Terrain', label: 'Terrain', icon: Mountain },
  { key: 'Kit', label: 'Survival Kit', icon: AlertTriangle },
  { key: 'Calcs', label: 'Field Calcs', icon: Calculator },
];

export default function DesertLensPage() {
  useLensNav('desert');
  const { latestData, isLive, lastUpdated, insights } = useRealtimeLens('desert');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [activeMode, setActiveMode] = useState<ModeTab>('Weather');

  // Lens-scoped keyboard commands (auto-wired by codemod).
  useLensCommand(
    [
      { id: 'tab-weather', keys: 'w', description: 'Live Conditions', category: 'navigation', action: () => setActiveMode('Weather') },
      { id: 'tab-route', keys: 'r', description: 'Route Planner', category: 'navigation', action: () => setActiveMode('Route') },
      { id: 'tab-heatuv', keys: 'h', description: 'Heat & UV', category: 'navigation', action: () => setActiveMode('HeatUv') },
      { id: 'plan-route', keys: 'n', description: 'Plan a route', category: 'actions', action: () => setActiveMode('Route') },
    ],
    { lensId: 'desert' }
  );

  return (
    <LensShell lensId="desert" asMain={false}>
      <FirstRunTour lensId="desert" />
      <DepthBadge lensId="desert" size="sm" className="ml-2" />
      <NorthStarFrame
        lensId="desert"
        crumb="Desert Operations"
        title={`Read the desert before you go${who ? `, ${who}` : ''}`}
        subtitle="Expedition planning, heat and UV safety, resources, solar siting and survival prep for arid environments."
        actions={(
          <>
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            <DTUExportButton domain="desert" data={{}} compact />
          </>
        )}
        tabs={MODE_TABS.map((t) => ({ id: t.key, label: t.label, icon: t.icon }))}
        activeTab={activeMode}
        onTab={(id) => setActiveMode(id as ModeTab)}
        tabsLabel="Desert tools"
        cta={{ label: 'Plan a route', icon: Compass, onClick: () => setActiveMode('Route'), title: 'Plan an expedition route (N)' }}
      >
        <div className="space-y-5">
          {/* Real Wikipedia desert-ecology reference. */}
          <WikipediaSearchPanel domain="desert" title="Wikipedia · desert ecology" />

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

          {/* Wildlife — species sighting log + proximity query via desert.sighting* */}
          {activeMode === 'Wildlife' && <WildlifeSightingLog />}

          {/* Incident Reports — dated infrastructure/hazard incidents with a real
              status lifecycle via desert.incident*, distinct from the standing
              hazard node markers in the Resource Map tab. */}
          {activeMode === 'Incidents' && <IncidentReportPanel />}

          {/* Solar — PV array sizing via desert.solarInstall */}
          {activeMode === 'Solar' && <SolarCalculator />}

          {/* Terrain — multi-sample terrain-class survey via desert.terrainOverlay */}
          {/* @modal-escape-ok: TerrainOverlay is an in-page map view selected by activeMode, not a trapping modal dialog. */}
          {activeMode === 'Terrain' && <TerrainOverlay />}

          {/* Survival Kit — per-expedition checklist via desert.kit* */}
          {activeMode === 'Kit' && <SurvivalKit />}

          {/* Field Calcs — one-shot water budget, heat stress, terrain class & solar potential estimators */}
          {activeMode === 'Calcs' && <DesertFieldCalcPanel />}

          <RealtimeDataPanel domain="desert" data={latestData} isLive={isLive} lastUpdated={lastUpdated} insights={insights} compact />
        </div>
      </NorthStarFrame>
    </LensShell>
  );
}
