'use client';

import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from "@/hooks/useLensCommand";
import { LensShell } from '@/components/lens/LensShell';
import { RecentMineCard } from '@/components/lens/RecentMineCard';
import { AutoActionStrip } from '@/components/lens/AutoActionStrip';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { AnatomyExplorer } from '@/components/organ/AnatomyExplorer';
import { OrgDesigner } from '@/components/organ/OrgDesigner';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';
import { useQuery } from '@tanstack/react-query';
import { api, lensRun } from '@/lib/api/client';
import { useState, useMemo } from 'react';
import {
  Heart, Activity, Zap, TrendingUp, TrendingDown, RefreshCw,
  AlertTriangle, Clock, Wrench,
  ChevronDown, Search, BarChart3, Layers, GitBranch, Play, Loader2, X, Upload,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';

// Concord's own self-model: `GET /api/growth/organs` returns the live state
// of the ~169 named organs in `server/server.js`'s ORGAN_DEFS registry
// (session_memory, psychological_os, council_engine, goal_os, repair_cortex,
// …). Each organ's maturity/wear updates every governor heartbeat (~15s)
// via `kernelTick()` — there is no user-triggerable "tick" or "repair" macro,
// so this page is a read-only introspection surface, not a control panel.
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

// ── Org Analysis input shapes (matches server/domains/organ.js exactly) ──
interface RosterEmployee {
  id: string;
  name: string;
  title: string;
  managerId: string | null;
  skills: string[];
  role?: string;
  demographics?: Record<string, string>;
}
interface OrgChartResult {
  totalEmployees: number;
  totalManagers: number;
  individualContributors: number;
  flatnessLabel: string;
  bottleneckManagers: Array<{ name: string; id: string; directReports: number }>;
  message?: string;
}
interface TeamCompResult {
  teamSize: number;
  uniqueSkills: number;
  gaps: string[];
  // Belbin role-balance + Simpson's-diversity-index sections — real numbers
  // only when the roster carries `role`/`demographics` (organ-capability-map
  // "role/demographics" gap closure); reads as "not offered" otherwise.
  belbinRoleBalance?: {
    score: number;
    filledRoles: number;
    totalRoles: number;
    missingRoles: string[];
    distribution: Record<string, number>;
  };
  demographics?: Record<string, { groups: Record<string, number>; simpsonDiversity: number; uniqueValues: number }>;
  message?: string;
}
interface CommsResult {
  nodes: number;
  edges: number;
  density: number;
  silos: unknown[];
  hubs: Array<{ node: string }>;
  message?: string;
}

export default function OrganLensPage() {
  useLensCommand(
    [
      { id: "organ-grid", keys: "v", description: "Grid view", category: "view", action: () => setViewMode("grid") },
      { id: "organ-timeline", keys: "g", description: "Timeline view", category: "view", action: () => setViewMode("timeline") },
    ],
    { lensId: "organ" }
  );

  useLensNav('organ');
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('organ');
  const [selectedOrgan, setSelectedOrgan] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [sortMode, setSortMode] = useState<SortMode>('health');
  const [searchFilter, setSearchFilter] = useState('');
  const [showFeatures, setShowFeatures] = useState(true);

  // Backend: GET /api/growth/organs — live state of Concord's own 169-organ
  // self-model registry (server.js ORGAN_DEFS). Real fields only: maturity is
  // {score,confidence,stability,plasticity,lastUpdateAt}, wear is
  // {damage,repair,debt} — not flat 0..1 numbers.
  const { data: organsData, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['growth-organs'],
    queryFn: () => api.get('/api/growth/organs').then((r) => r.data as { ok: boolean; organs: OrganState[] }),
    refetchInterval: 20000,
  });

  // Backend: GET /api/growth/status — the organism-level Growth OS vector
  // (bioAge, telomere, epigeneticClock, homeostasis, stress). Same registry
  // kernelTick() maintains; updated on every governor heartbeat.
  const { data: growthData, refetch: refetchGrowth } = useQuery({
    queryKey: ['growth-status'],
    queryFn: () => api.get('/api/growth/status').then((r) => r.data as { ok: boolean; status: GrowthStatus }),
    refetchInterval: 20000,
  });

  const organs: OrganState[] = useMemo(() => organsData?.organs || [], [organsData]);
  const growth = growthData?.status;

  const healthOf = (o: OrganState) => Math.max(0, Math.min(1, (o.maturity?.score ?? 0) - (o.wear?.damage ?? 0)));

  // Filtered and sorted organs
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
    <LensShell lensId="organ" asMain={false}>
      <FirstRunTour lensId="organ" />
      <ManifestActionBar />
      <DepthBadge lensId="organ" size="sm" className="ml-2" />
    <div className="p-6 space-y-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🫀</span>
          <div>
            <h1 className="text-xl font-bold">Organ Lens</h1>
            <p className="text-sm text-gray-400">
              Organizational design (ChartHop-parity) + Concord&apos;s own self-model organ registry
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
          <button onClick={() => { refetch(); refetchGrowth(); }} className="p-2 text-gray-400 hover:text-white" aria-label="Refresh">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* ChartHop-parity org-design platform: visual chart, drag-reassign,
          HRIS import, headcount scenarios, comp rollups, tenure, snapshots */}
      <section className="panel p-4">
        <OrgDesigner />
      </section>

      {/* Org Analysis — real graph-theory macros run against the live roster */}
      <OrgAnalysisPanel />

      <div className="border-t border-white/10 pt-2" />

      <div className="flex items-center gap-2 text-xs text-gray-400">
        <Wrench className="w-3.5 h-3.5" />
        <span>
          Organs below self-update every governor heartbeat (~15s) — this is a
          read-only introspection view of Concord&apos;s own cognitive architecture,
          not a control panel. There is no manual &quot;tick&quot; or per-organ repair action.
        </span>
      </div>

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

      {/* Organ Health Status Cards */}
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

      {/* Organism Overview */}
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

      {/* Controls */}
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

      {/* Organ Grid / Timeline */}
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
                      {/* Wear overlay */}
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

      {/* Growth OS — the organism-level vector kernelTick() maintains */}
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
      <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
        <AnatomyExplorer />
      </section>
    </div>
          <RecentMineCard domain="organ" limit={10} hideWhenEmpty className="mt-4" />
          <AutoActionStrip domain="organ" hideWhenEmpty className="mt-3" />
          <CrossLensRecentsPanel lensId="organ" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
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

