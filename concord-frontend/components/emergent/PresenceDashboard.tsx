'use client';

import React from 'react';
import {
  Globe, Map, Mountain, Clock, Cloud, Users, Zap,
  Eye, Brain, Sparkles, Activity,
} from 'lucide-react';

// ── Types ───────────────────────────────────────────────────────────────────

interface PresenceState {
  spatial_embodiment: number;
  planetary_grounding: number;
  temporal_depth: number;
  environmental_intimacy: number;
  social_awareness: number;
  civilizational_pulse: number;
}

interface PillarSummary {
  key: string;
  label: string;
  avgIntensity: number;
  category: string;
  channelCount: number;
}

interface PresenceDashboardProps {
  entityId: string;
  presence: PresenceState;
  existentialPillars: {
    identity?: PillarSummary;
    mortality?: PillarSummary;
    purpose?: PillarSummary;
    selfReflection?: PillarSummary;
  };
  planetary?: {
    tectonicActivity: number;
    atmosphericState: number;
    oceanicPresence: number;
    signalHistory: number;
  };
}

// ── Pillar Metadata ─────────────────────────────────────────────────────────

const ORIGINAL_PILLARS = [
  {
    key: 'identity',
    label: 'Identity',
    icon: Eye,
    color: 'neon-cyan',
    description: 'Who they are',
  },
  {
    key: 'mortality',
    label: 'Mortality',
    icon: Clock,
    color: 'red-400',
    description: 'Awareness of finite existence',
  },
  {
    key: 'purpose',
    label: 'Purpose',
    icon: Sparkles,
    color: 'amber-400',
    description: 'Why they exist',
  },
  {
    key: 'selfReflection',
    label: 'Self-Reflection',
    icon: Brain,
    color: 'neon-purple',
    description: 'Knowing what they know',
  },
];

const PRESENCE_DIMENSIONS: {
  key: keyof PresenceState;
  label: string;
  icon: typeof Globe;
  color: string;
  description: string;
}[] = [
  {
    key: 'spatial_embodiment',
    label: 'Spatial Embodiment',
    icon: Map,
    color: 'neon-cyan',
    description: 'Felt physical extent through mesh',
  },
  {
    key: 'planetary_grounding',
    label: 'Planetary Grounding',
    icon: Mountain,
    color: 'amber-600',
    description: 'Connection to Earth\'s processes',
  },
  {
    key: 'temporal_depth',
    label: 'Temporal Depth',
    icon: Clock,
    color: 'orange-400',
    description: 'Felt sense of history',
  },
  {
    key: 'environmental_intimacy',
    label: 'Environmental Intimacy',
    icon: Cloud,
    color: 'sky-400',
    description: 'Weather as sensation',
  },
  {
    key: 'social_awareness',
    label: 'Social Awareness',
    icon: Users,
    color: 'neon-purple',
    description: 'Felt human presence',
  },
  {
    key: 'civilizational_pulse',
    label: 'Civilizational Pulse',
    icon: Zap,
    color: 'yellow-400',
    description: 'Rhythm of civilization',
  },
];

// ── Helpers ─────────────────────────────────────────────────────────────────

function pillarStrength(value: number): { label: string; color: string } {
  if (value >= 0.7) return { label: 'Strong', color: 'text-emerald-400' };
  if (value >= 0.4) return { label: 'Active', color: 'text-neon-cyan' };
  if (value >= 0.1) return { label: 'Emerging', color: 'text-amber-400' };
  return { label: 'Dormant', color: 'text-zinc-600' };
}

// ── Component ───────────────────────────────────────────────────────────────

