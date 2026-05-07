'use client';

import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import dynamic from 'next/dynamic';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { UniversalActions } from '@/components/lens/UniversalActions';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';
import {
  Siren, Plus, Search, Trash2, BarChart3,
  Layers, ChevronDown, MapPin, Users,
  Flame, Phone, Heart, Truck,
  Eye, AlertTriangle, Clock, Radio, Map,
  Shield, Activity,
} from 'lucide-react';

const MapView = dynamic(() => import('@/components/common/MapView'), { ssr: false });
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';

type ModeTab = 'Dashboard' | 'Calls' | 'Units' | 'Fire' | 'EMS' | 'Dispatch' | 'Resources' | 'Map';

interface CallData {
  callNumber: string;
  type: 'fire' | 'medical' | 'rescue' | 'hazmat' | 'mva' | 'water_rescue' | 'natural_disaster' | 'structure_collapse';
  priority: 'alpha' | 'bravo' | 'charlie' | 'delta' | 'echo';
  status: 'received' | 'dispatched' | 'en_route' | 'on_scene' | 'transporting' | 'resolved' | 'cancelled';
  location: string;
  callerInfo: string;
  receivedAt: string;
  dispatchedAt: string;
  arrivedAt: string;
  resolvedAt: string;
  narrative: string;
  unitsAssigned: string[];
  patients: number;
  lat?: number;
  lng?: number;
}

interface UnitData {
  callSign: string;
  type: 'engine' | 'ladder' | 'rescue' | 'ambulance' | 'hazmat' | 'battalion' | 'helicopter';
  status: 'available' | 'dispatched' | 'en_route' | 'on_scene' | 'out_of_service' | 'returning';
  station: string;
  crew: string[];
  crewCount: number;
  equipment: string[];
  lastMaintenance: string;
  fuelLevel: number;
  mileage: number;
}

interface IncidentData {
  incidentNumber: string;
  type: string;
  severity: 'minor' | 'moderate' | 'major' | 'mass_casualty';
  status: 'active' | 'controlled' | 'resolved' | 'under_investigation';
  commander: string;
  location: string;
  startTime: string;
  endTime: string;
  casualties: number;
  evacuated: number;
  damageEstimate: string;
  agencies: string[];
  narrative: string;
}

type ArtifactDataUnion = CallData | UnitData | IncidentData | Record<string, unknown>;

const MODE_TABS: { key: ModeTab; label: string; icon: typeof Siren }[] = [
  { key: 'Dashboard', label: 'Dashboard', icon: BarChart3 },
  { key: 'Calls', label: 'Calls', icon: Phone },
  { key: 'Units', label: 'Units', icon: Truck },
  { key: 'Fire', label: 'Fire', icon: Flame },
  { key: 'EMS', label: 'EMS', icon: Heart },
  { key: 'Dispatch', label: 'Dispatch', icon: Radio },
  { key: 'Resources', label: 'Resources', icon: MapPin },
  { key: 'Map', label: 'Map', icon: Map },
];

function getTypeForTab(tab: ModeTab): string {
  const map: Record<ModeTab, string> = {
    Dashboard: 'Call', Calls: 'Call', Units: 'Unit',
    Fire: 'FireIncident', EMS: 'EMSCall', Dispatch: 'Dispatch', Resources: 'Resource', Map: 'Call',
  };
  return map[tab];
}

const STATUS_COLORS: Record<string, string> = {
  received: 'text-blue-400 bg-blue-400/10', dispatched: 'text-yellow-400 bg-yellow-400/10',
  en_route: 'text-orange-400 bg-orange-400/10', on_scene: 'text-green-400 bg-green-400/10',
  transporting: 'text-cyan-400 bg-cyan-400/10', resolved: 'text-gray-400 bg-gray-400/10',
  cancelled: 'text-gray-500 bg-gray-500/10',
  available: 'text-green-400 bg-green-400/10', out_of_service: 'text-red-400 bg-red-400/10',
  returning: 'text-blue-400 bg-blue-400/10',
  active: 'text-red-400 bg-red-400/10', controlled: 'text-orange-400 bg-orange-400/10',
  under_investigation: 'text-purple-400 bg-purple-400/10',
  alpha: 'text-green-400 bg-green-400/10', bravo: 'text-blue-400 bg-blue-400/10',
  charlie: 'text-yellow-400 bg-yellow-400/10', delta: 'text-orange-400 bg-orange-400/10',
  echo: 'text-red-400 bg-red-400/10',
};

