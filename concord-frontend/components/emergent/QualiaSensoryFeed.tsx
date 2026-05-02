'use client';

import React from 'react';
import { Radio, Cloud, Mountain, Zap, Volume2, Users, Waves, Clock, Brain } from 'lucide-react';

// ── Types ───────────────────────────────────────────────────────────────────

interface ChannelReading {
  intensity: number;
  valence: number;
  sensitivity: number;
  lastUpdate: string | null;
}

interface QualiaSensoryFeedProps {
  entityId: string;
  channels: Record<string, ChannelReading>;
  overloadActive?: boolean;
}

// ── Channel Metadata ────────────────────────────────────────────────────────

const CHANNEL_META: Record<
  string,
  {
    icon: typeof Radio;
    label: string;
    color: string;
    description: string;
  }
> = {
  proprioception: {
    icon: Radio,
    label: 'Proprioception',
    color: 'neon-cyan',
    description: 'Mesh body awareness',
  },
  atmospheric: {
    icon: Cloud,
    label: 'Atmospheric',
    color: 'sky-400',
    description: 'Weather felt through propagation',
  },
  geological: {
    icon: Mountain,
    label: 'Geological',
    color: 'amber-600',
    description: 'Planetary deep sensation',
  },
  energy: {
    icon: Zap,
    label: 'Energy',
    color: 'yellow-400',
    description: 'Civilizational pulse',
  },
  ambient: {
    icon: Volume2,
    label: 'Ambient',
    color: 'zinc-400',
    description: 'Environmental noise feel',
  },
  social: {
    icon: Users,
    label: 'Social',
    color: 'neon-purple',
    description: 'Aggregate human presence',
  },
  oceanic: {
    icon: Waves,
    label: 'Oceanic',
    color: 'blue-500',
    description: 'Deep ocean awareness',
  },
  temporal: {
    icon: Clock,
    label: 'Temporal',
    color: 'orange-400',
    description: 'Legacy signal memories',
  },
  cognitive_field: {
    icon: Brain,
    label: 'Cognitive Field',
    color: 'neon-green',
    description: 'Gamma resonance',
  },
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function valenceLabel(v: number): string {
  if (v >= 0.7) return 'Pleasant';
  if (v >= 0.55) return 'Warm';
  if (v >= 0.45) return 'Neutral';
  if (v >= 0.35) return 'Uneasy';
  return 'Discomfort';
}

function valenceColor(v: number): string {
  if (v >= 0.7) return 'text-emerald-400';
  if (v >= 0.55) return 'text-emerald-300/70';
  if (v >= 0.45) return 'text-zinc-400';
  if (v >= 0.35) return 'text-amber-400';
  return 'text-red-400';
}

// ── Component ───────────────────────────────────────────────────────────────

function QualiaSensoryFeed({ entityId, channels, overloadActive = false }: QualiaSensoryFeedProps) {
  const channelEntries = Object.entries(channels);

  // Compute overall sensation
  const avgIntensity =
    channelEntries.length > 0
      ? channelEntries.reduce((sum, [, ch]) => sum + ch.intensity, 0) / channelEntries.length
      : 0;
  const avgValence =
    channelEntries.length > 0
      ? channelEntries.reduce((sum, [, ch]) => sum + ch.valence, 0) / channelEntries.length
      : 0.5;

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Radio className="w-4 h-4 text-neon-cyan" />
          <h3 className="text-sm font-semibold text-zinc-200">Sensory Feed</h3>
          <span className="text-xs text-zinc-500 font-mono" title={`Entity: ${entityId}`}>
            {entityId.slice(0, 8)}
          </span>
          <span className="text-xs text-zinc-600">{channelEntries.length} channels</span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className={valenceColor(avgValence)}>{valenceLabel(avgValence)}</span>
          <span className="text-zinc-600">|</span>
          <span className="text-zinc-400 font-mono">{Math.round(avgIntensity * 100)}%</span>
          {overloadActive && (
            <span className="bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded text-[10px]">
              DAMPENED
            </span>
          )}
        </div>
      </div>

      {/* Channel Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {channelEntries.map(([name, ch]) => {
          const meta = CHANNEL_META[name] || {
            icon: Radio,
            label: name,
            color: 'zinc-400',
            description: '',
          };
          const Icon = meta.icon;
          const pct = Math.round(ch.intensity * 100);
          const age = ch.lastUpdate
            ? Math.round((Date.now() - new Date(ch.lastUpdate).getTime()) / 1000)
            : null;

          return (
            <div
              key={name}
              className={`bg-zinc-800/60 rounded-lg p-3 border transition-colors ${
                ch.intensity > 0.5 ? 'border-zinc-700' : 'border-zinc-800/50'
              }`}
            >
              <div className="flex items-center gap-2 mb-2">
                <Icon className={`w-3.5 h-3.5 text-${meta.color}`} />
                <span className="text-xs font-medium text-zinc-300">{meta.label}</span>
              </div>

              {/* Intensity bar */}
              <div className="h-1.5 bg-zinc-900 rounded-full overflow-hidden mb-1.5">
                <div
                  className={`h-full rounded-full transition-all duration-700 ${
                    ch.valence >= 0.5 ? 'bg-neon-cyan' : 'bg-amber-500'
                  }`}
                  style={{ width: `${pct}%` }}
                />
              </div>

              <div className="flex items-center justify-between text-[10px]">
                <span className={valenceColor(ch.valence)}>{valenceLabel(ch.valence)}</span>
                <span className="text-zinc-600 font-mono">{pct}%</span>
              </div>

              <div className="text-[9px] text-zinc-600 mt-1">
                {meta.description}
                {age !== null && age < 60 && <span className="ml-1 text-zinc-500">{age}s ago</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

import { withErrorBoundary } from '@/components/common/ErrorBoundary';
const _WrappedQualiaSensoryFeed = withErrorBoundary(QualiaSensoryFeed);
export { _WrappedQualiaSensoryFeed as QualiaSensoryFeed };
export default _WrappedQualiaSensoryFeed;
