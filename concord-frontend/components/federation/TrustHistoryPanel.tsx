'use client';

// Peer trust-score history / reputation timeline — federation domain.
// Macros: federation.recordTrustEvent, trustHistory.

import { useState, useCallback } from 'react';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz';
import { TrendingUp, Loader2, Plus } from 'lucide-react';

interface TrustSample {
  at: number;
  score: number;
  delta: number;
  reason: string;
}

interface TrustHistoryResult {
  domain: string;
  series: TrustSample[];
  current: number | null;
  min: number | null;
  max: number | null;
  avg: number | null;
}

export function TrustHistoryPanel() {
  const [domain, setDomain] = useState('');
  const [data, setData] = useState<TrustHistoryResult | null>(null);
  const [loading, setLoading] = useState(false);

  const [score, setScore] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async (d: string) => {
    if (!d.trim()) return;
    setLoading(true);
    try {
      const r = await lensRun<TrustHistoryResult>('federation', 'trustHistory', { domain: d.trim() });
      if (r.data.ok && r.data.result) setData(r.data.result);
    } finally {
      setLoading(false);
    }
  }, []);

  const record = useCallback(async () => {
    if (!domain.trim()) return;
    const n = Number(score);
    if (!Number.isFinite(n) || n < 0 || n > 1) {
      setErr('score must be 0..1');
      return;
    }
    setBusy(true); setErr(null);
    try {
      const r = await lensRun('federation', 'recordTrustEvent', {
        domain: domain.trim(), score: n, reason: reason.trim(),
      });
      if (!r.data.ok) { setErr(r.data.error || 'failed'); return; }
      setScore(''); setReason('');
      await load(domain);
    } finally {
      setBusy(false);
    }
  }, [domain, score, reason, load]);

  const chartData = (data?.series ?? []).map((s) => ({
    t: new Date(s.at).toLocaleDateString(),
    score: s.score,
  }));

  return (
    <section className="rounded-lg border border-emerald-500/30 bg-black/60 p-4">
      <h2 className="text-emerald-300 font-semibold mb-3 inline-flex items-center gap-1.5">
        <TrendingUp className="w-4 h-4" /> Peer trust history
      </h2>
      <p className="text-xs text-gray-400 mb-3">
        Reputation timeline for a single peer. Record trust events as you
        observe peer behaviour.
      </p>

      <div className="flex flex-wrap gap-2 mb-3">
        <input
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') load(domain); }}
          placeholder="peer domain"
          className="flex-1 min-w-[200px] bg-black/60 border border-white/10 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-emerald-400"
        />
        <button
          type="button"
          onClick={() => load(domain)}
          disabled={loading || !domain.trim()}
          className="px-3 py-2 bg-emerald-700/60 hover:bg-emerald-700 disabled:opacity-40 rounded text-white text-sm inline-flex items-center gap-1"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <TrendingUp className="w-4 h-4" />}
          Load
        </button>
      </div>

      {/* Record event */}
      <div className="flex flex-wrap gap-2 mb-3">
        <input
          value={score}
          onChange={(e) => setScore(e.target.value)}
          placeholder="score 0..1"
          inputMode="decimal"
          className="w-28 bg-black/60 border border-white/10 rounded px-3 py-2 text-sm text-gray-200"
        />
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="reason (optional)"
          className="flex-1 min-w-[160px] bg-black/60 border border-white/10 rounded px-3 py-2 text-sm text-gray-200"
        />
        <button
          type="button"
          onClick={record}
          disabled={busy || !domain.trim() || !score.trim()}
          className="px-3 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 rounded text-white text-sm inline-flex items-center gap-1"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          Record
        </button>
      </div>
      {err && <div className="text-rose-300 text-xs mb-2">{err}</div>}

      {data && (
        <>
          <div className="grid grid-cols-4 gap-2 mb-3 text-xs">
            <Stat label="Current" value={data.current} />
            <Stat label="Min" value={data.min} />
            <Stat label="Max" value={data.max} />
            <Stat label="Avg" value={data.avg} />
          </div>
          {chartData.length > 0 ? (
            <ChartKit
              kind="line"
              data={chartData}
              xKey="t"
              series={[{ key: 'score', label: 'Trust score', color: '#22c55e' }]}
              height={200}
            />
          ) : (
            <p className="text-xs text-gray-400 italic">
              No trust events recorded for {data.domain} yet.
            </p>
          )}
        </>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="bg-white/5 border border-white/10 rounded px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-white/50">{label}</div>
      <div className="text-sm font-bold text-emerald-300">
        {value == null ? '—' : value.toFixed(3)}
      </div>
    </div>
  );
}
