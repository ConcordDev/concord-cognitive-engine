'use client';

import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import dynamic from 'next/dynamic';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { UniversalActions } from '@/components/lens/UniversalActions';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';
import {
  Sun, Plus, Search, Trash2, BarChart3,
  Layers, ChevronDown, MapPin, Users,
  Thermometer, Wind, Droplets, Mountain,
  Eye, AlertTriangle, Navigation, Compass, Map, Binoculars, Cactus,
} from 'lucide-react';

const MapView = dynamic(() => import('@/components/common/MapView'), { ssr: false });
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';

type ModeTab = 'Dashboard' | 'Expeditions' | 'Climate' | 'Resources' | 'Wildlife' | 'Infrastructure' | 'Hazards' | 'Map';

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
  { key: 'Expeditions', label: 'Expeditions', icon: Compass },
  { key: 'Climate', label: 'Climate', icon: Thermometer },
  { key: 'Resources', label: 'Resources', icon: Droplets },
  { key: 'Wildlife', label: 'Wildlife', icon: Eye },
  { key: 'Infrastructure', label: 'Infrastructure', icon: Mountain },
  { key: 'Hazards', label: 'Hazards', icon: AlertTriangle },
  { key: 'Map', label: 'Map', icon: Map },
];

function getTypeForTab(tab: ModeTab): string {
  const map: Record<ModeTab, string> = {
    Dashboard: 'Expedition', Expeditions: 'Expedition', Climate: 'Climate',
    Resources: 'Resource', Wildlife: 'Wildlife', Infrastructure: 'Infrastructure', Hazards: 'Hazard', Map: 'Expedition',
  };
  return map[tab];
}

const STATUS_COLORS: Record<string, string> = {
  planning: 'text-blue-400 bg-amber-400/10', active: 'text-green-400 bg-green-400/10',
  completed: 'text-gray-400 bg-gray-400/10', aborted: 'text-red-400 bg-red-400/10',
  surveyed: 'text-blue-400 bg-amber-400/10', depleted: 'text-red-400 bg-red-400/10',
  protected: 'text-green-400 bg-green-400/10',
  low: 'text-green-400 bg-green-400/10', moderate: 'text-yellow-400 bg-yellow-400/10',
  high: 'text-orange-400 bg-orange-400/10', extreme: 'text-red-400 bg-red-400/10',
};

