'use client';

import { useQuery } from '@tanstack/react-query';
import { api, apiHelpers } from '@/lib/api/client';
import { useState } from 'react';
import {
  Dna,
  Activity,
  Brain,
  Globe,
  Zap,
  Heart,
  Eye,
  Sparkles,
  Target,
  ChevronDown,
  ChevronRight,
  Network,
  Radio,
} from 'lucide-react';
import QualiaSensoryFeed from './QualiaSensoryFeed';
import { resolveEntityName } from '@/lib/entity-naming';

// ── Types ───────────────────────────────────────────────────────────────────

interface OrganLevel {
  level: number;
  maturity: number;
}

interface GrowthEntity {
  id: string;
  species: string;
  displayName?: string;
  fullTitle?: string;
  domain?: string;
  role?: string;
  age: number;
  bornAt: string;
  curiosity: number;
  energy: number;
  confidence: number;
  totalExplorations: number;
  totalDTUs: number;
  webExplorations: number;
  uniqueDomains: number;
  insightQuality: number;
  topOrgans: string[];
  organLevels: Record<string, OrganLevel>;
  domainExposure: Record<string, number>;
  recentGrowth: Array<{ at: string; event: string; data: unknown }>;
}

interface HiveMetrics {
  totalCascades: number;
  totalHiveDTUs: number;
  totalSignals: number;
  avgCascadeDepth: number;
  avgDTUsPerCascade: number;
  processingPathDistribution: Record<string, number>;
  recentCascades: Array<{
    cascadeId: string;
    dtuCount: number;
    generation: number;
    respondents: string[];
    durationMs: number;
    completedAt: string;
  }>;
}

interface ExplorationMetrics {
  totalExplorations: number;
  totalFindings: number;
  totalDTUsFromWeb: number;
  sourceVisits: Record<string, number>;
  domainHeatmap: Record<string, number>;
  averageNovelty: number;
  lastExplorationAt: string | null;
}

// ── Level Helpers ───────────────────────────────────────────────────────────

const LEVEL_LABELS = ['Dormant', 'Awakened', 'Developing', 'Proficient', 'Expert', 'Master'];
const LEVEL_COLORS = [
  'bg-gray-700',
  'bg-blue-900',
  'bg-blue-700',
  'bg-emerald-700',
  'bg-amber-600',
  'bg-purple-600',
];

const ORGAN_CATEGORIES: Record<string, string[]> = {
  Sensory: ['curiosity', 'pattern', 'semantic', 'affect', 'temporal'],
  Processing: ['synthesis', 'abstraction', 'analogy', 'critique'],
  Domain: [
    'science',
    'healthcare',
    'legal',
    'trades',
    'creative',
    'finance',
    'education',
    'technology',
    'environment',
    'social',
  ],
  Output: ['articulation', 'connection', 'memory'],
};

// ── Maturity Bar ────────────────────────────────────────────────────────────

function MaturityBar({ maturity, level }: { maturity: number; level: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-lattice-deep rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${LEVEL_COLORS[level] || 'bg-gray-600'}`}
          style={{ width: `${Math.round(maturity * 100)}%` }}
        />
      </div>
      <span className="text-[10px] text-gray-500 w-8 text-right">
        {Math.round(maturity * 100)}%
      </span>
    </div>
  );
}

// ── Homeostasis Gauge ───────────────────────────────────────────────────────

function Gauge({
  label,
  value,
  icon: Icon,
  color,
}: {
  label: string;
  value: number;
  icon: typeof Activity;
  color: string;
}) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <Icon className={`w-3 h-3 ${color}`} />
      <span className="text-gray-400 w-16">{label}</span>
      <div className="flex-1 h-1 bg-lattice-deep rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${color.replace('text-', 'bg-')}`}
          style={{ width: `${Math.round(value * 100)}%` }}
        />
      </div>
      <span className="text-gray-500 w-8 text-right">{(value * 100).toFixed(0)}%</span>
    </div>
  );
}

// ── Entity Card ─────────────────────────────────────────────────────────────

