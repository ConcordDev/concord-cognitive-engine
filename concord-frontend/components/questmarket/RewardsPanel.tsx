/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz';
import {
  Loader2, Gift, TrendingDown, Scale, AlertTriangle, CheckCircle2,
} from 'lucide-react';

interface Quest {
  reward: number;
  difficulty: string;
  status: string;
  createdAt: string;
}
interface DiffBreak {
  count: number;
  totalReward: number;
  completed: number;
  avgReward: number;
  completionRate: number;
}
interface Economics {
  totalQuests: number;
  completedQuests: number;
  totalDistributed: number;
  totalPending: number;
  monthlyBurnRate: number;
  projectedAnnualBurn: number;
  byDifficulty: Record<string, DiffBreak>;
  healthCheck: string;
}
interface Balance {
  difficulty: string;
  suggestedReward: number;
  suggestedXP: number;
  rewardBalance: string;
  completionBalance: string;
  adjustments: string[];
  overallBalance: string;
}

export function RewardsPanel({ refreshKey }: { refreshKey?: number }) {
  const [econ, setEcon] = useState<Economics | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [empty, setEmpty] = useState(false);

  // balance tool inputs
  const [bDiff, setBDiff] = useState('medium');
  const [bReward, setBReward] = useState('100');
  const [bCompletion, setBCompletion] = useState('0.5');
  const [balance, setBalance] = useState<Balance | null>(null);
  const [balancing, setBalancing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    // Pull every quest from the real lifecycle store, then feed
    // rewardEconomics with that real data — no mock input.
    const ql = await lensRun<any>('questmarket', 'listQuests', {});
    if (!ql.data?.ok || !ql.data.result) {
      setErr(ql.data?.error || 'failed to load quests');
      setLoading(false);
      return;
    }
    const rawQuests: Quest[] = (ql.data.result.quests || []).map((q: any) => ({
      reward: q.reward,
      difficulty: q.difficulty,
      // rewardEconomics keys on status 'completed'; lifecycle uses 'resolved'.
      status: q.status === 'resolved' ? 'completed' : q.status,
      createdAt: q.createdAt,
      completedAt: q.status === 'resolved' ? q.createdAt : undefined,
    }));
    if (rawQuests.length === 0) {
      setEmpty(true);
      setEcon(null);
      setErr(null);
      setLoading(false);
      return;
    }
    setEmpty(false);
    const r = await lensRun<any>('questmarket', 'rewardEconomics', { quests: rawQuests });
    if (r.data?.ok && r.data.result) {
      if (r.data.result.message) { setEmpty(true); setEcon(null); }
      else setEcon(r.data.result);
      setErr(null);
    } else {
      setErr(r.data?.error || 'failed to analyze economics');
    }
    setLoading(false);
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [refreshKey]);

  const runBalance = async () => {
    setBalancing(true);
    const r = await lensRun<any>('questmarket', 'balanceDifficulty', {
      difficulty: bDiff,
      reward: Number(bReward) || 0,
      completionRate: Number(bCompletion) || 0,
    });
    setBalancing(false);
    if (r.data?.ok && r.data.result) setBalance(r.data.result);
  };

  const diffEntries = econ ? Object.entries(econ.byDifficulty) : [];
  const chartData = diffEntries.map(([d, v]) => ({
    name: d,
    avgReward: v.avgReward,
    total: v.totalReward,
  }));

  return (
    <div className="space-y-5">
      {/* Reward economics from real quest data */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Gift className="h-4 w-4 text-amber-400" />
          <h3 className="text-sm font-semibold text-white">Reward Economics</h3>
        </div>

        {err && (
          <div className="rounded border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-300">
            {err}
          </div>
        )}

        {loading ? (
          <div className="flex items-center gap-2 py-6 text-xs text-zinc-400">
            <Loader2 className="h-4 w-4 animate-spin" /> Analyzing…
          </div>
        ) : empty || !econ ? (
          <div className="rounded border border-dashed border-zinc-800 py-8 text-center text-xs text-zinc-400">
            No quest data to analyze yet. Post quests to populate the reward economy.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Metric label="Distributed" value={`${econ.totalDistributed} CC`} accent="text-emerald-300" />
              <Metric label="Pending" value={`${econ.totalPending} CC`} accent="text-sky-300" />
              <Metric label="30d Burn" value={`${econ.monthlyBurnRate} CC`} accent="text-amber-300" />
              <Metric label="Annual Proj." value={`${econ.projectedAnnualBurn} CC`} accent="text-fuchsia-300" />
            </div>

            {chartData.length > 0 && (
              <div>
                <p className="mb-1 text-[10px] uppercase tracking-wider text-zinc-400">
                  Average reward by difficulty
                </p>
                <ChartKit
                  kind="bar"
                  data={chartData}
                  xKey="name"
                  series={[
                    { key: 'avgReward', label: 'Avg reward', color: '#fbbf24' },
                    { key: 'total', label: 'Total pool', color: '#22c55e' },
                  ]}
                  height={170}
                />
              </div>
            )}

            <div className="space-y-1">
              {diffEntries.map(([d, v]) => (
                <div key={d}
                  className="flex items-center justify-between rounded border border-zinc-800 bg-zinc-950/60 px-2.5 py-1.5 text-[11px]">
                  <span className="capitalize text-white">{d}</span>
                  <span className="flex items-center gap-3 text-zinc-400">
                    <span>{v.count} quests</span>
                    <span className="text-amber-300">{v.avgReward} CC avg</span>
                    <span>{v.completionRate}% done</span>
                  </span>
                </div>
              ))}
            </div>

            <div className={`flex items-center gap-2 rounded px-3 py-2 text-xs ${
              econ.healthCheck.startsWith('High')
                ? 'border border-amber-500/30 bg-amber-500/5 text-amber-300'
                : 'border border-emerald-500/30 bg-emerald-500/5 text-emerald-300'}`}>
              {econ.healthCheck.startsWith('High')
                ? <AlertTriangle className="h-3.5 w-3.5" />
                : <CheckCircle2 className="h-3.5 w-3.5" />}
              {econ.healthCheck}
            </div>
          </>
        )}
      </div>

      {/* Difficulty balancing tool */}
      <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
        <div className="flex items-center gap-2">
          <Scale className="h-4 w-4 text-sky-400" />
          <h3 className="text-sm font-semibold text-white">Difficulty Balancer</h3>
        </div>
        <p className="text-[11px] text-zinc-400">
          Model a quest before posting — checks reward against the target range
          and suggests adjustments.
        </p>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="text-[10px] text-zinc-400">Difficulty</label>
            <select value={bDiff} onChange={(e) => setBDiff(e.target.value)}
              className="w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white">
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
              <option value="legendary">Legendary</option>
            </select>
          </div>
          <div>
            <label className="text-[10px] text-zinc-400">Reward (CC)</label>
            <input type="number" value={bReward} onChange={(e) => setBReward(e.target.value)}
              className="w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white" />
          </div>
          <div>
            <label className="text-[10px] text-zinc-400">Completion rate</label>
            <input type="number" step="0.05" min="0" max="1"
              value={bCompletion} onChange={(e) => setBCompletion(e.target.value)}
              className="w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white" />
          </div>
        </div>
        <button onClick={runBalance} disabled={balancing}
          className="rounded bg-sky-500/20 px-3 py-1.5 text-xs font-semibold text-sky-200 hover:bg-sky-500/30 disabled:opacity-50">
          {balancing ? 'Analyzing…' : 'Analyze Balance'}
        </button>

        {balance && (
          <div className="space-y-2 rounded border border-zinc-800 bg-zinc-900/60 p-2.5">
            <div className="flex flex-wrap gap-2 text-[11px]">
              <span className={`rounded px-2 py-0.5 ${
                balance.rewardBalance === 'balanced'
                  ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'}`}>
                reward: {balance.rewardBalance}
              </span>
              <span className={`rounded px-2 py-0.5 ${
                balance.completionBalance === 'balanced'
                  ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'}`}>
                completion: {balance.completionBalance}
              </span>
              <span className="rounded bg-zinc-800 px-2 py-0.5 text-zinc-300">
                suggested: {balance.suggestedReward} CC / {balance.suggestedXP} XP
              </span>
            </div>
            {balance.adjustments.length > 0 ? (
              <ul className="space-y-1">
                {balance.adjustments.map((a, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-[11px] text-amber-300">
                    <TrendingDown className="mt-0.5 h-3 w-3 shrink-0" />{a}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="flex items-center gap-1.5 text-[11px] text-emerald-300">
                <CheckCircle2 className="h-3 w-3" />{balance.overallBalance}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Metric({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-950/60 p-2.5">
      <p className="text-[9px] uppercase tracking-wider text-zinc-400">{label}</p>
      <p className={`text-sm font-bold ${accent}`}>{value}</p>
    </div>
  );
}
