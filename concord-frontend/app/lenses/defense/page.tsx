'use client';

import { useState, useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { UniversalActions } from '@/components/lens/UniversalActions';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';
import {
  Shield, Plus, Search, Trash2,
  BarChart3, AlertTriangle,
  Layers, ChevronDown, MapPin, Users, Radio,
  Target, Crosshair, Lock, Eye, ShieldCheck, Activity, Zap,
} from 'lucide-react';
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type ModeTab = 'Dashboard' | 'Operations' | 'Assets' | 'Personnel' | 'Intel' | 'Logistics' | 'Communications';
type ArtifactType = 'Operation' | 'Asset' | 'Personnel' | 'Intel' | 'Supply' | 'Comms';

interface OperationData {
  codeName: string;
  status: 'planning' | 'active' | 'completed' | 'suspended';
  classification: 'unclassified' | 'confidential' | 'secret' | 'top_secret';
  theater: string;
  commander: string;
  startDate: string;
  endDate: string;
  objective: string;
  personnelCount: number;
  threatLevel: 'low' | 'medium' | 'high' | 'critical';
}

interface AssetData {
  designation: string;
  type: 'vehicle' | 'aircraft' | 'vessel' | 'weapon_system' | 'sensor' | 'comms';
  status: 'operational' | 'maintenance' | 'deployed' | 'decommissioned';
  location: string;
  assignedUnit: string;
  readiness: number;
  lastInspection: string;
  serialNumber: string;
}

interface PersonnelData {
  rank: string;
  name: string;
  unit: string;
  mos: string;
  clearance: string;
  deploymentStatus: 'garrison' | 'deployed' | 'transit' | 'leave';
  fitness: 'fit' | 'limited' | 'unfit';
  specializations: string[];
}

interface IntelData {
  classification: string;
  source: string;
  reliability: 'A' | 'B' | 'C' | 'D' | 'E' | 'F';
  credibility: '1' | '2' | '3' | '4' | '5' | '6';
  region: string;
  threatType: string;
  summary: string;
  actionable: boolean;
  expiresAt: string;
}

type ArtifactDataUnion = OperationData | AssetData | PersonnelData | IntelData | Record<string, unknown>;

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const MODE_TABS: { key: ModeTab; label: string; icon: typeof Shield }[] = [
  { key: 'Dashboard', label: 'Dashboard', icon: BarChart3 },
  { key: 'Operations', label: 'Operations', icon: Target },
  { key: 'Assets', label: 'Assets', icon: Crosshair },
  { key: 'Personnel', label: 'Personnel', icon: Users },
  { key: 'Intel', label: 'Intelligence', icon: Eye },
  { key: 'Logistics', label: 'Logistics', icon: MapPin },
  { key: 'Communications', label: 'Comms', icon: Radio },
];

function getTypeForTab(tab: ModeTab): ArtifactType {
  const map: Record<ModeTab, ArtifactType> = {
    Dashboard: 'Operation', Operations: 'Operation', Assets: 'Asset',
    Personnel: 'Personnel', Intel: 'Intel', Logistics: 'Supply', Communications: 'Comms',
  };
  return map[tab];
}

const STATUS_COLORS: Record<string, string> = {
  planning: 'text-blue-400 bg-blue-400/10', active: 'text-green-400 bg-green-400/10',
  completed: 'text-gray-400 bg-gray-400/10', suspended: 'text-red-400 bg-red-400/10',
  operational: 'text-green-400 bg-green-400/10', maintenance: 'text-orange-400 bg-orange-400/10',
  deployed: 'text-cyan-400 bg-cyan-400/10', decommissioned: 'text-gray-500 bg-gray-500/10',
  garrison: 'text-blue-400 bg-blue-400/10', transit: 'text-yellow-400 bg-yellow-400/10',
  leave: 'text-purple-400 bg-purple-400/10',
};

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function DefenseLensPage() {
  useLensNav('defense');
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('defense');

  const [activeMode, setActiveMode] = useState<ModeTab>('Dashboard');
  const [searchQuery, setSearchQuery] = useState('');
  const [showFeatures, setShowFeatures] = useState(true);
  const [showEditor, setShowEditor] = useState(false);

  const currentType = getTypeForTab(activeMode);

  const { items, isLoading, isError, error, refetch, create, update, remove } =
    useLensData<ArtifactDataUnion>('defense', currentType, {
      search: searchQuery || undefined,
    });

  const { items: operations } = useLensData<OperationData>('defense', 'Operation', { seed: [] });
  const { items: assets } = useLensData<AssetData>('defense', 'Asset', { seed: [] });
  const { items: personnel } = useLensData<PersonnelData>('defense', 'Personnel', { seed: [] });
  const { items: intel } = useLensData<IntelData>('defense', 'Intel', { seed: [] });

  const runAction = useRunArtifact('defense');

  const handleAction = useCallback((artifactId: string) => {
    runAction.mutate({ id: artifactId, action: 'analyze' });
  }, [runAction]);

  const handleCreate = useCallback(() => {
    create({ title: `New ${currentType}`, data: {} as ArtifactDataUnion });
    setShowEditor(false);
  }, [create, currentType]);

  const handleUpdate = useCallback((id: string, data: ArtifactDataUnion) => {
    update(id, { data });
  }, [update]);

  // Dashboard stats
  const stats = useMemo(() => ({
    totalOps: operations.length,
    activeOps: operations.filter(o => (o.data as OperationData).status === 'active').length,
    totalAssets: assets.length,
    readyAssets: assets.filter(a => (a.data as AssetData).status === 'operational').length,
    totalPersonnel: personnel.length,
    deployedPersonnel: personnel.filter(p => (p.data as PersonnelData).deploymentStatus === 'deployed').length,
    activeIntel: intel.filter(i => (i.data as IntelData).actionable).length,
  }), [operations, assets, personnel, intel]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-red-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-gray-400">Loading defense systems...</p>
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
    <div className={cn(ds.pageContainer, 'space-y-4')}>
      {/* Header */}
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-red-500/20 flex items-center justify-center">
            <Shield className="w-5 h-5 text-red-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">Military & Defense</h1>
            <p className="text-sm text-gray-400">Operations, assets, personnel & intelligence management</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
          <DTUExportButton domain="defense" data={realtimeData || {}} compact />
        </div>
      </header>

      {/* Tabs */}
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
      <div className="grid grid-cols-4 gap-3">
        <div className="p-3 bg-zinc-900 rounded-lg border border-zinc-800 flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-red-400" />
          <div><p className="text-lg font-bold text-white">{intel.filter(i => (i.data as IntelData).actionable).length}</p><p className="text-xs text-gray-400">Active Threats</p></div>
        </div>
        <div className="p-3 bg-zinc-900 rounded-lg border border-zinc-800 flex items-center gap-3">
          <ShieldCheck className="w-5 h-5 text-green-400" />
          <div><p className="text-lg font-bold text-white">{operations.filter(o => (o.data as OperationData).status === 'completed').length}</p><p className="text-xs text-gray-400">Blocked / Resolved</p></div>
        </div>
        <div className="p-3 bg-zinc-900 rounded-lg border border-zinc-800 flex items-center gap-3">
          <Activity className="w-5 h-5 text-cyan-400" />
          <div><p className="text-lg font-bold text-white">{assets.length > 0 ? ((stats.readyAssets / assets.length) * 100).toFixed(0) : 0}%</p><p className="text-xs text-gray-400">Security Score</p></div>
        </div>
        <div className="p-3 bg-zinc-900 rounded-lg border border-zinc-800 flex items-center gap-3">
          <Users className="w-5 h-5 text-blue-400" />
          <div><p className="text-lg font-bold text-white">{stats.deployedPersonnel}</p><p className="text-xs text-gray-400">Deployed</p></div>
        </div>
      </div>

      {/* Search */}
      <div className="flex items-center gap-2">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
            placeholder={`Search ${currentType.toLowerCase()}s...`}
            className="w-full pl-9 pr-3 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-sm text-white placeholder-gray-500" />
        </div>
        <button onClick={() => setShowEditor(true)} className="flex items-center gap-2 px-3 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg text-sm">
          <Plus className="w-4 h-4" /> New {currentType}
        </button>
      </div>

      {/* Editor Panel */}
      {showEditor && (
        <div className="p-4 bg-zinc-900 rounded-lg border border-zinc-800 space-y-3">
          <h3 className="text-sm font-semibold text-white">Create {currentType}</h3>
          <p className="text-xs text-gray-400">This will create a new {currentType.toLowerCase()} entry.</p>
          <div className="flex gap-2">
            <button onClick={handleCreate} className="px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white rounded-lg text-sm">Create</button>
            <button onClick={() => setShowEditor(false)} className="px-3 py-1.5 text-gray-400 hover:text-white text-sm">Cancel</button>
          </div>
        </div>
      )}

      {/* Dashboard */}
      {activeMode === 'Dashboard' && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="Active Operations" value={stats.activeOps} total={stats.totalOps} color="green" />
          <StatCard label="Ready Assets" value={stats.readyAssets} total={stats.totalAssets} color="cyan" />
          <StatCard label="Deployed Personnel" value={stats.deployedPersonnel} total={stats.totalPersonnel} color="blue" />
          <StatCard label="Actionable Intel" value={stats.activeIntel} total={intel.length} color="amber" />
        </div>
      )}

      {/* Items List */}
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
                {!!(item.data as Record<string, unknown>).classification && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 flex items-center gap-1">
                    <Lock className="w-3 h-3" />{String((item.data as Record<string, unknown>).classification)}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => handleAction(item.id)} className="p-1.5 hover:bg-zinc-800 rounded text-gray-500 hover:text-cyan-400" title="Run AI analysis">
                  <Zap className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => handleUpdate(item.id, item.data as ArtifactDataUnion)} className="p-1.5 hover:bg-zinc-800 rounded text-gray-500 hover:text-blue-400" title="Update">
                  <Eye className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => remove(item.id)} className="p-1.5 hover:bg-zinc-800 rounded text-gray-500 hover:text-red-400">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            {!!(item.data as Record<string, unknown>).objective && (
              <p className="text-xs text-gray-500 mt-2">{String((item.data as Record<string, unknown>).objective)}</p>
            )}
            {!!(item.data as Record<string, unknown>).summary && (
              <p className="text-xs text-gray-500 mt-2">{String((item.data as Record<string, unknown>).summary)}</p>
            )}
          </motion.div>
        ))}
        {items.length === 0 && (
          <div className="text-center py-12 text-gray-500">
            <Shield className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p>No {currentType.toLowerCase()}s found</p>
            <p className="text-xs mt-1">Create your first {currentType.toLowerCase()} to get started</p>
          </div>
        )}
      </div>

      {/* Universal Actions */}
      <UniversalActions domain="defense" artifactId={items[0]?.id} />

      <RealtimeDataPanel data={insights} />

      {/* Lens Features */}
      <div className="border-t border-white/10">
        <button onClick={() => setShowFeatures(!showFeatures)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-300 hover:text-white transition-colors bg-white/[0.02] hover:bg-white/[0.04] rounded-lg">
          <span className="flex items-center gap-2"><Layers className="w-4 h-4" /> Lens Features</span>
          <ChevronDown className={cn('w-4 h-4 transition-transform', showFeatures && 'rotate-180')} />
        </button>
        {showFeatures && <div className="px-4 pb-4"><LensFeaturePanel lensId="defense" /></div>}
      </div>
    </div>
  );
}

function StatCard({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  return (
    <div data-lens-theme="defense" className="p-3 bg-zinc-900 rounded-lg border border-zinc-800">
      <p className={`text-2xl font-bold text-${color}-400`}>{value}</p>
      <p className="text-xs text-gray-400">{label}</p>
      <p className="text-xs text-gray-600">of {total} total</p>
    </div>
  );
}
