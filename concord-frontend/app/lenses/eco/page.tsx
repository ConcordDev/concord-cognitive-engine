'use client';

import { useState, useMemo, useCallback } from 'react';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import {
  Leaf, Sun, Droplet, Wind, TreeDeciduous, TrendingUp,
  Loader2, Activity, BarChart3, AlertTriangle, RefreshCw,
  Thermometer, Cloud, Zap, Fish, Bug, Mountain, Globe,
  ArrowUpRight, ArrowDownRight, Eye, Shield, Waves, Sprout,
  ChevronDown, ChevronRight, Search, X, Recycle, CheckCircle2,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { ErrorState } from '@/components/common/EmptyState';
import { UniversalActions } from '@/components/lens/UniversalActions';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { cn } from '@/lib/utils';

// ── Types ─────────────────────────────────────────────────────────────────────

type EcoTab = 'overview' | 'populations' | 'climate' | 'biodiversity' | 'impact';

interface PopulationEntry {
  species: string;
  category: 'flora' | 'fauna' | 'fungi' | 'microorganism';
  population: number;
  trend: number;
  habitat: string;
  conservationStatus: 'stable' | 'growing' | 'declining' | 'critical' | 'endangered';
  lastSurveyed: string;
}

interface ClimateDataPoint {
  month: string;
  temperature: number;
  precipitation: number;
  humidity: number;
  co2Level: number;
  uvIndex: number;
}

interface BiodiversityIndex {
  zone: string;
  shannonIndex: number;
  simpsonIndex: number;
  speciesRichness: number;
  evenness: number;
  trend: 'improving' | 'stable' | 'declining';
  lastAssessed: string;
}

interface ImpactAssessment {
  id: string;
  name: string;
  type: 'deforestation' | 'pollution' | 'urbanization' | 'climate' | 'invasive_species' | 'resource_extraction';
  severity: 'low' | 'moderate' | 'high' | 'critical';
  affectedArea: number;
  mitigationStatus: 'not_started' | 'planned' | 'in_progress' | 'completed';
  description: string;
  startDate: string;
}

// ── Seed Data ─────────────────────────────────────────────────────────────────

const SEED_METRICS: { title: string; data: { id: string; value: number; unit: string; icon: string; color: string } }[] = [];

const SEED_ORGANISMS: { title: string; data: { type: string; count: number; growth: number } }[] = [];

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  Sun,
  Droplet,
  Wind,
  TreeDeciduous,
};

// ── Data now fetched from real API via useLensData (see component body) ──────

// ── Helper Functions ──────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  stable: 'text-neon-blue bg-neon-blue/10 border-neon-blue/30',
  growing: 'text-neon-green bg-neon-green/10 border-neon-green/30',
  declining: 'text-neon-orange bg-neon-orange/10 border-neon-orange/30',
  critical: 'text-red-400 bg-red-400/10 border-red-400/30',
  endangered: 'text-neon-pink bg-neon-pink/10 border-neon-pink/30',
};

const SEVERITY_COLORS: Record<string, string> = {
  low: 'text-gray-400 bg-gray-400/10',
  moderate: 'text-neon-blue bg-neon-blue/10',
  high: 'text-neon-orange bg-neon-orange/10',
  critical: 'text-red-400 bg-red-400/10',
};

const MITIGATION_COLORS: Record<string, string> = {
  not_started: 'text-gray-500',
  planned: 'text-neon-blue',
  in_progress: 'text-neon-orange',
  completed: 'text-neon-green',
};

const TREND_COLORS: Record<string, string> = {
  improving: 'text-neon-green',
  stable: 'text-neon-blue',
  declining: 'text-red-400',
};

const CATEGORY_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  flora: TreeDeciduous,
  fauna: Fish,
  fungi: Sprout,
  microorganism: Bug,
};

