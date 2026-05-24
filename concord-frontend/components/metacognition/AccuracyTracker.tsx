'use client';

/**
 * AccuracyTracker — Brier score / accuracy tracking over the resolved
 * decision history (`accuracyHistory`) plus reflection streak / habit
 * tracking (`streakStatus`). Every number is macro-derived.
 */

import { useCallback, useEffect, useState } from 'react';
import { Activity, Flame, Loader2, Target, TrendingUp } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz';

interface DomainStat { domain: string; n: number; accuracy: number; brierScore: number }
interface RollingPoint { index: number; title: string; rollingAccuracy: number }
interface AccuracyData {
  n: number;
  overallBrier: number | null;
  overallAccuracy: number | null;
  domains: DomainStat[];
  rolling: RollingPoint[];
}
interface CalendarDay { day: string; active: boolean }
interface StreakData {
  current: number;
  longest: number;
  totalDays: number;
  reflectedToday: boolean;
  calendar: CalendarDay[];
}

export function AccuracyTracker() {
  const [acc, setAcc] = useState<AccuracyData | null>(null);
  const [streak, setStreak] = useState<StreakData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [aRes, sRes] = await Promise.all([
      lensRun('metacognition', 'accuracyHistory', {}),
      lensRun('metacognition', 'streakStatus', {}),
    ]);
    if (aRes.data.ok && aRes.data.result) setAcc(aRes.data.result as AccuracyData);
    else setError(aRes.data.error || 'Failed to load accuracy history');
    if (sRes.data.ok && sRes.data.result) setStreak(sRes.data.result as StreakData);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-gray-400 gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading accuracy tracking...
      </div>
    );
  }

  const rollingData = (acc?.rolling || []).map((p) => ({
    label: `#${p.index}`,
    accuracy: Math.round(p.rollingAccuracy * 100),
  }));
  const domainData = (acc?.domains || []).map((d) => ({
    domain: d.domain,
    accuracy: Math.round(d.accuracy * 100),
    brier: Math.round(d.brierScore * 1000) / 1000,
  }));

  return (
    <div className="space-y-6">
      {error && (
        <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg p-3">{error}</div>
      )}

      {/* Headline stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="lens-card">
          <Target className="w-4 h-4 text-neon-cyan mb-1" />
          <p className="text-xl font-bold font-mono">{acc?.overallBrier != null ? acc.overallBrier.toFixed(3) : '--'}</p>
          <p className="text-xs text-gray-400">Overall Brier</p>
        </div>
        <div className="lens-card">
          <TrendingUp className="w-4 h-4 text-neon-green mb-1" />
          <p className="text-xl font-bold font-mono">{acc?.overallAccuracy != null ? `${(acc.overallAccuracy * 100).toFixed(0)}%` : '--'}</p>
          <p className="text-xs text-gray-400">Accuracy ({acc?.n ?? 0})</p>
        </div>
        <div className="lens-card">
          <Flame className="w-4 h-4 text-neon-yellow mb-1" />
          <p className="text-xl font-bold font-mono">{streak?.current ?? 0}</p>
          <p className="text-xs text-gray-400">Day streak</p>
        </div>
        <div className="lens-card">
          <Activity className="w-4 h-4 text-neon-purple mb-1" />
          <p className="text-xl font-bold font-mono">{streak?.longest ?? 0}</p>
          <p className="text-xs text-gray-400">Longest streak</p>
        </div>
      </div>

      {/* Reflection habit calendar */}
      {streak && (
        <div className="panel p-4">
          <h3 className="font-semibold mb-3 flex items-center gap-2">
            <Flame className="w-4 h-4 text-neon-yellow" /> Reflection Habit — last 14 days
          </h3>
          <div className="flex gap-1.5 flex-wrap">
            {streak.calendar.map((d) => (
              <div
                key={d.day}
                title={`${d.day}${d.active ? ' — reflected' : ''}`}
                className={`w-7 h-7 rounded ${d.active ? 'bg-neon-yellow/70' : 'bg-lattice-deep border border-gray-700/40'}`}
              />
            ))}
          </div>
          <p className="text-xs text-gray-400 mt-2">
            {streak.totalDays} total reflection day{streak.totalDays !== 1 ? 's' : ''}
            {streak.reflectedToday
              ? ' · reflected today'
              : ' · no reflection yet today — keep the streak alive'}
          </p>
        </div>
      )}

      {/* Rolling accuracy */}
      {rollingData.length > 1 ? (
        <div className="panel p-4">
          <h3 className="font-semibold mb-3 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-neon-green" /> Rolling Accuracy (5-prediction window)
          </h3>
          <ChartKit
            kind="line"
            data={rollingData}
            xKey="label"
            series={[{ key: 'accuracy', label: 'Rolling accuracy %', color: '#22c55e' }]}
            height={200}
          />
        </div>
      ) : (
        <div className="text-center py-6 text-gray-400 text-sm border border-dashed border-white/10 rounded-lg">
          Resolve at least two decisions in the journal to see a rolling-accuracy trend.
        </div>
      )}

      {/* Per-domain accuracy */}
      {domainData.length > 0 && (
        <div className="panel p-4">
          <h3 className="font-semibold mb-3 flex items-center gap-2">
            <Target className="w-4 h-4 text-neon-cyan" /> Accuracy by Domain
          </h3>
          <ChartKit
            kind="bar"
            data={domainData}
            xKey="domain"
            series={[{ key: 'accuracy', label: 'Accuracy %', color: '#06b6d4' }]}
            height={200}
          />
          <div className="mt-3 space-y-1">
            {acc?.domains.map((d) => (
              <div key={d.domain} className="flex items-center justify-between text-xs">
                <span className="text-gray-300 capitalize">{d.domain}</span>
                <span className="text-gray-400">
                  {d.n} resolved · {(d.accuracy * 100).toFixed(0)}% · Brier {d.brierScore.toFixed(3)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
