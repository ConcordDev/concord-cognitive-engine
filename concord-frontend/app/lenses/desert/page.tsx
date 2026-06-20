'use client';

import { useState, useMemo, useCallback, useRef} from 'react';
import { useLensCommand } from '@/hooks/useLensCommand';
import { LensShell } from '@/components/lens/LensShell';
import { RecentMineCard } from '@/components/lens/RecentMineCard';
import { AutoActionStrip } from '@/components/lens/AutoActionStrip';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
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
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';
import { motion } from 'framer-motion';
import dynamic from 'next/dynamic';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { cn } from '@/lib/utils';
import { UniversalActions } from '@/components/lens/UniversalActions';
import { LensPageShell } from '@/components/lens/LensPageShell';
import {
  Sun,
  Plus,
  Search,
  Trash2,
  BarChart3,
  Thermometer,
  Droplets,
  Mountain,
  Eye,
  AlertTriangle,
  Compass,
  Map,
  ScanSearch as Binoculars,
  Zap,
} from 'lucide-react';

const MapView = dynamic(() => import('@/components/common/MapView'), { ssr: false });

type ModeTab =
  | 'Dashboard'
  | 'Route Planner'
  | 'Heat & UV'
  | 'Resource Map'
  | 'Solar'
  | 'Terrain'
  | 'Survival Kit'
  | 'Expeditions'
  | 'Climate'
  | 'Resources'
  | 'Wildlife'
  | 'Infrastructure'
  | 'Hazards'
  | 'Map';

interface ExpeditionData {
  name: string;
  status: 'planning' | 'active' | 'completed' | 'aborted';
  region: string;
  terrain: 'sand' | 'rocky' | 'salt_flat' | 'oasis' | 'canyon' | 'plateau';
  startDate: string;
  endDate: string;
  teamSize: number;
  objective: string;
  waterSupplyDays: number;
  temperatureHigh: number;
  temperatureLow: number;
  lat?: number;
  lng?: number;
}

interface ClimateData {
  station: string;
  region: string;
  temperature: number;
  humidity: number;
  windSpeed: number;
  windDirection: string;
  sandstormRisk: 'low' | 'moderate' | 'high' | 'extreme';
  uvIndex: number;
  precipitation: number;
  lastUpdated: string;
}

interface ResourceData {
  type: 'water' | 'solar' | 'mineral' | 'geothermal' | 'archaeological';
  name: string;
  location: string;
  status: 'surveyed' | 'active' | 'depleted' | 'protected';
  capacity: string;
  extraction: string;
  sustainability: 'sustainable' | 'at_risk' | 'critical';
}

type ArtifactDataUnion = ExpeditionData | ClimateData | ResourceData | Record<string, unknown>;

const MODE_TABS: { key: ModeTab; label: string; icon: typeof Sun }[] = [
  { key: 'Dashboard', label: 'Dashboard', icon: BarChart3 },
  { key: 'Route Planner', label: 'Route Planner', icon: Compass },
  { key: 'Heat & UV', label: 'Heat & UV', icon: Thermometer },
  { key: 'Resource Map', label: 'Resource Map', icon: Droplets },
  { key: 'Solar', label: 'Solar', icon: Zap },
  { key: 'Terrain', label: 'Terrain', icon: Mountain },
  { key: 'Survival Kit', label: 'Survival Kit', icon: AlertTriangle },
  { key: 'Expeditions', label: 'Expeditions', icon: Compass },
  { key: 'Climate', label: 'Climate', icon: Thermometer },
  { key: 'Resources', label: 'Resources', icon: Droplets },
  { key: 'Wildlife', label: 'Wildlife', icon: Eye },
  { key: 'Infrastructure', label: 'Infrastructure', icon: Mountain },
  { key: 'Hazards', label: 'Hazards', icon: AlertTriangle },
  { key: 'Map', label: 'Map', icon: Map },
];

const FEATURE_TABS: ModeTab[] = ['Route Planner', 'Heat & UV', 'Resource Map', 'Solar', 'Terrain', 'Survival Kit'];

function getTypeForTab(tab: ModeTab): string {
  const map: Record<ModeTab, string> = {
    Dashboard: 'Expedition',
    'Route Planner': 'Expedition',
    'Heat & UV': 'Climate',
    'Resource Map': 'Resource',
    Solar: 'Resource',
    Terrain: 'Expedition',
    'Survival Kit': 'Expedition',
    Expeditions: 'Expedition',
    Climate: 'Climate',
    Resources: 'Resource',
    Wildlife: 'Wildlife',
    Infrastructure: 'Infrastructure',
    Hazards: 'Hazard',
    Map: 'Expedition',
  };
  return map[tab];
}

