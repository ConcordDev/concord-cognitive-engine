'use client';

import { useLensNav } from '@/hooks/useLensNav';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, apiHelpers } from '@/lib/api/client';
import { useState, useMemo } from 'react';
import {
  Heart, Activity, Zap, TrendingUp, TrendingDown, RefreshCw,
  AlertTriangle, Clock, Shield, Wrench,
  ChevronDown, Search, BarChart3, Layers, GitBranch,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';

interface Organ {
  id: string;
  name: string;
  maturity: number;
  wear: number;
  plasticity: number;
  lastTick: string;
  dependencies: string[];
  status?: string;
  type?: string;
}

type ViewMode = 'grid' | 'timeline';
type SortMode = 'name' | 'health' | 'maturity' | 'wear';

export default function OrganLensPage() {
  useLensNav('organ');
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('organ');
  const queryClient = useQueryClient();
  const [selectedOrgan, setSelectedOrgan] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [sortMode, setSortMode] = useState<SortMode>('health');
  const [searchFilter, setSearchFilter] = useState('');
  const [showRepairConfirm, setShowRepairConfirm] = useState<string | null>(null);
  const [showFeatures, setShowFeatures] = useState(true);

  // Backend: GET /api/status for organ registry
  const { data: statusData, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['status'],
    queryFn: () => api.get('/api/status').then((r) => r.data),
  });

  // Backend: GET /api/system/health
  const { data: healthData, refetch: refetchHealth } = useQuery({
    queryKey: ['system-health'],
    queryFn: () => apiHelpers.guidance.health().then((r) => r.data),
    refetchInterval: 30000,
  });

  // Tick mutation (simulates organ tick)
  const tickMutation = useMutation({
    mutationFn: () => apiHelpers.bridge.heartbeatTick(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['status'] });
      queryClient.invalidateQueries({ queryKey: ['system-health'] });
    },
    onError: (err) => console.error('Tick failed:', err instanceof Error ? err.message : err),
  });

  // Extract organs from status data
  const organs: Organ[] = useMemo(() => {
    const registry = statusData?.organs || statusData?.organRegistry || healthData?.organs || [];
    if (Array.isArray(registry)) return registry;
    if (typeof registry === 'object') {
      return Object.entries(registry).map(([key, val]) => ({
        id: key,
        name: key,
        ...(typeof val === 'object' && val !== null ? val : {}),
        maturity: (val as Record<string, number>)?.maturity ?? 0.5,
        wear: (val as Record<string, number>)?.wear ?? 0.1,
        plasticity: (val as Record<string, number>)?.plasticity ?? 0.5,
        lastTick: (val as Record<string, string>)?.lastTick ?? '',
        dependencies: (val as Record<string, string[]>)?.dependencies ?? [],
      })) as Organ[];
    }
    return [];
  }, [statusData, healthData]);

  // Filtered and sorted organs
  const displayOrgans = useMemo(() => {
    let result = [...organs];

    if (searchFilter) {
      const q = searchFilter.toLowerCase();
      result = result.filter(o => o.name.toLowerCase().includes(q) || o.id.toLowerCase().includes(q));
    }

    switch (sortMode) {
      case 'name':
        result.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case 'health':
        result.sort((a, b) => (b.maturity - b.wear) - (a.maturity - a.wear));
        break;
      case 'maturity':
        result.sort((a, b) => b.maturity - a.maturity);
        break;
      case 'wear':
        result.sort((a, b) => b.wear - a.wear);
        break;
    }

    return result;
  }, [organs, searchFilter, sortMode]);

  const avgHealth = organs.length > 0 ? organs.reduce((sum, o) => sum + (o.maturity - o.wear), 0) / organs.length : 0;
  const avgMaturity = organs.length > 0 ? organs.reduce((s, o) => s + o.maturity, 0) / organs.length : 0;
  const avgPlasticity = organs.length > 0 ? organs.reduce((s, o) => s + o.plasticity, 0) / organs.length : 0;
  const avgWear = organs.length > 0 ? organs.reduce((s, o) => s + o.wear, 0) / organs.length : 0;
  const criticalOrgans = organs.filter(o => (o.maturity - o.wear) < 0.3);
  const healthyOrgans = organs.filter(o => (o.maturity - o.wear) >= 0.7);

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
          <p className="text-sm text-gray-400">Loading organ data...</p>
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
          <span className="text-2xl">🫀</span>
          <div>
            <h1 className="text-xl font-bold">Organ Lens</h1>
            <p className="text-sm text-gray-400">
              Monitor organism health, maturity, and plasticity
            </p>
          </div>

      {/* Real-time Enhancement Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
        <DTUExportButton domain="organ" data={realtimeData || {}} compact />
        {realtimeAlerts.length > 0 && (
          <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
            {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>
        </div>
        <div className="flex items-center gap-3">
          <Heart className={`w-5 h-5 ${avgHealth > 0.7 ? 'text-neon-green' : avgHealth > 0.4 ? 'text-yellow-400' : 'text-red-400'}`} />
          <span className="text-lg font-bold">{(avgHealth * 100).toFixed(0)}%</span>
          <button
            onClick={() => tickMutation.mutate()}
            disabled={tickMutation.isPending}
            className="btn-neon text-sm"
          >
            <Zap className="w-4 h-4 mr-1 inline" />
            {tickMutation.isPending ? 'Ticking...' : 'Tick'}
          </button>
          <button onClick={() => { refetch(); refetchHealth(); }} className="p-2 text-gray-400 hover:text-white">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Critical Alerts */}
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
                key={o.id}
                onClick={() => setSelectedOrgan(o.id)}
                className="text-xs px-2 py-1 bg-red-400/10 text-red-400 rounded hover:bg-red-400/20"
              >
                {o.name} ({((o.maturity - o.wear) * 100).toFixed(0)}%)
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Organ Health Status Cards */}
      <div className="grid grid-cols-3 gap-4">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
          className="panel p-4 border-l-4 border-l-green-500 bg-green-500/5">
          <div className="flex items-center gap-2 mb-2">
            <Heart className="w-4 h-4 text-green-400" />
            <span className="text-sm font-semibold text-green-400">Healthy</span>
          </div>
          <p className="text-3xl font-bold text-green-400">{healthyOrgans.length}</p>
          <p className="text-xs text-gray-500">Health &ge; 70%</p>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
          className="panel p-4 border-l-4 border-l-amber-500 bg-amber-500/5">
          <div className="flex items-center gap-2 mb-2">
            <Activity className="w-4 h-4 text-amber-400" />
            <span className="text-sm font-semibold text-amber-400">Monitoring</span>
          </div>
          <p className="text-3xl font-bold text-amber-400">{organs.length - healthyOrgans.length - criticalOrgans.length}</p>
          <p className="text-xs text-gray-500">Health 30-70%</p>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
          className="panel p-4 border-l-4 border-l-red-500 bg-red-500/5">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-4 h-4 text-red-400" />
            <span className="text-sm font-semibold text-red-400">Critical</span>
          </div>
          <p className="text-3xl font-bold text-red-400">{criticalOrgans.length}</p>
          <p className="text-xs text-gray-500">Health &lt; 30%</p>
        </motion.div>
      </div>

      {/* Organism Overview */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="lens-card">
          <Activity className="w-5 h-5 text-neon-blue mb-2" />
          <p className="text-2xl font-bold">{organs.length}</p>
          <p className="text-sm text-gray-400">Active Organs</p>
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
          <p className="text-sm text-gray-400">Avg Wear</p>
          <GaugeBar value={avgWear} color="bg-neon-pink" />
        </motion.div>
      </div>

      {/* Controls */}
      <div className="flex flex-col md:flex-row gap-3 items-start md:items-center justify-between">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            className="w-full pl-10 py-2 bg-lattice-surface border border-lattice-border rounded-lg text-sm focus:border-neon-cyan outline-none"
            placeholder="Search organs..."
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
            <option value="name">Sort by Name</option>
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

      {/* Organ Grid / Timeline */}
      {viewMode === 'grid' ? (
        <div className="panel p-4">
          <h2 className="font-semibold mb-4 flex items-center gap-2">
            <Heart className="w-4 h-4 text-neon-pink" />
            Organ Registry
            <span className="text-xs text-gray-500 font-normal">({displayOrgans.length})</span>
          </h2>
          {displayOrgans.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <Heart className="w-12 h-12 mx-auto mb-4 opacity-40" />
              <p>{searchFilter ? 'No matching organs found' : 'No organs registered in the system'}</p>
              <p className="text-xs mt-2">Organs will appear here when the organism initializes</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {displayOrgans.map((organ, idx) => {
                const health = organ.maturity - organ.wear;
                return (
                  <motion.button
                    key={organ.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.04 }}
                    onClick={() => setSelectedOrgan(organ.id === selectedOrgan ? null : organ.id)}
                    className={`lens-card text-left transition-all ${
                      selectedOrgan === organ.id ? 'border-neon-cyan ring-1 ring-neon-cyan' : ''
                    }`}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="font-semibold">{organ.name}</h3>
                      <div className="flex items-center gap-2">
                        <span className={`text-sm font-mono ${getHealthColor(health)}`}>
                          {(health * 100).toFixed(0)}%
                        </span>
                        <span className={`w-3 h-3 rounded-full ${getHealthBg(health)}`} />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <MetricBar label="Maturity" value={organ.maturity} color="bg-neon-green" />
                      <MetricBar label="Plasticity" value={organ.plasticity} color="bg-neon-purple" />
                      <MetricBar label="Wear" value={organ.wear} color="bg-neon-pink" />
                    </div>

                    {organ.lastTick && (
                      <div className="flex items-center gap-1 mt-3 text-xs text-gray-500">
                        <Clock className="w-3 h-3" />
                        Last tick: {new Date(organ.lastTick).toLocaleTimeString()}
                      </div>
                    )}

                    {selectedOrgan === organ.id && (
                      <div className="mt-4 pt-4 border-t border-lattice-border space-y-3">
                        <div>
                          <p className="text-xs text-gray-400 mb-2">Dependencies:</p>
                          <div className="flex flex-wrap gap-1">
                            {organ.dependencies.length > 0 ? organ.dependencies.map((dep) => (
                              <span key={dep} className="text-xs px-2 py-0.5 bg-lattice-surface rounded">
                                {dep}
                              </span>
                            )) : (
                              <span className="text-xs text-gray-500">None</span>
                            )}
                          </div>
                        </div>
                        {health < 0.5 && (
                          <button
                            onClick={(e) => { e.stopPropagation(); setShowRepairConfirm(organ.id); }}
                            className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs bg-yellow-400/10 text-yellow-400 rounded-lg hover:bg-yellow-400/20"
                          >
                            <Wrench className="w-3 h-3" />
                            Trigger Repair Cycle
                          </button>
                        )}
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
              const health = organ.maturity - organ.wear;
              return (
                <div key={organ.id} className="flex items-center gap-4 p-3 bg-lattice-deep rounded-lg">
                  <div className="w-32 shrink-0">
                    <p className="font-medium text-sm truncate">{organ.name}</p>
                    <p className={`text-xs ${getHealthColor(health)}`}>
                      {(health * 100).toFixed(0)}% health
                    </p>
                  </div>
                  <div className="flex-1">
                    <div className="h-6 bg-lattice-void rounded-full overflow-hidden relative">
                      <div
                        className="h-full bg-gradient-to-r from-neon-green via-neon-blue to-neon-purple rounded-full transition-all"
                        style={{ width: `${organ.maturity * 100}%` }}
                      />
                      {/* Wear overlay */}
                      <div
                        className="absolute top-0 right-0 h-full bg-red-400/30 rounded-r-full"
                        style={{ width: `${organ.wear * 100}%` }}
                      />
                    </div>
                  </div>
                  <div className="w-20 text-right shrink-0">
                    <p className="text-sm font-mono">{(organ.maturity * 100).toFixed(0)}%</p>
                    <p className="text-xs text-gray-500">maturity</p>
                  </div>
                </div>
              );
            })}
            {displayOrgans.length === 0 && (
              <div className="text-center py-8 text-gray-500">
                <p className="text-sm">No organs to display</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* System Hierarchy & Dependency Graph */}
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
                const health = organ.maturity - organ.wear;
                return (
                  <motion.div key={organ.id} initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: idx * 0.08 }}
                    className="flex flex-col items-center gap-1">
                    <div className={`w-10 h-10 rounded-full border-2 flex items-center justify-center text-xs font-bold ${
                      health >= 0.7 ? 'border-green-400 text-green-400' : health >= 0.4 ? 'border-yellow-400 text-yellow-400' : 'border-red-400 text-red-400'
                    }`}>
                      {organ.name.slice(0, 2).toUpperCase()}
                    </div>
                    <span className="text-[10px] text-gray-500 max-w-[60px] truncate">{organ.name}</span>
                    {organ.dependencies.length > 0 && (
                      <span className="text-[9px] text-gray-600">{organ.dependencies.length} deps</span>
                    )}
                  </motion.div>
                );
              })}
            </div>
          ) : (
            <div className="text-center text-gray-500">
              <Layers className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm">Dependency graph will appear when organs are registered</p>
            </div>
          )}
        </div>
      </motion.div>

      {/* Bio Age Indicator */}
      <div className="panel p-4">
        <h2 className="font-semibold mb-4 flex items-center gap-2">
          <Shield className="w-4 h-4 text-neon-cyan" />
          Organism Bio-Age
        </h2>
        <div className="flex items-center gap-4">
          <div className="flex-1">
            <div className="h-4 bg-lattice-deep rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-neon-green via-neon-blue to-neon-purple transition-all"
                style={{ width: `${Math.max(0, avgHealth) * 100}%` }}
              />
            </div>
            <div className="flex justify-between mt-1 text-xs text-gray-500">
              <span>Nascent</span>
              <span>Juvenile</span>
              <span>Mature</span>
              <span>Elder</span>
            </div>
          </div>
          <span className="text-2xl font-bold text-neon-cyan">
            {Math.floor(Math.max(0, avgHealth) * 400)} years
          </span>
        </div>
        <p className="text-sm text-gray-400 mt-2">
          Projected continuity based on current organ health
        </p>
        <div className="grid grid-cols-3 gap-3 mt-4">
          <div className="bg-lattice-deep p-2 rounded-lg text-center">
            <p className="text-xs text-gray-500">Healthy</p>
            <p className="text-lg font-bold text-neon-green">{healthyOrgans.length}</p>
          </div>
          <div className="bg-lattice-deep p-2 rounded-lg text-center">
            <p className="text-xs text-gray-500">Degraded</p>
            <p className="text-lg font-bold text-yellow-400">{organs.length - healthyOrgans.length - criticalOrgans.length}</p>
          </div>
          <div className="bg-lattice-deep p-2 rounded-lg text-center">
            <p className="text-xs text-gray-500">Critical</p>
            <p className="text-lg font-bold text-red-400">{criticalOrgans.length}</p>
          </div>
        </div>
      </div>

      {/* Repair Confirmation Modal */}
      {showRepairConfirm && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="panel p-6 max-w-sm w-full space-y-4">
            <h3 className="text-lg font-bold flex items-center gap-2">
              <Wrench className="w-5 h-5 text-yellow-400" />
              Confirm Repair Cycle
            </h3>
            <p className="text-sm text-gray-400">
              This will trigger a repair cycle for the organ, which may temporarily reduce plasticity while wear is repaired.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                className="px-4 py-2 text-sm text-gray-400 hover:text-white"
                onClick={() => setShowRepairConfirm(null)}
              >
                Cancel
              </button>
              <button
                className="btn-neon text-sm"
                onClick={() => {
                  tickMutation.mutate();
                  setShowRepairConfirm(null);
                }}
              >
                Start Repair
              </button>
            </div>
          </div>
        </div>
      )}

      <RealtimeDataPanel data={realtimeInsights} />

      {/* Lens Features */}
      <div className="border-t border-white/10">
        <button
          onClick={() => setShowFeatures(!showFeatures)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-300 hover:text-white transition-colors bg-white/[0.02] hover:bg-white/[0.04] rounded-lg"
        >
          <span className="flex items-center gap-2">
            <Layers className="w-4 h-4" />
            Lens Features & Capabilities
          </span>
          <ChevronDown className={`w-4 h-4 transition-transform ${showFeatures ? 'rotate-180' : ''}`} />
        </button>
        {showFeatures && (
          <div className="px-4 pb-4">
            <LensFeaturePanel lensId="organ" />
          </div>
        )}
      </div>
    </div>
  );
}

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
