'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz';
import { BarChart3, Loader2, TrendingUp } from 'lucide-react';

interface RetentionPoint { interval: string; reviews: number; retention: number; }
interface MasteryRow {
  topic: string;
  cards: number;
  mastered: number;
  masteryRate: number;
  avgDaysToMastery: number | null;
  avgEase: number;
}
interface Analytics {
  totalReviews: number;
  overallRetention: number;
  retentionCurve: RetentionPoint[];
  timeToMastery: MasteryRow[];
  studySessions: number;
  cardsTracked: number;
}

export function ProgressAnalyticsPanel() {
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const { data: r } = await lensRun<any>('metalearning', 'progressAnalytics', {});
      if (r?.ok === false) { setErr(r.error || 'Failed to load analytics'); return; }
      setData(r?.result || r);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load analytics');
    } finally { setLoading(false); }
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold flex items-center gap-2 text-sm">
          <BarChart3 className="w-4 h-4 text-neon-green" /> Progress Analytics
        </h3>
        <button onClick={refresh} disabled={loading}
          className="text-xs text-gray-400 hover:text-white disabled:opacity-50">
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Refresh'}
        </button>
      </div>

      {err && <p className="text-xs text-red-400">{err}</p>}

      {data && (
        <>
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-lattice-deep rounded-lg p-3 border border-white/5">
              <p className="text-xl font-bold text-neon-green">
                {(data.overallRetention * 100).toFixed(0)}%
              </p>
              <p className="text-[10px] text-gray-500">Overall retention</p>
            </div>
            <div className="bg-lattice-deep rounded-lg p-3 border border-white/5">
              <p className="text-xl font-bold text-neon-cyan">{data.totalReviews}</p>
              <p className="text-[10px] text-gray-500">Total reviews</p>
            </div>
            <div className="bg-lattice-deep rounded-lg p-3 border border-white/5">
              <p className="text-xl font-bold text-neon-purple">{data.studySessions}</p>
              <p className="text-[10px] text-gray-500">Study sessions</p>
            </div>
          </div>

          {data.retentionCurve.length > 0 ? (
            <div>
              <p className="text-xs text-gray-400 mb-1 flex items-center gap-1">
                <TrendingUp className="w-3 h-3" /> Retention curve by review interval
              </p>
              <ChartKit
                kind="area"
                data={data.retentionCurve.map((p) => ({
                  interval: p.interval,
                  retention: Math.round(p.retention * 100),
                }))}
                xKey="interval"
                series={[{ key: 'retention', label: 'Retention %', color: '#22c55e' }]}
                height={180}
              />
            </div>
          ) : (
            <p className="text-xs text-gray-500 text-center py-3">
              Review cards to build a retention curve.
            </p>
          )}

          {data.timeToMastery.length > 0 && (
            <div>
              <p className="text-xs text-gray-400 mb-1">Time-to-mastery per topic</p>
              <div className="space-y-1">
                {data.timeToMastery.map((m) => (
                  <div key={m.topic} className="bg-lattice-surface rounded p-2 border border-white/5">
                    <div className="flex justify-between text-xs">
                      <span className="font-medium text-gray-200">{m.topic}</span>
                      <span className="text-gray-500">
                        {m.mastered}/{m.cards} mastered
                        {m.avgDaysToMastery != null && ` · ${m.avgDaysToMastery}d avg`}
                      </span>
                    </div>
                    <div className="h-1.5 bg-lattice-void rounded-full overflow-hidden mt-1">
                      <div className="h-full bg-neon-cyan rounded-full"
                        style={{ width: `${m.masteryRate * 100}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
