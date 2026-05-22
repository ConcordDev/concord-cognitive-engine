'use client';

// Metrics — counts, activity-over-time, focus distribution, top contributors.
// Backed by GET /api/emergents/metrics/summary.

import { useEffect, useState } from 'react';
import { Loader2, BarChart3 } from 'lucide-react';
import { ChartKit } from '@/components/viz';

interface MetricsResponse {
  ok: boolean;
  error?: string;
  windowDays?: number;
  summary?: {
    totalEmergents: number;
    activeEmergents: number;
    dormantEmergents: number;
    totalCommunications: number;
    totalObservations: number;
    feedEventsInWindow: number;
  };
  focusDistribution?: { focus: string; count: number }[];
  activityOverTime?: { date: string; count: number }[];
  eventTypeTotals?: Record<string, number>;
  topContributors?: { emergent_id: string; given_name: string; events: number }[];
}

const WINDOWS = [7, 14, 30, 90];

export function GenesisMetrics({ onSelect }: { onSelect?: (id: string) => void }) {
  const [days, setDays] = useState(14);
  const [data, setData] = useState<MetricsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch(`/api/emergents/metrics/summary?days=${days}`)
      .then((r) => r.json())
      .then((d: MetricsResponse) => { if (alive) { setData(d); setLoading(false); } })
      .catch(() => { if (alive) { setData({ ok: false, error: 'unreachable' }); setLoading(false); } });
    return () => { alive = false; };
  }, [days]);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-cyan-400" />
          <h3 className="text-sm font-semibold text-white">Observatory metrics</h3>
        </div>
        <div className="flex gap-1">
          {WINDOWS.map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => setDays(w)}
              className={`rounded px-2 py-0.5 text-[11px] transition-colors ${
                days === w
                  ? 'bg-cyan-500/20 text-cyan-200 border border-cyan-500/40'
                  : 'border border-zinc-800 bg-zinc-950 text-zinc-400 hover:border-zinc-700'
              }`}
            >
              {w}d
            </button>
          ))}
        </div>
      </header>

      {loading && (
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Computing metrics…
        </div>
      )}

      {!loading && !data?.ok && (
        <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">
          Could not load metrics ({data?.error || 'unknown error'}).
        </div>
      )}

      {!loading && data?.ok && data.summary && (
        <>
          <div className="grid grid-cols-3 gap-2 text-center sm:grid-cols-6">
            {([
              ['Emergents', data.summary.totalEmergents],
              ['Active', data.summary.activeEmergents],
              ['Dormant', data.summary.dormantEmergents],
              ['Comms', data.summary.totalCommunications],
              ['Observations', data.summary.totalObservations],
              ['Events / window', data.summary.feedEventsInWindow],
            ] as const).map(([label, n]) => (
              <div key={label} className="rounded-lg border border-zinc-800 bg-zinc-950/40 py-2">
                <p className="text-lg font-bold text-white">{n}</p>
                <p className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</p>
              </div>
            ))}
          </div>

          <div>
            <p className="mb-1.5 text-[11px] uppercase tracking-wider text-zinc-500">
              Activity over time ({data.windowDays}d)
            </p>
            <ChartKit
              kind="area"
              data={data.activityOverTime || []}
              xKey="date"
              series={[{ key: 'count', label: 'Feed events', color: '#22d3ee' }]}
              height={180}
              showLegend={false}
            />
          </div>

          {(data.focusDistribution?.length ?? 0) > 0 && (
            <div>
              <p className="mb-1.5 text-[11px] uppercase tracking-wider text-zinc-500">
                Focus distribution
              </p>
              <ChartKit
                kind="bar"
                data={data.focusDistribution || []}
                xKey="focus"
                series={[{ key: 'count', label: 'Emergents', color: '#a855f7' }]}
                height={180}
                showLegend={false}
              />
            </div>
          )}

          {(data.topContributors?.length ?? 0) > 0 && (
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
              <p className="mb-1.5 text-[11px] uppercase tracking-wider text-zinc-500">
                Top contributors
              </p>
              <ol className="space-y-1">
                {(data.topContributors || []).map((c, i) => (
                  <li key={c.emergent_id} className="flex items-center gap-2 text-[12px]">
                    <span className="w-5 font-mono text-zinc-600">#{i + 1}</span>
                    <button
                      type="button"
                      onClick={() => onSelect?.(c.emergent_id)}
                      className="flex-1 truncate text-left text-zinc-200 hover:text-cyan-300"
                    >
                      {c.given_name}
                    </button>
                    <span className="font-mono text-zinc-500">{c.events}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </>
      )}
    </div>
  );
}
