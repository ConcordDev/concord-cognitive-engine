'use client';

/**
 * TriagePanel — severity/priority ranking of active crises in a world.
 * Calls crisis.triage and renders an impact/urgency-ranked board plus a
 * summary distribution chart from the shared viz kit.
 */

import { useEffect, useState, useCallback } from 'react';
import { ListOrdered, Loader2, RefreshCw } from 'lucide-react';
import { ChartKit } from '@/components/viz';
import { lensRun } from '@/lib/api/client';

interface RankedCrisis {
  id: string;
  type: string;
  description: string;
  started_at: number;
  triage: {
    score: number;
    priority: 'critical' | 'high' | 'moderate' | 'low';
    impact: number;
    urgency: number;
    ageHours: number;
  };
}
interface TriageResult {
  ranked: RankedCrisis[];
  summary: Record<string, number>;
  total: number;
}

const PRIORITY_TONE: Record<string, string> = {
  critical: 'border-rose-500/50 bg-rose-900/25 text-rose-200',
  high: 'border-orange-500/40 bg-orange-900/20 text-orange-200',
  moderate: 'border-amber-500/30 bg-amber-900/15 text-amber-200',
  low: 'border-zinc-600/30 bg-zinc-800/30 text-zinc-300',
};

export function TriagePanel({
  worldId,
  onSelect,
}: {
  worldId: string;
  onSelect?: (c: RankedCrisis) => void;
}) {
  const [data, setData] = useState<TriageResult | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await lensRun<TriageResult>('crisis', 'triage', { worldId });
    if (r.data?.ok && r.data.result) setData(r.data.result);
    else setData({ ranked: [], summary: {}, total: 0 });
    setLoading(false);
  }, [worldId]);

  useEffect(() => { load(); }, [load]);

  const chartData = data
    ? [
        { tier: 'Critical', count: data.summary.critical || 0 },
        { tier: 'High', count: data.summary.high || 0 },
        { tier: 'Moderate', count: data.summary.moderate || 0 },
        { tier: 'Low', count: data.summary.low || 0 },
      ]
    : [];

  return (
    <div className="space-y-3">
      <header className="flex items-center justify-between border-b border-rose-500/15 pb-2">
        <div className="flex items-center gap-2">
          <ListOrdered className="h-5 w-5 text-rose-300" />
          <h2 className="text-sm font-semibold text-white">Triage board</h2>
          {data && (
            <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
              {data.total} ranked
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={load}
          className="flex items-center gap-1 rounded border border-white/10 px-2 py-1 text-xs text-gray-300 hover:bg-white/5"
        >
          <RefreshCw className="h-3 w-3" /> Refresh
        </button>
      </header>

      {loading && (
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Scoring crises…
        </div>
      )}

      {!loading && data && data.total === 0 && (
        <p className="rounded border border-white/10 bg-white/5 p-4 text-center text-xs text-zinc-500">
          No active crises to triage.
        </p>
      )}

      {!loading && data && data.total > 0 && (
        <>
          <div className="rounded-lg border border-white/10 bg-black/20 p-2">
            <ChartKit
              kind="bar"
              data={chartData}
              xKey="tier"
              series={[{ key: 'count', label: 'Crises', color: '#ef4444' }]}
              height={120}
              showLegend={false}
            />
          </div>
          <ol className="space-y-2">
            {data.ranked.map((c, i) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => onSelect?.(c)}
                  className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left transition hover:brightness-125 ${PRIORITY_TONE[c.triage.priority]}`}
                >
                  <span className="font-mono text-lg font-bold opacity-60">#{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold">{c.type}</span>
                      <span className="rounded bg-black/30 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider">
                        {c.triage.priority}
                      </span>
                    </div>
                    <p className="truncate text-[11px] opacity-75">{c.description}</p>
                    <div className="mt-1 flex gap-3 text-[10px] opacity-60">
                      <span>impact {c.triage.impact}</span>
                      <span>urgency {c.triage.urgency}</span>
                      <span>{c.triage.ageHours}h old</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-bold tabular-nums">{c.triage.score}</div>
                    <div className="text-[9px] uppercase tracking-wider opacity-60">priority</div>
                  </div>
                </button>
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}