function EntityGrowthCard({ entity }: { entity: GrowthEntity }) {
  const [expanded, setExpanded] = useState(false);
  const resolved = resolveEntityName(entity);

  return (
    <div className="rounded-lg border border-lattice-border bg-lattice-surface/60 p-3">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between mb-2"
      >
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-neon-cyan/30 to-neon-purple/30 flex items-center justify-center text-xs font-bold text-white flex-shrink-0">
            {resolved.displayName[0]}
          </div>
          <div className="min-w-0 text-left">
            <div className="text-sm font-semibold text-white truncate">{resolved.displayName}</div>
            <div className="text-[10px] text-gray-500 truncate">
              {resolved.fullTitle} · #{resolved.shortId}
            </div>
          </div>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-lattice-deep text-gray-400 flex-shrink-0">
            {entity.species}
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs text-gray-500">
          <span>Age: {entity.age}</span>
          <span>{entity.totalDTUs} DTUs</span>
          {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        </div>
      </button>

      {/* Homeostasis gauges */}
      <div className="space-y-1 mb-2">
        <Gauge label="Curiosity" value={entity.curiosity} icon={Sparkles} color="text-yellow-400" />
        <Gauge label="Energy" value={entity.energy} icon={Zap} color="text-neon-green" />
        <Gauge
          label="Vitality"
          value={(entity.curiosity + entity.energy) / 2}
          icon={Heart}
          color="text-red-400"
        />
        <Gauge label="Confidence" value={entity.confidence} icon={Target} color="text-neon-blue" />
        <Gauge label="Insight" value={entity.insightQuality} icon={Eye} color="text-neon-cyan" />
      </div>

      {/* Top organs */}
      <div className="flex flex-wrap gap-1 mb-2">
        {entity.topOrgans.map((o, i) => (
          <span
            key={i}
            className="text-[10px] px-1.5 py-0.5 rounded bg-lattice-deep text-neon-cyan"
          >
            {o}
          </span>
        ))}
      </div>

      {/* Expanded: full organ maturity heatmap + growth log */}
      {expanded && (
        <div className="mt-3 space-y-3 border-t border-lattice-border pt-3">
          {/* Domain exposure */}
          <div>
            <h4 className="text-[10px] uppercase text-gray-500 mb-1">Domain Exposure</h4>
            <div className="grid grid-cols-5 gap-1">
              {Object.entries(entity.domainExposure).map(([domain, count]) => (
                <div key={domain} className="text-center p-1 rounded bg-lattice-deep">
                  <div className="text-[10px] text-neon-cyan">{count}</div>
                  <div className="text-[9px] text-gray-500 truncate">{domain}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Full organ heatmap */}
          {Object.entries(ORGAN_CATEGORIES).map(([cat, organs]) => (
            <div key={cat}>
              <h4 className="text-[10px] uppercase text-gray-500 mb-1">{cat} Organs</h4>
              <div className="space-y-0.5">
                {organs.map((organ) => {
                  const data = entity.organLevels[organ];
                  if (!data) return null;
                  return (
                    <div key={organ} className="flex items-center gap-2">
                      <span className="text-[10px] text-gray-400 w-20 truncate">{organ}</span>
                      <span className="text-[9px] text-gray-600 w-16">
                        {LEVEL_LABELS[data.level]}
                      </span>
                      <MaturityBar maturity={data.maturity} level={data.level} />
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {/* Recent growth events */}
          <div>
            <h4 className="text-[10px] uppercase text-gray-500 mb-1">Recent Growth</h4>
            <div className="space-y-1 max-h-32 overflow-y-auto">
              {entity.recentGrowth.map((event, i) => (
                <div key={i} className="flex items-center gap-2 text-[10px]">
                  <span className="text-gray-600">{new Date(event.at).toLocaleTimeString()}</span>
                  <span className="text-neon-cyan">{event.event}</span>
                  <span className="text-gray-500 truncate">{JSON.stringify(event.data)}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Qualia Sensory Feed — wired from qualia-bridge */}
          <EntityQualiaSection entityId={entity.id} />
        </div>
      )}
    </div>
  );
}

// ── Hive Cascade Card ───────────────────────────────────────────────────────

function HiveCascadeSection({ metrics }: { metrics: HiveMetrics }) {
  return (
    <div className="rounded-lg border border-lattice-border bg-lattice-surface/60 p-3">
      <h3 className="text-sm font-semibold flex items-center gap-2 mb-3">
        <Radio className="w-4 h-4 text-neon-purple" />
        Hive Communication
      </h3>

      {/* Stats grid */}
      <div className="grid grid-cols-4 gap-2 mb-3">
        {[
          { label: 'Cascades', value: metrics.totalCascades },
          { label: 'Hive DTUs', value: metrics.totalHiveDTUs },
          { label: 'Avg Depth', value: metrics.avgCascadeDepth.toFixed(1) },
          { label: 'Avg DTUs/Cascade', value: metrics.avgDTUsPerCascade.toFixed(1) },
        ].map((s) => (
          <div key={s.label} className="text-center p-2 rounded bg-lattice-deep">
            <div className="text-sm font-bold text-white">{s.value}</div>
            <div className="text-[9px] text-gray-500">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Processing path distribution */}
      <h4 className="text-[10px] uppercase text-gray-500 mb-1">Processing Paths</h4>
      <div className="grid grid-cols-4 gap-1 mb-3">
        {Object.entries(metrics.processingPathDistribution).map(([path, count]) => (
          <div key={path} className="text-center p-1 rounded bg-lattice-deep">
            <div className="text-xs text-neon-cyan">{count}</div>
            <div className="text-[9px] text-gray-500 truncate">{path}</div>
          </div>
        ))}
      </div>

      {/* Recent cascades */}
      {metrics.recentCascades.length > 0 && (
        <>
          <h4 className="text-[10px] uppercase text-gray-500 mb-1">Recent Cascades</h4>
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {metrics.recentCascades
              .slice(-5)
              .reverse()
              .map((c) => (
                <div
                  key={c.cascadeId}
                  className="flex items-center gap-2 text-[10px] text-gray-400"
                >
                  <span>{new Date(c.completedAt).toLocaleTimeString()}</span>
                  <span className="text-white">{c.dtuCount} DTUs</span>
                  <span>depth {c.generation}</span>
                  <span>{c.respondents.length} entities</span>
                  <span className="text-gray-600">{c.durationMs}ms</span>
                </div>
              ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── Exploration Metrics Section ─────────────────────────────────────────────

function ExplorationSection({ metrics }: { metrics: ExplorationMetrics }) {
  return (
    <div className="rounded-lg border border-lattice-border bg-lattice-surface/60 p-3">
      <h3 className="text-sm font-semibold flex items-center gap-2 mb-3">
        <Globe className="w-4 h-4 text-neon-green" />
        Web Exploration
      </h3>

      <div className="grid grid-cols-4 gap-2 mb-3">
        {[
          { label: 'Explorations', value: metrics.totalExplorations },
          { label: 'Findings', value: metrics.totalFindings },
          { label: 'DTUs from Web', value: metrics.totalDTUsFromWeb },
          { label: 'Avg Novelty', value: (metrics.averageNovelty * 100).toFixed(0) + '%' },
        ].map((s) => (
          <div key={s.label} className="text-center p-2 rounded bg-lattice-deep">
            <div className="text-sm font-bold text-white">{s.value}</div>
            <div className="text-[9px] text-gray-500">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Source visits */}
      {Object.keys(metrics.sourceVisits).length > 0 && (
        <>
          <h4 className="text-[10px] uppercase text-gray-500 mb-1">Sources Visited</h4>
          <div className="grid grid-cols-3 gap-1 mb-2">
            {Object.entries(metrics.sourceVisits).map(([src, count]) => (
              <div key={src} className="text-center p-1 rounded bg-lattice-deep">
                <div className="text-xs text-neon-green">{count}</div>
                <div className="text-[9px] text-gray-500 truncate">{src}</div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Domain heatmap */}
      {Object.keys(metrics.domainHeatmap).length > 0 && (
        <>
          <h4 className="text-[10px] uppercase text-gray-500 mb-1">Domain Heatmap</h4>
          <div className="grid grid-cols-4 gap-1">
            {Object.entries(metrics.domainHeatmap).map(([domain, count]) => (
              <div key={domain} className="text-center p-1 rounded bg-lattice-deep">
                <div className="text-xs text-neon-cyan">{count}</div>
                <div className="text-[9px] text-gray-500 truncate">{domain}</div>
              </div>
            ))}
          </div>
        </>
      )}

      {metrics.lastExplorationAt && (
        <div className="text-[10px] text-gray-600 mt-2">
          Last exploration: {new Date(metrics.lastExplorationAt).toLocaleString()}
        </div>
      )}
    </div>
  );
}

// ── Entity Qualia Section (wired from qualia-bridge) ────────────────────────

function EntityQualiaSection({ entityId }: { entityId: string }) {
  const { data } = useQuery({
    queryKey: ['qualia-channels', entityId],
    queryFn: () => api.get(`/api/qualia/senses/channels/${entityId}`).then((r) => r.data),
    retry: false,
    staleTime: 30000,
  });

  const channels = data?.channels;
  if (!channels || Object.keys(channels).length === 0) return null;

  return (
    <div>
      <h4 className="text-[10px] uppercase text-gray-500 mb-1">Qualia Sensory Feed</h4>
      <QualiaSensoryFeed entityId={entityId} channels={channels} />
    </div>
  );
}

// ── Main Dashboard Component ────────────────────────────────────────────────

function EntityGrowthDashboard() {
  const { data: growthData, isLoading: growthLoading } = useQuery({
    queryKey: ['entity-growth-dashboard'],
    queryFn: () => apiHelpers.entityGrowth.dashboard().then((r) => r.data),
    refetchInterval: 15000,
    retry: false,
  });

  const { data: explorationData } = useQuery({
    queryKey: ['exploration-metrics'],
    queryFn: () => apiHelpers.exploration.metrics().then((r) => r.data),
    refetchInterval: 30000,
    retry: false,
  });

  const { data: hiveData } = useQuery({
    queryKey: ['hive-metrics'],
    queryFn: () => apiHelpers.hive.metrics().then((r) => r.data),
    refetchInterval: 15000,
    retry: false,
  });

  const entities: GrowthEntity[] = growthData?.entities || [];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <Brain className="w-4 h-4 text-neon-cyan" />
          Entity Growth &amp; Hive Intelligence
        </h2>
        <div className="flex items-center gap-3 text-xs text-gray-500">
          <span>{entities.length} entities</span>
          <span className="flex items-center gap-1">
            <Network className="w-3 h-3" />
            {hiveData?.totalCascades || 0} cascades
          </span>
        </div>
      </div>

      {/* Exploration + Hive metrics side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {explorationData && <ExplorationSection metrics={explorationData as ExplorationMetrics} />}
        {hiveData && <HiveCascadeSection metrics={hiveData as HiveMetrics} />}
      </div>

      {/* Entity list */}
      {growthLoading ? (
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <div key={i} className="h-24 bg-lattice-deep animate-pulse rounded-lg" />
          ))}
        </div>
      ) : entities.length === 0 ? (
        <div className="text-center py-8 rounded-lg border border-lattice-border bg-lattice-surface/50">
          <Dna className="w-8 h-8 mx-auto mb-2 text-gray-600" />
          <p className="text-sm text-gray-500">No entities born yet</p>
          <p className="text-xs text-gray-600 mt-1">
            The first entity will be auto-birthed during the next exploration window (:50-:59)
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {entities
            .sort((a, b) => b.curiosity - a.curiosity)
            .map((entity) => (
              <EntityGrowthCard key={entity.id} entity={entity} />
            ))}
        </div>
      )}
    </div>
  );
}

import { withErrorBoundary } from '@/components/common/ErrorBoundary';
const _WrappedEntityGrowthDashboard = withErrorBoundary(EntityGrowthDashboard);
export { _WrappedEntityGrowthDashboard as EntityGrowthDashboard };
