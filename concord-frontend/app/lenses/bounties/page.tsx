'use client';

/**
 * /lenses/bounties — autofix bounty staking. Phase 9.5 #7. Currency: CC.
 */

import { useEffect, useState } from 'react';

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
  const [bounties, setBounties] = useState<Bounty[]>([]);
  const [stake, setStake] = useState({ autofixId: 0, patchChoice: 0, stakeCc: 5 });
  const [status, setStatus] = useState<string | null>(null);

  const refresh = async () => {
    const r = await macro('bounty', 'list_open');
    if (r?.ok) setBounties(r.bounties || []);
  };

  useEffect(() => { void refresh(); }, []);

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
    <div className="p-6 max-w-3xl mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-zinc-100">Autofix Bounties</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Reflex detectors found problems; the system generated competing patches; stake CC on which patch you think wins. Treasury pays winning stakers proportionally after CI green + maintainer merge.
          {' '}<strong>Currency: CC.</strong> 5% platform cut from losers.
        </p>
      </header>

      {status && (
        <div className="mb-4 bg-rose-950/50 border border-rose-700/50 text-rose-200 px-3 py-2 rounded-lg text-sm">{status}</div>
      )}

      <div className="mb-4 flex items-center gap-3 bg-zinc-900/60 border border-zinc-800 rounded-lg px-3 py-2">
        <label className="text-xs text-zinc-400">Stake CC per choice:</label>
        <input
          type="number" min={1} value={stake.stakeCc}
          onChange={(e) => setStake({ ...stake, stakeCc: Math.max(1, Number(e.target.value) || 1) })}
          className="w-20 bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-sm text-zinc-100"
        />
      </div>

      {bounties.length === 0 ? (
        <div className="text-center text-zinc-500 italic py-8 border border-zinc-800 rounded-xl">
          No open bounties. Check back when reflex detectors find issues.
        </div>
      ) : (
        <ul className="space-y-3">
          {bounties.map(b => (
            <li key={b.autofix_id} className="bg-zinc-900/80 border border-zinc-700/50 rounded-xl p-4">
              <div className="flex justify-between items-start mb-2">
                <div>
                  <h3 className="text-sm font-bold text-zinc-100">Bounty #{b.autofix_id}</h3>
                  <p className="text-[10px] text-zinc-500 mt-0.5 font-mono">{b.proposal_kind} · {b.stake_count} stakes</p>
                </div>
                <span className="text-amber-300 font-bold">{b.total_pool_cc} CC pool</span>
              </div>
              <div className="flex gap-2">
                <button onClick={() => place(b.autofix_id, 0)} className="flex-1 bg-cyan-700 hover:bg-cyan-600 text-white text-xs py-1.5 rounded">Stake on patch 0</button>
                <button onClick={() => place(b.autofix_id, 1)} className="flex-1 bg-purple-700 hover:bg-purple-600 text-white text-xs py-1.5 rounded">Stake on patch 1</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
