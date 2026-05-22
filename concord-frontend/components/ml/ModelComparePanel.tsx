'use client';

/**
 * ModelComparePanel — leaderboard / side-by-side model comparison.
 * Add candidate models with metrics, or fall back to comparing the
 * user's completed experiments. Wires ml.model-compare.
 */

import { useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz';
import { Trophy, Plus, Trash2, Loader2, BarChart3, Beaker } from 'lucide-react';

interface Candidate {
  name: string; accuracy: string; f1: string; precision: string; recall: string;
  auc: string; latencyMs: string; paramsM: string;
}
interface LeaderRow {
  rank: number; name: string; score?: number; accuracy?: number; f1?: number;
  precision?: number; recall?: number; auc?: number; latencyMs?: number | null;
  paramsM?: number | null; valLoss?: number; epochs?: number; source?: string;
}

const blank: Candidate = {
  name: '', accuracy: '', f1: '', precision: '', recall: '', auc: '', latencyMs: '', paramsM: '',
};

export function ModelComparePanel() {
  const [rows, setRows] = useState<Candidate[]>([{ ...blank }, { ...blank }]);
  const [leaderboard, setLeaderboard] = useState<LeaderRow[]>([]);
  const [winner, setWinner] = useState<string | null>(null);
  const [usedExperiments, setUsedExperiments] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = (i: number, field: keyof Candidate, value: string) => {
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, [field]: value } : row)));
  };

  const compare = async () => {
    setBusy(true); setError(null);
    const models = rows
      .filter((r) => r.name.trim())
      .map((r) => {
        const m: Record<string, unknown> = { name: r.name.trim() };
        (['accuracy', 'f1', 'precision', 'recall', 'auc', 'latencyMs', 'paramsM'] as const).forEach((k) => {
          if (r[k] !== '') m[k] = Number(r[k]);
        });
        return m;
      });
    const r = await lensRun('ml', 'model-compare', { models });
    if (r.data?.ok && r.data.result) {
      const res = r.data.result as { leaderboard: LeaderRow[]; winner: string };
      setLeaderboard(res.leaderboard || []);
      setWinner(res.winner || null);
      setUsedExperiments((res.leaderboard || []).some((x) => x.source === 'experiment'));
    } else {
      setError(r.data?.error || 'Comparison failed');
      setLeaderboard([]);
    }
    setBusy(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold flex items-center gap-2">
          <Trophy className="w-4 h-4 text-yellow-400" /> Model Comparison
        </h3>
        <button onClick={() => setRows((r) => [...r, { ...blank }])}
          className="btn-neon small" disabled={rows.length >= 8}>
          <Plus className="w-3 h-3 mr-1 inline" /> Candidate
        </button>
      </div>
      <p className="text-xs text-gray-500">
        Enter metrics for 2+ models, or leave blank to compare your completed experiments.
      </p>

      <div className="space-y-2">
        {rows.map((row, i) => (
          <div key={i} className="panel p-3 grid grid-cols-2 md:grid-cols-9 gap-2 items-center">
            <input value={row.name} onChange={(e) => update(i, 'name', e.target.value)}
              placeholder={`Model ${i + 1}`}
              className="col-span-2 px-2 py-1.5 bg-lattice-surface border border-lattice-border rounded text-xs outline-none focus:border-neon-purple" />
            {(['accuracy', 'f1', 'precision', 'recall', 'auc', 'latencyMs', 'paramsM'] as const).map((k) => (
              <input key={k} value={row[k]} onChange={(e) => update(i, k, e.target.value)}
                type="number" step="0.01" placeholder={k === 'latencyMs' ? 'ms' : k === 'paramsM' ? 'params(M)' : k}
                className="px-2 py-1.5 bg-lattice-surface border border-lattice-border rounded text-xs font-mono outline-none focus:border-neon-purple" />
            ))}
            {rows.length > 2 && (
              <button onClick={() => setRows((r) => r.filter((_, idx) => idx !== i))}
                className="text-red-400 hover:text-red-300 justify-self-end" aria-label="Remove">
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        ))}
      </div>

      <button onClick={compare} disabled={busy} className="btn-neon purple disabled:opacity-50">
        {busy ? <Loader2 className="w-4 h-4 mr-2 inline animate-spin" /> : <BarChart3 className="w-4 h-4 mr-2 inline" />}
        Compare
      </button>
      {error && <p className="text-sm text-red-400">{error}</p>}

      {leaderboard.length > 0 && (
        <div className="panel p-4 space-y-4">
          <div className="flex items-center gap-2">
            <h4 className="font-semibold flex items-center gap-2">
              <Trophy className="w-4 h-4 text-yellow-400" /> Leaderboard
            </h4>
            {usedExperiments && (
              <span className="text-xs text-gray-500 flex items-center gap-1">
                <Beaker className="w-3 h-3" /> from experiments
              </span>
            )}
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500 uppercase tracking-wider border-b border-lattice-border">
                <th className="text-left py-1.5">Rank</th>
                <th className="text-left">Model</th>
                {usedExperiments ? (
                  <>
                    <th className="text-right">Accuracy</th>
                    <th className="text-right">Val Loss</th>
                    <th className="text-right">Epochs</th>
                  </>
                ) : (
                  <>
                    <th className="text-right">Score</th>
                    <th className="text-right">Acc</th>
                    <th className="text-right">F1</th>
                    <th className="text-right">Latency</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {leaderboard.map((r) => (
                <tr key={r.rank} className={`border-b border-lattice-border/50 ${r.name === winner ? 'text-neon-green' : ''}`}>
                  <td className="py-2 font-mono">{r.rank === 1 ? '🏆' : `#${r.rank}`}</td>
                  <td className="font-medium">{r.name}</td>
                  {usedExperiments ? (
                    <>
                      <td className="text-right font-mono">{r.accuracy != null ? `${(r.accuracy * 100).toFixed(1)}%` : '—'}</td>
                      <td className="text-right font-mono">{r.valLoss?.toFixed(4) ?? '—'}</td>
                      <td className="text-right font-mono">{r.epochs ?? '—'}</td>
                    </>
                  ) : (
                    <>
                      <td className="text-right font-mono">{r.score?.toFixed(3) ?? '—'}</td>
                      <td className="text-right font-mono">{r.accuracy ?? '—'}</td>
                      <td className="text-right font-mono">{r.f1 ?? '—'}</td>
                      <td className="text-right font-mono">{r.latencyMs != null ? `${r.latencyMs}ms` : '—'}</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          <ChartKit
            kind="bar"
            data={leaderboard.map((r) => ({
              name: r.name,
              metric: usedExperiments ? (r.accuracy || 0) : (r.score || 0),
            }))}
            xKey="name"
            series={[{ key: 'metric', label: usedExperiments ? 'Accuracy' : 'Score', color: '#f59e0b' }]}
            height={200}
          />
        </div>
      )}
    </div>
  );
}