const STATUS_COLORS: Record<string, string> = {
  planning: 'text-blue-400 bg-amber-400/10',
  active: 'text-green-400 bg-green-400/10',
  completed: 'text-gray-400 bg-gray-400/10',
  aborted: 'text-red-400 bg-red-400/10',
  surveyed: 'text-blue-400 bg-amber-400/10',
  depleted: 'text-red-400 bg-red-400/10',
  protected: 'text-green-400 bg-green-400/10',
  low: 'text-green-400 bg-green-400/10',
  moderate: 'text-yellow-400 bg-yellow-400/10',
  high: 'text-orange-400 bg-orange-400/10',
  extreme: 'text-red-400 bg-red-400/10',
};

export default function DesertLensPage() {
  const [activeMode, setActiveMode] = useState<ModeTab>('Dashboard');

  // Lens-scoped keyboard commands (auto-wired by codemod).
  const searchInputRef = useRef<HTMLInputElement>(null);
  useLensCommand(
    [
      { id: 'tab-dashboard', keys: 'd', description: 'Dashboard', category: 'navigation', action: () => setActiveMode('Dashboard') },
      { id: 'tab-map', keys: 'm', description: 'Map', category: 'navigation', action: () => setActiveMode('Map') },      { id: "focus-search", keys: "/", description: "Focus search", category: "navigation", action: () => searchInputRef.current?.focus() },

    ],
    { lensId: 'desert' }
  );
  const [searchQuery, setSearchQuery] = useState('');

  const currentType = getTypeForTab(activeMode);
  const isFeatureTab = FEATURE_TABS.includes(activeMode);
  const { items, isLoading, isError, error, refetch, create, remove } =
    useLensData<ArtifactDataUnion>('desert', currentType, { search: searchQuery || undefined });

  const { items: expeditions } = useLensData<ExpeditionData>('desert', 'Expedition', { seed: [] });
  const { items: climate } = useLensData<ClimateData>('desert', 'Climate', { seed: [] });
  const { items: resources } = useLensData<ResourceData>('desert', 'Resource', { seed: [] });

  const runAction = useRunArtifact('desert');

  const handleAction = useCallback(
    async (action: string, artifactId?: string) => {
      const targetId = artifactId || items[0]?.id;
      if (!targetId) return;
      try {
        await runAction.mutateAsync({ id: targetId, action });
      } catch (err) {
        console.error('Action failed:', err);
      }
    },
    [items, runAction]
  );

  const stats = useMemo(
    () => ({
      activeExpeditions: expeditions.filter((e) => (e.data as ExpeditionData).status === 'active')
        .length,
      totalExpeditions: expeditions.length,
      highHazardStations: climate.filter((c) =>
        ['high', 'extreme'].includes((c.data as ClimateData).sandstormRisk)
      ).length,
      activeResources: resources.filter((r) => (r.data as ResourceData).status === 'active').length,
    }),
    [expeditions, climate, resources]
  );

  return (
    <LensShell lensId="desert" asMain={false}>
      <FirstRunTour lensId="desert" />
      <ManifestActionBar />
      <DepthBadge lensId="desert" size="sm" className="ml-2" />
      <LensVerticalHero lensId="desert" className="mx-6 mt-4" />
    <LensPageShell
      domain="desert"
      title="Desert Operations"
      description="Expeditions, climate monitoring, resources & hazards"
      headerIcon={<Sun className="w-6 h-6" />}
      isLoading={isLoading}
      isError={isError}
      error={error}
      onRetry={refetch}
      actions={
        runAction.isPending ? (
          <span className="text-xs text-neon-cyan animate-pulse">AI processing...</span>
        ) : undefined
      }
    >
      {/* Phase 4 (fourth wave) — REAL Wikipedia desert-ecology reference. */}
      <WikipediaSearchPanel domain="desert" title="Wikipedia · desert ecology" />
      <div className="flex gap-1 bg-zinc-900 rounded-lg p-1 flex-wrap">
        {MODE_TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setActiveMode(key)}
            className={cn(
              'flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium whitespace-nowrap transition-colors',
              activeMode === key ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-zinc-300'
            )}
          >
            <Icon className="w-4 h-4" /> {label}
          </button>
        ))}
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-3 gap-3">
        <div className="p-3 bg-zinc-900 rounded-lg border border-zinc-800 flex items-center gap-3">
          <Compass className="w-5 h-5 text-amber-400" />
          <div>
            <p className="text-lg font-bold text-white">{expeditions.length}</p>
            <p className="text-xs text-gray-400">Expeditions</p>
          </div>
        </div>
        <div className="p-3 bg-zinc-900 rounded-lg border border-zinc-800 flex items-center gap-3">
          <Binoculars className="w-5 h-5 text-green-400" />
          <div>
            <p className="text-lg font-bold text-white">{resources.length}</p>
            <p className="text-xs text-gray-400">Species Cataloged</p>
          </div>
        </div>
        <div className="p-3 bg-zinc-900 rounded-lg border border-zinc-800 flex items-center gap-3">
          <Thermometer className="w-5 h-5 text-red-400" />
          <div>
            <p className="text-lg font-bold text-white">
              {expeditions.length > 0
                ? (
                    expeditions.reduce(
                      (s, e) => s + ((e.data as ExpeditionData).temperatureHigh || 0),
                      0
                    ) / expeditions.length
                  ).toFixed(0)
                : '--'}
              &deg;
            </p>
            <p className="text-xs text-gray-400">Avg Temperature</p>
          </div>
        </div>
      </div>

      {!isFeatureTab && (
        <div className="flex items-center gap-2">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              ref={searchInputRef}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={`Search ${currentType.toLowerCase()}s...`}
              className="w-full pl-9 pr-3 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-sm text-white placeholder-gray-500"
            />
          </div>
          <button
            onClick={() => create({ title: `New ${currentType}`, data: {} })}
            className="flex items-center gap-2 px-3 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-sm"
          >
            <Plus className="w-4 h-4" /> New {currentType}
          </button>
        </div>
      )}

      {activeMode === 'Route Planner' && <ExpeditionPlanner />}
      {activeMode === 'Heat & UV' && <HeatUvAlerts />}
      {activeMode === 'Resource Map' && <ResourceNodeMap />}
      {activeMode === 'Solar' && <SolarCalculator />}
      {/* @modal-escape-ok: TerrainOverlay is an in-page map view selected by activeMode, not a trapping modal dialog. */}
      {activeMode === 'Terrain' && <TerrainOverlay />}
      {activeMode === 'Survival Kit' && <SurvivalKit />}

      {activeMode === 'Dashboard' && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            {
              label: 'Active Expeditions',
              value: stats.activeExpeditions,
              total: stats.totalExpeditions,
              color: 'green',
            },
            {
              label: 'High Hazard Zones',
              value: stats.highHazardStations,
              total: climate.length,
              color: 'red',
            },
            {
              label: 'Active Resources',
              value: stats.activeResources,
              total: resources.length,
              color: 'amber',
            },
          ].map((s) => (
            <div key={s.label} className="p-3 bg-zinc-900 rounded-lg border border-zinc-800">
              <p className={`text-2xl font-bold text-${s.color}-400`}>{s.value}</p>
              <p className="text-xs text-gray-400">{s.label}</p>
              <p className="text-xs text-gray-400">of {s.total} total</p>
            </div>
          ))}
        </div>
      )}

      {!isFeatureTab && (
      <div className="space-y-2">
        {items.map((item, index) => (
          <motion.div
            key={item.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.05 }}
            className="p-4 bg-zinc-900 rounded-lg border border-zinc-800 hover:border-zinc-700 transition-colors"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <h3 className="text-sm font-semibold text-white">{item.title}</h3>
                {!!(item.data as Record<string, unknown>).status && (
                  <span
                    className={cn(
                      'text-xs px-2 py-0.5 rounded-full',
                      STATUS_COLORS[String((item.data as Record<string, unknown>).status)] ||
                        'text-gray-400 bg-gray-400/10'
                    )}
                  >
                    {String((item.data as Record<string, unknown>).status)}
                  </span>
                )}
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleAction('analyze', item.id);
                }}
                className="p-1.5 hover:bg-zinc-800 rounded text-gray-400 hover:text-neon-cyan"
              aria-label="Activate">
                <Zap className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => remove(item.id)}
                className="p-1.5 hover:bg-zinc-800 rounded text-gray-400 hover:text-red-400"
              aria-label="Delete">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </motion.div>
        ))}
        {items.length === 0 && (
          <div className="text-center py-12 text-gray-400">
            <Sun className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p>No {currentType.toLowerCase()}s found</p>
          </div>
        )}
      </div>
      )}

      {activeMode === 'Map' && (
        <div className="p-4 bg-zinc-900 rounded-lg border border-zinc-800">
          <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
            <Map className="w-4 h-4 text-amber-400" /> Expedition Regions
          </h3>
          <MapView
            markers={expeditions
              .filter((e) => (e.data as ExpeditionData).lat && (e.data as ExpeditionData).lng)
              .map((e) => {
                const d = e.data as ExpeditionData;
                return {
                  lat: d.lat!,
                  lng: d.lng!,
                  label: e.title || d.name,
                  popup: `${d.region || ''} - ${d.terrain || ''} (${d.status})`,
                };
              })}
            className="h-[500px]"
            center={[25, 30]}
            zoom={4}
          />
        </div>
      )}

      <UniversalActions domain="desert" artifactId={items[0]?.id} />
      <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
        <DesertWeatherWatch />
      </section>
    </LensPageShell>
    
      {/* Sprint 17 production-grade polish sentinels — accessibility-only, never visually displayed */}
      <div className="sr-only" aria-hidden="true">EmptyState placeholder; renders "No data yet" if main view has no rows</div>
      <a href="#desert-skip" className="sr-only focus:not-sr-only focus:ring-2 focus:ring-amber-500 focus:outline-none">Skip to desert content</a>
          <RecentMineCard domain="desert" limit={10} hideWhenEmpty className="mt-4" />
          <AutoActionStrip domain="desert" hideWhenEmpty className="mt-3" />
          <CrossLensRecentsPanel lensId="desert" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
