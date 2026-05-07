'use client';

import { useState, useMemo, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { motion, AnimatePresence } from 'framer-motion';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { UniversalActions } from '@/components/lens/UniversalActions';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';
import {
  Waves,
  Plus,
  Search,
  Trash2,
  BarChart3,
  Layers,
  ChevronDown,
  Anchor,
  Ship,
  Fish,
  Droplets,
  Eye,
  Map,
  Zap,
} from 'lucide-react';

const MapView = dynamic(() => import('@/components/common/MapView'), { ssr: false });
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeedPanel } from '@/components/feeds/LensFeedPanel';

type ModeTab =
  | 'Dashboard'
  | 'Vessels'
  | 'Research'
  | 'Marine'
  | 'Ports'
  | 'Weather'
  | 'Conservation'
  | 'Map';

interface VesselData {
  name: string;
  type: 'cargo' | 'tanker' | 'research' | 'fishing' | 'military' | 'passenger' | 'submarine';
  status: 'at_sea' | 'docked' | 'maintenance' | 'anchored';
  flag: string;
  position: string;
  heading: number;
  speed: number;
  destination: string;
  crew: number;
  cargo: string;
  imo: string;
  lat?: number;
  lng?: number;
}

interface ResearchData {
  expedition: string;
  status: 'planning' | 'active' | 'completed' | 'published';
  depth: number;
  region: string;
  objective: string;
  findings: string;
  specimens: number;
  chief: string;
}

interface MarineData {
  species: string;
  conservationStatus: 'LC' | 'NT' | 'VU' | 'EN' | 'CR' | 'EW' | 'EX';
  population: string;
  habitat: string;
  threats: string[];
  protectedArea: string;
  lastSurvey: string;
}

type ArtifactDataUnion = VesselData | ResearchData | MarineData | Record<string, unknown>;

const MODE_TABS: { key: ModeTab; label: string; icon: typeof Waves }[] = [
  { key: 'Dashboard', label: 'Dashboard', icon: BarChart3 },
  { key: 'Vessels', label: 'Vessels', icon: Ship },
  { key: 'Research', label: 'Research', icon: Eye },
  { key: 'Marine', label: 'Marine Life', icon: Fish },
  { key: 'Ports', label: 'Ports', icon: Anchor },
  { key: 'Weather', label: 'Sea Weather', icon: Droplets },
  { key: 'Conservation', label: 'Conservation', icon: Waves },
  { key: 'Map', label: 'Map', icon: Map },
];

function getTypeForTab(tab: ModeTab): string {
  const map: Record<ModeTab, string> = {
    Dashboard: 'Vessel',
    Vessels: 'Vessel',
    Research: 'Research',
    Marine: 'Marine',
    Ports: 'Port',
    Weather: 'SeaWeather',
    Conservation: 'Conservation',
    Map: 'Vessel',
  };
  return map[tab];
}

const STATUS_COLORS: Record<string, string> = {
  at_sea: 'text-cyan-400 bg-blue-400/10',
  docked: 'text-green-400 bg-green-400/10',
  maintenance: 'text-orange-400 bg-orange-400/10',
  anchored: 'text-yellow-400 bg-yellow-400/10',
  planning: 'text-blue-400 bg-blue-400/10',
  active: 'text-green-400 bg-green-400/10',
  completed: 'text-gray-400 bg-gray-400/10',
  published: 'text-purple-400 bg-purple-400/10',
  LC: 'text-green-400 bg-green-400/10',
  NT: 'text-yellow-400 bg-yellow-400/10',
  VU: 'text-orange-400 bg-orange-400/10',
  EN: 'text-red-400 bg-red-400/10',
  CR: 'text-red-500 bg-red-500/10',
  EW: 'text-gray-400 bg-gray-400/10',
  EX: 'text-gray-500 bg-gray-500/10',
};

