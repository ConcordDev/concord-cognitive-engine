'use client';

import { useState, useMemo, useCallback } from 'react';
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
  TreePine, Plus, Search, Trash2, BarChart3,
  Layers, ChevronDown,
  Leaf, Flame, Bug, Mountain, Ruler, Map, Sprout, HeartPulse, Zap,
} from 'lucide-react';

const MapView = dynamic(() => import('@/components/common/MapView'), { ssr: false });
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';

type ModeTab = 'Dashboard' | 'Stands' | 'Harvest' | 'Fire' | 'Wildlife' | 'Replanting' | 'Inventory' | 'Map';

interface StandData {
  name: string;
  species: string[];
  age: number;
  area: number;
  density: number;
  status: 'mature' | 'growing' | 'harvested' | 'replanted' | 'protected';
  siteIndex: number;
  volume: number;
  basal: number;
  elevation: number;
  terrain: string;
  lastInventory: string;
  lat?: number;
  lng?: number;
}

interface HarvestData {
  block: string;
  method: 'clearcut' | 'selective' | 'shelterwood' | 'seed_tree' | 'salvage';
  status: 'planned' | 'active' | 'completed' | 'suspended';
  volume: number;
  area: number;
  startDate: string;
  endDate: string;
  crew: string;
  equipment: string[];
  species: string[];
  destination: string;
}

interface FireData {
  name: string;
  status: 'detected' | 'contained' | 'controlled' | 'extinguished' | 'monitoring';
  type: 'wildfire' | 'prescribed' | 'spot';
  cause: string;
  areaAffected: number;
  containment: number;
  risk: 'low' | 'moderate' | 'high' | 'extreme';
  location: string;
  detectedAt: string;
  resources: string[];
}

type ArtifactDataUnion = StandData | HarvestData | FireData | Record<string, unknown>;

const MODE_TABS: { key: ModeTab; label: string; icon: typeof TreePine }[] = [
  { key: 'Dashboard', label: 'Dashboard', icon: BarChart3 },
  { key: 'Stands', label: 'Stands', icon: TreePine },
  { key: 'Harvest', label: 'Harvest', icon: Ruler },
  { key: 'Fire', label: 'Fire Mgmt', icon: Flame },
  { key: 'Wildlife', label: 'Wildlife', icon: Bug },
  { key: 'Replanting', label: 'Replanting', icon: Leaf },
  { key: 'Inventory', label: 'Inventory', icon: Mountain },
  { key: 'Map', label: 'Map', icon: Map },
];

function getTypeForTab(tab: ModeTab): string {
  const map: Record<ModeTab, string> = {
    Dashboard: 'Stand', Stands: 'Stand', Harvest: 'Harvest',
    Fire: 'Fire', Wildlife: 'Wildlife', Replanting: 'Replanting', Inventory: 'Inventory', Map: 'Stand',
  };
  return map[tab];
}

const STATUS_COLORS: Record<string, string> = {
  mature: 'text-green-400 bg-green-400/10', growing: 'text-lime-400 bg-lime-400/10',
  harvested: 'text-yellow-400 bg-yellow-400/10', replanted: 'text-blue-400 bg-blue-400/10',
  protected: 'text-purple-400 bg-purple-400/10', planned: 'text-blue-400 bg-blue-400/10',
  active: 'text-green-400 bg-green-400/10', completed: 'text-gray-400 bg-gray-400/10',
  suspended: 'text-orange-400 bg-orange-400/10',
  detected: 'text-red-500 bg-red-500/10', contained: 'text-orange-400 bg-orange-400/10',
  controlled: 'text-yellow-400 bg-yellow-400/10', extinguished: 'text-gray-400 bg-gray-400/10',
  monitoring: 'text-blue-400 bg-blue-400/10',
  low: 'text-green-400 bg-green-400/10', moderate: 'text-yellow-400 bg-yellow-400/10',
  high: 'text-orange-400 bg-orange-400/10', extreme: 'text-red-400 bg-red-400/10',
};

