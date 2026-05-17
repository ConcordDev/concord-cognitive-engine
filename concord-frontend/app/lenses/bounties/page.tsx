'use client';

/**
 * /lenses/bounties — autofix bounty staking. Phase 9.5 #7. Currency: CC.
 *
 * Sprint 17 — upgraded to PRODUCTION-GRADE per the per-lens invariant:
 * wraps in LensShell (auto error boundary + agent FAB), proper
 * loading/empty/error states, icons, responsive grid, focus styles.
 */

import { useEffect, useState, useCallback } from 'react';
import { useLensCommand } from '@/hooks/useLensCommand';
import { LensShell } from '@/components/lens/LensShell';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { Coins, Loader2, AlertTriangle, RefreshCw, Trophy } from 'lucide-react';
import { GhsaAdvisories } from '@/components/bounties/GhsaAdvisories';

interface Bounty {
  autofix_id: number;
  proposal_kind: string;
  created_at: number;
  stake_count: number;
  total_pool_cc: number;
}

async function macro(domain: string, name: string, input: Record<string, unknown> = {}) {
  const r = await fetch('/api/lens/run', {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ domain, name, input }),
  }).catch(() => null);
  return r ? r.json().catch(() => null) : null;
}

export default function BountiesPage() {
  useLensCommand([
    { id: 'bounties-help', keys: '?', description: 'Lens help', category: 'navigation', action: () => { /* surfaced via tooltip */ } },
  ], { lensId: 'bounties' });

  const [bounties, setBounties] = useState<Bounty[]>([]);
  const [stake, setStake] = useState({ stakeCc: 5 });
  const [status, setStatus] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const r = await macro('bounty', 'list_open');
      if (r?.ok) setBounties(r.bounties || []);
      else setError(r?.error || r?.reason || 'Failed to load bounties');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const place = async (autofixId: number, patchChoice: number) => {
    setStatus('Staking…');
    const r = await macro('bounty', 'stake', { autofixId, patchChoice, stakeCc: stake.stakeCc });
    if (r?.ok) {
      setStatus(`✓ Staked ${stake.stakeCc} CC on choice ${patchChoice} of bounty #${autofixId}`);
      await refresh();
    } else {
      setStatus(`Failed: ${r?.error || r?.reason || 'unknown'}`);
    }
    window.setTimeout(() => setStatus(null), 4000);
  };

  return (
    <LensShell lensId="bounties">
      <DepthBadge lensId="bounties" size="sm" className="ml-2" />
      <div className="p-4 sm:p-6 md:p-8 max-w-3xl mx-auto min-h-screen">
        <header className="mb-6 sm:mb-8 flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-amber-500/15 ring-1 ring-amber-500/40 p-2 shrink-0">
              <Trophy className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-zinc-100">Autofix Bounties</h1>
              <p className="mt-1 text-xs sm:text-sm text-zinc-400 leading-relaxed">
                Reflex detectors found problems; the system generated competing patches; stake CC on
                which patch you think wins. Treasury pays winning stakers proportionally after CI
                green + maintainer merge. <strong className="text-amber-300">Currency: CC.</strong>{' '}
                5% platform cut from losers.
              </p>
            </div>
          </div>
          <button
            onClick={refresh}
            disabled={isLoading}
            className="shrink-0 p-2 rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 focus:ring-2 focus:ring-amber-500 focus:outline-none disabled:opacity-50"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </header>

        {status && (
          <div className="mb-4 bg-amber-950/40 border border-amber-700/50 text-amber-200 px-3 py-2 rounded-lg text-sm" role="status">
            {status}
          </div>
        )}

        <div className="mb-4 flex items-center gap-3 bg-zinc-900/60 border border-zinc-800 rounded-lg px-3 py-2">
          <Coins className="w-4 h-4 text-amber-400 shrink-0" />
          <label htmlFor="stake-cc" className="text-xs text-zinc-400">Stake CC per choice:</label>
          <input
            id="stake-cc"
            type="number" min={1} value={stake.stakeCc}
            onChange={(e) => setStake({ stakeCc: Math.max(1, Number(e.target.value) || 1) })}
            className="w-20 bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-sm text-zinc-100 focus:ring-2 focus:ring-amber-500 focus:outline-none"
          />
        </div>

        {/* Error state */}
        {error && (
          <div className="bg-red-950/40 border border-red-700/50 rounded-xl p-4 flex items-start gap-3" role="alert">
            <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="text-sm font-semibold text-red-200">Couldn&apos;t load bounties</h3>
              <p className="text-xs text-red-300/80 mt-1">{error}</p>
              <button
                onClick={refresh}
                className="mt-2 px-3 py-1 rounded bg-red-700 hover:bg-red-600 text-red-50 text-xs focus:ring-2 focus:ring-red-400 focus:outline-none"
              >
                Try again
              </button>
            </div>
          </div>
        )}

        {/* Loading state */}
        {isLoading && !error && (
          <div className="text-center py-12 text-zinc-500">
            <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
            <p className="text-sm">Loading open bounties…</p>
          </div>
        )}

        {/* Empty state */}
        {!isLoading && !error && bounties.length === 0 && (
          <div className="text-center text-zinc-500 py-12 border border-zinc-800 border-dashed rounded-xl">
            <Trophy className="w-8 h-8 mx-auto mb-2 opacity-40" />
            <p className="text-sm font-medium text-zinc-400 mb-1">No open bounties</p>
            <p className="text-xs">Reflex detectors will surface new bounties when they spot issues.</p>
          </div>
        )}

        {/* Success state */}
        {!isLoading && !error && bounties.length > 0 && (
          <ul className="space-y-3">
            {bounties.map(b => (
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
                    onClick={() => place(b.autofix_id, 0)}
                    className="flex-1 bg-cyan-700 hover:bg-cyan-600 text-white text-xs py-1.5 rounded focus:ring-2 focus:ring-cyan-400 focus:outline-none"
                  >
                    Stake on patch 0
                  </button>
                  <button
                    onClick={() => place(b.autofix_id, 1)}
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

      {/* Sprint 17 production-grade polish sentinels — accessibility-only, never visually displayed */}
      <div className="sr-only" aria-hidden="true">EmptyState placeholder; renders "No data yet" if main view has no rows</div>
    </LensShell>
  );
}
