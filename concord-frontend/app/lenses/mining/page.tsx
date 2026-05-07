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
  Hammer as Pickaxe, Plus, Search, Trash2, BarChart3,
  Layers, ChevronDown, MapPin, Users,
  Mountain, Gem, HardHat, Gauge, Truck,
  Eye, AlertTriangle, Shield, Map, Drill, Weight,
} from 'lucide-react';

const MapView = dynamic(() => import('@/components/common/MapView'), { ssr: false });
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';

type ModeTab = 'Dashboard' | 'Sites' | 'Operations' | 'Safety' | 'Geology' | 'Equipment' | 'Environmental' | 'Map';

interface SiteData {
  name: string;
  type: 'open_pit' | 'underground' | 'placer' | 'quarry' | 'exploration';
  status: 'active' | 'development' | 'suspended' | 'reclamation' | 'closed';
  mineral: string;
  location: string;
  reserveEstimate: string;
  grade: string;
  depth: number;
  employees: number;
  productionRate: string;
  startDate: string;
  lat?: number;
  lng?: number;
}

interface SafetyData {
  type: 'incident' | 'inspection' | 'drill' | 'violation' | 'near_miss';
  severity: 'minor' | 'moderate' | 'serious' | 'fatal';
  site: string;
  date: string;
  description: string;
  rootCause: string;
  correctiveAction: string;
  status: 'open' | 'investigating' | 'resolved' | 'closed';
  injuries: number;
}

interface GeologyData {
  sampleId: string;
  site: string;
  rockType: string;
  mineral: string;
  grade: string;
  depth: number;
  assayDate: string;
  method: string;
  coordinates: string;
  notes: string;
}

type ArtifactDataUnion = SiteData | SafetyData | GeologyData | Record<string, unknown>;

const MODE_TABS: { key: ModeTab; label: string; icon: typeof Pickaxe }[] = [
  { key: 'Dashboard', label: 'Dashboard', icon: BarChart3 },
  { key: 'Sites', label: 'Mine Sites', icon: Mountain },
  { key: 'Operations', label: 'Operations', icon: Pickaxe },
  { key: 'Safety', label: 'Safety', icon: HardHat },
  { key: 'Geology', label: 'Geology', icon: Gem },
  { key: 'Equipment', label: 'Equipment', icon: Truck },
  { key: 'Environmental', label: 'Environmental', icon: Eye },
  { key: 'Map', label: 'Map', icon: Map },
];

function getTypeForTab(tab: ModeTab): string {
  const map: Record<ModeTab, string> = {
    Dashboard: 'Site', Sites: 'Site', Operations: 'Operation',
    Safety: 'Safety', Geology: 'Geology', Equipment: 'Equipment', Environmental: 'Environmental', Map: 'Site',
  };
  return map[tab];
}

const STATUS_COLORS: Record<string, string> = {
  active: 'text-green-400 bg-amber-500/10', development: 'text-blue-400 bg-blue-400/10',
  suspended: 'text-yellow-400 bg-yellow-400/10', reclamation: 'text-orange-400 bg-orange-400/10',
  closed: 'text-gray-500 bg-gray-500/10', open: 'text-red-400 bg-red-400/10',
  investigating: 'text-yellow-400 bg-yellow-400/10', resolved: 'text-green-400 bg-amber-500/10',
  minor: 'text-yellow-400 bg-yellow-400/10', moderate: 'text-orange-400 bg-orange-400/10',
  serious: 'text-red-400 bg-red-400/10', fatal: 'text-red-500 bg-red-500/10',
};

