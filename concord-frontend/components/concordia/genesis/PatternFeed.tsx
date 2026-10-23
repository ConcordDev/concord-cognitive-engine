'use client';

import React, { useEffect, useState, useCallback } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface SubstratePattern {
  id: string;
  pattern_type: 'skill_family' | 'creation_style' | 'cultural_practice' | string;
  description: string;
  member_dtu_ids: string[];
  worlds_present: string[];
  emergence_date: number;
  current_strength: number;
  trajectory: 'growing' | 'stable' | 'declining';
}

interface PatternFeedProps {
  refreshIntervalMs?: number;
  className?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const TRAJECTORY_CONFIG: Record<string, { icon: string; colour: string; label: string }> = {
  growing:   { icon: '↑', colour: 'text-emerald-400', label: 'Growing'   },
  stable:    { icon: '→', colour: 'text-yellow-400',  label: 'Stable'    },
  declining: { icon: '↓', colour: 'text-red-400',     label: 'Declining' },
};

const TYPE_LABELS: Record<string, string> = {
  skill_family:      'Skill Family',
  creation_style:    'Creation Style',
  cultural_practice: 'Cultural Practice',
};

const UNIVERSE_ICON: Record<string, string> = {
  'concordia-hub':      '🏙️',
  'fantasy':            '🧙',
  'superhero':          '⚡',
  'crime':              '🔫',
  'cyber':              '💾',
  'sere':               '🌑',
  'tunya':              '🌊',
  'sovereign-ruins':    '🏛️',
  'lattice-crucible':   '🔷',
  'concord-link-frontier': '🧭',
  'fable-world':        '🧙',
  'superhero-world':    '⚡',
  'wasteland-world':    '☢️',
  'crime-city':         '🔫',
  'war-zone':           '🪖',
};

// ── Sub-components ────────────────────────────────────────────────────────────

function StrengthBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const colour = pct >= 70 ? 'bg-emerald-500' : pct >= 40 ? 'bg-yellow-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${colour} transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-white/40 font-mono w-8 text-right">{pct}%</span>
    </div>
  );
}

function PatternCard({ pattern }: { pattern: SubstratePattern }) {
  const traj = TRAJECTORY_CONFIG[pattern.trajectory] || TRAJECTORY_CONFIG.stable;
  const typeLabel = TYPE_LABELS[pattern.pattern_type] || pattern.pattern_type;

  return (
    <div className="bg-black/50 border border-white/10 rounded-lg p-4 flex flex-col gap-2 hover:border-white/20 transition">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs text-white/40 font-mono uppercase tracking-wide">{typeLabel}</span>
        <span className={`text-xs font-semibold font-mono ${traj.colour}`}>
          {traj.icon} {traj.label}
        </span>
      </div>

      {/* Description */}
      <p className="text-sm text-white/80">{pattern.description || '—'}</p>

      {/* Strength */}
      <StrengthBar value={pattern.current_strength} />

      {/* Worlds */}
      {pattern.worlds_present.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1">
          {pattern.worlds_present.map(w => (
            <span key={w} className="text-xs bg-white/5 border border-white/10 rounded px-1.5 py-0.5 text-white/50">
              {UNIVERSE_ICON[w] || '🌍'} {w}
            </span>
          ))}
        </div>
      )}

      {/* Member count */}
      <div className="text-xs text-white/30 font-mono mt-1">
        {pattern.member_dtu_ids.length} skills
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function PatternFeed({ refreshIntervalMs = 60000, className = '' }: PatternFeedProps) {
  const [patterns, setPatterns]   = useState<SubstratePattern[]>([]);
  const [loading,  setLoading]    = useState(true);
  const [error,    setError]      = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res  = await fetch('/api/worlds/substrate/patterns');
      if (!res.ok) throw new Error('Failed to load patterns');
      const data = await res.json();
      setPatterns(data.patterns || []);
      setError(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load patterns');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, refreshIntervalMs);
    return () => clearInterval(timer);
  }, [load, refreshIntervalMs]);

  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      <div className="flex items-center justify-between">
        <span className="text-white font-semibold">Substrate Patterns</span>
        <button onClick={load} className="text-xs text-white/40 hover:text-white/70 transition">↺ Refresh</button>
      </div>

      {error && (
        <div className="text-red-400 text-xs bg-red-900/20 border border-red-500/30 rounded px-3 py-2">{error}</div>
      )}

      {loading ? (
        <div className="text-white/40 text-sm font-mono">Scanning substrate…</div>
      ) : patterns.length === 0 ? (
        <div className="text-white/30 text-sm font-mono">
          No patterns detected yet. They emerge as skills diffuse across worlds.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {patterns.map(p => <PatternCard key={p.id} pattern={p} />)}
        </div>
      )}
    </div>
  );
}