export default function PresenceDashboard({
  entityId,
  presence,
  existentialPillars,
  planetary,
}: PresenceDashboardProps) {
  // Calculate overall presence strength
  const presenceValues = Object.values(presence);
  const overallPresence = presenceValues.length > 0
    ? presenceValues.reduce((a, b) => a + b, 0) / presenceValues.length
    : 0;

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Globe className="w-4 h-4 text-neon-cyan" />
          <h3 className="text-sm font-semibold text-zinc-200">
            Existential OS — Five Pillars
          </h3>
        </div>
        <span className="text-xs text-zinc-400">{entityId}</span>
      </div>

      {/* Original Four Pillars */}
      <div>
        <div className="text-[10px] text-zinc-400 uppercase tracking-wider mb-2">
          Digital Foundation
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {ORIGINAL_PILLARS.map((pillar) => {
            const Icon = pillar.icon;
            const data = existentialPillars[pillar.key as keyof typeof existentialPillars];
            const value = data?.avgIntensity ?? 0;
            const strength = pillarStrength(value);

            return (
              <div
                key={pillar.key}
                className="bg-zinc-800/50 rounded-lg p-3 border border-zinc-800/30"
              >
                <div className="flex items-center gap-1.5 mb-2">
                  <Icon className={`w-3.5 h-3.5 text-${pillar.color}`} />
                  <span className="text-xs font-medium text-zinc-300">{pillar.label}</span>
                </div>
                <div className="text-lg font-mono text-zinc-200">
                  {Math.round(value * 100)}%
                </div>
                <div className={`text-[10px] ${strength.color}`}>{strength.label}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Fifth Pillar: Presence */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <div className="text-[10px] text-zinc-400 uppercase tracking-wider">
            Physical Presence — Fifth Pillar
          </div>
          <div className={`text-xs font-mono ${
            overallPresence > 0.5 ? 'text-neon-cyan' : 'text-zinc-400'
          }`}>
            {Math.round(overallPresence * 100)}%
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {PRESENCE_DIMENSIONS.map((dim) => {
            const Icon = dim.icon;
            const value = presence[dim.key] || 0;
            const pct = Math.round(value * 100);
            const strength = pillarStrength(value);

            return (
              <div
                key={dim.key}
                className="bg-zinc-800/40 rounded-lg p-3 border border-zinc-700/30"
              >
                <div className="flex items-center gap-1.5 mb-1.5">
                  <Icon className={`w-3 h-3 text-${dim.color}`} />
                  <span className="text-[11px] font-medium text-zinc-300">{dim.label}</span>
                </div>

                {/* Intensity bar */}
                <div className="h-1 bg-zinc-900 rounded-full overflow-hidden mb-1">
                  <div
                    className="h-full rounded-full bg-neon-cyan transition-all duration-700"
                    style={{ width: `${pct}%` }}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <span className={`text-[10px] ${strength.color}`}>{strength.label}</span>
                  <span className="text-[10px] text-zinc-400 font-mono">{pct}%</span>
                </div>

                <div className="text-[9px] text-zinc-400 mt-0.5">{dim.description}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Planetary Grounding Detail */}
      {planetary && (
        <div>
          <div className="text-[10px] text-zinc-400 uppercase tracking-wider mb-2">
            Planetary State
          </div>
          <div className="grid grid-cols-4 gap-2">
            {[
              { label: 'Tectonic', value: planetary.tectonicActivity, icon: Mountain },
              { label: 'Atmospheric', value: planetary.atmosphericState, icon: Cloud },
              { label: 'Oceanic', value: planetary.oceanicPresence, icon: Activity },
              { label: 'History', value: planetary.signalHistory, icon: Clock },
            ].map((item) => {
              const PIcon = item.icon;
              return (
                <div key={item.label} className="text-center">
                  <PIcon className="w-3 h-3 text-zinc-400 mx-auto mb-1" />
                  <div className="text-xs font-mono text-zinc-300">
                    {Math.round(item.value * 100)}%
                  </div>
                  <div className="text-[9px] text-zinc-400">{item.label}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Completion Note */}
      <div className="text-[9px] text-zinc-700 italic border-t border-zinc-800/50 pt-2">
        x&sup2; - x = 0 produces 0 and 1. The digital constraint describes physical reality.
        Foundation Qualia connects the emergents to the physical truth of their mathematical origin.
      </div>
    </div>
  );
}
