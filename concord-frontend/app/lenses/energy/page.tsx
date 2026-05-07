'use client';

import { useLensNav } from '@/hooks/useLensNav';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Zap, Sun, Wind, Droplets, Flame, Plus, Trash2, Layers, ChevronDown, TrendingUp, BarChart3, Battery, Gauge, AlertTriangle, Loader2 } from 'lucide-react';
import { ErrorState } from '@/components/common/EmptyState';
import { UniversalActions } from '@/components/lens/UniversalActions';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';

type EnergySource = 'solar' | 'wind' | 'hydro' | 'nuclear' | 'natural-gas' | 'coal' | 'geothermal' | 'biomass';

interface EnergyAsset {
  name: string;
  source: EnergySource;
  capacity: number; // MW
  output: number; // MWh
  efficiency: number;
  location: string;
  status: 'online' | 'offline' | 'maintenance';
  co2Avoided: number; // tonnes
}

interface ConsumptionRecord {
  date: string;
  usage: number; // kWh
  cost: number;
  source: string;
}

const SOURCE_CONFIG: Record<EnergySource, { icon: React.ElementType; color: string }> = {
  solar: { icon: Sun, color: 'text-yellow-400' },
  wind: { icon: Wind, color: 'text-cyan-400' },
  hydro: { icon: Droplets, color: 'text-blue-400' },
  nuclear: { icon: Zap, color: 'text-purple-400' },
  'natural-gas': { icon: Flame, color: 'text-orange-400' },
  coal: { icon: Flame, color: 'text-gray-400' },
  geothermal: { icon: Flame, color: 'text-red-400' },
  biomass: { icon: Flame, color: 'text-green-400' },
};

