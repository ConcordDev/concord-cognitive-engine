'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { useState, useMemo } from 'react';
import {
  Heart, Activity, Zap, TrendingUp, TrendingDown, RefreshCw,
  AlertTriangle, Clock, Wrench, Search, BarChart3, Layers, GitBranch,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';

interface OrganMaturity {
  score: number;
  confidence: number;
  stability: number;
  plasticity: number;
  lastUpdateAt: string;
}
interface OrganWear {
  damage: number;
  repair: number;
  debt: number;
}
interface OrganState {
  organId: string;
  status: string;
  resolution: number;
  maturity: OrganMaturity;
  wear: OrganWear;
  deps: string[];
  desc: string;
}
interface GrowthStatus {
  bioAge: number;
  epigeneticClock: number;
  telomere: number;
  proteomeShift: number;
  homeostasis: number;
  stress: { acute: number; chronic: number };
  maintenance: { repairRate: number; cleanupBacklog: number };
  functionalDecline: { contradictionLoad: number };
}

type ViewMode = 'grid' | 'timeline';
type SortMode = 'name' | 'health' | 'maturity' | 'wear';

function MetricBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-gray-400">{label}</span>
        <span>{(value * 100).toFixed(0)}%</span>
      </div>
      <div className="h-1.5 bg-lattice-deep rounded-full overflow-hidden">
        <div className={`h-full ${color} transition-all`} style={{ width: `${value * 100}%` }} />
      </div>
    </div>
  );
}

function GaugeBar({ value, color }: { value: number; color: string }) {
  return (
    <div data-lens-theme="organ" className="h-1 bg-lattice-deep rounded-full overflow-hidden mt-2">
      <div className={`h-full ${color} transition-all`} style={{ width: `${value * 100}%` }} />
    </div>
  );
}

function GrowthStat({ label, value, inverse }: { label: string; value: number; inverse?: boolean }) {
  const pct = Math.max(0, Math.min(1, value));
  const good = inverse ? pct < 0.4 : pct > 0.6;
  const bad = inverse ? pct > 0.7 : pct < 0.3;
  const tone = good ? 'text-neon-green' : bad ? 'text-red-400' : 'text-yellow-400';
  return (
    <div className="bg-lattice-deep p-2 rounded-lg text-center">
      <p className="text-xs text-gray-400">{label}</p>
      <p className={`text-lg font-bold ${tone}`}>{(pct * 100).toFixed(0)}%</p>
    </div>
  );
}

