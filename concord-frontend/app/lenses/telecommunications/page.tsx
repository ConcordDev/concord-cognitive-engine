'use client';

import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { UniversalActions } from '@/components/lens/UniversalActions';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';
import {
  Radio, Plus, Search, Trash2, BarChart3,
  Layers, ChevronDown, MapPin, Users,
  Wifi, Signal, Globe, Server, Cable,
  Eye, AlertTriangle, Activity, Zap, Gauge, Antenna,
} from 'lucide-react';
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';

type ModeTab = 'Dashboard' | 'Networks' | 'Towers' | 'Spectrum' | 'Subscribers' | 'Outages' | 'Fiber';

interface NetworkData {
  name: string;
  type: '5G' | '4G_LTE' | '3G' | 'fiber' | 'satellite' | 'microwave';
  status: 'operational' | 'degraded' | 'maintenance' | 'outage';
  region: string;
  bandwidth: string;
  latency: number;
  uptime: number;
  subscribers: number;
  loadPercent: number;
}

interface TowerData {
  siteId: string;
  type: 'macro' | 'micro' | 'small_cell' | 'das' | 'rooftop';
  status: 'active' | 'maintenance' | 'planned' | 'decommissioned';
  location: string;
  height: number;
  technology: string[];
  antennas: number;
  power: string;
  backhaul: 'fiber' | 'microwave' | 'satellite';
  lastInspection: string;
}

interface SpectrumData {
  band: string;
  frequency: string;
  bandwidth: string;
  license: string;
  type: 'licensed' | 'unlicensed' | 'shared';
  usage: number;
  region: string;
  expiryDate: string;
  technology: string;
}

type ArtifactDataUnion = NetworkData | TowerData | SpectrumData | Record<string, unknown>;

const MODE_TABS: { key: ModeTab; label: string; icon: typeof Radio }[] = [
  { key: 'Dashboard', label: 'Dashboard', icon: BarChart3 },
  { key: 'Networks', label: 'Networks', icon: Globe },
  { key: 'Towers', label: 'Towers', icon: Signal },
  { key: 'Spectrum', label: 'Spectrum', icon: Wifi },
  { key: 'Subscribers', label: 'Subscribers', icon: Users },
  { key: 'Outages', label: 'Outages', icon: AlertTriangle },
  { key: 'Fiber', label: 'Fiber', icon: Cable },
];

function getTypeForTab(tab: ModeTab): string {
  const map: Record<ModeTab, string> = {
    Dashboard: 'Network', Networks: 'Network', Towers: 'Tower',
    Spectrum: 'Spectrum', Subscribers: 'Subscriber', Outages: 'Outage', Fiber: 'Fiber',
  };
  return map[tab];
}

const STATUS_COLORS: Record<string, string> = {
  operational: 'text-green-400 bg-green-400/10', degraded: 'text-yellow-400 bg-yellow-400/10',
  maintenance: 'text-orange-400 bg-orange-400/10', outage: 'text-red-400 bg-red-400/10',
  active: 'text-green-400 bg-green-400/10', planned: 'text-blue-400 bg-blue-400/10',
  decommissioned: 'text-gray-500 bg-gray-500/10',
};

