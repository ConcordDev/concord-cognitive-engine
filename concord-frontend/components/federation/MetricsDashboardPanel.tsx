'use client';

// Federation activity metrics dashboard — in/out volume over time.
// Macros: federation.recordMetric, metricsDashboard.

import { useState, useCallback, useEffect } from 'react';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz';
import { BarChart3, Loader2, Plus } from 'lucide-react';

interface MetricSample {
  at: number;
  inbound: number;
  outbound: number;
  label: string;
}

interface MetricsResult {
  series: MetricSample[];
  totalInbound: number;
  totalOutbound: number;
  ratio: number | null;
  peerCounts: { allow: number; block: number; pending: number };
  openModeration: number;
  relayCount: number;
}

const WINDOWS: Array<{ label: string; sinceMs: number }> = [
  { label: '24h', sinceMs: 24 * 3600 * 1000 },
  { label: '7d', sinceMs: 7 * 24 * 3600 * 1000 },
  { label: '30d', sinceMs: 30 * 24 * 3600 * 1000 },
  { label: 'All', sinceMs: 0 },
];

export function MetricsDashboardPanel() {
  const [data, setData] = useState<MetricsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [windowIdx, setWindowIdx] = useState(1);

  const [inbound, setInbound] = useState('');
  const [outbound, setOutbound] = useState('');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async (idx: number) => {
    setLoading(true);
    try {
      const w = WINDOWS[idx];
      const r = await lensRun<MetricsResult>('federation', 'metricsDashboard',
        w.sinceMs > 0 ? { sinceMs: w.sinceMs } : {});
      if (r.data.ok && r.data.result) setData(r.data.result);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(windowIdx); }, [load, windowIdx]);

  const record = useCallback(async () => {
    const inN = Number(inbound) || 0;
    const outN = Number(outbound) || 0;
    if (inN <= 0 && outN <= 0) {
      setErr('enter an inbound or outbound count');
      return;
    }
    setBusy(true); setErr(null);
    try {
      const r = await lensRun('federation', 'recordMetric', {
        inbound: inN, outbound: outN, label: label.trim() || undefined,
      });
      if (!r.data.ok) { setErr(r.data.error || 'failed'); return; }
      setInbound(''); setOutbound(''); setLabel('');
      await load(windowIdx);
    } finally {
      setBusy(false);
    }
  }, [inbound, outbound, label, load, windowIdx]);

  const chartData = (data?.series ?? []).map((s) => ({
    t: new Date(s.at).toLocaleDateString(),
    inbound: s.inbound,
    outbound: s.outbound,
  }));

  return (
    <section className="rounded-lg border border-amber-500/30 bg-black/60 p-4">
      <h2 className="text-amber-300 font-semibold mb-3 inline-flex items-center gap-1.5">
        <BarChart3 className="w-4 h-4" /> Activity metrics
      </h2>
      <p className="text-xs text-gray-500 mb-3">
        Federation in/out volume over time. Record samples after each sync pass.
      </p>

      {/* Record sample */}
      <div className="flex flex-wrap gap-2 mb-3">
        <input
          value={inbound}
          onChange={(e) => setInbound(e.target.value)}
          placeholder="inbound count"
          inputMode="numeric"
          className="w-32 bg-black/60 border border-white/10 rounded px-3 py-2 text-sm text-gray-200"
        />
        <input
          value={outbound}
          onChange={(e) => setOutbound(e.target.value)}
          placeholder="outbound count"
          inputMode="numeric"
          className="w-32 bg-black/60 border border-white/10 rounded px-3 py-2 text-sm text-gray-200"
        />
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="label (optional)"
          className="flex-1 min-w-[140px] bg-black/60 border border-white/10 rounded px-3 py-2 text-sm text-gray-200"
        />
        <button
          type="button"
          onClick={record}
          disabled={busy}
          className="px-3 py-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-40 rounded text-white text-sm inline-flex items-center gap-1"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          Record
        </button>
      </div>
      {err && <div className="text-rose-300 text-xs mb-2">{err}</div>}

      {/* Window selector */}
      <div className="flex gap-2 mb-3 text-xs">
        {WINDOWS.map((w, i) => (
          <button
            key={w.label}
            type="button"
            onClick={() => setWindowIdx(i)}
            className={`px-2 py-1 rounded border ${
              windowIdx === i
                ? 'bg-amber-500/20 border-amber-500/40 text-amber-300'
                : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10'
            }`}
          >
            {w.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-xs text-gray-500 italic">Loading metrics…</p>
      ) : data ? (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3 text-xs">
            <Stat label="Inbound" value={String(data.totalInbound)} tone="good" />
            <Stat label="Outbound" value={String(data.totalOutbound)} tone="warn" />
            <Stat label="In/Out ratio" value={data.ratio == null ? '—' : data.ratio.toFixed(2)} />
            <Stat label="Open reports" value={String(data.openModeration)} tone={data.openModeration > 0 ? 'warn' : undefined} />
            <Stat label="Allowed peers" value={String(data.peerCounts.allow)} tone="good" />
            <Stat label="Blocked peers" value={String(data.peerCounts.block)} tone="warn" />
            <Stat label="Pending peers" value={String(data.peerCounts.pending)} />
            <Stat label="Relays" value={String(data.relayCount)} />
          </div>
          {chartData.length > 0 ? (
            <ChartKit
              kind="bar"
              data={chartData}
              xKey="t"
              series={[
                { key: 'inbound', label: 'Inbound', color: '#22c55e' },
                { key: 'outbound', label: 'Outbound', color: '#f59e0b' },
              ]}
              height={220}
            />
          ) : (
            <p className="text-xs text-gray-500 italic">
              No metric samples in this window. Record one above.
            </p>
          )}
        </>
      ) : null}
    </section>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'warn' }) {
  const color = tone === 'good' ? 'text-emerald-300' : tone === 'warn' ? 'text-amber-300' : 'text-white';
  return (
    <div className="bg-white/5 border border-white/10 rounded px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-white/50">{label}</div>
      <div className={`text-sm font-bold ${color}`}>{value}</div>
    </div>
  );
}