export function SelfModelPanel({ onGridTimelineCommand }: { onGridTimelineCommand?: (mode: ViewMode) => void } = {}) {
  const { insights: realtimeInsights } = useRealtimeLens('organ');
  const [selectedOrgan, setSelectedOrgan] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [sortMode, setSortMode] = useState<SortMode>('health');
  const [searchFilter, setSearchFilter] = useState('');

  // expose setter for page-level commands if needed
  void onGridTimelineCommand;

  const { data: organsData, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['growth-organs'],
    queryFn: () => api.get('/api/growth/organs').then((r) => r.data as { ok: boolean; organs: OrganState[] }),
    refetchInterval: 20000,
  });

  const { data: growthData, refetch: refetchGrowth } = useQuery({
    queryKey: ['growth-status'],
    queryFn: () => api.get('/api/growth/status').then((r) => r.data as { ok: boolean; status: GrowthStatus }),
    refetchInterval: 20000,
  });

  const organs: OrganState[] = useMemo(() => organsData?.organs || [], [organsData]);
  const growth = growthData?.status;

  const healthOf = (o: OrganState) => Math.max(0, Math.min(1, (o.maturity?.score ?? 0) - (o.wear?.damage ?? 0)));

  const displayOrgans = useMemo(() => {
    let result = [...organs];
    if (searchFilter) {
      const q = searchFilter.toLowerCase();
      result = result.filter(o => o.organId.toLowerCase().includes(q) || (o.desc || '').toLowerCase().includes(q));
    }
    switch (sortMode) {
      case 'name':
        result.sort((a, b) => a.organId.localeCompare(b.organId));
        break;
      case 'health':
        result.sort((a, b) => healthOf(b) - healthOf(a));
        break;
      case 'maturity':
        result.sort((a, b) => (b.maturity?.score ?? 0) - (a.maturity?.score ?? 0));
        break;
      case 'wear':
        result.sort((a, b) => (b.wear?.damage ?? 0) - (a.wear?.damage ?? 0));
        break;
    }
    return result;
  }, [organs, searchFilter, sortMode]);

  const avgHealth = organs.length > 0 ? organs.reduce((sum, o) => sum + healthOf(o), 0) / organs.length : 0;
  const avgMaturity = organs.length > 0 ? organs.reduce((s, o) => s + (o.maturity?.score ?? 0), 0) / organs.length : 0;
  const avgPlasticity = organs.length > 0 ? organs.reduce((s, o) => s + (o.maturity?.plasticity ?? 0), 0) / organs.length : 0;
  const avgWear = organs.length > 0 ? organs.reduce((s, o) => s + (o.wear?.damage ?? 0), 0) / organs.length : 0;
  const criticalOrgans = organs.filter(o => healthOf(o) < 0.3);
  const healthyOrgans = organs.filter(o => healthOf(o) >= 0.7);

  const getHealthColor = (health: number) => {
    if (health >= 0.7) return 'text-neon-green';
    if (health >= 0.4) return 'text-yellow-400';
    return 'text-red-400';
  };

  const getHealthBg = (health: number) => {
    if (health >= 0.7) return 'bg-neon-green';
    if (health >= 0.4) return 'bg-yellow-400';
    return 'bg-red-400';
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-neon-cyan border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-gray-400">Loading organ registry...</p>
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
    <div className="space-y-6">
      <div className="flex items-center justify-end gap-3">
        <Heart className={`w-5 h-5 ${avgHealth > 0.7 ? 'text-neon-green' : avgHealth > 0.4 ? 'text-yellow-400' : 'text-red-400'}`} />
        <span className="text-lg font-bold">{(avgHealth * 100).toFixed(0)}%</span>
        <button onClick={() => { refetch(); refetchGrowth(); }} className="p-2 text-gray-400 hover:text-white" aria-label="Refresh">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      <div className="flex items-center gap-2 text-xs text-gray-400">
        <Wrench className="w-3.5 h-3.5" />
        <span>
          Organs below self-update every governor heartbeat (~15s) — this is a
          read-only introspection view of Concord&apos;s own cognitive architecture,
          not a control panel. There is no manual &quot;tick&quot; or per-organ repair action.
        </span>
      </div>

      {criticalOrgans.length > 0 && (
        <div className="panel p-3 border border-red-400/30 bg-red-400/5">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-4 h-4 text-red-400" />
            <span className="text-sm font-semibold text-red-400">
              {criticalOrgans.length} organ{criticalOrgans.length > 1 ? 's' : ''} in critical state
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {criticalOrgans.map(o => (
              <button
                key={o.organId}
                onClick={() => setSelectedOrgan(o.organId)}
                className="text-xs px-2 py-1 bg-red-400/10 text-red-400 rounded hover:bg-red-400/20"
              >
                {o.organId} ({(healthOf(o) * 100).toFixed(0)}%)
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-4">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
          className="panel p-4 border-l-4 border-l-green-500 bg-green-500/5">
          <div className="flex items-center gap-2 mb-2">
            <Heart className="w-4 h-4 text-green-400" />
            <span className="text-sm font-semibold text-green-400">Healthy</span>
          </div>
          <p className="text-3xl font-bold text-green-400">{healthyOrgans.length}</p>
          <p className="text-xs text-gray-400">Health &ge; 70%</p>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
          className="panel p-4 border-l-4 border-l-amber-500 bg-amber-500/5">
          <div className="flex items-center gap-2 mb-2">
            <Activity className="w-4 h-4 text-amber-400" />
            <span className="text-sm font-semibold text-amber-400">Monitoring</span>
          </div>
          <p className="text-3xl font-bold text-amber-400">{organs.length - healthyOrgans.length - criticalOrgans.length}</p>
          <p className="text-xs text-gray-400">Health 30-70%</p>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
          className="panel p-4 border-l-4 border-l-red-500 bg-red-500/5">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-4 h-4 text-red-400" />
            <span className="text-sm font-semibold text-red-400">Critical</span>
          </div>
          <p className="text-3xl font-bold text-red-400">{criticalOrgans.length}</p>
          <p className="text-xs text-gray-400">Health &lt; 30%</p>
        </motion.div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="lens-card">
          <Activity className="w-5 h-5 text-neon-blue mb-2" />
          <p className="text-2xl font-bold">{organs.length}</p>
          <p className="text-sm text-gray-400">Registered Organs</p>
          <div className="flex gap-1 mt-2">
            <span className="text-xs text-neon-green">{healthyOrgans.length} healthy</span>
            {criticalOrgans.length > 0 && (
              <span className="text-xs text-red-400">/ {criticalOrgans.length} critical</span>
            )}
          </div>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }} className="lens-card">
          <TrendingUp className="w-5 h-5 text-neon-green mb-2" />
          <p className="text-2xl font-bold">{(avgMaturity * 100).toFixed(0)}%</p>
          <p className="text-sm text-gray-400">Avg Maturity</p>
          <GaugeBar value={avgMaturity} color="bg-neon-green" />
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="lens-card">
          <Zap className="w-5 h-5 text-neon-purple mb-2" />
          <p className="text-2xl font-bold">{(avgPlasticity * 100).toFixed(0)}%</p>
          <p className="text-sm text-gray-400">Avg Plasticity</p>
          <GaugeBar value={avgPlasticity} color="bg-neon-purple" />
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }} className="lens-card">
          <TrendingDown className="w-5 h-5 text-neon-pink mb-2" />
          <p className="text-2xl font-bold">{(avgWear * 100).toFixed(0)}%</p>
          <p className="text-sm text-gray-400">Avg Wear (damage)</p>
          <GaugeBar value={avgWear} color="bg-neon-pink" />
        </motion.div>
      </div>

      <div className="flex flex-col md:flex-row gap-3 items-start md:items-center justify-between">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            className="w-full pl-10 py-2 bg-lattice-surface border border-lattice-border rounded-lg text-sm focus:border-neon-cyan outline-none"
            placeholder="Search organs by id or description..."
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
          />
        </div>
        <div className="flex gap-2">
          <select
            className="px-3 py-2 bg-lattice-surface border border-lattice-border rounded-lg text-sm text-gray-300"
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value as SortMode)}
          >
            <option value="health">Sort by Health</option>
            <option value="name">Sort by Organ ID</option>
            <option value="maturity">Sort by Maturity</option>
            <option value="wear">Sort by Wear</option>
          </select>
          <div className="flex rounded-lg border border-lattice-border overflow-hidden">
            <button
              className={`px-3 py-2 text-sm ${viewMode === 'grid' ? 'bg-neon-purple/20 text-neon-purple' : 'bg-lattice-surface text-gray-400'}`}
              onClick={() => setViewMode('grid')}
            >
              Grid
            </button>
            <button
              className={`px-3 py-2 text-sm ${viewMode === 'timeline' ? 'bg-neon-purple/20 text-neon-purple' : 'bg-lattice-surface text-gray-400'}`}
              onClick={() => setViewMode('timeline')}
            >
              Timeline
            </button>
          </div>
        </div>
      </div>

      {viewMode === 'grid' ? (
        <div className="panel p-4">
          <h2 className="font-semibold mb-4 flex items-center gap-2">
            <Heart className="w-4 h-4 text-neon-pink" />
            Organ Registry
            <span className="text-xs text-gray-400 font-normal">({displayOrgans.length})</span>
          </h2>
          {displayOrgans.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <Heart className="w-12 h-12 mx-auto mb-4 opacity-40" />
              <p>{searchFilter ? 'No matching organs found' : 'No organs registered in the system'}</p>
              <p className="text-xs mt-2">Organs register automatically at boot via ensureOrganRegistry()</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {displayOrgans.map((organ, idx) => {
                const health = healthOf(organ);
                return (
                  <motion.button
                    key={organ.organId}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.04 }}
                    onClick={() => setSelectedOrgan(organ.organId === selectedOrgan ? null : organ.organId)}
                    className={`lens-card text-left transition-all ${
                      selectedOrgan === organ.organId ? 'border-neon-cyan ring-1 ring-neon-cyan' : ''
                    }`}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="font-semibold font-mono text-sm">{organ.organId}</h3>
                      <div className="flex items-center gap-2">
                        <span className={`text-sm font-mono ${getHealthColor(health)}`}>
                          {(health * 100).toFixed(0)}%
                        </span>
                        <span className={`w-3 h-3 rounded-full ${getHealthBg(health)}`} />
                      </div>
                    </div>
                    {organ.desc && <p className="text-[11px] text-gray-400 mb-2 line-clamp-2">{organ.desc}</p>}

                    <div className="space-y-2">
                      <MetricBar label="Maturity" value={organ.maturity?.score ?? 0} color="bg-neon-green" />
                      <MetricBar label="Plasticity" value={organ.maturity?.plasticity ?? 0} color="bg-neon-purple" />
                      <MetricBar label="Wear (damage)" value={organ.wear?.damage ?? 0} color="bg-neon-pink" />
                    </div>

                    {organ.maturity?.lastUpdateAt && (
                      <div className="flex items-center gap-1 mt-3 text-xs text-gray-400">
                        <Clock className="w-3 h-3" />
                        Last update: {new Date(organ.maturity.lastUpdateAt).toLocaleTimeString()}
                      </div>
                    )}

                    {selectedOrgan === organ.organId && (
                      <div className="mt-4 pt-4 border-t border-lattice-border space-y-3">
                        <div>
                          <p className="text-xs text-gray-400 mb-2">Depends on:</p>
                          <div className="flex flex-wrap gap-1">
                            {organ.deps?.length > 0 ? organ.deps.map((dep) => (
                              <span key={dep} className="text-xs px-2 py-0.5 bg-lattice-surface rounded font-mono">
                                {dep}
                              </span>
                            )) : (
                              <span className="text-xs text-gray-400">None (core organ)</span>
                            )}
                          </div>
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-[10px] text-gray-400">
                          <span>confidence {((organ.maturity?.confidence ?? 0) * 100).toFixed(0)}%</span>
                          <span>stability {((organ.maturity?.stability ?? 0) * 100).toFixed(0)}%</span>
                          <span>debt {((organ.wear?.debt ?? 0) * 100).toFixed(0)}%</span>
                        </div>
                      </div>
                    )}
                  </motion.button>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <div className="panel p-4">
          <h2 className="font-semibold mb-4 flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-neon-cyan" />
            Maturation Timeline
          </h2>
          <div className="space-y-3">
            {displayOrgans.map((organ) => {
              const health = healthOf(organ);
              const maturityScore = organ.maturity?.score ?? 0;
              const wearDamage = organ.wear?.damage ?? 0;
              return (
                <div key={organ.organId} className="flex items-center gap-4 p-3 bg-lattice-deep rounded-lg">
                  <div className="w-40 shrink-0">
                    <p className="font-medium text-sm truncate font-mono">{organ.organId}</p>
                    <p className={`text-xs ${getHealthColor(health)}`}>
                      {(health * 100).toFixed(0)}% health
                    </p>
                  </div>
                  <div className="flex-1">
                    <div className="h-6 bg-lattice-void rounded-full overflow-hidden relative">
                      <div
                        className="h-full bg-gradient-to-r from-neon-green via-neon-blue to-neon-purple rounded-full transition-all"
                        style={{ width: `${maturityScore * 100}%` }}
                      />
                      <div
                        className="absolute top-0 right-0 h-full bg-red-400/30 rounded-r-full"
                        style={{ width: `${wearDamage * 100}%` }}
                      />
                    </div>
                  </div>
                  <div className="w-20 text-right shrink-0">
                    <p className="text-sm font-mono">{(maturityScore * 100).toFixed(0)}%</p>
                    <p className="text-xs text-gray-400">maturity</p>
                  </div>
                </div>
              );
            })}
            {displayOrgans.length === 0 && (
              <div className="text-center py-8 text-gray-400">
                <p className="text-sm">No organs to display</p>
              </div>
            )}
          </div>
        </div>
      )}

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}
        className="panel p-4">
        <h2 className="font-semibold mb-4 flex items-center gap-2">
          <GitBranch className="w-4 h-4 text-neon-cyan" />
          Dependency Graph
        </h2>
        <div className="bg-lattice-deep rounded-lg p-6 min-h-[120px] flex flex-col items-center justify-center relative overflow-hidden">
          {displayOrgans.length > 0 ? (
            <div className="flex flex-wrap gap-3 justify-center">
              {displayOrgans.slice(0, 8).map((organ, idx) => {
                const health = healthOf(organ);
                return (
                  <motion.div key={organ.organId} initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: idx * 0.08 }}
                    className="flex flex-col items-center gap-1">
                    <div className={`w-10 h-10 rounded-full border-2 flex items-center justify-center text-[9px] font-bold ${
                      health >= 0.7 ? 'border-green-400 text-green-400' : health >= 0.4 ? 'border-yellow-400 text-yellow-400' : 'border-red-400 text-red-400'
                    }`}>
                      {organ.organId.slice(0, 2).toUpperCase()}
                    </div>
                    <span className="text-[10px] text-gray-400 max-w-[70px] truncate">{organ.organId}</span>
                    {organ.deps?.length > 0 && (
                      <span className="text-[9px] text-gray-400">{organ.deps.length} deps</span>
                    )}
                  </motion.div>
                );
              })}
            </div>
          ) : (
            <div className="text-center text-gray-400">
              <Layers className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm">Dependency graph will appear when organs are registered</p>
            </div>
          )}
        </div>
      </motion.div>

      <div className="panel p-4">
        <h2 className="font-semibold mb-4 flex items-center gap-2">
          <Activity className="w-4 h-4 text-neon-cyan" />
          Growth OS
        </h2>
        {growth ? (
          <>
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <div className="h-4 bg-lattice-deep rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-neon-green via-neon-blue to-neon-purple transition-all"
                    style={{ width: `${Math.max(0, Math.min(100, growth.bioAge))}%` }}
                  />
                </div>
                <div className="flex justify-between mt-1 text-xs text-gray-400">
                  <span>Nascent</span>
                  <span>Developing</span>
                  <span>Mature</span>
                  <span>Decline pressure</span>
                </div>
              </div>
              <span className="text-2xl font-bold text-neon-cyan">
                {growth.bioAge.toFixed(1)}
              </span>
            </div>
            <p className="text-sm text-gray-400 mt-2">
              Bio-Age index (0–100) — rises with epigenetic drift, telomere loss, chronic stress and
              contradiction load; falls with repair. Not a literal age.
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
              <GrowthStat label="Homeostasis" value={growth.homeostasis} />
              <GrowthStat label="Telomere" value={growth.telomere} />
              <GrowthStat label="Epigenetic Clock" value={growth.epigeneticClock} inverse />
              <GrowthStat label="Chronic Stress" value={growth.stress?.chronic ?? 0} inverse />
            </div>
          </>
        ) : (
          <p className="text-sm text-gray-400">Growth OS status unavailable.</p>
        )}
      </div>

      <RealtimeDataPanel data={realtimeInsights} />
    </div>
  );
}
