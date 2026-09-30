'use client';

import { useCallback, useState } from 'react';
import { Coins, Trophy, TrendingDown } from 'lucide-react';
import { api, lensRun } from '@/lib/api/client';
import { ds } from '@/lib/design-system';
import { StatTile } from '@/components/ui/StatTile';
import { CreatorLeaderboard } from './CreatorLeaderboard';
import { useCreator } from './CreatorProvider';
import type { DashboardResponse, DriftHit, SocialProfile, WithdrawalStatus } from './types';

const PANEL = ds.panel;

function OverviewTab({
  me, drift, withdrawal, profile, onWithdrawalDone,
}: {
  me: DashboardResponse | null;
  drift: DriftHit[];
  withdrawal: WithdrawalStatus | null;
  profile: SocialProfile | null;
  onWithdrawalDone: () => void;
}) {
  return (
    <>
      {/* Profile chip — quick visual identity at the top of overview */}
      {profile && (
        <section className={`${PANEL} mb-6 flex items-center gap-3`}>
          <div className="w-10 h-10 rounded-full bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-300 font-bold">
            {(profile.displayName || profile.userId).slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-white font-semibold truncate">{profile.displayName || profile.userId}</div>
            <div className="text-xs text-gray-400 truncate">{profile.bio || 'No bio yet — set one in Profile.'}</div>
          </div>
          <div className="flex items-center gap-3 text-xs text-gray-400">
            <span><span className="text-amber-300 font-mono">{profile.stats.followerCount}</span> followers</span>
            <span><span className="text-amber-300 font-mono">{profile.stats.followingCount}</span> following</span>
          </div>
        </section>
      )}

      {me?.ok && me.summary ? (
        <section className={`${PANEL} mb-6`}>
          <h2 className="text-amber-200 font-semibold mb-3 inline-flex items-center gap-1.5">
            <Trophy className="w-4 h-4" /> Your stats
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Stat label="DTUs"               value={me.summary.dtuCount} />
            <Stat label="Listings"           value={me.summary.listingCount} />
            <Stat label="Downloads"          value={me.summary.totalDownloads} />
            <Stat label="Earnings (CC)"      value={me.summary.totalEarnings} />
            <Stat label="Citations received" value={me.summary.citationsReceived} />
            <Stat label="Citations made"     value={me.summary.citationsMade} />
            <Stat label="Max lineage depth"  value={me.summary.lineageDepth} />
            <Stat label="Reputation score"   value={me.summary.reputationScore} />
          </div>
        </section>
      ) : (
        <div className={`${PANEL} mb-6 text-gray-400 italic`}>
          {me?.error ? 'Sign in to see your dashboard.' : 'Loading your stats...'}
        </div>
      )}

      {/* Withdrawal */}
      {withdrawal?.ok && (
        <WithdrawalSection withdrawal={withdrawal} onDone={onWithdrawalDone} />
      )}

      {/* Top creators + trending citations live in <CreatorLeaderboard>,
          mounted once directly below this tab (real-time via react-query) —
          this used to duplicate the exact same two /api/creator/* endpoints
          in a second, differently-styled panel underneath every tab. */}
      <section className={PANEL}>
        <h2 className="text-rose-300 font-semibold mb-3 inline-flex items-center gap-1.5">
          <TrendingDown className="w-4 h-4" /> Influence drift (7d)
        </h2>
        {drift.length === 0 ? (
          <div className="text-gray-400 italic">No significant drift.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-gray-400 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left py-1">Creator</th>
                <th className="text-right py-1">Recent</th>
                <th className="text-right py-1">Prior</th>
                <th className="text-right py-1">Change</th>
              </tr>
            </thead>
            <tbody>
              {drift.map((d) => (
                <tr key={d.userId} className="border-t border-white/5">
                  <td className="py-1 text-gray-200 truncate">{d.userId}</td>
                  <td className="py-1 text-right text-gray-300">{d.recentCitations}</td>
                  <td className="py-1 text-right text-gray-400">{d.priorCitations}</td>
                  <td className={`py-1 text-right font-mono ${
                    d.change > 0 ? 'text-emerald-400' : d.change < 0 ? 'text-rose-400' : 'text-gray-400'
                  }`}>
                    {d.change > 0 ? '+' : ''}{d.change}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}

function WithdrawalSection({
  withdrawal, onDone,
}: { withdrawal: WithdrawalStatus; onDone: () => void }) {
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  const [withdrawing, setWithdrawing] = useState(false);

  const requestWithdrawal = useCallback(async () => {
    setWithdrawError(null);
    const amount = Number(withdrawAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setWithdrawError('Enter a positive amount.');
      return;
    }
    setWithdrawing(true);
    try {
      const res = await api.post('/api/economy/withdraw', { amount });
      const body = res.data;
      if (body?.ok === false) {
        setWithdrawError(body?.error ?? 'Request failed.');
      } else {
        setWithdrawAmount('');
        onDone();
      }
    } catch (e) {
      setWithdrawError(e instanceof Error ? e.message : 'Request failed.');
    } finally {
      setWithdrawing(false);
    }
  }, [withdrawAmount, onDone]);

  return (
    <section className={`${PANEL} mb-6`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
        <h2 className="text-emerald-300 font-semibold inline-flex items-center gap-1.5">
          <Coins className="w-4 h-4" /> Earnings &amp; withdrawal
        </h2>
        <span className="text-[11px] text-gray-400">
          {withdrawal.holdHours}h hold · min {withdrawal.minWithdraw} CC
        </span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-4">
        <div>
          <div className="text-[10px] text-gray-400 uppercase tracking-wider">Total balance</div>
          <div className="text-2xl text-emerald-300 font-mono mt-1">{withdrawal.balance.toFixed(2)} CC</div>
        </div>
        <div>
          <div className="text-[10px] text-gray-400 uppercase tracking-wider">Eligible to withdraw</div>
          <div className="text-2xl text-emerald-200 font-mono mt-1">{withdrawal.eligibleAmount.toFixed(2)} CC</div>
        </div>
        <div>
          <div className="text-[10px] text-gray-400 uppercase tracking-wider">In {withdrawal.holdHours}h hold</div>
          <div className="text-2xl text-amber-300 font-mono mt-1">{withdrawal.pendingHoldAmount.toFixed(2)} CC</div>
          {withdrawal.nextEligibleAt && (
            <div className="text-[11px] text-gray-400 mt-1">
              next unlock {new Date(withdrawal.nextEligibleAt).toLocaleString()}
            </div>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={withdrawAmount}
          onChange={(e) => setWithdrawAmount(e.target.value)}
          inputMode="decimal"
          placeholder={`Amount (max ${withdrawal.eligibleAmount.toFixed(2)})`}
          className="flex-1 min-w-[200px] bg-black/60 border border-white/10 rounded px-3 py-2 text-sm text-gray-200 focus:border-emerald-400/60 focus:outline-none"
        />
        <button
          onClick={requestWithdrawal}
          disabled={withdrawing || withdrawal.eligibleAmount < withdrawal.minWithdraw}
          className="px-4 py-2 text-sm font-medium bg-emerald-700 hover:bg-emerald-600 disabled:bg-stone-800 disabled:text-gray-400 rounded text-white"
        >
          {withdrawing ? 'Requesting…' : 'Request withdrawal'}
        </button>
      </div>
      {withdrawError && (
        <p role="alert" className="mt-2 text-xs text-rose-300">{withdrawError}</p>
      )}
      {withdrawal.pendingWithdrawals.length > 0 && (
        <div className="mt-4 space-y-1.5">
          <div className="text-[11px] text-gray-400 uppercase tracking-wider">In review</div>
          {withdrawal.pendingWithdrawals.map((w) => (
            <div key={w.id} className="flex items-center justify-between text-sm border-l-2 border-emerald-500/40 pl-3">
              <span className="text-gray-200 font-mono">{w.amount.toFixed(2)} CC</span>
              <span className="text-gray-400 capitalize">{w.status}</span>
              <span className="text-gray-600 text-xs">{new Date(w.createdAt).toLocaleDateString()}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function StudioPulse() {
  const { studioDash, studioGoal, refreshStudio } = useCreator();
  const [metric, setMetric] = useState('followers');
  const [target, setTarget] = useState('');
  const setGoal = async () => {
    const t = Number(target);
    if (!(t > 0)) return;
    await lensRun('creator', 'creator-goal-set', { metric, target: t });
    setTarget('');
    refreshStudio();
  };
  if (!studioDash) return null;
  return (
    <section className={`${PANEL} mb-6`}>
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-3">
        <StatTile size="sm" label="Platforms" value={studioDash.platforms} />
        <StatTile size="sm" label="Followers" value={studioDash.totalFollowers.toLocaleString()} />
        <StatTile size="sm" label="Ideas" value={studioDash.ideas} />
        <StatTile size="sm" label="In progress" value={studioDash.inProgress} />
        <StatTile size="sm" label="Published/mo" value={studioDash.publishedThisMonth} />
        <StatTile size="sm" label="Revenue/mo" value={`$${studioDash.revenueThisMonth.toLocaleString()}`} unit="" />
      </div>
      {studioGoal?.hasGoal ? (
        <div>
          <div className="flex items-center justify-between mb-1 text-[11px] text-white/50">
            <span>Goal · {studioGoal.metric}</span>
            <span className={studioGoal.met ? 'text-emerald-400' : ''}>
              {studioGoal.current?.toLocaleString()} / {studioGoal.target?.toLocaleString()} ({studioGoal.pct}%)
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
            <div className={`h-full ${studioGoal.met ? 'bg-emerald-500' : 'bg-amber-500'}`}
              style={{ width: `${Math.min(100, studioGoal.pct || 0)}%` }} />
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-white/50">Set a goal</span>
          <select value={metric} onChange={(e) => setMetric(e.target.value)} className={ds.input + ' w-auto py-1 text-[11px]'}>
            <option value="followers">Total followers</option>
            <option value="monthly_revenue">Monthly revenue</option>
            <option value="monthly_posts">Posts this month</option>
          </select>
          <input placeholder="Target" inputMode="numeric" value={target} onChange={(e) => setTarget(e.target.value)}
            className={ds.input + ' w-24 py-1 text-[11px]'} />
          <button type="button" onClick={setGoal} className={ds.btnPrimary + ' !px-2.5 !py-1 text-[11px]'}>Set</button>
        </div>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <div className="text-[10px] text-gray-400 uppercase tracking-wider">{label}</div>
      <div className="text-2xl text-amber-300 font-mono mt-1">{value}</div>
    </div>
  );
}

export function OverviewPanel() {
  const { me, drift, withdrawal, profile, dashboardLoading, refreshWithdrawal } = useCreator();
  return (
    <div className="space-y-0">
      <StudioPulse />
      <OverviewTab me={me} drift={drift} withdrawal={withdrawal} profile={profile} onWithdrawalDone={refreshWithdrawal} />
      {dashboardLoading && !me && (
        <div className={`${PANEL} text-white/40 italic`}>Loading your studio…</div>
      )}
      <section className="mt-6">
        <CreatorLeaderboard />
      </section>
    </div>
  );
}