export default function ForestryLensPage() {
  useLensNav('forestry');
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('forestry');

  const [activeMode, setActiveMode] = useState<ModeTab>('Dashboard');
  const [searchQuery, setSearchQuery] = useState('');
  const [showFeatures, setShowFeatures] = useState(true);

  const currentType = getTypeForTab(activeMode);
  const { items, isLoading, isError, error, refetch, create, remove } =
    useLensData<ArtifactDataUnion>('forestry', currentType, { search: searchQuery || undefined });

  const { items: stands } = useLensData<StandData>('forestry', 'Stand', { seed: [] });
  const { items: fires } = useLensData<FireData>('forestry', 'Fire', { seed: [] });
  const { items: harvests } = useLensData<HarvestData>('forestry', 'Harvest', { seed: [] });

  const runAction = useRunArtifact('forestry');

  const handleAction = useCallback(async (action: string, artifactId?: string) => {
    const targetId = artifactId || items[0]?.id;
    if (!targetId) return;
    try {
      await runAction.mutateAsync({ id: targetId, action });
    } catch (err) {
      console.error('Action failed:', err);
    }
  }, [items, runAction]);

  const stats = useMemo(() => ({
    totalStands: stands.length,
    matureStands: stands.filter(s => (s.data as StandData).status === 'mature').length,
    activeFires: fires.filter(f => ['detected', 'contained'].includes((f.data as FireData).status)).length,
    activeHarvests: harvests.filter(h => (h.data as HarvestData).status === 'active').length,
  }), [stands, fires, harvests]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-green-600 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-gray-400">Loading forestry data...</p>
        </div>
      </div>
    );
  }

  if (isError) {
    return <div className="flex items-center justify-center h-full p-8"><ErrorState error={error?.message} onRetry={refetch} /></div>;
  }

  return (
    <div data-lens-theme="forestry" className={cn(ds.pageContainer, 'space-y-4')}>
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-green-600/20 flex items-center justify-center">
            <TreePine className="w-5 h-5 text-green-500" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">Forestry Management</h1>
            <p className="text-sm text-gray-400">Timber stands, harvest planning, fire management & wildlife</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {runAction.isPending && <span className="text-xs text-neon-cyan animate-pulse">AI processing...</span>}
          <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
          <DTUExportButton domain="forestry" data={realtimeData || {}} compact />
        </div>
      </header>

      <div className="flex gap-1 bg-zinc-900 rounded-lg p-1 flex-wrap">
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
          <TreePine className="w-5 h-5 text-green-500" />
          <div><p className="text-lg font-bold text-white">{stands.length}</p><p className="text-xs text-gray-400">Plot Count</p></div>
        </div>
        <div className="p-3 bg-zinc-900 rounded-lg border border-zinc-800 flex items-center gap-3">
          <Sprout className="w-5 h-5 text-lime-400" />
          <div><p className="text-lg font-bold text-white">{new Set(stands.flatMap(s => (s.data as StandData).species || [])).size}</p><p className="text-xs text-gray-400">Species Count</p></div>
        </div>
        <div className="p-3 bg-zinc-900 rounded-lg border border-zinc-800 flex items-center gap-3">
          <HeartPulse className="w-5 h-5 text-emerald-400" />
          <div><p className="text-lg font-bold text-white">{stands.length > 0 ? ((stats.matureStands / stands.length) * 100).toFixed(0) : 0}%</p><p className="text-xs text-gray-400">Avg Health Score</p></div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
            placeholder={`Search ${currentType.toLowerCase()}s...`}
            className="w-full pl-9 pr-3 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-sm text-white placeholder-gray-500" />
        </div>
        <button onClick={() => create({ title: `New ${currentType}`, data: {} })} className="flex items-center gap-2 px-3 py-2 bg-green-600 hover:bg-green-500 text-white rounded-lg text-sm">
          <Plus className="w-4 h-4" /> New {currentType}
        </button>
      </div>

      {activeMode === 'Dashboard' && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'Mature Stands', value: stats.matureStands, total: stats.totalStands, color: 'green' },
            { label: 'Active Fires', value: stats.activeFires, total: fires.length, color: 'red' },
            { label: 'Active Harvests', value: stats.activeHarvests, total: harvests.length, color: 'yellow' },
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
              <button onClick={e => { e.stopPropagation(); handleAction('analyze', item.id); }} className="p-1.5 hover:bg-zinc-800 rounded text-gray-500 hover:text-neon-cyan">
                <Zap className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => remove(item.id)} className="p-1.5 hover:bg-zinc-800 rounded text-gray-500 hover:text-red-400">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </motion.div>
        ))}
        {items.length === 0 && (
          <div className="text-center py-12 text-gray-500">
            <TreePine className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p>No {currentType.toLowerCase()} records found</p>
          </div>
        )}
      </div>

      {activeMode === 'Map' && (
        <div className="p-4 bg-zinc-900 rounded-lg border border-zinc-800">
          <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2"><Map className="w-4 h-4 text-green-500" /> Forest Areas</h3>
          <MapView
            markers={[
              ...stands.filter(s => (s.data as StandData).lat && (s.data as StandData).lng).map(s => { const d = s.data as StandData; return { lat: d.lat!, lng: d.lng!, label: s.title || d.name, popup: `${d.species?.join(', ') || ''} - ${d.status} (${d.area} acres)` }; }),
              ...fires.filter(f => (f.data as unknown as Record<string, unknown>).lat && (f.data as unknown as Record<string, unknown>).lng).map(f => { const d = f.data as unknown as Record<string, unknown>; return { lat: d.lat as number, lng: d.lng as number, label: f.title || (d.name as string), popup: `Fire - ${d.status}` }; }),
            ]}
            className="h-[500px]"
          />
        </div>
      )}

      <UniversalActions domain="forestry" artifactId={items[0]?.id} />
      <RealtimeDataPanel data={insights} />

      <div className="border-t border-white/10">
        <button onClick={() => setShowFeatures(!showFeatures)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-300 hover:text-white transition-colors bg-white/[0.02] hover:bg-white/[0.04] rounded-lg">
          <span className="flex items-center gap-2"><Layers className="w-4 h-4" /> Lens Features</span>
          <ChevronDown className={cn('w-4 h-4 transition-transform', showFeatures && 'rotate-180')} />
        </button>
        {showFeatures && <div className="px-4 pb-4"><LensFeaturePanel lensId="forestry" /></div>}
      </div>
    </div>
  );
}
