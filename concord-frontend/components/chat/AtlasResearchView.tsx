'use client';

import React from 'react';
import { FlaskConical, Layers, Database, Activity } from 'lucide-react';

// ── Types ───────────────────────────────────────────────────────────────────

interface AtlasResearchViewProps {
  data: AtlasResearchData | null;
  loading?: boolean;
}

interface AtlasResearchData {
  ok: boolean;
  view: 'subsurface' | 'material' | 'volume' | 'changes';
  subsurface?: {
    tier: string;
    bounds: { lat_min: number; lat_max: number; lng_min: number; lng_max: number };
    features: SubsurfaceFeature[];
  };
  material?: {
    material: string;
    confidence: number;
    resolution_cm: number;
  };
  volume?: {
    tier: string;
    accessibleLayers: string[];
    tiles: VolumeTile[];
    tileCount: number;
  };
  changes?: {
    count: number;
    changes: ChangeRecord[];
  };
  error?: string;
}

interface SubsurfaceFeature {
  type: string;
  depth_m: number;
  material: string;
  confidence: number;
}

interface VolumeTile {
  id: string;
  confidence: number;
  resolution_cm: number;
}

interface ChangeRecord {
  tileKey: string;
  changeType: string;
  magnitude: number;
  detected_at: string;
}

// ── Material Colors ─────────────────────────────────────────────────────────

const materialColors: Record<string, string> = {
  air: 'bg-sky-900/50 text-sky-300',
  concrete: 'bg-zinc-700 text-zinc-200',
  wood: 'bg-amber-900/50 text-amber-300',
  metal: 'bg-slate-700 text-slate-200',
  glass: 'bg-cyan-900/50 text-cyan-300',
  water: 'bg-blue-900/50 text-blue-300',
  soil: 'bg-orange-900/50 text-orange-300',
  rock: 'bg-stone-700 text-stone-200',
  vegetation: 'bg-emerald-900/50 text-emerald-300',
};

// ── Component ───────────────────────────────────────────────────────────────

export default function AtlasResearchView({ data, loading }: AtlasResearchViewProps) {
  if (loading) {
    return (
      <div className="rounded-lg bg-zinc-800/50 border border-zinc-700/50 p-4">
        <div className="flex items-center gap-2">
          <FlaskConical size={16} className="text-violet-400 animate-pulse" />
          <span className="text-sm text-zinc-400">Loading research data...</span>
        </div>
      </div>
    );
  }

  if (!data?.ok) {
    return (
      <div className="rounded-lg bg-zinc-800/50 border border-zinc-700/50 p-4">
        <div className="flex items-center gap-2">
          <FlaskConical size={16} className="text-zinc-400" />
          <span className="text-sm text-zinc-400">
            {data?.error || 'No research data available. Research tier access required.'}
          </span>
        </div>
      </div>
    );
  }

  if (data.view === 'subsurface' && data.subsurface) return <SubsurfaceView data={data.subsurface} />;
  if (data.view === 'material' && data.material) return <MaterialView data={data.material} />;
  if (data.view === 'volume' && data.volume) return <VolumeView data={data.volume} />;
  if (data.view === 'changes' && data.changes) return <ChangesView data={data.changes} />;

  return null;
}

// ── Subsurface View ─────────────────────────────────────────────────────────

function SubsurfaceView({ data }: { data: NonNullable<AtlasResearchData['subsurface']> }) {
  return (
    <div className="rounded-lg bg-zinc-800/50 border border-violet-900/30 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Database size={16} className="text-violet-400" />
          <span className="text-sm font-medium text-zinc-200">Subsurface Analysis</span>
        </div>
        <span className="text-xs px-1.5 py-0.5 rounded bg-violet-900/30 text-violet-400">
          {data.tier}
        </span>
      </div>
      {data.features.length === 0 ? (
        <p className="text-xs text-zinc-400">No subsurface features detected in this area</p>
      ) : (
        <div className="space-y-1.5">
          {data.features.slice(0, 8).map((feat, i) => (
            <div key={i} className="flex items-center gap-2 text-xs">
              <Layers size={10} className="text-zinc-600" />
              <span className="text-zinc-400 w-16">{feat.depth_m}m</span>
              <span className={`px-1.5 py-0.5 rounded ${materialColors[feat.material] || 'bg-zinc-800 text-zinc-400'}`}>
                {feat.material}
              </span>
              <span className="text-zinc-400">{feat.type}</span>
              <span className="ml-auto text-zinc-600">{Math.round(feat.confidence * 100)}%</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Material View ───────────────────────────────────────────────────────────

function MaterialView({ data }: { data: NonNullable<AtlasResearchData['material']> }) {
  const colorClass = materialColors[data.material] || 'bg-zinc-800 text-zinc-400';

  return (
    <div className="rounded-lg bg-zinc-800/50 border border-zinc-700/50 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Layers size={16} className="text-violet-400" />
        <span className="text-sm font-medium text-zinc-200">Material Classification</span>
      </div>
      <div className="flex items-center gap-3">
        <span className={`text-sm px-3 py-1.5 rounded font-medium ${colorClass}`}>
          {data.material}
        </span>
        <div className="text-xs space-y-0.5">
          <div className="text-zinc-400">
            Confidence: <span className="text-zinc-200">{Math.round(data.confidence * 100)}%</span>
          </div>
          <div className="text-zinc-400">
            Resolution: <span className="text-zinc-200">{data.resolution_cm}cm</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Volume View ─────────────────────────────────────────────────────────────

function VolumeView({ data }: { data: NonNullable<AtlasResearchData['volume']> }) {
  return (
    <div className="rounded-lg bg-zinc-800/50 border border-violet-900/30 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Database size={16} className="text-violet-400" />
          <span className="text-sm font-medium text-zinc-200">3D Volume Data</span>
        </div>
        <span className="text-xs px-1.5 py-0.5 rounded bg-violet-900/30 text-violet-400">
          {data.tier}
        </span>
      </div>
      <div className="flex flex-wrap gap-1">
        {data.accessibleLayers.map((layer) => (
          <span key={layer} className="text-xs px-1.5 py-0.5 rounded bg-zinc-900/50 text-zinc-300">
            {layer}
          </span>
        ))}
      </div>
      <div className="text-xs text-zinc-400">{data.tileCount} tiles in volume</div>
    </div>
  );
}

// ── Changes View ────────────────────────────────────────────────────────────

function ChangesView({ data }: { data: NonNullable<AtlasResearchData['changes']> }) {
  return (
    <div className="rounded-lg bg-zinc-800/50 border border-zinc-700/50 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity size={16} className="text-yellow-400" />
          <span className="text-sm font-medium text-zinc-200">Temporal Changes</span>
        </div>
        <span className="text-xs text-zinc-400">{data.count} detected</span>
      </div>
      {data.count === 0 ? (
        <p className="text-xs text-zinc-400">No recent changes detected</p>
      ) : (
        <div className="space-y-1">
          {data.changes.slice(0, 8).map((change, i) => (
            <div key={i} className="flex items-center gap-2 text-xs">
              <span className="text-zinc-400 font-mono">{change.tileKey.slice(0, 16)}</span>
              <span className="text-yellow-400">{change.changeType}</span>
              <span className="text-zinc-600">mag: {change.magnitude.toFixed(2)}</span>
              <span className="ml-auto text-zinc-600">{change.detected_at?.slice(0, 10)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