/* ─────────────────────────── Org Analysis panel ───────────────────────────
 * Runs the real deterministic graph-theory macros (organ.orgChart /
 * teamComposition / communicationFlow) against the live roster maintained by
 * OrgDesigner above — via POST /api/lens/run, which builds the macro's
 * `artifact.data` straight from the `input` object (no artifact-store
 * indirection needed). Communication-flow has no real interaction-log
 * substrate in Concord today, so it honestly asks for a pasted log instead
 * of pretending one exists.
 * ────────────────────────────────────────────────────────────────────── */
function OrgAnalysisPanel() {
  const [isRunning, setIsRunning] = useState<string | null>(null);
  const [orgChartResult, setOrgChartResult] = useState<OrgChartResult | null>(null);
  const [teamResult, setTeamResult] = useState<TeamCompResult | null>(null);
  const [commsResult, setCommsResult] = useState<CommsResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showCommsPaste, setShowCommsPaste] = useState(false);
  const [commsCsv, setCommsCsv] = useState('');

  const loadRoster = async (): Promise<RosterEmployee[] | null> => {
    const r = await lensRun<{ employees: RosterEmployee[] }>('organ', 'roster-list');
    if (!r.data.ok || !r.data.result) return null;
    return r.data.result.employees || [];
  };

  const runOrgChart = async () => {
    setIsRunning('orgChart'); setErrorMsg(null);
    const employees = await loadRoster();
    if (!employees || employees.length === 0) { setErrorMsg('No roster yet — add people in the Org Chart tab above first.'); setIsRunning(null); return; }
    const r = await lensRun<OrgChartResult>('organ', 'orgChart', { employees });
    if (r.data.ok && r.data.result) setOrgChartResult(r.data.result); else setErrorMsg(r.data.error || 'Org chart analysis failed');
    setIsRunning(null);
  };

  const runTeamComp = async () => {
    setIsRunning('teamComposition'); setErrorMsg(null);
    const employees = await loadRoster();
    if (!employees || employees.length === 0) { setErrorMsg('No roster yet — add people in the Org Chart tab above first.'); setIsRunning(null); return; }
    const team = employees.map((e) => ({ name: e.name, skills: e.skills || [], role: e.role, demographics: e.demographics }));
    const r = await lensRun<TeamCompResult>('organ', 'teamComposition', { team });
    if (r.data.ok && r.data.result) setTeamResult(r.data.result); else setErrorMsg(r.data.error || 'Team composition analysis failed');
    setIsRunning(null);
  };

  const runCommsFlow = async () => {
    if (!commsCsv.trim()) { setErrorMsg('Paste a from,to[,channel[,weight]] log first'); return; }
    setIsRunning('communicationFlow'); setErrorMsg(null);
    const communications = commsCsv
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [from, to, channel, weight] = line.split(',').map((s) => s.trim());
        return { from, to, channel: channel || undefined, weight: weight ? Number(weight) : undefined };
      })
      .filter((c) => c.from && c.to);
    const r = await lensRun<CommsResult>('organ', 'communicationFlow', { communications });
    if (r.data.ok && r.data.result) { setCommsResult(r.data.result); setShowCommsPaste(false); } else setErrorMsg(r.data.error || 'Communication flow analysis failed');
    setIsRunning(null);
  };

  return (
    <div className="panel p-4 space-y-3">
      <h2 className="font-semibold flex items-center gap-2">
        <GitBranch className="w-4 h-4 text-neon-cyan" />
        Org Analysis
        <span className="text-xs text-gray-400 font-normal">graph-theory macros run against the live roster</span>
      </h2>
      <div className="flex flex-wrap gap-2">
        <button onClick={runOrgChart} disabled={!!isRunning} className="btn-secondary text-sm flex items-center gap-1 disabled:opacity-50">
          {isRunning === 'orgChart' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
          Span of Control / Bottlenecks
        </button>
        <button onClick={runTeamComp} disabled={!!isRunning} className="btn-secondary text-sm flex items-center gap-1 disabled:opacity-50">
          {isRunning === 'teamComposition' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
          Skill Coverage / Diversity
        </button>
        <button onClick={() => setShowCommsPaste(true)} disabled={!!isRunning} className="btn-secondary text-sm flex items-center gap-1 disabled:opacity-50">
          {isRunning === 'communicationFlow' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
          Communication Flow (paste log)
        </button>
      </div>
      {errorMsg && (
        <div className="text-xs text-red-400 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> {errorMsg}</div>
      )}

      {orgChartResult && (
        <div className="bg-lattice-deep rounded-lg p-4 space-y-2 text-sm">
          {orgChartResult.message ? <p className="text-gray-400">{orgChartResult.message}</p> : (
            <>
              <div className="flex flex-wrap gap-4 text-xs">
                <span className="text-gray-400">Employees: <span className="text-neon-cyan font-bold">{orgChartResult.totalEmployees}</span></span>
                <span className="text-gray-400">Managers: <span className="text-neon-cyan">{orgChartResult.totalManagers}</span></span>
                <span className="text-gray-400">Structure: <span className="text-neon-purple">{orgChartResult.flatnessLabel}</span></span>
              </div>
              {orgChartResult.bottleneckManagers?.length > 0 && (
                <div>
                  <p className="text-xs text-yellow-400 font-semibold mb-1">Bottleneck Managers</p>
                  {orgChartResult.bottleneckManagers.map((m, i) => (
                    <span key={i} className="text-xs bg-yellow-400/10 border border-yellow-400/20 rounded px-2 py-0.5 mr-1 text-yellow-400">{m.name} ({m.directReports})</span>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {teamResult && (
        <div className="bg-lattice-deep rounded-lg p-4 space-y-2 text-sm">
          {teamResult.message ? <p className="text-gray-400">{teamResult.message}</p> : (
            <>
              <div className="flex flex-wrap gap-4 text-xs">
                <span className="text-gray-400">Size: <span className="text-neon-cyan">{teamResult.teamSize}</span></span>
                <span className="text-gray-400">Skills: <span className="text-neon-cyan">{teamResult.uniqueSkills}</span></span>
              </div>
              {teamResult.gaps?.length > 0 && (
                <div>
                  <p className="text-xs text-red-400 font-semibold mb-1">Skill Gaps (required, uncovered)</p>
                  <div className="flex flex-wrap gap-1">
                    {teamResult.gaps.map((g, i) => <span key={i} className="text-xs bg-red-400/10 border border-red-400/20 rounded px-2 py-0.5 text-red-400">{g}</span>)}
                  </div>
                </div>
              )}
              <div>
                <p className="text-xs text-neon-purple font-semibold mb-1">Belbin Role Balance</p>
                {teamResult.belbinRoleBalance && teamResult.belbinRoleBalance.filledRoles > 0 ? (
                  <>
                    <span className="text-xs text-gray-400">
                      {teamResult.belbinRoleBalance.filledRoles}/{teamResult.belbinRoleBalance.totalRoles} roles filled
                      {' '}(<span className="text-neon-cyan">{(teamResult.belbinRoleBalance.score * 100).toFixed(0)}%</span>)
                    </span>
                    {teamResult.belbinRoleBalance.missingRoles.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {teamResult.belbinRoleBalance.missingRoles.map((r, i) => (
                          <span key={i} className="text-xs bg-lattice-surface border border-lattice-border rounded px-2 py-0.5 text-gray-500">{r}</span>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-xs text-gray-500">Not offered — no roster member has a Belbin team role set. Add one via Edit Person.</p>
                )}
              </div>
              <div>
                <p className="text-xs text-neon-purple font-semibold mb-1">Demographic Diversity (Simpson&apos;s index)</p>
                {teamResult.demographics && Object.keys(teamResult.demographics).length > 0 ? (
                  <div className="space-y-1">
                    {Object.entries(teamResult.demographics).map(([key, d]) => (
                      <div key={key} className="flex items-center gap-2 text-xs">
                        <span className="text-gray-400 w-20 shrink-0">{key}</span>
                        <span className="text-neon-cyan">{d.simpsonDiversity.toFixed(2)}</span>
                        <span className="text-gray-500">({d.uniqueValues} groups)</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-gray-500">Not offered — no roster member has demographics set. Add via Edit Person.</p>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {commsResult && (
        <div className="bg-lattice-deep rounded-lg p-4 space-y-2 text-sm">
          {commsResult.message ? <p className="text-gray-400">{commsResult.message}</p> : (
            <>
              <div className="flex flex-wrap gap-4 text-xs">
                <span className="text-gray-400">Nodes: <span className="text-neon-cyan">{commsResult.nodes}</span></span>
                <span className="text-gray-400">Edges: <span className="text-neon-cyan">{commsResult.edges}</span></span>
                <span className="text-gray-400">Density: <span className="text-neon-green">{commsResult.density}</span></span>
                <span className="text-gray-400">Silos: <span className="text-red-400">{commsResult.silos?.length || 0}</span></span>
              </div>
              {commsResult.hubs?.length > 0 && (
                <div>
                  <p className="text-xs text-neon-green font-semibold mb-1">Hubs</p>
                  <div className="flex flex-wrap gap-1">
                    {commsResult.hubs.map((h, i) => <span key={i} className="text-xs bg-neon-green/10 border border-neon-green/20 rounded px-2 py-0.5 text-neon-green">{h.node}</span>)}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {showCommsPaste && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="panel p-5 max-w-lg w-full space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-sm">Paste a Communication Log</h3>
              <button onClick={() => setShowCommsPaste(false)} className="text-gray-400 hover:text-white" aria-label="Close"><X className="w-4 h-4" /></button>
            </div>
            <p className="text-xs text-gray-400">
              Concord has no internal message-log substrate to analyze automatically —
              this macro is a real network-analysis engine (density, reciprocity, silo
              detection, betweenness-centrality brokers), but it needs your own
              interaction log. One row per line: <code className="text-neon-cyan">from,to,channel,weight</code>
              {' '}(channel and weight optional).
            </p>
            <textarea
              value={commsCsv}
              onChange={(e) => setCommsCsv(e.target.value)}
              placeholder={'ada,grace,slack,3\ngrace,ada,slack,2\nada,linus,email'}
              rows={8}
              className="w-full px-3 py-2 bg-lattice-surface border border-lattice-border rounded text-xs font-mono focus:border-neon-cyan outline-none"
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowCommsPaste(false)} className="px-3 py-1.5 text-sm text-gray-400 hover:text-white">Cancel</button>
              <button onClick={runCommsFlow} disabled={isRunning === 'communicationFlow'} className="btn-neon text-sm flex items-center gap-1">
                {isRunning === 'communicationFlow' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                Analyze
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
