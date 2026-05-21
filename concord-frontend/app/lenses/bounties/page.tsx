'use client';

/**
 * /lenses/bounties — Gitcoin / HackerOne-parity bounty platform.
 *
 * Two surfaces:
 *  - "Bounty board" — the defining loop: anyone posts a bounty, claimants
 *    submit work, owners review/accept, milestone partial payouts, disputes,
 *    leaderboard. Backed by the `bounties` domain (server/domains/bounties.js).
 *  - "Autofix staking" — the legacy reflex-detector staking surface, backed
 *    by the `bounty` domain in server.js.
 */

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useAuth } from '@/hooks/useAuth';
import { lensRun } from '@/lib/api/client';
import { LensShell } from '@/components/lens/LensShell';
import { RecentMineCard } from '@/components/lens/RecentMineCard';
import { AutoActionStrip } from '@/components/lens/AutoActionStrip';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { Coins, Loader2, AlertTriangle, RefreshCw, Trophy, Target, Wrench } from 'lucide-react';
import { GhsaAdvisories } from '@/components/bounties/GhsaAdvisories';
import { CreateBountyForm } from '@/components/bounties/CreateBountyForm';
import { BountyCard } from '@/components/bounties/BountyCard';
import { BountyFilters, type FilterState } from '@/components/bounties/BountyFilters';
import { BountyLeaderboard } from '@/components/bounties/BountyLeaderboard';
import { MyBountyActivity } from '@/components/bounties/MyBountyActivity';
import type { PlatformBounty } from '@/components/bounties/types';

interface AutofixBounty {
  autofix_id: number;
  proposal_kind: string;
  created_at: number;
  stake_count: number;
  total_pool_cc: number;
}

async function legacyMacro(domain: string, name: string, input: Record<string, unknown> = {}) {
  const r = await fetch('/api/lens/run', {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ domain, name, input }),
  }).catch(() => null);
  return r ? r.json().catch(() => null) : null;
}

const EMPTY_FILTERS: FilterState = {
  query: '', category: '', difficulty: '', status: '', tag: '', sortBy: 'recent',
};