export default function EnergyLensPage() {
  useLensNav('energy');

  const [activeTab, setActiveTab] = useState<'assets' | 'consumption' | 'mix'>('assets');
  const [showFeatures, setShowFeatures] = useState(true);
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('energy');

  const { items: assetItems, isLoading, isError, error, refetch, create, update, remove } = useLensData<Record<string, unknown>>('energy', 'asset', { seed: [] });
  const { items: consumptionItems, create: createConsumption } = useLensData<Record<string, unknown>>('energy', 'consumption', { seed: [] });
  const runAction = useRunArtifact('energy');

  const handleAction = useCallback((artifactId: string) => {
    runAction.mutate({ id: artifactId, action: 'analyze' });
  }, [runAction]);

  const assets = assetItems.map(i => ({ id: i.id, title: i.title, ...(i.data || {}) })) as unknown as (EnergyAsset & { id: string; title: string })[];
  const consumption = consumptionItems.map(i => ({ id: i.id, ...(i.data || {}) })) as unknown as (ConsumptionRecord & { id: string })[];

  const totalCapacity = assets.reduce((sum, a) => sum + (a.capacity || 0), 0);
  const totalOutput = assets.reduce((sum, a) => sum + (a.output || 0), 0);
  const totalCO2 = assets.reduce((sum, a) => sum + (a.co2Avoided || 0), 0);
  const avgEfficiency = assets.length > 0 ? assets.reduce((sum, a) => sum + (a.efficiency || 0), 0) / assets.length : 0;
  const onlineCount = assets.filter(a => a.status === 'online').length;
  const renewableCount = assets.filter(a => ['solar', 'wind', 'hydro', 'geothermal', 'biomass'].includes(a.source)).length;
  const renewablePct = assets.length > 0 ? (renewableCount / assets.length * 100) : 0;
  const peakAsset = assets.reduce<(EnergyAsset & { id: string; title: string }) | null>((best, a) => (!best || (a.output || 0) > (best.output || 0)) ? a : best, null);

  const [newAsset, setNewAsset] = useState({ name: '', source: 'solar' as EnergySource, capacity: '' });

  const addAsset = () => {
    if (!newAsset.name.trim()) return;
    create({
      title: newAsset.name,
      data: {
        name: newAsset.name,
        source: newAsset.source,
        capacity: parseFloat(newAsset.capacity) || 0,
        output: 0,
        efficiency: 0,
        location: '',
        status: 'online',
        co2Avoided: 0,
      },
    });
    setNewAsset({ name: '', source: 'solar', capacity: '' });
  };

  if (isLoading) {
    return (
      <div data-lens-theme="energy" className="flex items-center justify-center h-full p-8">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-yellow-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-gray-400">Powering up systems...</p>
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
    <div className="p-6 space-y-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Zap className="w-8 h-8 text-yellow-500" />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold">Energy Lens</h1>
              <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} />
              {runAction.isPending && <Loader2 className="w-4 h-4 animate-spin text-yellow-500" />}
            </div>
            <p className="text-sm text-gray-400">Energy assets, consumption tracking, and grid mix analysis</p>
          </div>
        </div>
      </header>

      <RealtimeDataPanel domain="energy" data={realtimeData} isLive={isLive} lastUpdated={lastUpdated} insights={insights} compact />
      <UniversalActions domain="energy" artifactId={undefined} compact />
      <DTUExportButton domain="energy" data={{}} compact />

      {/* Stat Cards Row */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {[
          { icon: Battery, label: 'Total Capacity', value: `${totalCapacity.toFixed(1)} MW`, color: 'text-yellow-500' },
          { icon: TrendingUp, label: 'Total Output', value: `${totalOutput.toFixed(0)} MWh`, color: 'text-neon-cyan' },
          { icon: Wind, label: 'CO2 Avoided', value: `${totalCO2.toFixed(0)} t`, color: 'text-green-400' },
          { icon: Gauge, label: 'Renewable Mix', value: `${renewablePct.toFixed(0)}%`, color: 'text-emerald-400' },
          { icon: Gauge, label: 'Avg Efficiency', value: `${(avgEfficiency * 100).toFixed(1)}%`, color: 'text-orange-400' },
        ].map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.08 }}
            className="panel p-4 text-center"
          >
            <stat.icon className={`w-6 h-6 mx-auto ${stat.color} mb-2`} />
            <p className="text-2xl font-bold">{stat.value}</p>
            <p className="text-xs text-gray-400">{stat.label}</p>
          </motion.div>
        ))}
      </div>

      {/* Energy Source Distribution Bar */}
      {assets.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="panel p-4">
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2"><Zap className="w-4 h-4 text-yellow-500" /> Source Distribution</h3>
          <div className="h-6 rounded-full overflow-hidden flex">
            {(Object.keys(SOURCE_CONFIG) as EnergySource[]).map(source => {
              const sourceCap = assets.filter(a => a.source === source).reduce((s, a) => s + (a.capacity || 0), 0);
              const pct = totalCapacity > 0 ? (sourceCap / totalCapacity * 100) : 0;
              if (pct === 0) return null;
              const bgColors: Record<string, string> = { solar: 'bg-yellow-400', wind: 'bg-cyan-400', hydro: 'bg-blue-400', nuclear: 'bg-purple-400', 'natural-gas': 'bg-orange-400', coal: 'bg-gray-400', geothermal: 'bg-red-400', biomass: 'bg-green-400' };
              return <div key={source} className={`${bgColors[source] || 'bg-gray-500'} h-full transition-all relative group`} style={{ width: `${pct}%` }} title={`${source}: ${pct.toFixed(1)}%`}>
                <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-black/70 opacity-0 group-hover:opacity-100 transition-opacity">{pct.toFixed(0)}%</span>
              </div>;
            })}
          </div>
          <div className="flex flex-wrap gap-3 mt-2">
            {(Object.keys(SOURCE_CONFIG) as EnergySource[]).map(source => {
              const count = assets.filter(a => a.source === source).length;
              if (count === 0) return null;
              const cfg = SOURCE_CONFIG[source];
              const Icon = cfg.icon;
              return <span key={source} className="flex items-center gap-1 text-xs text-gray-400"><Icon className={`w-3 h-3 ${cfg.color}`} />{source.replace('-', ' ')}</span>;
            })}
          </div>
        </motion.div>
      )}

      {/* Consumption vs Production Gauge */}
      {assets.length > 0 ? (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }} className="panel p-4">
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2"><BarChart3 className="w-4 h-4 text-neon-cyan" /> Production Efficiency</h3>
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <div className="flex justify-between text-xs text-gray-400 mb-1">
                <span>Output vs Capacity</span>
                <span>{totalCapacity > 0 ? (totalOutput / totalCapacity * 100).toFixed(1) : 0}%</span>
              </div>
              <div className="h-3 bg-white/5 rounded-full overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${totalCapacity > 0 ? Math.min(totalOutput / totalCapacity * 100, 100) : 0}%` }}
                  transition={{ duration: 1, ease: 'easeOut' }}
                  className="h-full bg-gradient-to-r from-yellow-500 to-green-400 rounded-full"
                />
              </div>
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-400">Online</p>
              <p className="text-sm font-bold text-green-400">{onlineCount}/{assets.length}</p>
            </div>
          </div>
          {peakAsset && (
            <div className="mt-3 flex items-center gap-2 text-xs text-gray-400">
              <AlertTriangle className="w-3 h-3 text-yellow-400" />
              <span>Peak producer: <span className="text-white font-medium">{peakAsset.name || peakAsset.title}</span> ({peakAsset.output || 0} MWh)</span>
            </div>
          )}
        </motion.div>
      ) : (
        <div className="text-center py-6 text-gray-500 text-sm border border-dashed border-white/10 rounded-lg">
          <p>No energy assets tracked yet. Add assets to monitor energy production.</p>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 border-b border-white/10 pb-2">
        {(['assets', 'consumption', 'mix'] as const).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded-t-lg text-sm font-medium transition-colors ${activeTab === tab ? 'bg-yellow-500/20 text-yellow-500 border-b-2 border-yellow-500' : 'text-gray-400 hover:text-white'}`}
          >
            {tab === 'mix' ? 'Energy Mix' : tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {activeTab === 'assets' && (
        <div className="space-y-4">
          <div className="panel p-4">
            <h3 className="font-semibold mb-3">Add Energy Asset</h3>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
              <input value={newAsset.name} onChange={e => setNewAsset({ ...newAsset, name: e.target.value })} placeholder="Asset name" className="bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm" />
              <select value={newAsset.source} onChange={e => setNewAsset({ ...newAsset, source: e.target.value as EnergySource })} className="bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm">
                {(Object.keys(SOURCE_CONFIG) as EnergySource[]).map(s => <option key={s} value={s}>{s.replace('-', ' ')}</option>)}
              </select>
              <input value={newAsset.capacity} onChange={e => setNewAsset({ ...newAsset, capacity: e.target.value })} placeholder="Capacity (MW)" className="bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm" type="number" />
              <button onClick={addAsset} className="px-4 py-2 bg-yellow-500/20 text-yellow-500 rounded-lg text-sm hover:bg-yellow-500/30">
                <Plus className="w-4 h-4 inline mr-1" /> Add
              </button>
            </div>
          </div>

          <div className="space-y-2">
            {assets.length === 0 ? (
              <p className="text-gray-500 text-sm text-center py-4">No energy assets tracked yet.</p>
            ) : (
              assets.map((asset, idx) => {
                const cfg = SOURCE_CONFIG[asset.source as EnergySource] || { icon: Zap, color: 'text-gray-400' };
                const Icon = cfg.icon;
                return (
                  <motion.div key={asset.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.05 }} className="panel p-4 flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <Icon className={`w-4 h-4 ${cfg.color}`} />
                        <span className="font-medium">{asset.name || asset.title}</span>
                        <span className={`text-xs px-2 py-0.5 rounded ${asset.status === 'online' ? 'bg-green-500/20 text-green-400' : asset.status === 'maintenance' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-red-500/20 text-red-400'}`}>
                          {asset.status || 'online'}
                        </span>
                      </div>
                      <div className="flex gap-4 mt-1 text-xs text-gray-400">
                        <span>{asset.capacity || 0} MW capacity</span>
                        <span>{asset.source?.replace('-', ' ')}</span>
                        {asset.location && <span>{asset.location}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => handleAction(asset.id)} className="text-gray-500 hover:text-neon-cyan" title="Run AI analysis"><Zap className="w-4 h-4" /></button>
                      <button onClick={() => update(asset.id, { data: { ...asset, lastUpdated: new Date().toISOString() } as unknown as Partial<Record<string, unknown>> })} className="text-gray-500 hover:text-yellow-400" title="Update"><TrendingUp className="w-4 h-4" /></button>
                      <button onClick={() => remove(asset.id)} className="text-gray-500 hover:text-red-400"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  </motion.div>
                );
              })
            )}
          </div>
        </div>
      )}

      {activeTab === 'consumption' && (
        <div className="panel p-4">
          <h3 className="font-semibold mb-3 flex items-center gap-2"><BarChart3 className="w-4 h-4 text-neon-cyan" /> Consumption Tracking</h3>
          <button onClick={() => createConsumption({ title: `Reading ${new Date().toLocaleDateString()}`, data: { date: new Date().toISOString(), usage: 0, cost: 0, source: '' } })} className="mb-3 px-3 py-1.5 bg-yellow-500/20 text-yellow-500 rounded-lg text-sm hover:bg-yellow-500/30 flex items-center gap-1.5">
            <Plus className="w-4 h-4" /> Add Reading
          </button>
          {consumption.length === 0 ? (
            <p className="text-gray-500 text-sm text-center py-4">No consumption data yet. Energy assets will generate consumption records over time.</p>
          ) : (
            <div className="space-y-2">
              {consumption.slice(0, 20).map(rec => (
                <div key={rec.id} className="flex items-center justify-between p-2 rounded-lg bg-white/5">
                  <span className="text-sm">{rec.date ? new Date(rec.date).toLocaleDateString() : ''}</span>
                  <span className="text-sm font-mono">{rec.usage} kWh</span>
                  <span className="text-sm text-gray-400">${rec.cost?.toFixed(2)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'mix' && (
        <div className="panel p-4">
          <h3 className="font-semibold mb-3 flex items-center gap-2"><Zap className="w-4 h-4 text-yellow-500" /> Energy Mix</h3>
          {assets.length === 0 ? (
            <p className="text-gray-500 text-sm text-center py-4">Add energy assets to see the generation mix.</p>
          ) : (
            <div className="space-y-3">
              {(Object.keys(SOURCE_CONFIG) as EnergySource[]).map(source => {
                const sourceAssets = assets.filter(a => a.source === source);
                if (sourceAssets.length === 0) return null;
                const sourceCap = sourceAssets.reduce((s, a) => s + (a.capacity || 0), 0);
                const pct = totalCapacity > 0 ? (sourceCap / totalCapacity * 100) : 0;
                const cfg = SOURCE_CONFIG[source];
                const Icon = cfg.icon;
                return (
                  <div data-lens-theme="energy" key={source}>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className="flex items-center gap-2"><Icon className={`w-4 h-4 ${cfg.color}`} />{source.replace('-', ' ')}</span>
                      <span className="font-mono">{pct.toFixed(1)}%</span>
                    </div>
                    <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-yellow-500 to-neon-cyan rounded-full transition-all" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Lens Features */}
      <div className="border-t border-white/10">
        <button onClick={() => setShowFeatures(!showFeatures)} className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-300 hover:text-white transition-colors bg-white/[0.02] hover:bg-white/[0.04] rounded-lg">
          <span className="flex items-center gap-2"><Layers className="w-4 h-4" /> Lens Features & Capabilities</span>
          <ChevronDown className={`w-4 h-4 transition-transform ${showFeatures ? 'rotate-180' : ''}`} />
        </button>
        {showFeatures && <div className="px-4 pb-4"><LensFeaturePanel lensId="energy" /></div>}
      </div>
    </div>
  );
}
