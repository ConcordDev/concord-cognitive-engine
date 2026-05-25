'use client';

import React, { useState } from 'react';
import {
  Map, Layers, Mountain, Droplets, Building2, Wind,
  ChevronDown, ChevronUp, Radio, ScanLine, Clock,
} from 'lucide-react';

// ── Types ───────────────────────────────────────────────────────────────────

interface MapTile {
  id: string;
  type: string;
  coordinates: { lat_min: number; lat_max: number; lng_min: number; lng_max: number };
  altitude_range: { top: number; bottom: number };
  resolution_cm: number;
  layers: Record<string, LayerData>;
  frequency_sources: string[];
  node_count: number;
  signal_paths_used: number;
  confidence: number;
  version: number;
  created: string;
}

interface LayerData {
  populated: boolean;
  pathCount: number;
  angularDiversity: number;
  avgImpact: number;
  dominantMaterial: string;
}

interface CoverageData {
  ok: boolean;
  totalNodes: number;
  totalPaths: number;
  totalTiles: number;
  coveredArea_km2: number;
  bestResolution_cm: number | null;
  frequenciesActive: string[];
  frequencyCapabilities: FrequencyBand[];
}

interface FrequencyBand {
  name: string;
  resolution_cm: number;
  penetration: string;
  range_m: number;
}

interface AtlasMetrics {
  initialized: boolean;
  coverage: {
    totalPaths: number;
    totalTiles: number;
    bestResolution_cm: number | null;
    frequenciesActive: string[];
  };
  stats: {
    signalsCollected: number;
    pathsModeled: number;
    tilesReconstructed: number;
    materialsClassified: number;
    changesDetected: number;
    queriesServed: number;
  };
}

interface AtlasViewerProps {
  type: 'overview' | 'tile' | 'coverage' | 'layers' | 'timeline';
  metrics?: AtlasMetrics;
  tile?: MapTile;
  coverage?: CoverageData;
}

// ── Layer Icons & Colors ────────────────────────────────────────────────────

const layerConfig: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
  surface:    { icon: <Mountain size={14} />,  color: 'text-emerald-400', label: 'Surface' },
  subsurface: { icon: <Layers size={14} />,    color: 'text-amber-400',   label: 'Subsurface' },
  interior:   { icon: <Building2 size={14} />, color: 'text-violet-400',  label: 'Interior' },
  atmosphere: { icon: <Wind size={14} />,      color: 'text-sky-400',     label: 'Atmosphere' },
  material:   { icon: <Droplets size={14} />,  color: 'text-rose-400',    label: 'Material' },
};

const penetrationColors: Record<string, string> = {
  walls: 'bg-violet-900 text-violet-300',
  thin_walls: 'bg-violet-900/60 text-violet-300',
  surface: 'bg-emerald-900 text-emerald-300',
  ground: 'bg-amber-900 text-amber-300',
  deep_ground: 'bg-orange-900 text-orange-300',
  deep_geology: 'bg-red-900 text-red-300',
  conducted: 'bg-sky-900 text-sky-300',
};

// ── Sub-Components ──────────────────────────────────────────────────────────

function OverviewView({ metrics }: { metrics: AtlasMetrics }) {
  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-900 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Map size={18} className="text-emerald-400" />
        <span className="text-sm font-semibold text-zinc-200">Foundation Atlas</span>
        <span className={`ml-auto text-xs px-2 py-0.5 rounded-full ${
          metrics.initialized ? 'bg-emerald-900 text-emerald-300' : 'bg-amber-900 text-amber-300'
        }`}>
          {metrics.initialized ? 'Tomography Active' : 'Inactive'}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="bg-zinc-800 rounded p-2 text-center">
          <Radio size={16} className="text-sky-400 mx-auto mb-1" />
          <div className="text-xs text-zinc-400">Signals</div>
          <div className="text-sm font-semibold text-zinc-200">{metrics.stats.signalsCollected}</div>
        </div>
        <div className="bg-zinc-800 rounded p-2 text-center">
          <ScanLine size={16} className="text-violet-400 mx-auto mb-1" />
          <div className="text-xs text-zinc-400">Paths</div>
          <div className="text-sm font-semibold text-zinc-200">{metrics.stats.pathsModeled}</div>
        </div>
        <div className="bg-zinc-800 rounded p-2 text-center">
          <Layers size={16} className="text-emerald-400 mx-auto mb-1" />
          <div className="text-xs text-zinc-400">Tiles</div>
          <div className="text-sm font-semibold text-zinc-200">{metrics.stats.tilesReconstructed}</div>
        </div>
      </div>

      <div className="flex items-center gap-4 text-xs text-zinc-400">
        <span>Materials: {metrics.stats.materialsClassified}</span>
        <span>Changes: {metrics.stats.changesDetected}</span>
        <span>Queries: {metrics.stats.queriesServed}</span>
      </div>

      {metrics.coverage.bestResolution_cm && (
        <div className="text-xs text-zinc-400">
          Best resolution: {metrics.coverage.bestResolution_cm}cm |
          Active bands: {metrics.coverage.frequenciesActive.length}
        </div>
      )}
    </div>
  );
}

