'use client';

/**
 * StandingsPanel — round-robin / Swiss standings table + prize payout
 * breakdown. Wires tournaments.payouts (re-split + recompute).
 */

import { useState } from 'react';
import { Medal, Coins } from 'lucide-react';
import { ChartKit } from '@/components/viz';
import type { Tournament } from './types';

export function StandingsPanel({
  t,
  busy,
  onRepayout,
}: {
  t: Tournament;
  busy: boolean;
  onRepayout: (split: number[]) => void;
}) {
  const showStandings = t.format === 'round_robin' || t.format === 'swiss';
  const [splitText, setSplitText] = useState(t.payoutSplit.join(', '));

  const applySplit = () => {
    const split = splitText.split(',').map((x) => Number(x.trim())).filter((n) => Number.isFinite(n) && n >= 0);
    if (split.length) onRepayout(split);
  };

  return (
    <div className="space-y-4">
      {showStandings && t.standings.length > 0 && (
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <h3 className="mb-3 flex items-center gap-2 font-semibold text-slate-200">
            <Medal className="h-4 w-4" /> Standings
          </h3>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-slate-400">
                <th className="pb-1">#</th>
                <th className="pb-1">Entrant</th>
                <th className="pb-1 text-center">W</th>
                <th className="pb-1 text-center">L</th>
                <th className="pb-1 text-center">+/-</th>
              </tr>
            </thead>
            <tbody>
              {t.standings.map((s) => (
                <tr key={s.entrantId} className="border-t border-slate-800">
                  <td className="py-1 font-mono text-slate-400">{s.rank}</td>
                  <td className="py-1 font-medium text-slate-100">{s.name}</td>
                  <td className="py-1 text-center text-emerald-300">{s.wins}</td>
                  <td className="py-1 text-center text-rose-300">{s.losses}</td>
                  <td className={`py-1 text-center ${s.diff >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                    {s.diff > 0 ? '+' : ''}{s.diff}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {t.standings.length > 1 && (
            <div className="mt-3">
              <ChartKit
                kind="bar"
                height={160}
                data={t.standings.map((s) => ({ name: s.name, wins: s.wins, losses: s.losses }))}
                xKey="name"
                series={[
                  { key: 'wins', label: 'Wins', color: '#22c55e' },
                  { key: 'losses', label: 'Losses', color: '#ef4444' },
                ]}
              />
            </div>
          )}
        </div>
      )}

      <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
        <h3 className="mb-3 flex items-center gap-2 font-semibold text-slate-200">
          <Coins className="h-4 w-4 text-amber-300" /> Prize Distribution
        </h3>
        <div className="mb-3 flex items-baseline gap-2">
          <span className="text-2xl font-bold text-amber-300">{t.prizePoolCc}</span>
          <span className="text-xs text-slate-400">CC prize pool</span>
        </div>

        {t.status === 'completed' ? (
          <>
            {t.payouts.length === 0 ? (
              <p className="text-xs text-slate-400">No payouts computed.</p>
            ) : (
              <ul className="space-y-1">
                {t.payouts.map((p) => (
                  <li key={p.entrantId} className="flex items-center justify-between rounded bg-slate-950/50 px-2 py-1.5 text-xs">
                    <span className="flex items-center gap-2">
                      <span className={`font-mono ${p.rank === 1 ? 'text-amber-300' : 'text-slate-400'}`}>
                        {p.rank === 1 ? 'Champion' : `#${p.rank}`}
                      </span>
                      <span className="font-medium text-slate-100">{p.name}</span>
                    </span>
                    <span className="flex items-center gap-1 font-semibold text-amber-300">
                      <Coins className="h-3.5 w-3.5" /> {p.amountCc}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-3 flex items-end gap-2">
              <label className="flex-1">
                <span className="mb-1 block text-[10px] uppercase tracking-wider text-slate-400">Payout split %</span>
                <input
                  value={splitText}
                  onChange={(e) => setSplitText(e.target.value)}
                  placeholder="60, 25, 15"
                  className="w-full rounded bg-slate-800 px-2 py-1 text-xs"
                />
              </label>
              <button
                onClick={applySplit}
                disabled={busy}
                className="rounded bg-amber-700 px-3 py-1 text-xs font-medium hover:bg-amber-600 disabled:opacity-40"
              >
                Re-split
              </button>
            </div>
          </>
        ) : (
          <p className="text-xs text-slate-400">
            Split <span className="font-mono text-slate-400">{t.payoutSplit.join(' / ')}</span> — payouts compute on completion.
          </p>
        )}
      </div>
    </div>
  );
}
