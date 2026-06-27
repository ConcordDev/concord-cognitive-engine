'use client';

import { useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';

export interface Position {
  id: string;
  poolId: string;
  poolName: string;
  principalCc: number;
  stakeMonths: number;
  lockedAt: number;
  unlocksAt: number;
  yieldRateBps: number;
  accruedYieldCc: number;
  autoCompound: boolean;
  status: string;
  receiptTokenId: string | null;
  compoundCount: number;
  unlocked: boolean;
}

interface PositionList {
  positions: Position[];
  count: number;
  totalPrincipalCc: number;
  totalAccruedYieldCc: number;
}

const STATUS_TONE: Record<string, string> = {
  active: 'bg-emerald-900/50 text-emerald-300',
  redeemed: 'bg-zinc-800 text-zinc-400',
  early_exited: 'bg-rose-900/50 text-rose-300',
};

/**
 * StakePositions — user's positions with live accrued yield. Wires
 * staking.list_positions, redeem_stake, early_unstake, set_auto_compound,
 * compound_now.
 */
export function StakePositions({
  refreshKey,
  onChange,
}: {
  refreshKey: number;
  onChange: () => void;
}) {
  const [data, setData] = useState<PositionList | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await lensRun<PositionList>('staking', 'list_positions', {});
      if (r.data?.ok && r.data.result) {
        setData(r.data.result);
      } else {
        setError(r.data?.error || 'Could not load positions.');
      }
    } catch {
      setError('Could not reach the staking service.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [refreshKey]);

  const act = async (
    macro: 'redeem_stake' | 'early_unstake' | 'compound_now',
    pos: Position,
    label: string,
  ) => {
    setBusy(pos.id);
    setStatus(`${label}…`);
    const r = await lensRun('staking', macro, { stakeId: pos.id });
    if (r.data?.ok) {
      const res = r.data.result as Record<string, unknown> | null;
      if (macro === 'redeem_stake') {
        setStatus(`Redeemed ${res?.totalReturnCc} CC (principal + ${res?.accruedYieldCc} yield).`);
      } else if (macro === 'early_unstake') {
        setStatus(`Early exit — returned ${res?.returnedCc} CC, penalty ${res?.totalPenaltyCc} CC.`);
      } else {
        setStatus(`Compounded ${res?.compoundedYieldCc} CC — re-staked ${res?.newPrincipalCc} CC.`);
      }
      await load();
      onChange();
    } else {
      setStatus(`Failed: ${r.data?.error || 'unknown'}`);
    }
    setBusy(null);
    window.setTimeout(() => setStatus(null), 5000);
  };

  const toggleAutoCompound = async (pos: Position) => {
    setBusy(pos.id);
    const r = await lensRun('staking', 'set_auto_compound', {
      stakeId: pos.id,
      enabled: !pos.autoCompound,
    });
    if (r.data?.ok) {
      setStatus(`Auto-compound ${!pos.autoCompound ? 'enabled' : 'disabled'}.`);
      await load();
      onChange();
    } else {
      setStatus(`Failed: ${r.data?.error || 'unknown'}`);
    }
    setBusy(null);
    window.setTimeout(() => setStatus(null), 4000);
  };

  if (loading && !data) {
    return (
      <div role="status" aria-live="polite" className="text-xs text-zinc-400 py-3">
        Loading positions…
      </div>
    );
  }

  if (error && !data) {
    return (
      <div
        role="alert"
        className="flex flex-wrap items-center gap-3 rounded-lg border border-rose-800/60 bg-rose-950/40 px-3 py-3 text-xs text-rose-200"
      >
        <span>Could not load your positions: {error}</span>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded bg-rose-800 px-2.5 py-1 text-white hover:bg-rose-700 focus:outline-none focus:ring-2 focus:ring-rose-500"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!data) {
    return (
      <div role="status" aria-live="polite" className="text-xs text-zinc-400 py-3">
        Loading positions…
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {status && (
        <div className="rounded-lg border border-amber-700/50 bg-amber-950/40 px-3 py-2 text-xs text-amber-200">
          {status}
        </div>
      )}
      <div className="grid grid-cols-3 gap-2">
        <SummaryStat label="Positions" value={String(data.count)} />
        <SummaryStat label="Staked" value={`${data.totalPrincipalCc} CC`} />
        <SummaryStat label="Accruing" value={`${data.totalAccruedYieldCc} CC`} tone="text-emerald-300" />
      </div>
      {data.positions.length === 0 ? (
        <div
          role="status"
          className="rounded-lg border border-zinc-800 px-3 py-6 text-center text-xs italic text-zinc-400"
        >
          No positions yet. Open a stake above.
        </div>
      ) : (
        <ul className="space-y-2" aria-label="Your staking positions">
          {data.positions.map((p) => (
            <li
              key={p.id}
              className="rounded-lg border border-zinc-700/50 bg-zinc-900/80 p-3 text-sm"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium text-zinc-100">
                    {p.poolName} · {p.principalCc} CC · {p.stakeMonths}mo
                    {p.compoundCount > 0 && (
                      <span className="ml-2 text-[10px] text-cyan-400">
                        ×{p.compoundCount} compounded
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 font-mono text-[10px] text-zinc-400">
                    {(p.yieldRateBps / 100).toFixed(2)}% APR · accrued {p.accruedYieldCc} CC ·{' '}
                    {p.unlocked
                      ? 'UNLOCKED'
                      : `unlocks ${new Date(p.unlocksAt * 1000).toLocaleDateString()}`}
                  </p>
                </div>
                <span
                  className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${
                    STATUS_TONE[p.status] || STATUS_TONE.redeemed
                  }`}
                >
                  {p.status.replace('_', ' ')}
                </span>
              </div>
              {p.status === 'active' && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {p.unlocked ? (
                    <>
                      <button
                        type="button"
                        disabled={busy === p.id}
                        onClick={() => act('redeem_stake', p, 'Redeeming')}
                        className="rounded bg-amber-700 px-2.5 py-1 text-xs text-white hover:bg-amber-600 disabled:opacity-50"
                      >
                        Redeem
                      </button>
                      <button
                        type="button"
                        disabled={busy === p.id}
                        onClick={() => act('compound_now', p, 'Compounding')}
                        className="rounded bg-emerald-700 px-2.5 py-1 text-xs text-white hover:bg-emerald-600 disabled:opacity-50"
                      >
                        Compound &amp; re-stake
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      disabled={busy === p.id}
                      onClick={() => act('early_unstake', p, 'Exiting')}
                      className="rounded bg-rose-800 px-2.5 py-1 text-xs text-white hover:bg-rose-700 disabled:opacity-50"
                    >
                      Early exit (penalty)
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busy === p.id}
                    onClick={() => toggleAutoCompound(p)}
                    className={`rounded px-2.5 py-1 text-xs text-white disabled:opacity-50 ${
                      p.autoCompound
                        ? 'bg-cyan-700 hover:bg-cyan-600'
                        : 'bg-zinc-700 hover:bg-zinc-600'
                    }`}
                  >
                    Auto-compound: {p.autoCompound ? 'ON' : 'OFF'}
                  </button>
                  {p.receiptTokenId && (
                    <span className="rounded bg-cyan-950/60 px-2 py-1 text-[10px] text-cyan-300">
                      liquid receipt minted
                    </span>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SummaryStat({
  label,
  value,
  tone = 'text-zinc-200',
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5">
      <div className="text-[10px] uppercase tracking-wider text-zinc-400">{label}</div>
      <div className={`mt-0.5 font-mono text-sm ${tone}`}>{value}</div>
    </div>
  );
}