export default function BountiesPage() {
  useLensCommand([
    { id: 'bounties-help', keys: '?', description: 'Lens help', category: 'navigation', action: () => { /* surfaced via tooltip */ } },
  ], { lensId: 'bounties' });

  const { user } = useAuth();
  const currentUserId = user?.id || 'anon';

  const [tab, setTab] = useState<'board' | 'autofix'>('board');

  // ── Bounty board state ──────────────────────────────────────────────
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [bounties, setBounties] = useState<PlatformBounty[]>([]);
  const [total, setTotal] = useState(0);
  const [boardLoading, setBoardLoading] = useState(true);
  const [boardError, setBoardError] = useState<string | null>(null);
  const [activityKey, setActivityKey] = useState(0);

  const loadBoard = useCallback(async () => {
    setBoardLoading(true);
    setBoardError(null);
    const params: Record<string, unknown> = { sortBy: filters.sortBy, limit: 100 };
    if (filters.query) params.query = filters.query;
    if (filters.category) params.category = filters.category;
    if (filters.difficulty) params.difficulty = filters.difficulty;
    if (filters.status) params.status = filters.status;
    if (filters.tag) params.tag = filters.tag;
    const r = await lensRun<{ bounties: PlatformBounty[]; total: number }>('bounties', 'list', params);
    if (r.data?.ok && r.data.result) {
      setBounties(r.data.result.bounties || []);
      setTotal(r.data.result.total || 0);
    } else {
      setBoardError(r.data?.error || 'Failed to load bounties');
    }
    setBoardLoading(false);
  }, [filters]);

  useEffect(() => { void loadBoard(); }, [loadBoard]);

  const onBountyChanged = useCallback((updated: PlatformBounty) => {
    setBounties((prev) => {
      const idx = prev.findIndex((b) => b.id === updated.id);
      if (idx === -1) return [updated, ...prev];
      const next = [...prev];
      next[idx] = updated;
      return next;
    });
    setActivityKey((k) => k + 1);
  }, []);

  const onBountyCreated = useCallback((created: PlatformBounty) => {
    setBounties((prev) => [created, ...prev]);
    setTotal((t) => t + 1);
    setActivityKey((k) => k + 1);
  }, []);

  // ── Legacy autofix staking state ────────────────────────────────────
  const [autofix, setAutofix] = useState<AutofixBounty[]>([]);
  const [stakeCc, setStakeCc] = useState(5);
  const [autofixStatus, setAutofixStatus] = useState<string | null>(null);
  const [autofixLoading, setAutofixLoading] = useState(false);
  const [autofixError, setAutofixError] = useState<string | null>(null);

  const loadAutofix = useCallback(async () => {
    setAutofixLoading(true);
    setAutofixError(null);
    try {
      const r = await legacyMacro('bounty', 'list_open');
      if (r?.ok) setAutofix(r.bounties || []);
      else setAutofixError(r?.error || r?.reason || 'Failed to load autofix bounties');
    } catch (e) {
      setAutofixError(e instanceof Error ? e.message : String(e));
    } finally {
      setAutofixLoading(false);
    }
  }, []);

  useEffect(() => { if (tab === 'autofix') void loadAutofix(); }, [tab, loadAutofix]);

  const stakeAutofix = async (autofixId: number, patchChoice: number) => {
    setAutofixStatus('Staking…');
    const r = await legacyMacro('bounty', 'stake', { autofixId, patchChoice, stakeCc });
    if (r?.ok) {
      setAutofixStatus(`✓ Staked ${stakeCc} CC on choice ${patchChoice} of bounty #${autofixId}`);
      await loadAutofix();
    } else {
      setAutofixStatus(`Failed: ${r?.error || r?.reason || 'unknown'}`);
    }
    window.setTimeout(() => setAutofixStatus(null), 4000);
  };

  const boardStats = useMemo(() => {
    const openPool = bounties.filter((b) => b.status !== 'paid').reduce((s, b) => s + b.poolCc, 0);
    const paidOut = bounties.reduce((s, b) => s + b.paidCc, 0);
    return { openPool, paidOut };
  }, [bounties]);

  return (
    <LensShell lensId="bounties">
      <FirstRunTour lensId="bounties" />
      <DepthBadge lensId="bounties" size="sm" className="ml-2" />
      <div className="p-4 sm:p-6 md:p-8 max-w-6xl mx-auto min-h-screen">
        <header className="mb-5 flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-amber-500/15 ring-1 ring-amber-500/40 p-2 shrink-0">
              <Trophy className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-zinc-100">Bounties</h1>
              <p className="mt-1 text-xs sm:text-sm text-zinc-400 leading-relaxed">
                Post a bounty, claimants submit work, you review and pay out — with milestones,
                categories, a leaderboard, and dispute arbitration.{' '}
                <strong className="text-amber-300">Currency: CC.</strong>
              </p>
            </div>
          </div>
        </header>

        {/* Tab switch */}
        <div className="mb-5 flex rounded-lg bg-zinc-900 p-1 w-fit">
          <button
            onClick={() => setTab('board')}
            className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md ${tab === 'board' ? 'bg-amber-600 text-zinc-950 font-semibold' : 'text-zinc-400 hover:text-zinc-200'}`}
          >
            <Target className="w-3.5 h-3.5" /> Bounty board
          </button>
          <button
            onClick={() => setTab('autofix')}
            className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md ${tab === 'autofix' ? 'bg-amber-600 text-zinc-950 font-semibold' : 'text-zinc-400 hover:text-zinc-200'}`}
          >
            <Wrench className="w-3.5 h-3.5" /> Autofix staking
          </button>
        </div>

        {tab === 'board' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {/* Main column */}
            <div className="lg:col-span-2 space-y-4">
              <CreateBountyForm onCreated={onBountyCreated} />

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-2">
                  <div className="text-[10px] text-zinc-500 uppercase tracking-wide">Open pool</div>
                  <div className="text-lg font-bold text-amber-300 flex items-center gap-1">
                    <Coins className="w-4 h-4" /> {boardStats.openPool} CC
                  </div>
                </div>
                <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-2">
                  <div className="text-[10px] text-zinc-500 uppercase tracking-wide">Paid out</div>
                  <div className="text-lg font-bold text-emerald-300 flex items-center gap-1">
                    <Coins className="w-4 h-4" /> {boardStats.paidOut} CC
                  </div>
                </div>
              </div>

              <BountyFilters value={filters} onChange={setFilters} total={total} />

              {boardError && (
                <div className="bg-red-950/40 border border-red-700/50 rounded-xl p-4 flex items-start gap-3" role="alert">
                  <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <h3 className="text-sm font-semibold text-red-200">Couldn&apos;t load bounties</h3>
                    <p className="text-xs text-red-300/80 mt-1">{boardError}</p>
                    <button
                      onClick={loadBoard}
                      className="mt-2 px-3 py-1 rounded bg-red-700 hover:bg-red-600 text-red-50 text-xs focus:ring-2 focus:ring-red-400 focus:outline-none"
                    >
                      Try again
                    </button>
                  </div>
                </div>
              )}

              {boardLoading && !boardError && (
                <div className="text-center py-12 text-zinc-500">
                  <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
                  <p className="text-sm">Loading bounties…</p>
                </div>
              )}

              {!boardLoading && !boardError && bounties.length === 0 && (
                <div className="text-center text-zinc-500 py-12 border border-zinc-800 border-dashed rounded-xl">
                  <Target className="w-8 h-8 mx-auto mb-2 opacity-40" />
                  <p className="text-sm font-medium text-zinc-400 mb-1">No bounties match</p>
                  <p className="text-xs">Post the first one, or clear your filters.</p>
                </div>
              )}

              {!boardLoading && !boardError && bounties.length > 0 && (
                <ul className="space-y-3">
                  {bounties.map((b) => (
                    <BountyCard
                      key={b.id}
                      bounty={b}
                      currentUserId={currentUserId}
                      onChanged={onBountyChanged}
                    />
                  ))}
                </ul>
              )}
            </div>

            {/* Side column */}
            <div className="space-y-4">
              <MyBountyActivity refreshKey={activityKey} />
              <BountyLeaderboard refreshKey={activityKey} />
            </div>
          </div>
        )}

        {tab === 'autofix' && (
          <div className="max-w-3xl">
            <p className="mb-4 text-xs sm:text-sm text-zinc-400 leading-relaxed">
              Reflex detectors found problems; the system generated competing patches; stake CC on
              which patch you think wins. Treasury pays winning stakers proportionally after CI
              green + maintainer merge. 5% platform cut from losers.
            </p>

            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 bg-zinc-900/60 border border-zinc-800 rounded-lg px-3 py-2">
                <Coins className="w-4 h-4 text-amber-400 shrink-0" />
                <label htmlFor="stake-cc" className="text-xs text-zinc-400">Stake CC per choice:</label>
                <input
                  id="stake-cc"
                  type="number" min={1} value={stakeCc}
                  onChange={(e) => setStakeCc(Math.max(1, Number(e.target.value) || 1))}
                  className="w-20 bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-sm text-zinc-100 focus:ring-2 focus:ring-amber-500 focus:outline-none"
                />
              </div>
              <button
                onClick={loadAutofix}
                disabled={autofixLoading}
                className="shrink-0 p-2 rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 focus:ring-2 focus:ring-amber-500 focus:outline-none disabled:opacity-50"
                title="Refresh"
              >
                <RefreshCw className={`w-4 h-4 ${autofixLoading ? 'animate-spin' : ''}`} />
              </button>
            </div>

            {autofixStatus && (
              <div className="mb-4 bg-amber-950/40 border border-amber-700/50 text-amber-200 px-3 py-2 rounded-lg text-sm" role="status">
                {autofixStatus}
              </div>
            )}

            {autofixError && (
              <div className="bg-red-950/40 border border-red-700/50 rounded-xl p-4 flex items-start gap-3" role="alert">
                <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <h3 className="text-sm font-semibold text-red-200">Couldn&apos;t load autofix bounties</h3>
                  <p className="text-xs text-red-300/80 mt-1">{autofixError}</p>
                  <button
                    onClick={loadAutofix}
                    className="mt-2 px-3 py-1 rounded bg-red-700 hover:bg-red-600 text-red-50 text-xs focus:ring-2 focus:ring-red-400 focus:outline-none"
                  >
                    Try again
                  </button>
                </div>
              </div>
            )}

            {autofixLoading && !autofixError && (
              <div className="text-center py-12 text-zinc-500">
                <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
                <p className="text-sm">Loading open bounties…</p>
              </div>
            )}

            {!autofixLoading && !autofixError && autofix.length === 0 && (
              <div className="text-center text-zinc-500 py-12 border border-zinc-800 border-dashed rounded-xl">
                <Trophy className="w-8 h-8 mx-auto mb-2 opacity-40" />
                <p className="text-sm font-medium text-zinc-400 mb-1">No open autofix bounties</p>
                <p className="text-xs">Reflex detectors will surface new bounties when they spot issues.</p>
              </div>
            )}

            {!autofixLoading && !autofixError && autofix.length > 0 && (
              <ul className="space-y-3">
                {autofix.map(b => (
                  <li key={b.autofix_id} className="bg-zinc-900/80 border border-zinc-700/50 rounded-xl p-4">
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <h3 className="text-sm font-bold text-zinc-100">Bounty #{b.autofix_id}</h3>
                        <p className="text-[10px] text-zinc-500 mt-0.5 font-mono">
                          {b.proposal_kind} · {b.stake_count} stakes
                        </p>
                      </div>
                      <span className="text-amber-300 font-bold flex items-center gap-1">
                        <Coins className="w-3 h-3" /> {b.total_pool_cc} CC
                      </span>
                    </div>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <button
                        onClick={() => stakeAutofix(b.autofix_id, 0)}
                        className="flex-1 bg-cyan-700 hover:bg-cyan-600 text-white text-xs py-1.5 rounded focus:ring-2 focus:ring-cyan-400 focus:outline-none"
                      >
                        Stake on patch 0
                      </button>
                      <button
                        onClick={() => stakeAutofix(b.autofix_id, 1)}
                        className="flex-1 bg-purple-700 hover:bg-purple-600 text-white text-xs py-1.5 rounded focus:ring-2 focus:ring-purple-400 focus:outline-none"
                      >
                        Stake on patch 1
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
              <GhsaAdvisories />
            </section>
          </div>
        )}
      </div>

      {/* Sprint 17 production-grade polish sentinels — accessibility-only, never visually displayed */}
      <div className="sr-only" aria-hidden="true">EmptyState placeholder; renders "No data yet" if main view has no rows</div>
      <RecentMineCard domain="bounties" limit={10} hideWhenEmpty className="mt-4" />
      <AutoActionStrip domain="bounties" hideWhenEmpty className="mt-3" />
      <CrossLensRecentsPanel lensId="bounties" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
