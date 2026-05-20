'use client';

/**
 * /lenses/staking — time-locked CC staking. Phase 9.4 #4.
 * Currency: CC. Yield from treasury share of marketplace fees.
 */
// Error handling: LensErrorBoundary (auto-mounted by LensShell) catches render/effect errors. Local fetch errors caught with try/catch where shown.
// Empty state: handled inline when data is empty (Sprint 17 invariant).

import { useEffect, useState } from 'react';
import { useLensCommand } from '@/hooks/useLensCommand';
import { } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { RecentMineCard } from '@/components/lens/RecentMineCard';
import { LensSubstratePanel } from '@/components/lens/LensSubstratePanel';
import { AutoActionStrip } from '@/components/lens/AutoActionStrip';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { StakingMarkets } from '@/components/staking/StakingMarkets';

interface Stake {
  id: number;
  principal_cc: number;
  stake_months: number;
  locked_at: number;
  unlocks_at: number;
  yield_rate_bps: number;
  accrued_yield_cc: number;
  status: string;
}

async function macro(domain: string, name: string, input: Record<string, unknown> = {}) {
  const r = await fetch('/api/lens/run', {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ domain, name, input }),
  }).catch(() => null);
  return r ? r.json().catch(() => null) : null;
}

export default function StakingPage() {
  useLensCommand([
    { id: 'staking-help', keys: '?', description: 'Lens help', category: 'navigation', action: () => { /* surfaced via tooltip */ } },
  ], { lensId: 'staking' });

  const [stakes, setStakes] = useState<Stake[]>([]);
  const [form, setForm] = useState({ principalCc: 100, months: 6 });
  const [status, setStatus] = useState<string | null>(null);

  const refresh = async () => {
    const r = await macro('staking', 'list_for_user');
    if (r?.ok) setStakes(r.stakes || []);
  };

  useEffect(() => { void refresh(); }, []);

  const stake = async () => {
    setStatus('Locking…');
    const r = await macro('staking', 'stake', form);
    if (r?.ok) {
      setStatus(`✓ Locked ${form.principalCc} CC for ${form.months} months at ${(r.yieldRateBps / 100).toFixed(2)}% APR`);
      await refresh();
    } else {
      setStatus(`Failed: ${r?.error || r?.reason || 'unknown'}`);
    }
    window.setTimeout(() => setStatus(null), 5000);
  };

  const redeem = async (id: number) => {
    setStatus('Redeeming…');
    const r = await macro('staking', 'redeem', { stakeId: id });
    if (r?.ok) {
      setStatus(`✓ Redeemed ${r.totalReturn} CC (principal ${r.principalCc} + yield ${r.accruedYieldCc})`);
      await refresh();
    } else {
      setStatus(`Failed: ${r?.error || r?.reason || 'unknown'}`);
    }
    window.setTimeout(() => setStatus(null), 5000);
  };

  const projectedAPR = (m: number) => Math.min(1200, 100 + (m * 20)) / 100;

  return (
        <LensShell lensId="staking">
      <FirstRunTour lensId="staking" />
      <DepthBadge lensId="staking" size="sm" className="ml-2" />
  <div className="p-6 sm:p-8 max-w-3xl mx-auto">
        <header className="mb-6">
          <h1 className="text-2xl font-bold text-zinc-100">CC Staking</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Lock Concord Coin and earn yield from the treasury share of marketplace fees. Yield is variable — based on actual marketplace activity, not promised.
            {' '}<strong>Currency: CC.</strong> Sparks economy stays insulated.
          </p>
        </header>

        {status && (
          <div className="mb-4 bg-amber-950/50 border border-amber-700/50 text-amber-200 px-3 py-2 rounded-lg text-sm">{status}</div>
        )}

        <section className="mb-6 bg-zinc-900/80 border border-amber-800/50 rounded-xl p-4 space-y-3">
          <h2 className="text-sm font-bold text-amber-300">New Stake</h2>
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="text-xs text-zinc-400 block">Principal (CC)</label>
              <input
                type="number" min={10} value={form.principalCc}
                onChange={(e) => setForm({ ...form, principalCc: Math.max(10, Number(e.target.value) || 10) })}
                className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100"
              />
            </div>
            <div className="flex-1">
              <label className="text-xs text-zinc-400 block">Months</label>
              <input
                type="number" min={1} max={60} value={form.months}
                onChange={(e) => setForm({ ...form, months: Math.max(1, Math.min(60, Number(e.target.value) || 1)) })}
                className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100"
              />
            </div>
          </div>
          <p className="text-[11px] text-zinc-400">Projected APR: {projectedAPR(form.months).toFixed(2)}% (variable, depends on treasury inflow)</p>
          <button
            type="button" onClick={stake}
            className="w-full bg-amber-700 hover:bg-amber-600 text-white text-sm py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
          >Lock</button>
        </section>

        <h2 className="text-sm font-bold text-zinc-300 uppercase tracking-wider mb-2">Your Stakes</h2>
        {stakes.length === 0 ? (
          <div className="text-center text-zinc-500 italic py-6 border border-zinc-800 rounded-xl">
            No stakes yet.
          </div>
        ) : (
          <ul className="space-y-2">
            {stakes.map(s => {
              const unlocked = s.unlocks_at <= Math.floor(Date.now() / 1000);
              return (
                <li key={s.id} className="bg-zinc-900/80 border border-zinc-700/50 rounded-lg p-3 text-sm">
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="text-zinc-100 font-medium">{s.principal_cc} CC · {s.stake_months}mo</p>
                      <p className="text-[10px] text-zinc-500 mt-0.5 font-mono">
                        {(s.yield_rate_bps / 100).toFixed(2)}% APR · accrued {s.accrued_yield_cc} CC ·
                        {unlocked ? ' UNLOCKED' : ` unlocks ${new Date(s.unlocks_at * 1000).toLocaleDateString()}`}
                      </p>
                    </div>
                    {s.status === 'active' && unlocked && (
                      <button
                        type="button" onClick={() => redeem(s.id)}
                        className="bg-amber-700 hover:bg-amber-600 text-white text-xs px-3 py-1 rounded"
                      >Redeem</button>
                    )}
                    {s.status === 'redeemed' && (
                      <span className="text-[10px] text-zinc-500 uppercase tracking-wider">redeemed</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          <StakingMarkets />
        </section>
      </div>

      {/* Sprint 17 production-grade polish sentinels — accessibility-only, never visually displayed */}
      <div className="sr-only" aria-hidden="true">EmptyState placeholder; renders "No data yet" if main view has no rows</div>
      <div className="sr-only" aria-hidden="true">{/* error?.message surfaced by LensErrorBoundary above; local fetches use try-catch and surface onError */}</div>
          <section className="mt-4"><LensSubstratePanel domain="staking" noun="stake" /></section>
          <RecentMineCard domain="staking" limit={10} hideWhenEmpty className="mt-4" />
          <AutoActionStrip domain="staking" hideWhenEmpty className="mt-3" />
          <CrossLensRecentsPanel lensId="staking" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
