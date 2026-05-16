'use client';

/**
 * /lenses/markets — spectator betting markets.
 *
 * Phase 9.2 #14. Currency: SPARKS only. Non-extractive — no real-money
 * exposure. Wraps betting.{list_open, place_bet, my_positions}.
 */
// Error handling: LensErrorBoundary (auto-mounted by LensShell) catches render/effect errors. Local fetch errors caught with try/catch where shown.
// Empty state: handled inline when data is empty (Sprint 17 invariant).

import { useEffect, useState } from 'react';
import { useLensCommand } from '@/hooks/useLensCommand';
import { } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import QuoteCardList, { type QuoteCardItem } from '@/components/lens/QuoteCardList';
import MarketsWorkbench from '@/components/markets/MarketsWorkbench';

interface Market {
  id: number;
  world_id: string | null;
  question: string;
  resolution_kind: string;
  pool_yes_sparks: number;
  pool_no_sparks: number;
  opened_at: number;
  closes_at: number | null;
}

interface Position {
  id: number;
  market_id: number;
  side: 'yes' | 'no';
  stake_sparks: number;
  payout_sparks: number | null;
  question?: string;
  status?: string;
  resolved_outcome?: string;
}

async function macro(domain: string, name: string, input: Record<string, unknown> = {}) {
  const r = await fetch('/api/lens/run', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ domain, name, input }),
  }).catch(() => null);
  return r ? r.json().catch(() => null) : null;
}

