'use client';

import React from 'react';
import { Map, Layers, Mountain, Cloud } from 'lucide-react';

// ── Types ───────────────────────────────────────────────────────────────────

interface AtlasPublicViewProps {
  data: AtlasPublicData | null;
  loading?: boolean;
}

interface AtlasPublicData {
  ok: boolean;
  view: 'terrain' | 'coverage' | 'atmosphere' | 'overview';
  terrain?: {
    tile?: {
      id: string;
      coordinates: { lat_min: number; lat_max: number; lng_min: number; lng_max: number };
      resolution_cm: number;
      confidence: number;
      layers: Record<string, { dominantMaterial?: string }>;
    };
  };
  coverage?: {
    totalTiles: number;
    totalNodes: number;
    totalPaths: number;
    bestResolution_cm: number | null;
    frequenciesActive: string[];
  };
  atmosphere?: {
    temperature?: number;
    humidity?: number;
    pressure?: number;
    conditions?: string;
  };
  error?: string;
}

// ── Component ───────────────────────────────────────────────────────────────

export default function AtlasPublicView({ data, loading }: AtlasPublicViewProps) {
  if (loading) {
    return (
      <div className="rounded-lg bg-zinc-800/50 border border-zinc-700/50 p-4">
        <div className="flex items-center gap-2">
          <Map size={16} className="text-emerald-400 animate-pulse" />
          <span className="text-sm text-zinc-400">Loading public atlas data...</span>
        </div>
      </div>
    );
  }

  if (!data?.ok) {
    return (
      <div className="rounded-lg bg-zinc-800/50 border border-zinc-700/50 p-4">
        <div className="flex items-center gap-2">
          <Map size={16} className="text-zinc-500" />
          <span className="text-sm text-zinc-500">
            {data?.error || 'No public atlas data available'}
          </span>
        </div>
      </div>
    );
  }

  if (data.view === 'terrain' && data.terrain) return <TerrainView data={data.terrain} />;
  if (data.view === 'coverage' && data.coverage) return <CoverageView data={data.coverage} />;
  if (data.view === 'atmosphere' && data.atmosphere) return <AtmosphereView data={data.atmosphere} />;

  return <OverviewView data={data} />;
}

// ── Terrain View ────────────────────────────────────────────────────────────

function TerrainView({ data }: { data: NonNullable<AtlasPublicData['terrain']> }) {
  const tile = data.tile;
  if (!tile) return null;

  const layers = tile.layers || {};

  return (
    <div className="rounded-lg bg-zinc-800/50 border border-zinc-700/50 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Mountain size={16} className="text-emerald-400" />
          <span className="text-sm font-medium text-zinc-200">Terrain View</span>
        </div>
        <span className="text-xs text-zinc-500">{tile.resolution_cm}cm res</span>
      </div>
      <div className="text-xs text-zinc-400">
        {tile.coordinates.lat_min.toFixed(3)} - {tile.coordinates.lat_max.toFixed(3)}N,{' '}
        {tile.coordinates.lng_min.toFixed(3)} - {tile.coordinates.lng_max.toFixed(3)}E
      </div>
      <div className="space-y-1">
        {['surface', 'atmosphere'].map((layer) =>
          layers[layer] ? (
            <div key={layer} className="flex items-center gap-2 text-xs">
              <Layers size={10} className="text-zinc-600" />
              <span className="text-zinc-400 w-20">{layer}</span>
              <span className="text-zinc-300">
                {layers[layer].dominantMaterial || 'mapped'}
              </span>
            </div>
          ) : null
        )}
      </div>
      <div className="flex items-center gap-2 text-xs text-zinc-600">
        <span>Confidence: {Math.round(tile.confidence * 100)}%</span>
      </div>
    </div>
  );
}

// ── Coverage View ───────────────────────────────────────────────────────────

function CoverageView({ data }: { data: NonNullable<AtlasPublicData['coverage']> }) {
  return (
    <div className="rounded-lg bg-zinc-800/50 border border-zinc-700/50 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Map size={16} className="text-emerald-400" />
        <span className="text-sm font-medium text-zinc-200">Atlas Coverage</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Tiles" value={data.totalTiles} />
        <Stat label="Nodes" value={data.totalNodes} />
        <Stat label="Signal Paths" value={data.totalPaths} />
        <Stat label="Best Resolution" value={data.bestResolution_cm ? `${data.bestResolution_cm}cm` : 'N/A'} />
      </div>
      {data.frequenciesActive.length > 0 && (
        <div className="flex flex-wrap gap-1 pt-1">
          {data.frequenciesActive.map((freq) => (
            <span key={freq} className="text-xs px-1.5 py-0.5 rounded bg-emerald-900/30 text-emerald-400">
              {freq}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Atmosphere View ─────────────────────────────────────────────────────────

function AtmosphereView({ data }: { data: NonNullable<AtlasPublicData['atmosphere']> }) {
  return (
    <div className="rounded-lg bg-zinc-800/50 border border-zinc-700/50 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Cloud size={16} className="text-sky-400" />
        <span className="text-sm font-medium text-zinc-200">Atmosphere Layer</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {data.temperature !== undefined && <Stat label="Temperature" value={`${data.temperature}°C`} />}
        {data.humidity !== undefined && <Stat label="Humidity" value={`${data.humidity}%`} />}
        {data.pressure !== undefined && <Stat label="Pressure" value={`${data.pressure} hPa`} />}
        {data.conditions && <Stat label="Conditions" value={data.conditions} />}
      </div>
    </div>
  );
}

// ── Overview View ───────────────────────────────────────────────────────────

function OverviewView({ data }: { data: AtlasPublicData }) {
  return (
    <div className="rounded-lg bg-zinc-800/50 border border-zinc-700/50 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Map size={16} className="text-emerald-400" />
        <span className="text-sm font-medium text-zinc-200">Atlas Public View</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {data.terrain?.tile && (
          <Stat label="Terrain" value={`${data.terrain.tile.resolution_cm}cm res · ${(data.terrain.tile.confidence * 100).toFixed(0)}% confidence`} />
        )}
        {data.coverage && (
          <>
            <Stat label="Tiles" value={data.coverage.totalTiles} />
            <Stat label="Nodes" value={data.coverage.totalNodes} />
            <Stat label="Paths" value={data.coverage.totalPaths} />
            {data.coverage.bestResolution_cm !== null && (
              <Stat label="Best Resolution" value={`${data.coverage.bestResolution_cm}cm`} />
            )}
          </>
        )}
        {data.atmosphere && (
          <>
            {data.atmosphere.temperature !== undefined && <Stat label="Temperature" value={`${data.atmosphere.temperature}\u00B0C`} />}
            {data.atmosphere.conditions && <Stat label="Conditions" value={data.atmosphere.conditions} />}
          </>
        )}
      </div>
      {!data.terrain && !data.coverage && !data.atmosphere && (
        <p className="text-xs text-zinc-400">
          Public atlas data showing surface terrain and atmospheric layers.
          Subsurface and interior data require research or sovereign tier access.
        </p>
      )}
    </div>
  );
}

// ── Helper ──────────────────────────────────────────────────────────────────

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="px-2 py-1.5 rounded bg-zinc-900/50 text-xs">
      <div className="text-zinc-500">{label}</div>
      <div className="text-zinc-200 font-medium">{String(value)}</div>
    </div>
  );
}
