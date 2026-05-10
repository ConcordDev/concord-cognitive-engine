'use client';

/**
 * WalkerArbitrageMap — surfaces regional commodity arbitrage opportunities
 * + active walker journeys on a small inset map. Powered by Phase 4 macros:
 * walker.trade_routes + walker.arbitrage.
 *
 * Players see "buy zinc in Heartmere (low scarcity), sell in Fall Kill
 * (high scarcity), delta 0.34" plus dots for in-flight walkers. Click an
 * opp to copy hint to clipboard so the player can hire a walker through
 * the existing concord-link UI.
 */

import { useEffect, useState } from 'react';

interface Opp {
  commodity: string;
  buyRegion: string;
  buyScarcity: number;
  sellRegion: string;
  sellScarcity: number;
  delta: number;
}

export default function WalkerArbitrageMap({ worldId = 'concordia-hub' }: { worldId?: string }) {
  const [opps, setOpps] = useState<Opp[]>([]);
  const [walkerCount, setWalkerCount] = useState(0);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      const [arbR, walkerR] = await Promise.all([
        fetch('/api/lens/run', {
          method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ domain: 'walker', name: 'arbitrage', input: { worldId } }),
        }).catch(() => null),
        fetch('/api/lens/run', {
          method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ domain: 'walker', name: 'trade_routes', input: { worldId } }),
        }).catch(() => null),
      ]);
      const arbData = arbR ? await arbR.json().catch(() => null) : null;
      const walkerData = walkerR ? await walkerR.json().catch(() => null) : null;
      if (!alive) return;
      if (arbData?.ok) setOpps(arbData.opps || []);
      if (walkerData?.ok) setWalkerCount(walkerData.count || 0);
    };
    void refresh();
    const interval = window.setInterval(refresh, 30_000);
    return () => { alive = false; window.clearInterval(interval); };
  }, [worldId]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-3 right-3 z-30 bg-zinc-900/85 backdrop-blur-md border border-amber-700/50 text-amber-300 rounded-xl px-3 py-2 shadow-md text-xs font-mono hover:bg-zinc-800/90"
      >
        ⛺ {walkerCount} walkers · {opps.length} arbitrage
      </button>
    );
  }

  return (
    <div className="fixed bottom-3 right-3 z-30 max-w-sm bg-zinc-950/90 backdrop-blur-md border border-zinc-700/50 rounded-xl p-3 shadow-xl pointer-events-auto">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-bold text-amber-300 uppercase tracking-wider">Trade Routes</h3>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-[10px] text-zinc-400 hover:text-white"
          aria-label="Close"
        >
          ✕
        </button>
      </div>
      <p className="text-[10px] text-zinc-400 mb-2">
        {walkerCount} walkers in transit · {opps.length} arbitrage opportunities
      </p>
      {opps.length === 0 ? (
        <p className="text-[11px] text-zinc-500 italic">No arbitrage opps right now — markets in equilibrium.</p>
      ) : (
        <ul className="space-y-1.5 max-h-64 overflow-y-auto">
          {opps.slice(0, 8).map((o, i) => (
            <li key={i} className="text-[11px] bg-zinc-900/60 border border-zinc-800 rounded px-2 py-1.5">
              <div className="flex justify-between gap-2">
                <span className="text-zinc-100 font-medium">{o.commodity}</span>
                <span className="text-amber-400 font-mono">+{o.delta.toFixed(2)}</span>
              </div>
              <div className="text-[10px] text-zinc-400 mt-0.5">
                buy <span className="text-emerald-400">{o.buyRegion}</span> → sell <span className="text-rose-400">{o.sellRegion}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
