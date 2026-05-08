'use client';

import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

/* ── Types ─────────────────────────────────────────────────────── */

type ExpertiseLevel = 'newcomer' | 'beginner' | 'intermediate' | 'advanced' | 'expert';
type DetailLevel = 'simplified' | 'standard' | 'detailed' | 'engineering';

interface BehaviorSignal {
  type: 'material-choice' | 'cross-section-config' | 'build-speed' | 'ui-navigation' | 'validation-result' | 'tool-usage' | 'undo-redo';
  complexity: number; // 0–1 how advanced the action was
  timestamp: number;
}

interface ExpertiseMetrics {
  materialDiversity: number;
  configComplexity: number;
  buildSpeed: number;
  navigationFluency: number;
  validationSuccessRate: number;
  toolUsageBreadth: number;
  undoFrequency: number;
}

interface AdaptiveComplexityAPI {
  expertiseLevel: ExpertiseLevel;
  detailLevel: DetailLevel;
  recordSignal: (signal: Omit<BehaviorSignal, 'timestamp'>) => void;
  setOverride: (level: DetailLevel | null) => void;
}

interface AdaptiveComplexityProps {
  children: React.ReactNode;
  userId?: string;
}

/* ── Constants ────────────────────────────────────────────────── */

const EXPERTISE_THRESHOLDS: Record<ExpertiseLevel, number> = {
  newcomer: 0,
  beginner: 0.15,
  intermediate: 0.35,
  advanced: 0.60,
  expert: 0.80,
};

const DETAIL_MAP: Record<ExpertiseLevel, DetailLevel> = {
  newcomer: 'simplified',
  beginner: 'simplified',
  intermediate: 'standard',
  advanced: 'detailed',
  expert: 'engineering',
};

const SIGNAL_WEIGHTS: Record<BehaviorSignal['type'], number> = {
  'material-choice': 0.15,
  'cross-section-config': 0.20,
  'build-speed': 0.10,
  'ui-navigation': 0.10,
  'validation-result': 0.20,
  'tool-usage': 0.15,
  'undo-redo': 0.10,
};

const MAX_SIGNAL_HISTORY = 200;
const DECAY_FACTOR = 0.995; // slight decay on older signals

/* ── Context ──────────────────────────────────────────────────── */

const AdaptiveComplexityContext = createContext<AdaptiveComplexityAPI>({
  expertiseLevel: 'newcomer',
  detailLevel: 'simplified',
  recordSignal: () => {},
  setOverride: () => {},
});

export function useAdaptiveComplexity(): AdaptiveComplexityAPI {
  return useContext(AdaptiveComplexityContext);
}

/* ── Expertise inference engine ───────────────────────────────── */

function inferExpertise(signals: BehaviorSignal[]): { level: ExpertiseLevel; score: number; metrics: ExpertiseMetrics } {
  if (signals.length === 0) {
    return {
      level: 'newcomer',
      score: 0,
      metrics: {
        materialDiversity: 0,
        configComplexity: 0,
        buildSpeed: 0,
        navigationFluency: 0,
        validationSuccessRate: 0,
        toolUsageBreadth: 0,
        undoFrequency: 0,
      },
    };
  }

  const now = Date.now();
  const byType: Record<string, BehaviorSignal[]> = {};
  for (const s of signals) {
    if (!byType[s.type]) byType[s.type] = [];
    byType[s.type].push(s);
  }

  const avgComplexity = (type: string): number => {
    const group = byType[type] || [];
    if (group.length === 0) return 0;
    let weighted = 0;
    let totalWeight = 0;
    for (const s of group) {
      const age = (now - s.timestamp) / (1000 * 60 * 60); // hours
      const w = Math.pow(DECAY_FACTOR, age);
      weighted += s.complexity * w;
      totalWeight += w;
    }
    return totalWeight > 0 ? weighted / totalWeight : 0;
  };

  const metrics: ExpertiseMetrics = {
    materialDiversity: avgComplexity('material-choice'),
    configComplexity: avgComplexity('cross-section-config'),
    buildSpeed: avgComplexity('build-speed'),
    navigationFluency: avgComplexity('ui-navigation'),
    validationSuccessRate: avgComplexity('validation-result'),
    toolUsageBreadth: avgComplexity('tool-usage'),
    undoFrequency: 1 - avgComplexity('undo-redo'), // high undo = lower expertise
  };

  // Weighted composite score
  let score =
    metrics.materialDiversity * SIGNAL_WEIGHTS['material-choice'] +
    metrics.configComplexity * SIGNAL_WEIGHTS['cross-section-config'] +
    metrics.buildSpeed * SIGNAL_WEIGHTS['build-speed'] +
    metrics.navigationFluency * SIGNAL_WEIGHTS['ui-navigation'] +
    metrics.validationSuccessRate * SIGNAL_WEIGHTS['validation-result'] +
    metrics.toolUsageBreadth * SIGNAL_WEIGHTS['tool-usage'] +
    metrics.undoFrequency * SIGNAL_WEIGHTS['undo-redo'];

  // Boost slightly for volume of activity
  const volumeBonus = Math.min(0.1, signals.length / 1000);
  score = Math.min(1, score + volumeBonus);

  // Determine level
  let level: ExpertiseLevel = 'newcomer';
  for (const [lvl, threshold] of Object.entries(EXPERTISE_THRESHOLDS) as [ExpertiseLevel, number][]) {
    if (score >= threshold) level = lvl;
  }

  return { level, score, metrics };
}