function TileView({ tile }: { tile: MapTile }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-900 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Map size={18} className="text-emerald-400" />
        <span className="text-sm font-semibold text-zinc-200">Map Tile</span>
        <span className={`ml-auto text-xs px-2 py-0.5 rounded-full ${
          tile.confidence >= 0.7 ? 'bg-emerald-900 text-emerald-300' :
          tile.confidence >= 0.4 ? 'bg-amber-900 text-amber-300' :
          'bg-zinc-700 text-zinc-400'
        }`}>
          {Math.round(tile.confidence * 100)}% confidence
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="bg-zinc-800 rounded p-2">
          <div className="text-zinc-400">Resolution</div>
          <div className="text-zinc-200 font-semibold">{tile.resolution_cm}cm</div>
        </div>
        <div className="bg-zinc-800 rounded p-2">
          <div className="text-zinc-400">Version</div>
          <div className="text-zinc-200 font-semibold">v{tile.version}</div>
        </div>
        <div className="bg-zinc-800 rounded p-2">
          <div className="text-zinc-400">Signal Paths</div>
          <div className="text-zinc-200 font-semibold">{tile.signal_paths_used}</div>
        </div>
        <div className="bg-zinc-800 rounded p-2">
          <div className="text-zinc-400">Nodes</div>
          <div className="text-zinc-200 font-semibold">{tile.node_count}</div>
        </div>
      </div>

      <div className="flex flex-wrap gap-1">
        {tile.frequency_sources.map(freq => (
          <span key={freq} className="text-xs px-2 py-0.5 rounded bg-zinc-800 text-zinc-400">
            {freq}
          </span>
        ))}
      </div>

      <button
        onClick={() => setExpanded(!expanded)}
        className="text-xs text-zinc-400 hover:text-zinc-300 flex items-center gap-1"
      >
        {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        {expanded ? 'Hide layers' : 'Show layers'}
      </button>

      {expanded && (
        <div className="space-y-1">
          {Object.entries(tile.layers).map(([name, data]) => {
            const config = layerConfig[name];
            if (!config || !data) return null;
            return (
              <div key={name} className="flex items-center gap-2 p-1.5 bg-zinc-800 rounded text-xs">
                <span className={config.color}>{config.icon}</span>
                <span className="text-zinc-300 flex-1">{config.label}</span>
                <span className="text-zinc-400">
                  {(data as LayerData).dominantMaterial || 'unknown'}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CoverageView({ coverage }: { coverage: CoverageData }) {
  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-900 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Radio size={18} className="text-sky-400" />
        <span className="text-sm font-semibold text-zinc-200">Tomography Coverage</span>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="bg-zinc-800 rounded p-2">
          <div className="text-zinc-400">Signal Paths</div>
          <div className="text-zinc-200 font-semibold">{coverage.totalPaths}</div>
        </div>
        <div className="bg-zinc-800 rounded p-2">
          <div className="text-zinc-400">Map Tiles</div>
          <div className="text-zinc-200 font-semibold">{coverage.totalTiles}</div>
        </div>
        <div className="bg-zinc-800 rounded p-2">
          <div className="text-zinc-400">Area Covered</div>
          <div className="text-zinc-200 font-semibold">{coverage.coveredArea_km2.toFixed(3)} km²</div>
        </div>
        <div className="bg-zinc-800 rounded p-2">
          <div className="text-zinc-400">Best Resolution</div>
          <div className="text-zinc-200 font-semibold">
            {coverage.bestResolution_cm ? `${coverage.bestResolution_cm}cm` : 'N/A'}
          </div>
        </div>
      </div>

      <div className="space-y-1">
        <div className="text-xs text-zinc-400 mb-1">Frequency Capabilities</div>
        {coverage.frequencyCapabilities.map(band => (
          <div key={band.name} className="flex items-center gap-2 p-1.5 bg-zinc-800 rounded text-xs">
            <span className={`px-1.5 py-0.5 rounded ${penetrationColors[band.penetration] || 'bg-zinc-700 text-zinc-400'}`}>
              {band.penetration.replace(/_/g, ' ')}
            </span>
            <span className="text-zinc-300 flex-1">{band.name}</span>
            {band.resolution_cm > 0 && (
              <span className="text-zinc-400">{band.resolution_cm}cm</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function TimelineView({ metrics }: { metrics: AtlasMetrics }) {
  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-900 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Clock size={18} className="text-amber-400" />
        <span className="text-sm font-semibold text-zinc-200">Temporal Changes</span>
      </div>

      <div className="bg-zinc-800 rounded p-3 text-center">
        <div className="text-2xl font-bold text-zinc-200">{metrics.stats.changesDetected}</div>
        <div className="text-xs text-zinc-400">Physical changes detected</div>
      </div>

      <div className="text-xs text-zinc-400">
        Changes include: construction, demolition, weather effects, seasonal variation, human activity patterns.
        Detected through temporal differencing of tomographic reconstructions.
      </div>
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────────────────────

export default function AtlasViewer({
  type, metrics, tile, coverage,
}: AtlasViewerProps) {
  switch (type) {
    case 'overview':
      return metrics ? <OverviewView metrics={metrics} /> : null;
    case 'tile':
      return tile ? <TileView tile={tile} /> : null;
    case 'coverage':
      return coverage ? <CoverageView coverage={coverage} /> : null;
    case 'timeline':
      return metrics ? <TimelineView metrics={metrics} /> : null;
    default:
      return null;
  }
}
