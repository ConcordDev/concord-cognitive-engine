'use client';

/**
 * ConfrontHistory — the calling hunter's confront outcome ledger
 * (wins/losses, rewards) plus lifetime summary. Mounts ghost-hunt.history
 * and visualises the win/loss split with ChartKit.
 */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz';

interface OutcomeReward { xp: number; essence: number; title: string | null }

interface Outcome {
  id: string;
  residueId: string;
  drift_type: string;
  severity: string;
  result: string;
  winChance: number;
  reward: OutcomeReward;
  at: number;
}

interface HistorySummary {
  wins: number;
  losses: number;
  winRate: number;
  totalXp: number;
  totalEssence: number;
  lifetime: { wins: number; losses: number; xp: number; essence: number };
}

interface HistoryResult {
  ok: boolean;
  history?: Outcome[];
  summary?: HistorySummary;
}

export function ConfrontHistory({ refreshKey }: { refreshKey: number }) {
  const [history, setHistory] = useState<Outcome[]>([]);
  const [summary, setSummary] = useState<HistorySummary | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await lensRun<HistoryResult>('ghost-hunt', 'history', { limit: 50 });
    setHistory(r.data.result?.history ?? []);
    setSummary(r.data.result?.summary ?? null);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);

  return (
    <div>
      <h3 className="mb-2 text-xs uppercase tracking-wide text-violet-400">Confront history</h3>
      {loading && <p className="text-xs text-gray-400">Loading history…</p>}
      {!loading && summary && (
        <div className="mb-3 grid grid-cols-4 gap-2">
          <Stat label="Wins" value={summary.wins} tone="text-emerald-300" />
          <Stat label="Losses" value={summary.losses} tone="text-rose-300" />
          <Stat label="Win%" value={`${Math.round(summary.winRate * 100)}%`} tone="text-violet-300" />
          <Stat label="XP" value={summary.totalXp} tone="text-amber-300" />
        </div>
      )}
      {!loading && summary && (summary.wins > 0 || summary.losses > 0) && (
        <div className="mb-3">
          <ChartKit
            kind="bar"
            height={120}
            showLegend={false}
            xKey="label"
            data={[
              { label: 'Wins', count: summary.wins },
              { label: 'Losses', count: summary.losses },
            ]}
            series={[{ key: 'count', label: 'Outcomes' }]}
          />
        </div>
      )}
      {!loading && history.length === 0 && (
        <p className="text-xs text-gray-400">No confrontations recorded yet.</p>
      )}
      {!loading && history.length > 0 && (
        <ul className="max-h-64 space-y-1 overflow-y-auto">
          {history.map((o) => (
            <li
              key={o.id}
              className={`flex items-center justify-between rounded border px-2 py-1.5 text-xs ${
                o.result === 'win'
                  ? 'border-emerald-600/25 bg-emerald-900/10'
                  : 'border-rose-600/25 bg-rose-900/10'
              }`}
            >
              <div>
                <span className={o.result === 'win' ? 'text-emerald-300' : 'text-rose-300'}>
                  {o.result === 'win' ? 'Extinguished' : 'Resisted'}
                </span>
                <span className="ml-2 text-gray-400">{o.drift_type} · {o.severity}</span>
              </div>
              <div className="text-right text-gray-400">
                <span className="font-mono text-amber-300">{o.reward?.xp ?? 0} XP</span>
                <span className="ml-2 text-[10px]">{new Date(o.at).toLocaleDateString()}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string | number; tone: string }) {
  return (
    <div className="rounded border border-white/10 bg-white/5 px-2 py-1.5 text-center">
      <div className="text-[10px] uppercase tracking-wide text-gray-400">{label}</div>
      <div className={`mt-0.5 font-mono text-sm ${tone}`}>{value}</div>
    </div>
  );
}