/* ── Component ────────────────────────────────────────────────── */

const panel = 'bg-black/80 backdrop-blur-sm border border-white/10 rounded-lg';

export default function AdaptiveComplexity({ children, userId }: AdaptiveComplexityProps) {
  const [signals, setSignals] = useState<BehaviorSignal[]>([]);
  const [override, setOverrideState] = useState<DetailLevel | null>(null);
  const [showDebug, setShowDebug] = useState(false);

  const { level, score, metrics } = useMemo(() => inferExpertise(signals), [signals]);

  const detailLevel: DetailLevel = override ?? DETAIL_MAP[level];

  const recordSignal = useCallback((signal: Omit<BehaviorSignal, 'timestamp'>) => {
    setSignals((prev) => {
      const next = [...prev, { ...signal, timestamp: Date.now() }];
      return next.length > MAX_SIGNAL_HISTORY ? next.slice(-MAX_SIGNAL_HISTORY) : next;
    });
  }, []);

  const setOverride = useCallback((level: DetailLevel | null) => {
    setOverrideState(level);
  }, []);

  const api = useMemo<AdaptiveComplexityAPI>(
    () => ({ expertiseLevel: level, detailLevel, recordSignal, setOverride }),
    [level, detailLevel, recordSignal, setOverride],
  );

  const levelColors: Record<ExpertiseLevel, string> = {
    newcomer: 'text-gray-400',
    beginner: 'text-green-400',
    intermediate: 'text-blue-400',
    advanced: 'text-purple-400',
    expert: 'text-yellow-400',
  };

  return (
    <AdaptiveComplexityContext.Provider value={api}>
      {children}

      {/* Debug dashboard — hidden by default, toggled via keyboard shortcut or settings */}
      {showDebug && (
        <div className={`fixed top-4 left-4 z-[8500] w-72 ${panel} p-4`}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-semibold text-gray-300">Adaptive Complexity</h3>
            <button onClick={() => setShowDebug(false)} className="text-[10px] text-gray-500 hover:text-white">
              Close
            </button>
          </div>

          {/* Inferred level */}
          <div className="mb-3">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-gray-500">Inferred Level</span>
              <span className={`text-xs font-semibold capitalize ${levelColors[level]}`}>{level}</span>
            </div>
            <div className="h-1.5 rounded-full bg-white/10 mt-1 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-green-500 via-blue-500 to-yellow-500"
                style={{ width: `${score * 100}%` }}
              />
            </div>
            <div className="flex justify-between mt-0.5">
              <span className="text-[8px] text-gray-600">Newcomer</span>
              <span className="text-[8px] text-gray-600">Expert</span>
            </div>
          </div>

          {/* Detail level */}
          <div className="mb-3">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-gray-500">Detail Level</span>
              <span className="text-xs text-cyan-400 capitalize">{detailLevel}</span>
            </div>
            {override && (
              <span className="text-[8px] text-yellow-400">Override active</span>
            )}
          </div>

          {/* Metrics breakdown */}
          <div className="space-y-1.5">
            <span className="text-[10px] text-gray-500">Behavior Metrics</span>
            {Object.entries(metrics).map(([key, value]) => (
              <div key={key} className="flex items-center gap-2">
                <span className="text-[9px] text-gray-500 w-24 truncate">
                  {key.replace(/([A-Z])/g, ' $1').trim()}
                </span>
                <div className="flex-1 h-1 rounded-full bg-white/10 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-cyan-500/60"
                    style={{ width: `${(value as number) * 100}%` }}
                  />
                </div>
                <span className="text-[8px] text-gray-600 w-8 text-right">
                  {((value as number) * 100).toFixed(0)}%
                </span>
              </div>
            ))}
          </div>

          {/* Signal count */}
          <div className="mt-3 pt-2 border-t border-white/5 flex items-center justify-between">
            <span className="text-[9px] text-gray-600">{signals.length} signals recorded</span>
            {userId && <span className="text-[9px] text-gray-600">{userId}</span>}
          </div>

          {/* Override control */}
          <div className="mt-3 pt-2 border-t border-white/5">
            <span className="text-[10px] text-gray-500 block mb-1">Override Detail Level</span>
            <div className="flex gap-1 flex-wrap">
              {(['simplified', 'standard', 'detailed', 'engineering'] as DetailLevel[]).map((lvl) => (
                <button
                  key={lvl}
                  onClick={() => setOverride(override === lvl ? null : lvl)}
                  className={`text-[9px] px-2 py-0.5 rounded border transition-colors ${
                    override === lvl
                      ? 'border-cyan-500/50 bg-cyan-500/10 text-cyan-400'
                      : 'border-white/10 text-gray-500 hover:text-white hover:border-white/20'
                  }`}
                >
                  {lvl}
                </button>
              ))}
            </div>
            <button
              onClick={() => setOverride('engineering')}
              className="text-[9px] text-gray-500 hover:text-cyan-400 mt-1.5 transition-colors"
            >
              Always show full engineering data
            </button>
          </div>
        </div>
      )}

      {/* Hidden toggle — ctrl+shift+D */}
      <div
        className="fixed top-0 left-0 w-0 h-0 overflow-hidden"
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.ctrlKey && e.shiftKey && e.key === 'D') {
            setShowDebug((prev) => !prev);
          }
        }}
      />
    </AdaptiveComplexityContext.Provider>
  );
}
