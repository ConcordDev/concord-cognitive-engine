'use client';

/**
 * TrendView — pain metrics over time. Records dated snapshots and charts
 * total impact, open vs resolved pains, and intervention progress with the
 * shared ChartKit / TimelineView viz. Wires snapshot-record and trend-view.
 */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { ChartKit, TimelineView } from '@/components/viz';
import type { TimelineEvent } from '@/components/viz';
import { Loader2, Camera, TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface Snapshot {
  id: string;
  at: string;
  totalPains: number;
  openPains: number;
  resolvedPains: number;
  totalImpact: number;
  avgSeverity: number;
  activeInterventions: number;
  completedInterventions: number;
}
interface TrendResult {
  snapshots: Snapshot[];
  count: number;
  direction: string;
  deltaImpact: number;
  latest: Snapshot | null;
}

export function TrendView({ refreshKey, onChanged }: { refreshKey: number; onChanged: () => void }) {
  const [data, setData] = useState<TrendResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await lensRun<TrendResult>('suffering', 'trend-view', {});
    setLoading(false);
    if (!res.data.ok || !res.data.result) { setErr(res.data.error || 'Failed to load trend'); return; }
    setData(res.data.result);
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);

  const recordSnapshot = useCallback(async () => {
    setBusy(true);
    setErr(null);
    const res = await lensRun('suffering', 'snapshot-record', {});
    setBusy(false);
    if (!res.data.ok) { setErr(res.data.error || 'Snapshot failed'); return; }
    onChanged();
    load();
  }, [load, onChanged]);

  const chartData = (data?.snapshots || []).map((s) => ({
    at: new Date(s.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit' }),
    totalImpact: s.totalImpact,
    openPains: s.openPains,
    resolvedPains: s.resolvedPains,
  }));

  const timelineEvents: TimelineEvent[] = (data?.snapshots || []).map((s) => ({
    id: s.id,
    label: `Impact ${s.totalImpact}`,
    time: s.at,
    tone: s.totalImpact > 5 ? 'bad' : s.totalImpact > 2 ? 'warn' : 'good',
    detail: `${s.openPains} open · ${s.resolvedPains} resolved · ${s.completedInterventions} fixes`,
  }));

  const DirIcon = data?.direction === 'worsening' ? TrendingUp
    : data?.direction === 'improving' ? TrendingDown : Minus;
  const dirTone = data?.direction === 'worsening' ? 'text-rose-400'
    : data?.direction === 'improving' ? 'text-emerald-400' : 'text-gray-400';

  return (
    <div className="panel p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold flex items-center gap-2">
          Trend View
          {(loading || busy) && <Loader2 className="w-4 h-4 animate-spin text-neon-cyan" />}
        </h3>
        <button
          onClick={recordSnapshot}
          disabled={busy}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-neon-purple/20 text-neon-purple rounded-lg text-sm hover:bg-neon-purple/30 disabled:opacity-50"
        >
          <Camera className="w-4 h-4" /> Record Snapshot
        </button>
      </div>

      {err && <p className="text-xs text-red-400 mb-2">{err}</p>}

      {data && data.count > 0 && (
        <div className={`flex items-center gap-2 mb-3 text-sm ${dirTone}`}>
          <DirIcon className="w-4 h-4" />
          <span className="capitalize font-medium">{data.direction}</span>
          <span className="text-gray-400">
            (Δ impact {data.deltaImpact > 0 ? '+' : ''}{data.deltaImpact} across {data.count} snapshots)
          </span>
        </div>
      )}

      {!data || data.count === 0 ? (
        <p className="text-gray-400 text-sm text-center py-6">
          No snapshots yet. Record one to start tracking pain metrics over time.
        </p>
      ) : (
        <div className="space-y-4">
          <ChartKit
            kind="area"
            data={chartData}
            xKey="at"
            series={[
              { key: 'totalImpact', label: 'Total impact', color: '#ec4899' },
              { key: 'openPains', label: 'Open pains', color: '#f59e0b' },
              { key: 'resolvedPains', label: 'Resolved', color: '#22c55e' },
            ]}
            height={220}
          />
          <div>
            <p className="text-xs text-gray-400 mb-1">Snapshot timeline</p>
            <TimelineView events={timelineEvents} height={110} />
          </div>
          {data.latest && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
              <Stat label="Total impact" value={data.latest.totalImpact} />
              <Stat label="Open pains" value={data.latest.openPains} />
              <Stat label="Resolved" value={data.latest.resolvedPains} />
              <Stat label="Avg severity" value={data.latest.avgSeverity} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-white/[0.03] border border-white/10 p-2">
      <p className="text-lg font-bold">{value}</p>
      <p className="text-gray-400">{label}</p>
    </div>
  );
}
