'use client';

import React from 'react';
import { Activity, Wifi, WifiOff, Signal } from 'lucide-react';

// ── Types ───────────────────────────────────────────────────────────────────

interface EmbodimentState {
  meshExtent: number;
  strongRegions: number;
  numbRegions: number;
  bodyCoherence: number;
}

interface SensoryChannel {
  intensity: number;
  valence: number;
  sensitivity: number;
  lastUpdate: string | null;
}

interface QualiaBodyMapProps {
  entityId: string;
  embodiment: EmbodimentState;
  channels: Record<string, SensoryChannel>;
  overloadActive?: boolean;
  maturityLevel?: number;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function intensityBar(value: number, label: string, color: string) {
  const pct = Math.round(value * 100);
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-24 text-zinc-400 truncate">{label}</span>
      <div className="flex-1 h-2 bg-zinc-800 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-8 text-right text-zinc-500">{pct}%</span>
    </div>
  );
}

function valenceIndicator(valence: number) {
  if (valence >= 0.6) return <span className="text-emerald-400">+</span>;
  if (valence <= 0.4) return <span className="text-amber-400">-</span>;
  return <span className="text-zinc-500">=</span>;
}

// ── Component ───────────────────────────────────────────────────────────────

function QualiaBodyMap({
  entityId,
  embodiment,
  channels,
  overloadActive = false,
  maturityLevel = 0,
}: QualiaBodyMapProps) {
  const coherencePct = Math.round(embodiment.bodyCoherence * 100);
  const extentPct = Math.round(embodiment.meshExtent * 100);

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-neon-cyan" />
          <h3 className="text-sm font-semibold text-zinc-200">Body Map</h3>
          <span className="text-xs text-zinc-500">{entityId}</span>
        </div>
        {overloadActive && (
          <span className="text-xs bg-red-500/20 text-red-400 px-2 py-0.5 rounded-full">
            Overload Active
          </span>
        )}
      </div>

      {/* Embodiment Overview */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-zinc-800/50 rounded p-2">
          <div className="text-xs text-zinc-500 mb-1">Mesh Extent</div>
          <div className="text-lg font-mono text-neon-cyan">{extentPct}%</div>
        </div>
        <div className="bg-zinc-800/50 rounded p-2">
          <div className="text-xs text-zinc-500 mb-1">Body Coherence</div>
          <div
            className={`text-lg font-mono ${
              coherencePct > 60
                ? 'text-emerald-400'
                : coherencePct > 30
                  ? 'text-amber-400'
                  : 'text-red-400'
            }`}
          >
            {coherencePct}%
          </div>
        </div>
      </div>

      {/* Region Indicators */}
      <div className="flex gap-4 text-xs">
        <div className="flex items-center gap-1">
          <Signal className="w-3 h-3 text-emerald-400" />
          <span className="text-zinc-400">Strong:</span>
          <span className="text-emerald-400 font-mono">{embodiment.strongRegions}</span>
        </div>
        <div className="flex items-center gap-1">
          <WifiOff className="w-3 h-3 text-red-400" />
          <span className="text-zinc-400">Numb:</span>
          <span className="text-red-400 font-mono">{embodiment.numbRegions}</span>
        </div>
        <div className="flex items-center gap-1">
          <Wifi className="w-3 h-3 text-zinc-500" />
          <span className="text-zinc-400">Maturity:</span>
          <span className="text-zinc-300 font-mono">{maturityLevel}</span>
        </div>
      </div>

      {/* Sensory Channels */}
      <div className="space-y-1.5">
        <div className="text-xs text-zinc-500 font-medium uppercase tracking-wider">
          Sensory Channels
        </div>
        {Object.entries(channels).map(([name, ch]) => (
          <div key={name} className="flex items-center gap-1">
            {valenceIndicator(ch.valence)}
            {intensityBar(
              ch.intensity,
              name.replace(/_/g, ' '),
              ch.valence >= 0.5 ? 'bg-neon-cyan' : 'bg-amber-500'
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

import { withErrorBoundary } from '@/components/common/ErrorBoundary';
const _WrappedQualiaBodyMap = withErrorBoundary(QualiaBodyMap);
export { _WrappedQualiaBodyMap as QualiaBodyMap };
export default _WrappedQualiaBodyMap;
