'use client';

import React, { useState } from 'react';
import {
  Eye, Lock, ShieldAlert, Cloud, Mountain, Zap, Waves,
  Activity, Sprout, TreePine, ChevronDown, ChevronUp,
  FileSearch, Globe, BarChart3,
} from 'lucide-react';

// ── Types ───────────────────────────────────────────────────────────────────

interface PublicIntelligence {
  ok: boolean;
  tier: string;
  category: string;
  count: number;
  total: number;
  data: PublicIntelDTU[];
}

interface PublicIntelDTU {
  id: string;
  type: string;
  tier: string;
  category: string;
  classification: string;
  created: string;
  confidence: number;
  sources: number;
  data: { summary: string | null; measurements: Record<string, unknown> };
  coverage_area: { center: { lat: number; lng: number }; radius_km: number };
  commercially_licensable: boolean;
}

interface ClassifierStatus {
  active: boolean;
  stats: {
    totalClassified: number;
    routedPublic: number;
    routedResearch: number;
    routedSovereign: number;
    ambiguousUpgraded: number;
  };
  thresholds: { sensitivity: number; sovereign: number };
}

interface IntelMetrics {
  initialized: boolean;
  classifierActive: boolean;
  classifier: ClassifierStatus['stats'];
  tiers: {
    public: { categories: Record<string, number>; totalDTUs: number };
    research: { entries: number; activeGrants: number; pendingApplications: number; totalDTUs: number };
    sovereign: { count: number; categories: Record<string, number>; isolated: boolean };
  };
  uptime: number;
}

interface IntelligenceCardProps {
  type: 'overview' | 'public' | 'classifier' | 'research';
  metrics?: IntelMetrics;
  publicData?: PublicIntelligence;
  classifierStatus?: ClassifierStatus;
}

// ── Category Icons ──────────────────────────────────────────────────────────

const categoryIcons: Record<string, React.ReactNode> = {
  weather: <Cloud size={14} />,
  geology: <Mountain size={14} />,
  energy: <Zap size={14} />,
  ocean: <Waves size={14} />,
  seismic: <Activity size={14} />,
  agriculture: <Sprout size={14} />,
  environment: <TreePine size={14} />,
};

// ── Sub-Components ──────────────────────────────────────────────────────────