function formatPopulation(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function EcoLensPage() {
  useLensNav('eco');
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('eco');

  const [activeTab, setActiveTab] = useState<EcoTab>('overview');
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [expandedImpact, setExpandedImpact] = useState<string | null>(null);
  const [showSimulation, setShowSimulation] = useState(false);
  const [simulationSpeed, setSimulationSpeed] = useState<'slow' | 'normal' | 'fast'>('normal');

  const { items: metricItems, isLoading: metricsLoading, isError, error, refetch } = useLensData('eco', 'metric', {
    seed: SEED_METRICS,
  });

  const { items: organismItems, isLoading: organismsLoading, isError: isError2, error: error2, refetch: refetch2 } = useLensData('eco', 'organism', {
    seed: SEED_ORGANISMS,
  });

  const { items: populationItems } = useLensData<PopulationEntry>('eco', 'population', { noSeed: true });
  const { items: climateItems } = useLensData<ClimateDataPoint>('eco', 'climate', { noSeed: true });
  const { items: biodiversityItems } = useLensData<BiodiversityIndex>('eco', 'biodiversity', { noSeed: true });
  const { items: impactItems } = useLensData<ImpactAssessment>('eco', 'impact', { noSeed: true });

  // Map fetched items to typed arrays (real API data, empty if no DTUs exist yet)
  const POPULATIONS: PopulationEntry[] = useMemo(() =>
    populationItems.map(i => ({ ...i.data } as PopulationEntry)), [populationItems]);
  const CLIMATE: ClimateDataPoint[] = useMemo(() =>
    climateItems.map(i => ({ ...i.data } as ClimateDataPoint)), [climateItems]);
  const BIODIVERSITY: BiodiversityIndex[] = useMemo(() =>
    biodiversityItems.map(i => ({ ...i.data } as BiodiversityIndex)), [biodiversityItems]);
  const IMPACTS: ImpactAssessment[] = useMemo(() =>
    impactItems.map(i => ({ ...i.data } as ImpactAssessment)), [impactItems]);

  const isLoading = metricsLoading || organismsLoading;

  // Map fetched items to display shape
  const ecosystemMetrics = metricItems.map((item) => {
    const d = item.data as { id: string; value: number; unit: string; icon: string; color: string };
    return {
      id: d.id ?? item.id,
      name: item.title,
      value: d.value,
      unit: d.unit,
      icon: ICON_MAP[d.icon] ?? Sun,
      color: d.color ?? 'text-gray-400',
    };
  });

  const organisms = organismItems.map((item) => {
    const d = item.data as { type: string; count: number; growth: number };
    return { type: d.type ?? item.title, count: d.count, growth: d.growth };
  });

  // Filtered populations
  const filteredPopulations = useMemo(() => {
    let list = [...POPULATIONS];
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(p =>
        p.species.toLowerCase().includes(q) ||
        p.habitat.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q)
      );
    }
    if (categoryFilter !== 'all') {
      list = list.filter(p => p.category === categoryFilter);
    }
    return list;
  }, [searchQuery, categoryFilter, POPULATIONS]);

  // Aggregated stats
  const totalSpecies = POPULATIONS.length;
  const criticalCount = POPULATIONS.filter(p => p.conservationStatus === 'critical' || p.conservationStatus === 'endangered').length;
  const growingCount = POPULATIONS.filter(p => p.conservationStatus === 'growing').length;
  const avgBiodiversity = BIODIVERSITY.reduce((sum, b) => sum + b.shannonIndex, 0) / BIODIVERSITY.length;
  const totalImpactArea = IMPACTS.reduce((sum, i) => sum + i.affectedArea, 0);
  const criticalImpacts = IMPACTS.filter(i => i.severity === 'critical' || i.severity === 'high').length;

  const handleRefresh = useCallback(() => {
    refetch();
    refetch2();
  }, [refetch, refetch2]);

  // --- Domain action state ---
  const runAction = useRunArtifact('eco');
  const [actionResult, setActionResult] = useState<Record<string, unknown> | null>(null);
  const [activeAction, setActiveAction] = useState<string | null>(null);

  const handleEcoAction = useCallback(async (action: string) => {
    const targetId = metricItems[0]?.id;
    if (!targetId) return;
    setActiveAction(action);
    setActionResult(null);
    try {
      const res = await runAction.mutateAsync({ id: targetId, action });
      if (res.ok === false) { setActionResult({ message: `Action failed: ${(res as Record<string, unknown>).error || 'Unknown error'}` }); } else { setActionResult(res.result as Record<string, unknown>); }
    } catch (e) { console.error(`Action ${action} failed:`, e); setActionResult({ message: `Action failed: ${e instanceof Error ? e.message : 'Unknown error'}` }); }
    setActiveAction(null);
  }, [metricItems, runAction]);

  const tabs: { id: EcoTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'overview', label: 'Overview', icon: Globe },
    { id: 'populations', label: 'Populations', icon: Fish },
    { id: 'climate', label: 'Climate', icon: Thermometer },
    { id: 'biodiversity', label: 'Biodiversity', icon: Leaf },
    { id: 'impact', label: 'Impact', icon: AlertTriangle },
  ];

  // ── Loading & Error States ──────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="p-6 flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-neon-green" />
        <span className="ml-3 text-gray-400">Loading ecosystem data...</span>
      </div>
    );
  }

  if (isError || isError2) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <ErrorState error={error?.message || error2?.message} onRetry={handleRefresh} />
      </div>
    );
  }

  // ── Render: Overview Tab ────────────────────────────────────────────────────

  const renderOverview = () => (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        {[
          { icon: Fish, color: 'text-neon-cyan', value: totalSpecies, label: 'Tracked Species', valueColor: '' },
          { icon: AlertTriangle, color: 'text-red-400', value: criticalCount, label: 'At Risk', valueColor: 'text-red-400' },
          { icon: TrendingUp, color: 'text-neon-green', value: growingCount, label: 'Growing', valueColor: 'text-neon-green' },
          { icon: Leaf, color: 'text-neon-blue', value: avgBiodiversity.toFixed(2), label: 'Avg Shannon Index', valueColor: '' },
          { icon: Mountain, color: 'text-neon-orange', value: totalImpactArea.toLocaleString(), label: 'Impacted Hectares', valueColor: '' },
          { icon: Shield, color: 'text-neon-purple', value: criticalImpacts, label: 'High/Critical Impacts', valueColor: 'text-neon-orange' },
        ].map((card, index) => {
          const CardIcon = card.icon;
          return (
            <motion.div key={card.label} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.05 }} className="lens-card">
              <CardIcon className={`w-5 h-5 ${card.color} mb-2`} />
              <p className={`text-2xl font-bold ${card.valueColor}`}>{card.value}</p>
              <p className="text-sm text-gray-400">{card.label}</p>
            </motion.div>
          );
        })}
      </div>

      {/* Ecosystem Metrics from Backend */}
      {ecosystemMetrics.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {ecosystemMetrics.map((metric) => {
            const Icon = metric.icon;
            return (
              <div key={metric.id} className="lens-card">
                <Icon className={`w-5 h-5 ${metric.color} mb-2`} />
                <p className="text-2xl font-bold">{(metric.value * 100).toFixed(0)}%</p>
                <p className="text-sm text-gray-400">{metric.name}</p>
              </div>
            );
          })}
        </div>
      )}

      {/* Ecosystem Health from Backend */}
      {organisms.length > 0 && (
        <div className="panel p-4">
          <h2 className="font-semibold mb-4 flex items-center gap-2">
            <Leaf className="w-4 h-4 text-neon-green" />
            Ecosystem Health
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {organisms.map((org) => (
              <div key={org.type} className="lens-card">
                <div className="flex items-center justify-between mb-2">
                  <p className="font-semibold">{org.type}</p>
                  <span className={`text-xs ${org.growth >= 0 ? 'text-neon-green' : 'text-neon-pink'}`}>
                    {org.growth >= 0 ? '+' : ''}{(org.growth * 100).toFixed(1)}%
                  </span>
                </div>
                <p className="text-2xl font-bold text-neon-cyan">{org.count.toLocaleString()}</p>
                <p className="text-xs text-gray-500">Population</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Growth OS Mapping Chart */}
      <div className="panel p-4">
        <h2 className="font-semibold mb-4 flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-neon-blue" />
          Growth OS Mapping
        </h2>
        <p className="text-sm text-gray-400 mb-4">
          Maps ecosystem dynamics to organism maturation kernel
        </p>
        <div className="h-32 flex items-end gap-1">
          {Array.from({ length: 30 }).map((_, i) => (
            <div
              key={i}
              className="flex-1 bg-gradient-to-t from-neon-green to-neon-cyan rounded-t"
              style={{ height: `${30 + Math.sin(i * 0.5) * 50}%` }}
            />
          ))}
        </div>
      </div>

      {/* Quick Climate Summary */}
      <div className="panel p-4">
        <h2 className="font-semibold mb-4 flex items-center gap-2">
          <Thermometer className="w-4 h-4 text-neon-orange" />
          Climate Summary (6-Month Trend)
        </h2>
        <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
          {CLIMATE.map((point) => (
            <div key={point.month} className="text-center">
              <p className="text-xs text-gray-500 mb-1">{point.month}</p>
              <p className={cn(
                'text-lg font-bold',
                point.temperature > 10 ? 'text-neon-orange' : point.temperature > 0 ? 'text-neon-cyan' : 'text-neon-blue'
              )}>
                {point.temperature > 0 ? '+' : ''}{point.temperature.toFixed(1)}
              </p>
              <p className="text-xs text-gray-500">{point.precipitation}mm</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  // ── Render: Populations Tab ─────────────────────────────────────────────────

  const renderPopulations = () => (
    <div className="space-y-4">
      {/* Search and Filter */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search species, habitats..."
            className="w-full pl-10 pr-4 py-2 bg-lattice-surface border border-lattice-border rounded-lg text-sm focus:outline-none focus:border-neon-green/50"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="px-3 py-2 bg-lattice-surface border border-lattice-border rounded-lg text-sm focus:outline-none focus:border-neon-green/50"
        >
          <option value="all">All Categories</option>
          <option value="flora">Flora</option>
          <option value="fauna">Fauna</option>
          <option value="fungi">Fungi</option>
          <option value="microorganism">Microorganisms</option>
        </select>
      </div>

      {/* Population Growth Curves Visualization */}
      <div className="panel p-4">
        <h2 className="font-semibold mb-4 flex items-center gap-2">
          <Activity className="w-4 h-4 text-neon-green" />
          Population Growth Curves
        </h2>
        <div className="h-40 flex items-end gap-2">
          {filteredPopulations.slice(0, 12).map((pop, _i) => {
            const maxPop = Math.max(...filteredPopulations.map(p => p.population));
            const normalizedHeight = Math.max(5, (pop.population / maxPop) * 100);
            const CategoryIcon = CATEGORY_ICONS[pop.category] || Bug;
            return (
              <div key={pop.species} className="flex-1 flex flex-col items-center gap-1" title={`${pop.species}: ${formatPopulation(pop.population)}`}>
                <span className={cn('text-[10px]', pop.trend >= 0 ? 'text-neon-green' : 'text-red-400')}>
                  {pop.trend >= 0 ? '+' : ''}{pop.trend.toFixed(1)}%
                </span>
                <div
                  className={cn(
                    'w-full rounded-t transition-all',
                    pop.conservationStatus === 'critical' || pop.conservationStatus === 'endangered'
                      ? 'bg-gradient-to-t from-red-500/80 to-red-400/40'
                      : pop.conservationStatus === 'growing'
                      ? 'bg-gradient-to-t from-neon-green/80 to-neon-green/30'
                      : pop.conservationStatus === 'declining'
                      ? 'bg-gradient-to-t from-neon-orange/80 to-neon-orange/30'
                      : 'bg-gradient-to-t from-neon-cyan/80 to-neon-cyan/30'
                  )}
                  style={{ height: `${normalizedHeight}%` }}
                />
                <CategoryIcon className="w-3 h-3 text-gray-500" />
                <span className="text-[9px] text-gray-500 truncate max-w-full text-center">{pop.species.split(' ').pop()}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Species Tracking Table */}
      <div className="panel overflow-hidden">
        <div className="p-4 border-b border-lattice-border">
          <h2 className="font-semibold flex items-center gap-2">
            <Eye className="w-4 h-4 text-neon-cyan" />
            Species Tracking Table
          </h2>
          <p className="text-xs text-gray-500 mt-1">{filteredPopulations.length} species tracked</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-lattice-border bg-lattice-surface/50">
                <th className="text-left px-4 py-3 font-medium text-gray-400">Species</th>
                <th className="text-left px-4 py-3 font-medium text-gray-400">Category</th>
                <th className="text-right px-4 py-3 font-medium text-gray-400">Population</th>
                <th className="text-right px-4 py-3 font-medium text-gray-400">Trend</th>
                <th className="text-left px-4 py-3 font-medium text-gray-400">Habitat</th>
                <th className="text-left px-4 py-3 font-medium text-gray-400">Status</th>
                <th className="text-left px-4 py-3 font-medium text-gray-400">Last Surveyed</th>
              </tr>
            </thead>
            <tbody>
              {filteredPopulations.map((pop) => {
                const CategoryIcon = CATEGORY_ICONS[pop.category] || Bug;
                return (
                  <tr key={pop.species} className="border-b border-lattice-border/50 hover:bg-lattice-elevated/50 transition-colors">
                    <td className="px-4 py-3 font-medium">{pop.species}</td>
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-1.5 text-gray-400">
                        <CategoryIcon className="w-3.5 h-3.5" />
                        {pop.category}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono">{formatPopulation(pop.population)}</td>
                    <td className="px-4 py-3 text-right">
                      <span className={cn('flex items-center justify-end gap-1', pop.trend >= 0 ? 'text-neon-green' : 'text-red-400')}>
                        {pop.trend >= 0 ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                        {pop.trend >= 0 ? '+' : ''}{pop.trend.toFixed(1)}%
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-400">{pop.habitat}</td>
                    <td className="px-4 py-3">
                      <span className={cn('text-xs px-2 py-0.5 rounded-full border', STATUS_COLORS[pop.conservationStatus])}>
                        {pop.conservationStatus}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{pop.lastSurveyed}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );

  // ── Render: Climate Tab ─────────────────────────────────────────────────────

  const renderClimate = () => (
    <div className="space-y-6">
      {/* Temperature Chart */}
      <div className="panel p-4">
        <h2 className="font-semibold mb-4 flex items-center gap-2">
          <Thermometer className="w-4 h-4 text-red-400" />
          Temperature Trend (6-Month)
        </h2>
        <div className="h-48 flex items-center">
          <div className="w-full h-full flex items-end gap-2 relative">
            {/* Zero line */}
            <div className="absolute left-0 right-0 border-t border-dashed border-gray-600" style={{ bottom: '50%' }} />
            <span className="absolute -left-1 text-[10px] text-gray-500" style={{ bottom: 'calc(50% - 6px)' }}>0</span>
            {CLIMATE.map((point) => {
              const normalizedTemp = ((point.temperature + 10) / 30) * 100;
              return (
                <div key={point.month} className="flex-1 flex flex-col items-center gap-1 h-full justify-end">
                  <span className="text-xs font-mono text-gray-300">{point.temperature > 0 ? '+' : ''}{point.temperature}</span>
                  <div
                    className={cn(
                      'w-full rounded-t transition-all',
                      point.temperature > 15 ? 'bg-red-400/70' : point.temperature > 5 ? 'bg-neon-orange/60' : point.temperature > 0 ? 'bg-neon-cyan/60' : 'bg-neon-blue/60'
                    )}
                    style={{ height: `${Math.max(4, normalizedTemp)}%` }}
                  />
                  <span className="text-xs text-gray-500">{point.month}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Precipitation & Humidity */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="panel p-4">
          <h2 className="font-semibold mb-4 flex items-center gap-2">
            <Droplet className="w-4 h-4 text-neon-blue" />
            Precipitation (mm)
          </h2>
          <div className="h-32 flex items-end gap-2">
            {CLIMATE.map((point) => (
              <div key={point.month} className="flex-1 flex flex-col items-center gap-1">
                <span className="text-[10px] text-gray-400">{point.precipitation}</span>
                <div
                  className="w-full bg-gradient-to-t from-neon-blue/80 to-neon-blue/20 rounded-t"
                  style={{ height: `${(point.precipitation / 100) * 100}%` }}
                />
                <span className="text-[10px] text-gray-500">{point.month}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="panel p-4">
          <h2 className="font-semibold mb-4 flex items-center gap-2">
            <Waves className="w-4 h-4 text-neon-cyan" />
            Humidity (%)
          </h2>
          <div className="h-32 flex items-end gap-2">
            {CLIMATE.map((point) => (
              <div key={point.month} className="flex-1 flex flex-col items-center gap-1">
                <span className="text-[10px] text-gray-400">{point.humidity}%</span>
                <div
                  className="w-full bg-gradient-to-t from-neon-cyan/80 to-neon-cyan/20 rounded-t"
                  style={{ height: `${point.humidity}%` }}
                />
                <span className="text-[10px] text-gray-500">{point.month}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* CO2 Levels & UV Index */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="panel p-4">
          <h2 className="font-semibold mb-4 flex items-center gap-2">
            <Cloud className="w-4 h-4 text-gray-400" />
            CO2 Concentration (ppm)
          </h2>
          <div className="space-y-3">
            {CLIMATE.map((point) => {
              const pct = ((point.co2Level - 415) / 10) * 100;
              return (
                <div key={point.month} className="flex items-center gap-3">
                  <span className="w-8 text-xs text-gray-500">{point.month}</span>
                  <div className="flex-1 h-3 bg-lattice-surface rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-neon-orange/60 to-red-400/60 rounded-full" style={{ width: `${Math.min(100, pct)}%` }} />
                  </div>
                  <span className="text-xs font-mono text-gray-300 w-10 text-right">{point.co2Level}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="panel p-4">
          <h2 className="font-semibold mb-4 flex items-center gap-2">
            <Sun className="w-4 h-4 text-yellow-400" />
            UV Index
          </h2>
          <div className="space-y-3">
            {CLIMATE.map((point) => (
              <div key={point.month} className="flex items-center gap-3">
                <span className="w-8 text-xs text-gray-500">{point.month}</span>
                <div className="flex-1 h-3 bg-lattice-surface rounded-full overflow-hidden">
                  <div
                    className={cn(
                      'h-full rounded-full',
                      point.uvIndex > 4 ? 'bg-red-400/60' : point.uvIndex > 2 ? 'bg-yellow-400/60' : 'bg-neon-green/60'
                    )}
                    style={{ width: `${(point.uvIndex / 8) * 100}%` }}
                  />
                </div>
                <span className="text-xs font-mono text-gray-300 w-10 text-right">{point.uvIndex}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );

  // ── Render: Biodiversity Tab ────────────────────────────────────────────────

  const renderBiodiversity = () => (
    <div className="space-y-6">
      {/* Biodiversity Indices Comparison */}
      <div className="panel p-4">
        <h2 className="font-semibold mb-4 flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-neon-green" />
          Biodiversity Index Comparison by Zone
        </h2>
        <div className="h-48 flex items-end gap-3">
          {BIODIVERSITY.map((zone) => (
            <div key={zone.zone} className="flex-1 flex flex-col items-center gap-1">
              <span className="text-[10px] text-gray-400">{zone.shannonIndex.toFixed(2)}</span>
              <div className="w-full flex gap-0.5 h-36 items-end">
                <div
                  className="flex-1 bg-gradient-to-t from-neon-green/80 to-neon-green/20 rounded-t"
                  style={{ height: `${(zone.shannonIndex / 4) * 100}%` }}
                  title={`Shannon: ${zone.shannonIndex}`}
                />
                <div
                  className="flex-1 bg-gradient-to-t from-neon-blue/80 to-neon-blue/20 rounded-t"
                  style={{ height: `${zone.simpsonIndex * 100}%` }}
                  title={`Simpson: ${zone.simpsonIndex}`}
                />
                <div
                  className="flex-1 bg-gradient-to-t from-neon-cyan/80 to-neon-cyan/20 rounded-t"
                  style={{ height: `${zone.evenness * 100}%` }}
                  title={`Evenness: ${zone.evenness}`}
                />
              </div>
              <span className="text-[9px] text-gray-500 text-center truncate max-w-full">{zone.zone.split(' ')[0]}</span>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-center gap-6 mt-4 text-xs text-gray-400">
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-neon-green/60" /> Shannon</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-neon-blue/60" /> Simpson</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-neon-cyan/60" /> Evenness</span>
        </div>
      </div>

      {/* Biodiversity Zone Details */}
      <div className="panel overflow-hidden">
        <div className="p-4 border-b border-lattice-border">
          <h2 className="font-semibold flex items-center gap-2">
            <Globe className="w-4 h-4 text-neon-blue" />
            Zone Biodiversity Metrics
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-lattice-border bg-lattice-surface/50">
                <th className="text-left px-4 py-3 font-medium text-gray-400">Zone</th>
                <th className="text-right px-4 py-3 font-medium text-gray-400">Shannon H&apos;</th>
                <th className="text-right px-4 py-3 font-medium text-gray-400">Simpson 1-D</th>
                <th className="text-right px-4 py-3 font-medium text-gray-400">Species Richness</th>
                <th className="text-right px-4 py-3 font-medium text-gray-400">Evenness</th>
                <th className="text-left px-4 py-3 font-medium text-gray-400">Trend</th>
                <th className="text-left px-4 py-3 font-medium text-gray-400">Assessed</th>
              </tr>
            </thead>
            <tbody>
              {BIODIVERSITY.map((zone) => (
                <tr key={zone.zone} className="border-b border-lattice-border/50 hover:bg-lattice-elevated/50 transition-colors">
                  <td className="px-4 py-3 font-medium">{zone.zone}</td>
                  <td className="px-4 py-3 text-right font-mono">{zone.shannonIndex.toFixed(2)}</td>
                  <td className="px-4 py-3 text-right font-mono">{zone.simpsonIndex.toFixed(2)}</td>
                  <td className="px-4 py-3 text-right font-mono">{zone.speciesRichness}</td>
                  <td className="px-4 py-3 text-right font-mono">{zone.evenness.toFixed(2)}</td>
                  <td className="px-4 py-3">
                    <span className={cn('flex items-center gap-1', TREND_COLORS[zone.trend])}>
                      {zone.trend === 'improving' && <ArrowUpRight className="w-3 h-3" />}
                      {zone.trend === 'declining' && <ArrowDownRight className="w-3 h-3" />}
                      {zone.trend === 'stable' && <Activity className="w-3 h-3" />}
                      {zone.trend}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">{zone.lastAssessed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Species Richness Distribution */}
      <div className="panel p-4">
        <h2 className="font-semibold mb-4 flex items-center gap-2">
          <Sprout className="w-4 h-4 text-neon-green" />
          Species Richness Distribution
        </h2>
        <div className="space-y-3">
          {BIODIVERSITY.sort((a, b) => b.speciesRichness - a.speciesRichness).map((zone) => {
            const maxRichness = Math.max(...BIODIVERSITY.map(z => z.speciesRichness));
            return (
              <div key={zone.zone} className="flex items-center gap-3">
                <span className="w-32 text-xs text-gray-400 truncate">{zone.zone}</span>
                <div className="flex-1 h-5 bg-lattice-surface rounded-full overflow-hidden">
                  <div
                    className={cn(
                      'h-full rounded-full transition-all',
                      zone.trend === 'improving' ? 'bg-neon-green/70' : zone.trend === 'declining' ? 'bg-neon-orange/70' : 'bg-neon-blue/70'
                    )}
                    style={{ width: `${(zone.speciesRichness / maxRichness) * 100}%` }}
                  />
                </div>
                <span className="text-xs font-mono text-gray-300 w-8 text-right">{zone.speciesRichness}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );

  // ── Render: Impact Assessment Tab ───────────────────────────────────────────

  const renderImpact = () => (
    <div className="space-y-4">
      {/* Impact Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {(['low', 'moderate', 'high', 'critical'] as const).map((sev) => {
          const count = IMPACTS.filter(i => i.severity === sev).length;
          return (
            <div key={sev} className="lens-card">
              <p className={cn('text-xs uppercase font-medium mb-1', SEVERITY_COLORS[sev].split(' ')[0])}>{sev}</p>
              <p className="text-2xl font-bold">{count}</p>
              <p className="text-xs text-gray-500">assessments</p>
            </div>
          );
        })}
      </div>

      {/* Impact Assessments List */}
      <div className="space-y-3">
        {IMPACTS.map((impact) => {
          const isExpanded = expandedImpact === impact.id;
          return (
            <div key={impact.id} className="panel overflow-hidden">
              <button
                onClick={() => setExpandedImpact(isExpanded ? null : impact.id)}
                className="w-full p-4 flex items-center justify-between hover:bg-lattice-elevated/30 transition-colors text-left"
              >
                <div className="flex items-center gap-3">
                  <div className={cn('w-2 h-2 rounded-full', {
                    'bg-gray-400': impact.severity === 'low',
                    'bg-neon-blue': impact.severity === 'moderate',
                    'bg-neon-orange': impact.severity === 'high',
                    'bg-red-400': impact.severity === 'critical',
                  })} />
                  <div>
                    <p className="font-medium">{impact.name}</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {impact.type.replace('_', ' ')} &middot; {impact.affectedArea} ha &middot; Since {impact.startDate}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={cn('text-xs px-2 py-0.5 rounded', SEVERITY_COLORS[impact.severity])}>
                    {impact.severity}
                  </span>
                  <span className={cn('text-xs', MITIGATION_COLORS[impact.mitigationStatus])}>
                    {impact.mitigationStatus.replace('_', ' ')}
                  </span>
                  {isExpanded ? <ChevronDown className="w-4 h-4 text-gray-500" /> : <ChevronRight className="w-4 h-4 text-gray-500" />}
                </div>
              </button>
              {isExpanded && (
                <div className="px-4 pb-4 border-t border-lattice-border/50 pt-3">
                  <p className="text-sm text-gray-300">{impact.description}</p>
                  <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div>
                      <p className="text-xs text-gray-500">Type</p>
                      <p className="text-sm font-medium capitalize">{impact.type.replace('_', ' ')}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Affected Area</p>
                      <p className="text-sm font-medium">{impact.affectedArea} hectares</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Severity</p>
                      <p className={cn('text-sm font-medium capitalize', SEVERITY_COLORS[impact.severity].split(' ')[0])}>{impact.severity}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Mitigation</p>
                      <p className={cn('text-sm font-medium capitalize', MITIGATION_COLORS[impact.mitigationStatus])}>
                        {impact.mitigationStatus.replace('_', ' ')}
                      </p>
                    </div>
                  </div>
                  {/* Impact severity progress bar */}
                  <div className="mt-3">
                    <p className="text-xs text-gray-500 mb-1">Mitigation Progress</p>
                    <div className="h-2 bg-lattice-surface rounded-full overflow-hidden">
                      <div
                        className={cn('h-full rounded-full transition-all', {
                          'bg-gray-500 w-[5%]': impact.mitigationStatus === 'not_started',
                          'bg-neon-blue': impact.mitigationStatus === 'planned',
                          'bg-neon-orange': impact.mitigationStatus === 'in_progress',
                          'bg-neon-green': impact.mitigationStatus === 'completed',
                        })}
                        style={{
                          width: impact.mitigationStatus === 'not_started' ? '5%'
                            : impact.mitigationStatus === 'planned' ? '25%'
                            : impact.mitigationStatus === 'in_progress' ? '60%'
                            : '100%'
                        }}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );

  // ── Render: Simulation Controls ─────────────────────────────────────────────

  const renderSimulationControls = () => (
    <div className="panel p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold flex items-center gap-2">
          <Zap className="w-4 h-4 text-neon-purple" />
          Ecosystem Simulation
        </h3>
        <button
          onClick={() => setShowSimulation(!showSimulation)}
          className={cn(
            'text-xs px-3 py-1 rounded-lg transition-colors',
            showSimulation ? 'bg-neon-green/20 text-neon-green' : 'bg-lattice-elevated text-gray-400 hover:text-white'
          )}
        >
          {showSimulation ? 'Running...' : 'Start Simulation'}
        </button>
      </div>
      {showSimulation && (
        <div className="space-y-3">
          <div className="flex items-center gap-4">
            <span className="text-xs text-gray-400">Speed:</span>
            {(['slow', 'normal', 'fast'] as const).map((speed) => (
              <button
                key={speed}
                onClick={() => setSimulationSpeed(speed)}
                className={cn(
                  'text-xs px-2 py-1 rounded transition-colors capitalize',
                  simulationSpeed === speed ? 'bg-neon-purple/20 text-neon-purple' : 'text-gray-500 hover:text-white'
                )}
              >
                {speed}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="text-center">
              <div className="w-12 h-12 mx-auto rounded-full border-2 border-neon-green/40 flex items-center justify-center animate-pulse">
                <TreeDeciduous className="w-5 h-5 text-neon-green" />
              </div>
              <p className="text-xs text-gray-400 mt-1">Flora Sim</p>
              <p className="text-xs text-neon-green">Active</p>
            </div>
            <div className="text-center">
              <div className="w-12 h-12 mx-auto rounded-full border-2 border-neon-cyan/40 flex items-center justify-center animate-pulse">
                <Fish className="w-5 h-5 text-neon-cyan" />
              </div>
              <p className="text-xs text-gray-400 mt-1">Fauna Sim</p>
              <p className="text-xs text-neon-cyan">Active</p>
            </div>
            <div className="text-center">
              <div className="w-12 h-12 mx-auto rounded-full border-2 border-neon-blue/40 flex items-center justify-center animate-pulse">
                <Waves className="w-5 h-5 text-neon-blue" />
              </div>
              <p className="text-xs text-gray-400 mt-1">Climate Sim</p>
              <p className="text-xs text-neon-blue">Active</p>
            </div>
          </div>
          {/* Simulation output visualization */}
          <div className="h-20 flex items-end gap-0.5">
            {Array.from({ length: 60 }).map((_, i) => {
              const h = 20 + Math.sin(i * 0.3 + Date.now() * 0.001) * 30 + Math.random() * 20;
              return (
                <div
                  key={i}
                  className="flex-1 bg-gradient-to-t from-neon-purple/60 to-neon-green/20 rounded-t transition-all"
                  style={{ height: `${Math.max(5, h)}%` }}
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );

  // ── Main Render ─────────────────────────────────────────────────────────────

  return (
    <div data-lens-theme="eco" className="p-6 space-y-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🌿</span>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold">Eco Lens</h1>
              <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} />
            </div>
            <p className="text-sm text-gray-400">
              Ecosystem simulations, biodiversity tracking, and environmental impact analysis
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <DTUExportButton domain="eco" data={{}} compact />
          <button onClick={handleRefresh} className="p-2 rounded-lg hover:bg-lattice-elevated text-gray-400 hover:text-white transition-colors">
            <RefreshCw className="w-5 h-5" />
          </button>
        </div>
      </header>

      <RealtimeDataPanel domain="eco" data={realtimeData} isLive={isLive} lastUpdated={lastUpdated} insights={insights} compact />

      {/* AI Actions */}
      <UniversalActions domain="eco" artifactId={metricItems[0]?.id} compact />

      {/* ── Domain Action Panel ─────────────────────────────────── */}
      <div className="panel p-4 space-y-3">
        <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
          <Zap className="w-4 h-4 text-neon-green" /> AI Eco Analysis
        </h3>
        <div className="flex flex-wrap gap-2">
          {(['carbonFootprint','biodiversityIndex','sustainabilityScore'] as const).map(action => (
            <button
              key={action}
              onClick={() => handleEcoAction(action)}
              disabled={activeAction !== null || !metricItems[0]?.id}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-neon-green/10 border border-neon-green/30 text-neon-green hover:bg-neon-green/20 disabled:opacity-50 transition-colors"
            >
              {activeAction === action ? <Loader2 className="w-3 h-3 animate-spin" /> : <Leaf className="w-3 h-3" />}
              {action === 'carbonFootprint' ? 'Carbon Footprint' : action === 'biodiversityIndex' ? 'Biodiversity Index' : 'Sustainability Score'}
            </button>
          ))}
        </div>

        {/* carbonFootprint result */}
        {actionResult && actionResult.totalEmissionsKgCO2e !== undefined && (
          <div className="space-y-3 pt-2 border-t border-white/5">
            <div className="grid grid-cols-4 gap-2">
              <div className="p-2 bg-lattice-surface rounded text-center">
                <p className="text-lg font-bold text-neon-green">{String(actionResult.totalEmissionsTonneCO2e ?? 0)}</p>
                <p className="text-[10px] text-gray-500">Tonnes CO₂e</p>
              </div>
              <div className="p-2 bg-lattice-surface rounded text-center">
                <p className={`text-lg font-bold ${Number(actionResult.netEmissionsKgCO2e) <= 0 ? 'text-neon-green' : 'text-red-400'}`}>{String(actionResult.netEmissionsKgCO2e ?? 0)}</p>
                <p className="text-[10px] text-gray-500">Net kg CO₂e</p>
              </div>
              <div className="p-2 bg-lattice-surface rounded text-center">
                <p className="text-lg font-bold text-neon-cyan">{String(actionResult.offsetPercentage ?? 0)}%</p>
                <p className="text-[10px] text-gray-500">Offset %</p>
              </div>
              <div className="p-2 bg-lattice-surface rounded text-center">
                <p className={`text-xs font-bold ${actionResult.carbonNeutral ? 'text-neon-green' : 'text-red-400'}`}>{actionResult.carbonNeutral ? 'NEUTRAL' : 'NOT NEUTRAL'}</p>
                <p className="text-[10px] text-gray-500">Status</p>
              </div>
            </div>
            {!!actionResult.scopeBreakdown && (
              <div className="grid grid-cols-3 gap-2">
                {Object.entries(actionResult.scopeBreakdown as Record<string, {kgCO2e:number;percentage:number;label:string}>).map(([scope, data]) => (
                  <div key={scope} className="p-2 bg-lattice-surface rounded text-center">
                    <p className="text-sm font-bold text-neon-cyan">{data.percentage}%</p>
                    <p className="text-[10px] text-gray-500">{data.label}</p>
                    <p className="text-[10px] text-gray-600">{data.kgCO2e} kg</p>
                  </div>
                ))}
              </div>
            )}
            {!!actionResult.equivalencies && (
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div className="p-2 bg-white/[0.02] rounded text-center">
                  <p className="text-neon-green font-bold">{String((actionResult.equivalencies as Record<string,number>).treesNeededToOffset)}</p>
                  <p className="text-[10px] text-gray-500">Trees Needed</p>
                </div>
                <div className="p-2 bg-white/[0.02] rounded text-center">
                  <p className="text-neon-cyan font-bold">{String((actionResult.equivalencies as Record<string,number>).carKmEquivalent)} km</p>
                  <p className="text-[10px] text-gray-500">Car Equivalent</p>
                </div>
                <div className="p-2 bg-white/[0.02] rounded text-center">
                  <p className="text-yellow-400 font-bold">{String((actionResult.equivalencies as Record<string,number>).londonToNewYorkFlights)} flights</p>
                  <p className="text-[10px] text-gray-500">LHR→JFK</p>
                </div>
              </div>
            )}
            {Array.isArray(actionResult.categoryBreakdown) && (
              <div className="space-y-1">
                <p className="text-[10px] text-gray-500 uppercase tracking-wider">Category Breakdown</p>
                {(actionResult.categoryBreakdown as Array<{category:string;emissionsKgCO2e:number;percentage:number}>).slice(0, 4).map((c, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-gray-300 text-xs flex-1 capitalize">{c.category}</span>
                    <span className="text-neon-green text-xs">{c.emissionsKgCO2e} kg</span>
                    <div className="w-24 h-1.5 bg-white/5 rounded-full overflow-hidden">
                      <div className="h-full bg-neon-green rounded-full" style={{ width: `${c.percentage}%` }} />
                    </div>
                    <span className="text-gray-500 text-[10px] w-8 text-right">{c.percentage}%</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* biodiversityIndex result */}
        {actionResult && actionResult.speciesRichness !== undefined && actionResult.diversityIndices !== undefined && (
          <div className="space-y-3 pt-2 border-t border-white/5">
            <div className="grid grid-cols-4 gap-2">
              <div className="p-2 bg-lattice-surface rounded text-center">
                <p className="text-lg font-bold text-neon-green">{String(actionResult.speciesRichness)}</p>
                <p className="text-[10px] text-gray-500">Species</p>
              </div>
              <div className="p-2 bg-lattice-surface rounded text-center">
                <p className="text-lg font-bold text-neon-cyan">{String(actionResult.totalIndividuals)}</p>
                <p className="text-[10px] text-gray-500">Individuals</p>
              </div>
              <div className="p-2 bg-lattice-surface rounded text-center">
                <p className="text-lg font-bold text-neon-purple">{String((actionResult.diversityIndices as Record<string,number>).shannonH ?? 0)}</p>
                <p className="text-[10px] text-gray-500">Shannon H</p>
              </div>
              <div className="p-2 bg-lattice-surface rounded text-center">
                <p className="text-lg font-bold text-yellow-400">{String((actionResult.diversityIndices as Record<string,number>).simpsonsDiversity ?? 0)}</p>
                <p className="text-[10px] text-gray-500">Simpson D</p>
              </div>
            </div>
            <div className="flex gap-2 flex-wrap">
              <span className={`px-2 py-0.5 text-[10px] rounded border ${
                actionResult.diversityLabel === 'very high' ? 'bg-neon-green/20 border-neon-green/40 text-neon-green' :
                actionResult.diversityLabel === 'high' ? 'bg-neon-cyan/20 border-neon-cyan/40 text-neon-cyan' :
                actionResult.diversityLabel === 'moderate' ? 'bg-yellow-400/20 border-yellow-400/40 text-yellow-400' :
                'bg-red-400/20 border-red-400/40 text-red-400'
              }`}>Diversity: {String(actionResult.diversityLabel)}</span>
              <span className={`px-2 py-0.5 text-[10px] rounded border bg-neon-purple/10 border-neon-purple/30 text-neon-purple`}>Evenness: {String(actionResult.evennessLabel)}</span>
            </div>
            {!!actionResult.rareSpecies && (
              <p className="text-xs text-gray-400">
                Rare species (singletons): <span className="text-neon-cyan">{String((actionResult.rareSpecies as Record<string,unknown>).count)}</span> ({String((actionResult.rareSpecies as Record<string,unknown>).singletonPercentage)}%)
              </p>
            )}
          </div>
        )}

        {/* sustainabilityScore result */}
        {actionResult && actionResult.overallScore !== undefined && actionResult.maturityLevel !== undefined && actionResult.pillars !== undefined && (
          <div className="space-y-3 pt-2 border-t border-white/5">
            <div className="grid grid-cols-3 gap-2">
              <div className="p-2 bg-lattice-surface rounded text-center">
                <p className={`text-2xl font-bold ${Number(actionResult.overallScore) >= 80 ? 'text-neon-green' : Number(actionResult.overallScore) >= 60 ? 'text-neon-cyan' : Number(actionResult.overallScore) >= 40 ? 'text-yellow-400' : 'text-red-400'}`}>
                  {String(actionResult.overallScore ?? '—')}
                </p>
                <p className="text-[10px] text-gray-500">ESG Score</p>
              </div>
              <div className="p-2 bg-lattice-surface rounded text-center">
                <p className="text-xs font-bold text-neon-purple">{String(actionResult.maturityLevel)}</p>
                <p className="text-[10px] text-gray-500">Maturity</p>
              </div>
              <div className="p-2 bg-lattice-surface rounded text-center">
                <p className="text-lg font-bold text-neon-cyan">{String(actionResult.dataCompleteness ?? 0)}%</p>
                <p className="text-[10px] text-gray-500">Data Coverage</p>
              </div>
            </div>
            <div className="h-2 bg-white/5 rounded-full overflow-hidden">
              <div className={`h-full rounded-full transition-all ${Number(actionResult.overallScore) >= 80 ? 'bg-neon-green' : Number(actionResult.overallScore) >= 60 ? 'bg-neon-cyan' : Number(actionResult.overallScore) >= 40 ? 'bg-yellow-400' : 'bg-red-400'}`} style={{ width: `${actionResult.overallScore ?? 0}%` }} />
            </div>
            {!!actionResult.pillars && (
              <div className="grid grid-cols-3 gap-2">
                {Object.entries(actionResult.pillars as Record<string, {score:number|null;rating:string;dataCompleteness:number}>).map(([pillar, data]) => (
                  <div key={pillar} className="p-2 bg-white/[0.02] border border-white/5 rounded text-center">
                    <p className={`text-sm font-bold ${data.score !== null && data.score >= 70 ? 'text-neon-green' : data.score !== null && data.score >= 50 ? 'text-yellow-400' : 'text-red-400'}`}>
                      {data.score !== null ? data.score : '—'}
                    </p>
                    <p className="text-[10px] text-gray-400 capitalize">{pillar}</p>
                    <p className="text-[10px] text-gray-600">{data.dataCompleteness}% covered</p>
                  </div>
                ))}
              </div>
            )}
            {Array.isArray(actionResult.recommendations) && (actionResult.recommendations as string[]).length > 0 && (
              <div>
                <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Recommendations</p>
                <ul className="space-y-0.5">
                  {(actionResult.recommendations as string[]).slice(0, 3).map((rec, i) => (
                    <li key={i} className="text-xs text-gray-300 flex items-start gap-1">
                      <span className="text-neon-green shrink-0">•</span> {rec}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {actionResult && !!actionResult.message && (
          <p className="text-xs text-gray-400 italic pt-1">{String(actionResult.message)}</p>
        )}
      </div>

      {/* Quick Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0 * 0.05 }} className="panel p-3 flex items-center gap-3">
          <Recycle className="w-5 h-5 text-neon-green" />
          <div>
            <p className="text-lg font-bold">{totalImpactArea.toLocaleString()}</p>
            <p className="text-xs text-gray-500">Carbon Offset (ha)</p>
          </div>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1 * 0.05 }} className="panel p-3 flex items-center gap-3">
          <Leaf className="w-5 h-5 text-neon-cyan" />
          <div>
            <p className="text-lg font-bold">{avgBiodiversity.toFixed(2)}</p>
            <p className="text-xs text-gray-500">Green Score</p>
          </div>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 2 * 0.05 }} className="panel p-3 flex items-center gap-3">
          <CheckCircle2 className="w-5 h-5 text-neon-blue" />
          <div>
            <p className="text-lg font-bold">{IMPACTS.filter(i => i.mitigationStatus === 'completed' || i.mitigationStatus === 'in_progress').length}</p>
            <p className="text-xs text-gray-500">Eco Actions Done</p>
          </div>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 3 * 0.05 }} className="panel p-3 flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-red-400" />
          <div>
            <p className="text-lg font-bold">{criticalCount}</p>
            <p className="text-xs text-gray-500">At Risk Species</p>
          </div>
        </motion.div>
      </div>

      {/* Tab Navigation */}
      <nav className="flex items-center gap-2 border-b border-lattice-border pb-4 flex-wrap">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-lg transition-colors whitespace-nowrap',
              activeTab === tab.id
                ? 'bg-neon-green/20 text-neon-green'
                : 'text-gray-400 hover:text-white hover:bg-lattice-elevated'
            )}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </nav>

      {/* Simulation Controls (always visible) */}
      {renderSimulationControls()}

      {/* Tab Content */}
      {activeTab === 'overview' && renderOverview()}
      {activeTab === 'populations' && renderPopulations()}
      {activeTab === 'climate' && renderClimate()}
      {activeTab === 'biodiversity' && renderBiodiversity()}
      {activeTab === 'impact' && renderImpact()}
    </div>
  );
}