export default function TelecommunicationsLensPage() {
  useLensNav('telecommunications');
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('telecommunications');

  const [activeMode, setActiveMode] = useState<ModeTab>('Dashboard');
  const [searchQuery, setSearchQuery] = useState('');
  const [showFeatures, setShowFeatures] = useState(false);

  const currentType = getTypeForTab(activeMode);
  const { items, isLoading, isError, error, refetch, create, remove } =
    useLensData<ArtifactDataUnion>('telecommunications', currentType, { search: searchQuery || undefined });

  const { items: networks } = useLensData<NetworkData>('telecommunications', 'Network', { seed: [] });
  const { items: towers } = useLensData<TowerData>('telecommunications', 'Tower', { seed: [] });
  const { items: outages } = useLensData<Record<string, unknown>>('telecommunications', 'Outage', { seed: [] });

  const runAction = useRunArtifact('telecommunications');

  const stats = useMemo(() => ({
    opNetworks: networks.filter(n => (n.data as NetworkData).status === 'operational').length,
    totalNetworks: networks.length,
    activeTowers: towers.filter(t => (t.data as TowerData).status === 'active').length,
    totalTowers: towers.length,
    activeOutages: outages.length,
  }), [networks, towers, outages]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-gray-400">Loading telecom systems...</p>
        </div>
      </div>
    );
  }

  if (isError) {
    return <div className="flex items-center justify-center h-full p-8"><ErrorState error={error?.message} onRetry={refetch} /></div>;
  }

  return (
    <div data-lens-theme="telecommunications" className={cn(ds.pageContainer, 'space-y-4')}>
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-violet-500/20 flex items-center justify-center">
            <Radio className="w-5 h-5 text-violet-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">Telecommunications</h1>
            <p className="text-sm text-gray-400">Networks, towers, spectrum management & fiber infrastructure</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
          <DTUExportButton domain="telecommunications" data={realtimeData || {}} compact />
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
            placeholder={`Search ${currentType.toLowerCase()}s...`}
            className="w-full pl-9 pr-3 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-sm text-white placeholder-gray-500" />
        </div>
        <button onClick={() => create({ title: `New ${currentType}`, data: {} })} className="flex items-center gap-2 px-3 py-2 bg-violet-600 hover:bg-violet-500 text-white rounded-lg text-sm">
          <Plus className="w-4 h-4" /> New {currentType}
        </button>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="p-3 bg-zinc-900 rounded-lg border border-zinc-800">
          <div className="flex items-center gap-2 mb-1"><Antenna className="w-4 h-4 text-violet-400" /></div>
          <p className="text-2xl font-bold text-violet-400">{stats.totalNetworks + stats.totalTowers}</p>
          <p className="text-xs text-gray-400">Connections</p>
        </div>
        <div className="p-3 bg-zinc-900 rounded-lg border border-zinc-800">
          <div className="flex items-center gap-2 mb-1"><Gauge className="w-4 h-4 text-cyan-400" /></div>
          <p className="text-2xl font-bold text-cyan-400">{networks.length > 0 ? (networks.reduce((s, n) => s + ((n.data as NetworkData).loadPercent || 0), 0) / networks.length).toFixed(0) : 0}%</p>
          <p className="text-xs text-gray-400">Bandwidth Utilization</p>
        </div>
        <div className="p-3 bg-zinc-900 rounded-lg border border-zinc-800">
          <div className="flex items-center gap-2 mb-1"><Activity className="w-4 h-4 text-green-400" /></div>
          <p className="text-2xl font-bold text-green-400">{networks.length > 0 ? (networks.reduce((s, n) => s + ((n.data as NetworkData).uptime || 0), 0) / networks.length).toFixed(1) : 0}%</p>
          <p className="text-xs text-gray-400">Uptime</p>
        </div>
        <div className="p-3 bg-zinc-900 rounded-lg border border-zinc-800">
          <div className="flex items-center gap-2 mb-1"><AlertTriangle className="w-4 h-4 text-red-400" /></div>
          <p className="text-2xl font-bold text-red-400">{stats.activeOutages}</p>
          <p className="text-xs text-gray-400">Active Outages</p>
        </div>
      </div>

      {activeMode === 'Dashboard' && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'Operational Networks', value: stats.opNetworks, total: stats.totalNetworks, color: 'green' },
            { label: 'Active Towers', value: stats.activeTowers, total: stats.totalTowers, color: 'violet' },
            { label: 'Active Outages', value: stats.activeOutages, total: 0, color: 'red' },
          ].map(s => (
            <div key={s.label} className="p-3 bg-zinc-900 rounded-lg border border-zinc-800">
              <p className={`text-2xl font-bold text-${s.color}-400`}>{s.value}</p>
              <p className="text-xs text-gray-400">{s.label}</p>
              {s.total > 0 && <p className="text-xs text-gray-600">of {s.total} total</p>}
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
            <Radio className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p>No {currentType.toLowerCase()}s found</p>
          </div>
        )}
      </div>

      <UniversalActions domain="telecommunications" artifactId={items[0]?.id} />
      <RealtimeDataPanel data={insights} />

      <div className="border-t border-white/10">
        <button onClick={() => setShowFeatures(!showFeatures)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-400 hover:text-white transition-colors">
          <span className="flex items-center gap-2"><Layers className="w-4 h-4" /> Lens Features</span>
          <ChevronDown className={cn('w-4 h-4 transition-transform', showFeatures && 'rotate-180')} />
        </button>
        {showFeatures && <div className="px-4 pb-4"><LensFeaturePanel lensId="telecommunications" /></div>}
      </div>
    </div>
  );
}