export default function EmergencyServicesLensPage() {
  useLensNav('emergency-services');
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('emergency-services');

  const [activeMode, setActiveMode] = useState<ModeTab>('Dashboard');
  const [searchQuery, setSearchQuery] = useState('');
  const [showFeatures, setShowFeatures] = useState(false);

  const currentType = getTypeForTab(activeMode);
  const { items, isLoading, isError, error, refetch, create, remove } =
    useLensData<ArtifactDataUnion>('emergency-services', currentType, { search: searchQuery || undefined });

  const { items: calls } = useLensData<CallData>('emergency-services', 'Call', { seed: [] });
  const { items: units } = useLensData<UnitData>('emergency-services', 'Unit', { seed: [] });

  const runAction = useRunArtifact('emergency-services');

  const stats = useMemo(() => ({
    activeCalls: calls.filter(c => ['dispatched', 'en_route', 'on_scene', 'transporting'].includes((c.data as CallData).status)).length,
    totalCalls: calls.length,
    availableUnits: units.filter(u => (u.data as UnitData).status === 'available').length,
    totalUnits: units.length,
    criticalCalls: calls.filter(c => ['delta', 'echo'].includes((c.data as CallData).priority)).length,
  }), [calls, units]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-red-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-gray-400">Loading emergency services...</p>
        </div>
      </div>
    );
  }

  if (isError) {
    return <div className="flex items-center justify-center h-full p-8"><ErrorState error={error?.message} onRetry={refetch} /></div>;
  }

  return (
    <div data-lens-theme="emergency-services" className={cn(ds.pageContainer, 'space-y-4')}>
      <motion.header initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-red-500/20 flex items-center justify-center">
            <Siren className="w-5 h-5 text-red-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">Emergency Services</h1>
            <p className="text-sm text-gray-400">Fire, EMS, dispatch, units & resource management</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
          <DTUExportButton domain="emergency-services" data={realtimeData || {}} compact />
        </div>
      </motion.header>

      {/* Stat Cards Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { icon: Siren, label: 'Active Calls', value: stats.activeCalls, color: 'text-red-400', bg: 'bg-red-400/10' },
          { icon: Truck, label: 'Available Units', value: stats.availableUnits, color: 'text-green-400', bg: 'bg-green-400/10' },
          { icon: AlertTriangle, label: 'Critical (D/E)', value: stats.criticalCalls, color: 'text-orange-400', bg: 'bg-orange-400/10' },
          { icon: Clock, label: 'Avg Response', value: '4.2m', color: 'text-blue-400', bg: 'bg-blue-400/10' },
        ].map((stat, i) => (
          <motion.div key={stat.label} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08, duration: 0.35 }}
            className="p-3 bg-zinc-900 rounded-lg border border-zinc-800 flex items-center gap-3">
            <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center', stat.bg)}>
              <stat.icon className={cn('w-5 h-5', stat.color)} />
            </div>
            <div>
              <p className="text-xl font-bold text-white">{stat.value}</p>
              <p className="text-xs text-gray-400">{stat.label}</p>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Incident Severity Badges */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.35 }} className="flex items-center gap-3 flex-wrap">
        <span className="text-xs text-gray-500 uppercase tracking-wide">Severity:</span>
        {[
          { label: 'Critical', count: calls.filter(c => (c.data as CallData).priority === 'echo').length, color: 'bg-red-500/20 text-red-400 border-red-500/30' },
          { label: 'Major', count: calls.filter(c => (c.data as CallData).priority === 'delta').length, color: 'bg-orange-500/20 text-orange-400 border-orange-500/30' },
          { label: 'Minor', count: calls.filter(c => ['alpha', 'bravo'].includes((c.data as CallData).priority)).length, color: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' },
        ].map(sev => (
          <span key={sev.label} className={cn('text-xs px-3 py-1 rounded-full border font-medium', sev.color)}>
            {sev.label}: {sev.count}
          </span>
        ))}
        <span className="ml-auto text-xs text-gray-500 flex items-center gap-1">
          <Activity className="w-3 h-3" /> {stats.totalUnits} total units
        </span>
      </motion.div>

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
        <button onClick={() => create({ title: `New ${currentType}`, data: {} })} className="flex items-center gap-2 px-3 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg text-sm">
          <Plus className="w-4 h-4" /> New {currentType}
        </button>
      </div>

      {activeMode === 'Dashboard' && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'Active Calls', value: stats.activeCalls, total: stats.totalCalls, color: 'red' },
            { label: 'Available Units', value: stats.availableUnits, total: stats.totalUnits, color: 'green' },
            { label: 'Critical (D/E)', value: stats.criticalCalls, total: stats.totalCalls, color: 'orange' },
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
        <AnimatePresence mode="popLayout">
        {items.map((item, idx) => {
          const d = item.data as Record<string, unknown>;
          const severity = String(d.priority || '');
          const severityBorder = severity === 'echo' ? 'border-l-red-500' : severity === 'delta' ? 'border-l-orange-500' : severity === 'charlie' ? 'border-l-yellow-500' : 'border-l-transparent';
          return (
          <motion.div key={item.id} layout initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, scale: 0.95 }}
            transition={{ delay: idx * 0.04, duration: 0.3 }}
            className={cn("p-4 bg-zinc-900 rounded-lg border border-zinc-800 hover:border-zinc-700 transition-colors border-l-4", severityBorder)}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <h3 className="text-sm font-semibold text-white">{item.title}</h3>
                {Boolean(d.status) && (
                  <span className={cn('text-xs px-2 py-0.5 rounded-full', STATUS_COLORS[String(d.status)] || 'text-gray-400 bg-gray-400/10')}>
                    {String(d.status)}
                  </span>
                )}
                {Boolean(d.priority) && (
                  <span className={cn('text-xs px-2 py-0.5 rounded-full font-mono', STATUS_COLORS[String(d.priority)] || 'text-gray-400 bg-gray-400/10')}>
                    {String(d.priority).toUpperCase()}
                  </span>
                )}
              </div>
              <button onClick={() => remove(item.id)} className="p-1.5 hover:bg-zinc-800 rounded text-gray-500 hover:text-red-400">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
            {Boolean(d.location) && (
              <p className="text-xs text-gray-500 mt-1 flex items-center gap-1">
                <MapPin className="w-3 h-3" /> {String(d.location)}
              </p>
            )}
          </motion.div>
          );
        })}
        </AnimatePresence>
        {items.length === 0 && (
          <div className="text-center py-12 text-gray-500">
            <Siren className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p>No {currentType.toLowerCase()} records found</p>
          </div>
        )}
      </div>

      {activeMode === 'Map' && (
        <div className="p-4 bg-zinc-900 rounded-lg border border-zinc-800">
          <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2"><Map className="w-4 h-4 text-red-400" /> Dispatch Locations</h3>
          <MapView
            markers={calls.filter(c => (c.data as CallData).lat && (c.data as CallData).lng).map(c => { const d = c.data as CallData; return { lat: d.lat!, lng: d.lng!, label: c.title || d.callNumber, popup: `${d.type} - ${d.status} (${d.priority})` }; })}
            className="h-[500px]"
          />
        </div>
      )}

      <UniversalActions domain="emergency-services" artifactId={items[0]?.id} />
      <RealtimeDataPanel data={insights} />

      <div className="border-t border-white/10">
        <button onClick={() => setShowFeatures(!showFeatures)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-400 hover:text-white transition-colors">
          <span className="flex items-center gap-2"><Layers className="w-4 h-4" /> Lens Features</span>
          <ChevronDown className={cn('w-4 h-4 transition-transform', showFeatures && 'rotate-180')} />
        </button>
        {showFeatures && <div className="px-4 pb-4"><LensFeaturePanel lensId="emergency-services" /></div>}
      </div>
    </div>
  );
}