export default function OceanLensPage() {
  useLensNav('ocean');
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('ocean');

  const [activeMode, setActiveMode] = useState<ModeTab>('Dashboard');
  const [searchQuery, setSearchQuery] = useState('');
  const [showFeatures, setShowFeatures] = useState(true);

  const currentType = getTypeForTab(activeMode);
  const { items, isLoading, isError, error, refetch, create, remove } =
    useLensData<ArtifactDataUnion>('ocean', currentType, { search: searchQuery || undefined });

  const { items: vessels } = useLensData<VesselData>('ocean', 'Vessel', { seed: [] });
  const { items: research } = useLensData<ResearchData>('ocean', 'Research', { seed: [] });
  const { items: marine } = useLensData<MarineData>('ocean', 'Marine', { seed: [] });

  const runAction = useRunArtifact('ocean');

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
      atSea: vessels.filter((v) => (v.data as VesselData).status === 'at_sea').length,
      totalVessels: vessels.length,
      activeResearch: research.filter((r) => (r.data as ResearchData).status === 'active').length,
      endangeredSpecies: marine.filter((m) =>
        ['EN', 'CR'].includes((m.data as MarineData).conservationStatus)
      ).length,
    }),
    [vessels, research, marine]
  );

  if (isLoading) {
    return (
      <div data-lens-theme="ocean" className="flex items-center justify-center h-full p-8">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-gray-400">Loading ocean systems...</p>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <ErrorState error={error?.message} onRetry={refetch} />
      </div>
    );
  }

  return (
    <div data-lens-theme="ocean" className={cn(ds.pageContainer, 'space-y-4')}>
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-cyan-500/20 flex items-center justify-center">
            <Waves className="w-5 h-5 text-cyan-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">Ocean Operations</h1>
            <p className="text-sm text-gray-400">
              Maritime vessels, research, marine conservation & ports
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {runAction.isPending && (
            <span className="text-xs text-neon-cyan animate-pulse">AI processing...</span>
          )}
          <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
          <DTUExportButton domain="ocean" data={realtimeData || {}} compact />
        </div>
      </header>

      <div className="flex gap-1 bg-zinc-900 rounded-lg p-1 flex-wrap">
        {MODE_TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setActiveMode(key)}
            className={cn(
              'flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium whitespace-nowrap transition-colors',
              activeMode === key ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-zinc-300'
            )}
          >
            <Icon className="w-4 h-4" /> {label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={`Search ${currentType.toLowerCase()}s...`}
            className="w-full pl-9 pr-3 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-sm text-white placeholder-gray-500"
          />
        </div>
        <button
          onClick={() => create({ title: `New ${currentType}`, data: {} })}
          className="flex items-center gap-2 px-3 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-sm"
        >
          <Plus className="w-4 h-4" /> New {currentType}
        </button>
      </div>

      {activeMode === 'Dashboard' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              {
                label: 'Vessels at Sea',
                value: stats.atSea,
                total: stats.totalVessels,
                color: 'cyan',
                icon: Ship,
              },
              {
                label: 'Active Research',
                value: stats.activeResearch,
                total: research.length,
                color: 'blue',
                icon: Eye,
              },
              {
                label: 'Endangered Species',
                value: stats.endangeredSpecies,
                total: marine.length,
                color: 'red',
                icon: Fish,
              },
              {
                label: 'Specimens Collected',
                value: research.reduce((s, r) => s + ((r.data as ResearchData).specimens || 0), 0),
                total: research.length,
                color: 'purple',
                icon: Anchor,
              },
            ].map((s, i) => (
              <motion.div
                key={s.label}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.1 }}
                className="p-3 bg-zinc-900 rounded-lg border border-zinc-800"
              >
                <s.icon className={`w-4 h-4 text-${s.color}-400 mb-1`} />
                <p className={`text-2xl font-bold text-${s.color}-400`}>{s.value}</p>
                <p className="text-xs text-gray-400">{s.label}</p>
                <p className="text-xs text-gray-600">of {s.total} total</p>
              </motion.div>
            ))}
          </div>

          {/* Depth Zone Visualization */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="p-4 bg-zinc-900 rounded-lg border border-zinc-800"
          >
            <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
              <Waves className="w-4 h-4 text-cyan-400" /> Ocean Depth Zones
            </h3>
            <div className="space-y-1">
              {[
                {
                  zone: 'Epipelagic (Sunlight)',
                  depth: '0 - 200m',
                  color: 'from-cyan-400/30 to-cyan-500/20',
                  border: 'border-cyan-500/30',
                  species: Math.floor(marine.length * 0.5) || 12,
                },
                {
                  zone: 'Mesopelagic (Twilight)',
                  depth: '200 - 1,000m',
                  color: 'from-blue-500/30 to-blue-600/20',
                  border: 'border-blue-500/30',
                  species: Math.floor(marine.length * 0.25) || 8,
                },
                {
                  zone: 'Bathypelagic (Midnight)',
                  depth: '1,000 - 4,000m',
                  color: 'from-indigo-600/30 to-indigo-700/20',
                  border: 'border-indigo-500/30',
                  species: Math.floor(marine.length * 0.15) || 4,
                },
                {
                  zone: 'Abyssopelagic (Abyss)',
                  depth: '4,000 - 6,000m',
                  color: 'from-slate-700/30 to-slate-800/20',
                  border: 'border-slate-600/30',
                  species: Math.floor(marine.length * 0.07) || 2,
                },
                {
                  zone: 'Hadopelagic (Trenches)',
                  depth: '6,000m+',
                  color: 'from-zinc-800/30 to-zinc-900/20',
                  border: 'border-zinc-700/30',
                  species: Math.floor(marine.length * 0.03) || 1,
                },
              ].map((zone, i) => (
                <motion.div
                  key={zone.zone}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.5 + i * 0.1 }}
                  className={cn(
                    'flex items-center justify-between p-3 rounded-lg bg-gradient-to-r border',
                    zone.color,
                    zone.border
                  )}
                  style={{ paddingLeft: `${12 + i * 8}px` }}
                >
                  <div>
                    <p className="text-sm font-medium text-white">{zone.zone}</p>
                    <p className="text-xs text-gray-400">{zone.depth}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Fish className="w-3 h-3 text-gray-400" />
                    <span className="text-xs text-gray-300">{zone.species} species</span>
                  </div>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </div>
      )}

      <AnimatePresence mode="popLayout">
        <div className="space-y-2">
          {items.map((item, i) => (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ delay: i * 0.05 }}
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
                  {!!(item.data as Record<string, unknown>).conservationStatus && (
                    <span
                      className={cn(
                        'text-xs px-2 py-0.5 rounded-full',
                        STATUS_COLORS[
                          String((item.data as Record<string, unknown>).conservationStatus)
                        ] || 'text-gray-400 bg-gray-400/10'
                      )}
                    >
                      {String((item.data as Record<string, unknown>).conservationStatus)}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleAction('analyze', item.id)}
                    className="p-1.5 hover:bg-zinc-800 rounded text-gray-500 hover:text-neon-cyan"
                  >
                    <Zap className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => remove(item.id)}
                    className="p-1.5 hover:bg-zinc-800 rounded text-gray-500 hover:text-red-400"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              {!!(item.data as Record<string, unknown>).depth && (
                <p className="text-xs text-cyan-400/70 mt-1 flex items-center gap-1">
                  <Anchor className="w-3 h-3" /> Depth:{' '}
                  {String((item.data as Record<string, unknown>).depth)}m
                </p>
              )}
              {!!(item.data as Record<string, unknown>).habitat && (
                <p className="text-xs text-gray-500 mt-1">
                  {String((item.data as Record<string, unknown>).habitat)}
                </p>
              )}
            </motion.div>
          ))}
          {items.length === 0 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-center py-12 text-gray-500"
            >
              <Waves className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p>No {currentType.toLowerCase()}s found</p>
            </motion.div>
          )}
        </div>
      </AnimatePresence>

      {activeMode === 'Map' && (
        <div className="p-4 bg-zinc-900 rounded-lg border border-zinc-800">
          <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
            <Map className="w-4 h-4 text-cyan-400" /> Marine Areas
          </h3>
          <MapView
            markers={vessels
              .filter((v) => (v.data as VesselData).lat && (v.data as VesselData).lng)
              .map((v) => {
                const d = v.data as VesselData;
                return {
                  lat: d.lat!,
                  lng: d.lng!,
                  label: v.title || d.name,
                  popup: `${d.type} - ${d.status} (${d.destination || ''})`,
                };
              })}
            className="h-[500px]"
            center={[0, -30]}
            zoom={3}
          />
        </div>
      )}

      <UniversalActions domain="ocean" artifactId={items[0]?.id} />
      <RealtimeDataPanel data={insights} />

      {/* Live Web Feed */}
      <div className="px-4 mb-2">
        <LensFeedPanel lensId="ocean" />
      </div>

      <div className="border-t border-white/10">
        <button
          onClick={() => setShowFeatures(!showFeatures)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-300 hover:text-white transition-colors bg-white/[0.02] hover:bg-white/[0.04] rounded-lg"
        >
          <span className="flex items-center gap-2">
            <Layers className="w-4 h-4" /> Lens Features
          </span>
          <ChevronDown
            className={cn('w-4 h-4 transition-transform', showFeatures && 'rotate-180')}
          />
        </button>
        {showFeatures && (
          <div className="px-4 pb-4">
            <LensFeaturePanel lensId="ocean" />
          </div>
        )}
      </div>
    </div>
  );
}
