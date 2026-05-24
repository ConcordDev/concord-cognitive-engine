'use client';

import React from 'react';
import { Map, Layers, ArrowDown } from 'lucide-react';

// ── Types ───────────────────────────────────────────────────────────────────

interface AtlasOverlayProps {
  query: string;
  result: AtlasResult | null;
  loading?: boolean;
}

interface AtlasResult {
  ok: boolean;
  material?: string;
  confidence?: number;
  resolution_cm?: number;
  tile?: {
    id: string;
    coordinates: { lat_min: number; lat_max: number; lng_min: number; lng_max: number };
    layers: Record<string, { dominantMaterial: string }>;
  };
  error?: string;
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
  unknown: 'bg-zinc-800 text-zinc-400',
};

// ── Component ───────────────────────────────────────────────────────────────

export default function AtlasOverlay({ query, result, loading }: AtlasOverlayProps) {
  if (loading) {
    return (
      <div className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-800/50 border border-zinc-700/50">
        <Map size={14} className="text-emerald-400 animate-pulse" />
        <span className="text-xs text-zinc-400">Querying Atlas{query ? `: ${query}` : ''}...</span>
      </div>
    );
  }

  if (!result) return null;

  if (!result.ok) {
    return (
      <div className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-800/50 border border-zinc-700/50">
        <Map size={14} className="text-zinc-400" />
        <span className="text-xs text-zinc-400">No atlas data for this location</span>
      </div>
    );
  }

  // Material query result
  if (result.material) {
    const colorClass = materialColors[result.material] || materialColors.unknown;
    return (
      <div className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-800/50 border border-zinc-700/50">
        <Layers size={14} className="text-emerald-400" />
        <span className={`text-xs px-2 py-0.5 rounded ${colorClass}`}>
          {result.material}
        </span>
        {result.confidence !== undefined && (
          <span className="text-xs text-zinc-400">
            {Math.round(result.confidence * 100)}% confidence
          </span>
        )}
        {result.resolution_cm && (
          <span className="text-xs text-zinc-400">
            {result.resolution_cm}cm res
          </span>
        )}
      </div>
    );
  }

  // Tile query result
  if (result.tile) {
    const layers = result.tile.layers || {};
    return (
      <div className="rounded-lg bg-zinc-800/50 border border-zinc-700/50 p-3 space-y-2">
        <div className="flex items-center gap-2">
          <Map size={14} className="text-emerald-400" />
          <span className="text-xs text-zinc-300 font-medium">Atlas Tile</span>
        </div>
        <div className="space-y-1">
          {Object.entries(layers).map(([layer, data]) => (
            <div key={layer} className="flex items-center gap-2 text-xs">
              <ArrowDown size={10} className="text-zinc-600" />
              <span className="text-zinc-400 w-20">{layer}</span>
              <span className={`px-1.5 py-0.5 rounded ${
                materialColors[(data as { dominantMaterial: string }).dominantMaterial] || materialColors.unknown
              }`}>
                {(data as { dominantMaterial: string }).dominantMaterial || 'unknown'}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return null;
}