export default function DesertLensPage() {
  useLensNav('desert');
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('desert');

  const [activeMode, setActiveMode] = useState<ModeTab>('Dashboard');
  const [searchQuery, setSearchQuery] = useState('');
  const [showFeatures, setShowFeatures] = useState(false);

  const currentType = getTypeForTab(activeMode);
  const { items, isLoading, isError, error, refetch, create, remove } =
    useLensData<ArtifactDataUnion>('desert', currentType, { search: searchQuery || undefined });

  const { items: expeditions } = useLensData<ExpeditionData>('desert', 'Expedition', { seed: [] });
  const { items: climate } = useLensData<ClimateData>('desert', 'Climate', { seed: [] });
  const { items: resources } = useLensData<ResourceData>('desert', 'Resource', { seed: [] });

  const runAction = useRunArtifact('desert');

  const stats = useMemo(() => ({
    activeExpeditions: expeditions.filter(e => (e.data as ExpeditionData).status === 'active').length,
    totalExpeditions: expeditions.length,
    highHazardStations: climate.filter(c => ['high', 'extreme'].includes((c.data as ClimateData).sandstormRisk)).length,
    activeResources: resources.filter(r => (r.data as ResourceData).status === 'active').length,
  }), [expeditions, climate, resources]);

  if (isLoading) {
    return (
      <div data-lens-theme="desert" className="flex items-center justify-center h-full p-8">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-gray-400">Loading desert operations...</p>
        </div>
      </div>
    );
  }

  if (isError) {
    return <div className="flex items-center justify-center h-full p-8"><ErrorState error={error?.message} onRetry={refetch} /></div>;
  }

  return (
    <div data-lens-theme="desert" className={cn(ds.pageContainer, 'space-y-4')}>
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-amber-500/20 flex items-center justify-center">
            <Sun className="w-5 h-5 text-amber-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">Desert Operations</h1>
            <p className="text-sm text-gray-400">Expeditions, climate monitoring, resources & hazards</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
          <DTUExportButton domain="desert" data={realtimeData || {}} compact />
        </div>
      </header>

      <div className="flex gap-1 bg-zinc-900 rounded-lg p-1 overflow-x-auto">
        {MODE_TABS.map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => setActiveMode(key)}
            className={cn('flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium whitespace-nowrap transition-colors',
              activeMode === key ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-zinc-300')}>
            <Icon className="w-4 h-4" /> {label}
          </button>
        ))}
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-3 gap-3">
        <div className="p-3 bg-zinc-900 rounded-lg border border-zinc-800 flex items-center gap-3">
          <Compass className="w-5 h-5 text-amber-400" />
          <div><p className="text-lg font-bold text-white">{expeditions.length}</p><p className="text-xs text-gray-400">Expeditions</p></div>
        </div>
        <div className="p-3 bg-zinc-900 rounded-lg border border-zinc-800 flex items-center gap-3">
          <Binoculars className="w-5 h-5 text-green-400" />
          <div><p className="text-lg font-bold text-white">{resources.length}</p><p className="text-xs text-gray-400">Species Cataloged</p></div>
        </div>
        <div className="p-3 bg-zinc-900 rounded-lg border border-zinc-800 flex items-center gap-3">
          <Thermometer className="w-5 h-5 text-red-400" />
          <div><p className="text-lg font-bold text-white">{expeditions.length > 0 ? (expeditions.reduce((s, e) => s + ((e.data as ExpeditionData).temperatureHigh || 0), 0) / expeditions.length).toFixed(0) : '--'}&deg;</p><p className="text-xs text-gray-400">Avg Temperature</p></div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
            placeholder={`Search ${currentType.toLowerCase()}s...`}
            className="w-full pl-9 pr-3 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-sm text-white placeholder-gray-500" />
        </div>
        <button onClick={() => create({ title: `New ${currentType}`, data: {} })} className="flex items-center gap-2 px-3 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-sm">
          <Plus className="w-4 h-4" /> New {currentType}
        </button>
      </div>

      {activeMode === 'Dashboard' && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'Active Expeditions', value: stats.activeExpeditions, total: stats.totalExpeditions, color: 'green' },
            { label: 'High Hazard Zones', value: stats.highHazardStations, total: climate.length, color: 'red' },
            { label: 'Active Resources', value: stats.activeResources, total: resources.length, color: 'amber' },
          ].map(s => (
            <div key={s.label} className="p-3 bg-zinc-900 rounded-lg border border-zinc-800">
              <p className={`text-2xl font-bold text-${s.color}-400`}>{s.value}</p>
              <p className="text-xs text-gray-400">{s.label}</p>
              <p className="text-xs text-gray-600">of {s.total} total</p>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-2">
        {items.map((item, index) => (
          <motion.div key={item.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.05 }} className="p-4 bg-zinc-900 rounded-lg border border-zinc-800 hover:border-zinc-700 transition-colors">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <h3 className="text-sm font-semibold text-white">{item.title}</h3>
                {!!(item.data as Record<string, unknown>).status && (
                  <span className={cn('text-xs px-2 py-0.5 rounded-full', STATUS_COLORS[String((item.data as Record<string, unknown>).status)] || 'text-gray-400 bg-gray-400/10')}>
                    {String((item.data as Record<string, unknown>).status)}
                  </span>
                )}
              </div>
              <button onClick={() => remove(item.id)} className="p-1.5 hover:bg-zinc-800 rounded text-gray-500 hover:text-red-400">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </motion.div>
        ))}
        {items.length === 0 && (
          <div className="text-center py-12 text-gray-500">
            <Sun className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p>No {currentType.toLowerCase()}s found</p>
          </div>
        )}
      </div>

      {activeMode === 'Map' && (
        <div className="p-4 bg-zinc-900 rounded-lg border border-zinc-800">
          <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2"><Map className="w-4 h-4 text-amber-400" /> Expedition Regions</h3>
          <MapView
            markers={expeditions.filter(e => (e.data as ExpeditionData).lat && (e.data as ExpeditionData).lng).map(e => { const d = e.data as ExpeditionData; return { lat: d.lat!, lng: d.lng!, label: e.title || d.name, popup: `${d.region || ''} - ${d.terrain || ''} (${d.status})` }; })}
            className="h-[500px]"
            center={[25, 30]}
            zoom={4}
          />
        </div>
      )}

      <UniversalActions domain="desert" artifactId={items[0]?.id} />
      <RealtimeDataPanel data={insights} />

      <div className="border-t border-white/10">
        <button onClick={() => setShowFeatures(!showFeatures)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-400 hover:text-white transition-colors">
          <span className="flex items-center gap-2"><Layers className="w-4 h-4" /> Lens Features</span>
          <ChevronDown className={cn('w-4 h-4 transition-transform', showFeatures && 'rotate-180')} />
        </button>
        {showFeatures && <div className="px-4 pb-4"><LensFeaturePanel lensId="desert" /></div>}
      </div>
    </div>
  );
}