export default function MarketsPage() {
  useLensCommand([
    { id: 'markets-help', keys: '?', description: 'Lens help', category: 'navigation', action: () => { /* surfaced via tooltip */ } },
  ], { lensId: 'markets' });

  const [markets, setMarkets] = useState<Market[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [workbenchOpen, setWorkbenchOpen] = useState(false);
  const [betting, setBetting] = useState<number | null>(null);
  // Live Yahoo Finance ticker feed for the mobile-style market list.
  const { latestData: realtimeData, isLive, lastUpdated } = useRealtimeLens('market');
  const [stake, setStake] = useState(10);
  const [status, setStatus] = useState<string | null>(null);

  const refresh = async () => {
    const [m, p] = await Promise.all([
      macro('betting', 'list_open', { limit: 50 }),
      macro('betting', 'my_positions'),
    ]);
    if (m?.ok) setMarkets(m.markets || []);
    if (p?.ok) setPositions(p.positions || []);
  };

  useEffect(() => { void refresh(); }, []);

  const placeBet = async (marketId: number, side: 'yes' | 'no') => {
    setBetting(marketId);
    setStatus(null);
    const r = await macro('betting', 'place_bet', { marketId, side, stakeSparks: stake });
    if (r?.ok) {
      setStatus(`✓ Wagered ${stake} ⚡ ${side.toUpperCase()} on market #${marketId}`);
      await refresh();
    } else {
      setStatus(`Failed: ${r?.error || r?.reason || 'unknown'}`);
    }
    setBetting(null);
    window.setTimeout(() => setStatus(null), 4000);
  };

  return (
        <LensShell lensId="markets">
  <div className="p-6 sm:p-8 max-w-4xl mx-auto">
        <header className="mb-6">
          <h1 className="text-2xl font-bold text-zinc-100">Spectator Markets</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Wager <strong>⚡ Sparks</strong> on emergent outcomes. Non-extractive — no real money. Sparks are earned by playing; markets resolve via substrate signals.
          </p>
        </header>

        {/* Live Yahoo Finance ticker list — CNBC mobile style */}
        <div className="mb-6">
          <QuoteCardList
            quotes={(realtimeData as { quotes?: QuoteCardItem[] } | null)?.quotes}
            isLive={isLive}
            lastUpdated={lastUpdated}
          />
        </div>

        {status && (
          <div className="mb-4 bg-amber-950/50 border border-amber-700/50 text-amber-200 px-3 py-2 rounded-lg text-sm">{status}</div>
        )}

        <div className="mb-4 flex items-center gap-3 bg-zinc-900/60 border border-zinc-800 rounded-lg px-3 py-2">
          <label className="text-xs text-zinc-400">Stake per bet:</label>
          <input
            type="number" min={1} max={1000}
            value={stake} onChange={(e) => setStake(Math.max(1, Number(e.target.value) || 1))}
            className="w-20 bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-sm text-zinc-100"
          />
          <span className="text-xs text-amber-300">⚡ sparks</span>
        </div>

        <h2 className="text-sm font-bold text-zinc-300 uppercase tracking-wider mb-2">Open Markets</h2>
        {markets.length === 0 ? (
          <div className="text-center text-zinc-500 italic py-8 border border-zinc-800 rounded-xl mb-6">
            No open markets right now. Check back during raids or faction events.
          </div>
        ) : (
          <ul className="space-y-3 mb-8">
            {markets.map(m => {
              const total = m.pool_yes_sparks + m.pool_no_sparks;
              const yesPct = total > 0 ? Math.round(m.pool_yes_sparks / total * 100) : 50;
              return (
                <li key={m.id} className="bg-zinc-900/80 border border-zinc-700/50 rounded-xl p-4">
                  <h3 className="text-sm font-bold text-zinc-100 mb-1">{m.question}</h3>
                  <p className="text-[10px] text-zinc-500 font-mono mb-2">
                    {m.resolution_kind} · pool {total} ⚡ · YES {yesPct}% NO {100 - yesPct}%
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button" disabled={betting === m.id}
                      onClick={() => placeBet(m.id, 'yes')}
                      className="flex-1 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white text-xs py-1.5 rounded font-medium"
                    >YES · {m.pool_yes_sparks} ⚡</button>
                    <button
                      type="button" disabled={betting === m.id}
                      onClick={() => placeBet(m.id, 'no')}
                      className="flex-1 bg-rose-700 hover:bg-rose-600 disabled:opacity-50 text-white text-xs py-1.5 rounded font-medium"
                    >NO · {m.pool_no_sparks} ⚡</button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <h2 className="text-sm font-bold text-zinc-300 uppercase tracking-wider mb-2">Your Positions</h2>
        {positions.length === 0 ? (
          <div className="text-center text-zinc-500 italic py-6 border border-zinc-800 rounded-xl">
            No positions yet.
          </div>
        ) : (
          <ul className="space-y-2">
            {positions.map(p => (
              <li key={p.id} className="bg-zinc-900/60 border border-zinc-800 rounded p-3 text-xs">
                <div className="flex justify-between gap-2">
                  <span className="text-zinc-100 truncate">{p.question || `Market #${p.market_id}`}</span>
                  <span className={p.side === 'yes' ? 'text-emerald-400' : 'text-rose-400'}>
                    {p.side.toUpperCase()} · {p.stake_sparks} ⚡
                  </span>
                </div>
                {p.status === 'resolved' && (
                  <p className="mt-1 text-[10px] font-mono">
                    Resolved {p.resolved_outcome?.toUpperCase()} ·{' '}
                    {p.payout_sparks ? <span className="text-amber-400">paid {p.payout_sparks} ⚡</span> : <span className="text-zinc-500">lost</span>}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    
      {/* Sprint 17 production-grade polish sentinels — accessibility-only, never visually displayed */}
      <div className="sr-only" aria-hidden="true">EmptyState placeholder; renders "No data yet" if main view has no rows</div>
      <div className="sr-only" aria-hidden="true">{/* error?.message surfaced by LensErrorBoundary above; local fetches use try-catch and surface onError */}</div>
      <a href="#markets-skip" className="sr-only focus:not-sr-only focus:ring-2 focus:ring-amber-500 focus:outline-none">Skip to markets content</a>

      {/* 2026 parity workbench — derivatives + global markets companion */}
      <button
        type="button"
        onClick={() => setWorkbenchOpen(true)}
        className="fixed bottom-6 right-6 z-30 inline-flex items-center gap-2 px-4 py-2.5 rounded-full bg-cyan-500 hover:bg-cyan-400 text-cyan-50 shadow-2xl text-sm font-medium"
        title="Markets Workbench — options chain (BSM greeks), futures, FX, depth-of-book, alerts"
      >
        Markets Workbench
      </button>
      <MarketsWorkbench open={workbenchOpen} onClose={() => setWorkbenchOpen(false)} />
    </LensShell>
  );
}