function OverviewView({ metrics }: { metrics: IntelMetrics }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-900 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Globe size={18} className="text-violet-400" />
        <span className="text-sm font-semibold text-zinc-200">Foundation Intelligence</span>
        <span className={`ml-auto text-xs px-2 py-0.5 rounded-full ${
          metrics.classifierActive ? 'bg-emerald-900 text-emerald-300' : 'bg-amber-900 text-amber-300'
        }`}>
          {metrics.classifierActive ? 'Classifier Active' : 'Inactive'}
        </span>
      </div>

      {/* Tier Summary */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-zinc-800 rounded p-2 text-center">
          <Eye size={16} className="text-emerald-400 mx-auto mb-1" />
          <div className="text-xs text-zinc-400">Public</div>
          <div className="text-sm font-semibold text-zinc-200">{metrics.tiers.public.totalDTUs}</div>
        </div>
        <div className="bg-zinc-800 rounded p-2 text-center">
          <FileSearch size={16} className="text-amber-400 mx-auto mb-1" />
          <div className="text-xs text-zinc-400">Research</div>
          <div className="text-sm font-semibold text-zinc-200">{metrics.tiers.research.totalDTUs}</div>
        </div>
        <div className="bg-zinc-800 rounded p-2 text-center">
          <ShieldAlert size={16} className="text-red-400 mx-auto mb-1" />
          <div className="text-xs text-zinc-400">Sovereign</div>
          <div className="text-sm font-semibold text-zinc-200">{metrics.tiers.sovereign.count}</div>
        </div>
      </div>

      {/* Classifier Stats */}
      <div className="flex items-center gap-4 text-xs text-zinc-400">
        <span>Classified: {metrics.classifier.totalClassified}</span>
        <span>Upgraded: {metrics.classifier.ambiguousUpgraded}</span>
      </div>

      <button
        onClick={() => setExpanded(!expanded)}
        className="text-xs text-zinc-400 hover:text-zinc-300 flex items-center gap-1"
      >
        {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        {expanded ? 'Hide categories' : 'Show categories'}
      </button>

      {expanded && (
        <div className="space-y-1">
          {Object.entries(metrics.tiers.public.categories).map(([cat, count]) => (
            <div key={cat} className="flex items-center gap-2 p-1.5 bg-zinc-800 rounded text-xs">
              <span className="text-zinc-400">{categoryIcons[cat] || <Eye size={14} />}</span>
              <span className="text-zinc-300 flex-1">{cat.replace(/_/g, ' ')}</span>
              <span className="text-zinc-400">{count} DTUs</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PublicDataView({ data }: { data: PublicIntelligence }) {
  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-900 p-4 space-y-3">
      <div className="flex items-center gap-2">
        {categoryIcons[data.category] || <Eye size={18} />}
        <span className="text-sm font-semibold text-zinc-200">
          {data.category.replace(/_/g, ' ')} Intelligence
        </span>
        <span className="ml-auto text-xs px-2 py-0.5 rounded-full bg-emerald-900 text-emerald-300">
          PUBLIC
        </span>
      </div>

      {data.count === 0 ? (
        <div className="text-xs text-zinc-400 text-center py-3">No intelligence data yet</div>
      ) : (
        <div className="space-y-1">
          {data.data.slice(0, 10).map(dtu => (
            <div key={dtu.id} className="p-2 bg-zinc-800 rounded text-xs space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-zinc-300 flex-1">
                  {dtu.data.summary || dtu.category}
                </span>
                <span className={`px-1.5 py-0.5 rounded ${
                  dtu.confidence >= 0.8 ? 'bg-emerald-900 text-emerald-300' :
                  dtu.confidence >= 0.5 ? 'bg-amber-900 text-amber-300' :
                  'bg-zinc-700 text-zinc-400'
                }`}>
                  {Math.round(dtu.confidence * 100)}%
                </span>
              </div>
              <div className="flex items-center gap-3 text-zinc-400">
                <span>{dtu.sources} sources</span>
                <span>{dtu.coverage_area.radius_km}km radius</span>
                <span>{new Date(dtu.created).toLocaleTimeString()}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="text-xs text-zinc-400">
        {data.total} total entries | Commercially licensable
      </div>
    </div>
  );
}

function ClassifierView({ status }: { status: ClassifierStatus }) {
  const total = status.stats.totalClassified || 1;
  const publicPct = Math.round((status.stats.routedPublic / total) * 100);
  const researchPct = Math.round((status.stats.routedResearch / total) * 100);
  const sovereignPct = Math.round((status.stats.routedSovereign / total) * 100);

  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-900 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <BarChart3 size={18} className="text-violet-400" />
        <span className="text-sm font-semibold text-zinc-200">Sovereign Classifier</span>
        <span className={`ml-auto text-xs px-2 py-0.5 rounded-full ${
          status.active ? 'bg-emerald-900 text-emerald-300' : 'bg-red-900 text-red-300'
        }`}>
          {status.active ? 'Active' : 'Inactive'}
        </span>
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-2 text-xs">
          <span className="text-emerald-400 w-16">Public</span>
          <div className="flex-1 bg-zinc-800 rounded-full h-2">
            <div className="h-2 rounded-full bg-emerald-500" style={{ width: `${publicPct}%` }} />
          </div>
          <span className="text-zinc-400 w-8 text-right">{publicPct}%</span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-amber-400 w-16">Research</span>
          <div className="flex-1 bg-zinc-800 rounded-full h-2">
            <div className="h-2 rounded-full bg-amber-500" style={{ width: `${researchPct}%` }} />
          </div>
          <span className="text-zinc-400 w-8 text-right">{researchPct}%</span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-red-400 w-16">Sovereign</span>
          <div className="flex-1 bg-zinc-800 rounded-full h-2">
            <div className="h-2 rounded-full bg-red-500" style={{ width: `${sovereignPct}%` }} />
          </div>
          <span className="text-zinc-400 w-8 text-right">{sovereignPct}%</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="bg-zinc-800 rounded p-2">
          <div className="text-zinc-400">Total Classified</div>
          <div className="text-zinc-200 font-semibold">{status.stats.totalClassified}</div>
        </div>
        <div className="bg-zinc-800 rounded p-2">
          <div className="text-zinc-400">Ambiguous Upgraded</div>
          <div className="text-zinc-200 font-semibold">{status.stats.ambiguousUpgraded}</div>
        </div>
      </div>

      <div className="flex items-center gap-4 text-xs text-zinc-400">
        <span>Sensitivity: {status.thresholds.sensitivity}</span>
        <span>Sovereign: {status.thresholds.sovereign}</span>
      </div>
    </div>
  );
}

function ResearchView({ metrics }: { metrics: IntelMetrics }) {
  return (
    <div className="rounded-lg border border-amber-900/50 bg-zinc-900 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Lock size={18} className="text-amber-400" />
        <span className="text-sm font-semibold text-zinc-200">Research Partition</span>
        <span className="ml-auto text-xs px-2 py-0.5 rounded-full bg-amber-900 text-amber-300">
          RESTRICTED
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2 text-xs">
        <div className="bg-zinc-800 rounded p-2 text-center">
          <div className="text-zinc-400">Entries</div>
          <div className="text-zinc-200 font-semibold">{metrics.tiers.research.entries}</div>
        </div>
        <div className="bg-zinc-800 rounded p-2 text-center">
          <div className="text-zinc-400">Active Grants</div>
          <div className="text-zinc-200 font-semibold">{metrics.tiers.research.activeGrants}</div>
        </div>
        <div className="bg-zinc-800 rounded p-2 text-center">
          <div className="text-zinc-400">Pending</div>
          <div className="text-zinc-200 font-semibold">{metrics.tiers.research.pendingApplications}</div>
        </div>
      </div>

      <div className="text-xs text-zinc-400">
        Lineage tracking enforced | Transfer prohibited | Governance-approved access only
      </div>
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────────────────────

export default function IntelligenceCard({
  type, metrics, publicData, classifierStatus,
}: IntelligenceCardProps) {
  switch (type) {
    case 'overview':
      return metrics ? <OverviewView metrics={metrics} /> : null;
    case 'public':
      return publicData ? <PublicDataView data={publicData} /> : null;
    case 'classifier':
      return classifierStatus ? <ClassifierView status={classifierStatus} /> : null;
    case 'research':
      return metrics ? <ResearchView metrics={metrics} /> : null;
    default:
      return null;
  }
}