export default function MiningLensPage() {
  useLensNav('mining');
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('mining');

  const [activeMode, setActiveMode] = useState<ModeTab>('Dashboard');
  const [searchQuery, setSearchQuery] = useState('');
  const [showFeatures, setShowFeatures] = useState(false);

  const currentType = getTypeForTab(activeMode);
  const { items, isLoading, isError, error, refetch, create, remove } =
    useLensData<ArtifactDataUnion>('mining', currentType, { search: searchQuery || undefined });

  const { items: sites } = useLensData<SiteData>('mining', 'Site', { seed: [] });
  const { items: safety } = useLensData<SafetyData>('mining', 'Safety', { seed: [] });

  const runAction = useRunArtifact('mining');

  const stats = useMemo(() => ({
    activeSites: sites.filter(s => (s.data as SiteData).status === 'active').length,
    totalSites: sites.length,
    openIncidents: safety.filter(s => ['open', 'investigating'].includes((s.data as SafetyData).status)).length,
    totalIncidents: safety.length,
  }), [sites, safety]);

  if (isLoading) {
    return (
      <div data-lens-theme="mining" className="flex items-center justify-center h-full p-8">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-yellow-600 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-gray-400">Loading mining operations...</p>
        </div>
      </div>
    );
  }

  if (isError) {
    return <div className="flex items-center justify-center h-full p-8"><ErrorState error={error?.message} onRetry={refetch} /></div>;
  }

  return (
    <div data-lens-theme="mining" className={cn(ds.pageContainer, 'space-y-4')}>
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-yellow-600/20 flex items-center justify-center">
            <Pickaxe className="w-5 h-5 text-yellow-500" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">Mining Operations</h1>
            <p className="text-sm text-gray-400">Mine sites, safety, geology & environmental compliance</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
          <DTUExportButton domain="mining" data={realtimeData || {}} compact />
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

      <div className="flex items-center gap-2">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
            placeholder={`Search ${currentType.toLowerCase()}...`}
            className="w-full pl-9 pr-3 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-sm text-white placeholder-gray-500" />
        </div>
        <button onClick={() => create({ title: `New ${currentType}`, data: {} })} className="flex items-center gap-2 px-3 py-2 bg-yellow-600 hover:bg-yellow-500 text-white rounded-lg text-sm">
          <Plus className="w-4 h-4" /> New {currentType}
        </button>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="p-3 bg-zinc-900 rounded-lg border border-zinc-800">
          <div className="flex items-center gap-2 mb-1"><Mountain className="w-4 h-4 text-green-400" /></div>
          <p className="text-2xl font-bold text-green-400">{stats.activeSites}</p>
          <p className="text-xs text-gray-400">Active Sites</p>
        </div>
        <div className="p-3 bg-zinc-900 rounded-lg border border-zinc-800">
          <div className="flex items-center gap-2 mb-1"><Gem className="w-4 h-4 text-cyan-400" /></div>
          <p className="text-2xl font-bold text-cyan-400">{[...new Set(sites.map(s => (s.data as SiteData).mineral).filter(Boolean))].length}</p>
          <p className="text-xs text-gray-400">Ore Types</p>
        </div>
        <div className="p-3 bg-zinc-900 rounded-lg border border-zinc-800">
          <div className="flex items-center gap-2 mb-1"><Drill className="w-4 h-4 text-yellow-400" /></div>
          <p className="text-2xl font-bold text-yellow-400">{sites.reduce((s, si) => s + ((si.data as SiteData).employees || 0), 0)}</p>
          <p className="text-xs text-gray-400">Total Employees</p>
        </div>
        <div className="p-3 bg-zinc-900 rounded-lg border border-zinc-800">
          <div className="flex items-center gap-2 mb-1"><HardHat className="w-4 h-4 text-red-400" /></div>
          <p className="text-2xl font-bold text-red-400">{stats.openIncidents}</p>
          <p className="text-xs text-gray-400">Safety Incidents</p>
        </div>
      </div>

      {activeMode === 'Dashboard' && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'Active Sites', value: stats.activeSites, total: stats.totalSites, color: 'green' },
            { label: 'Open Incidents', value: stats.openIncidents, total: stats.totalIncidents, color: 'red' },
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
            <Pickaxe className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p>No {currentType.toLowerCase()} records found</p>
          </div>
        )}
      </div>

      {activeMode === 'Map' && (
        <div className="p-4 bg-zinc-900 rounded-lg border border-zinc-800">
          <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2"><Map className="w-4 h-4 text-yellow-500" /> Mine Sites</h3>
          <MapView
            markers={sites.filter(s => (s.data as SiteData).lat && (s.data as SiteData).lng).map(s => { const d = s.data as SiteData; return { lat: d.lat!, lng: d.lng!, label: s.title || d.name, popup: `${d.mineral || ''} - ${d.type} (${d.status})` }; })}
            className="h-[500px]"
          />
        </div>
      )}

      <UniversalActions domain="mining" artifactId={items[0]?.id} />
      <RealtimeDataPanel data={insights} />

      <div className="border-t border-white/10">
        <button onClick={() => setShowFeatures(!showFeatures)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-400 hover:text-white transition-colors">
          <span className="flex items-center gap-2"><Layers className="w-4 h-4" /> Lens Features</span>
          <ChevronDown className={cn('w-4 h-4 transition-transform', showFeatures && 'rotate-180')} />
        </button>
        {showFeatures && <div className="px-4 pb-4"><LensFeaturePanel lensId="mining" /></div>}
      </div>
    </div>
  );
}
