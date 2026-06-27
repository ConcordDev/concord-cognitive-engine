'use client';

import { useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';

export interface Tier {
  tierId: string;
  name: string;
  monthlyCc: number;
  benefits: string[];
  dispatchFreqHours: number;
}
export interface Creator {
  creatorId: string;
  name: string;
  world: string;
  craft: string;
  blurb: string;
  baseMonthly: number;
  tiers: Tier[];
  sponsorCount: number;
  lowestTierCc: number;
}

export function DiscoverPanel({ onSubscribed }: { onSubscribed: () => void }) {
  const [creators, setCreators] = useState<Creator[]>([]);
  const [worlds, setWorlds] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [world, setWorld] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    const r = await lensRun('sponsorship', 'discover', {
      query: query || undefined,
      world: world || undefined,
    });
    setLoading(false);
    if (r.data?.ok && r.data.result) {
      setCreators(r.data.result.creators || []);
      if ((r.data.result.worlds || []).length) setWorlds(r.data.result.worlds);
    } else {
      setError(r.data?.error || 'Could not load creators.');
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, []);

  const subscribe = async (creatorId: string, tier: Tier) => {
    setBusy(true);
    const r = await lensRun('sponsorship', 'subscribe', { creatorId, tierId: tier.tierId });
    setBusy(false);
    if (r.data?.ok) {
      setMsg(`Subscribed to ${tier.name} — ${tier.monthlyCc} CC/mo`);
      setExpanded(null);
      onSubscribed();
      void load();
    } else {
      setMsg(`Failed: ${r.data?.error || 'unknown'}`);
    }
    window.setTimeout(() => setMsg(null), 4000);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <input
          type="text"
          placeholder="Search creators, crafts…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void load(); }}
          className="flex-1 min-w-[180px] bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100"
        />
        <select
          value={world}
          onChange={(e) => setWorld(e.target.value)}
          className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-2 text-sm text-zinc-100"
        >
          <option value="">All worlds</option>
          {worlds.map((w) => <option key={w} value={w}>{w}</option>)}
        </select>
        <button
          type="button"
          onClick={() => void load()}
          className="bg-emerald-700 hover:bg-emerald-600 text-white text-sm px-4 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
        >Browse</button>
      </div>

      {msg && (
        <div className="bg-emerald-950/50 border border-emerald-700/50 text-emerald-200 px-3 py-2 rounded-lg text-sm">{msg}</div>
      )}

      {loading ? (
        <div role="status" aria-live="polite" className="text-center text-zinc-400 italic py-6 border border-zinc-800 rounded-xl">
          Loading creators…
        </div>
      ) : error ? (
        <div role="alert" className="text-center py-6 border border-rose-800/60 bg-rose-950/30 rounded-xl">
          <p className="text-rose-300 text-sm">{error}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-2 bg-rose-800 hover:bg-rose-700 text-white text-xs px-4 py-1.5 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
          >Retry</button>
        </div>
      ) : creators.length === 0 ? (
        <div className="text-center text-zinc-400 italic py-6 border border-zinc-800 rounded-xl">
          No creators match your search.
        </div>
      ) : (
        <ul className="space-y-2">
          {creators.map((c) => (
            <li key={c.creatorId} className="bg-zinc-900/80 border border-zinc-700/50 rounded-xl p-3">
              <div className="flex justify-between items-start gap-3">
                <div>
                  <p className="text-zinc-100 font-medium">{c.name}</p>
                  <p className="text-xs text-zinc-400">{c.craft} · <span className="text-zinc-400">{c.world}</span></p>
                  <p className="text-xs text-zinc-400 mt-1">{c.blurb}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-[10px] text-zinc-400 uppercase tracking-wider">from</p>
                  <p className="text-amber-300 font-mono text-sm">{c.lowestTierCc} CC/mo</p>
                  <p className="text-[10px] text-zinc-400 mt-0.5">{c.sponsorCount} sponsor{c.sponsorCount === 1 ? '' : 's'}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setExpanded(expanded === c.creatorId ? null : c.creatorId)}
                className="mt-2 text-[11px] text-emerald-400 hover:text-emerald-300"
              >{expanded === c.creatorId ? 'Hide tiers' : 'View tiers'}</button>
              {expanded === c.creatorId && (
                <div className="mt-2 grid sm:grid-cols-3 gap-2">
                  {c.tiers.map((t) => (
                    <div key={t.tierId} className="bg-zinc-950 border border-zinc-700/60 rounded-lg p-2.5">
                      <div className="flex justify-between items-baseline">
                        <p className="text-sm font-bold text-zinc-100">{t.name}</p>
                        <p className="text-amber-300 font-mono text-xs">{t.monthlyCc} CC</p>
                      </div>
                      <ul className="mt-1 space-y-0.5">
                        {t.benefits.map((b) => (
                          <li key={b} className="text-[10px] text-zinc-400">· {b}</li>
                        ))}
                      </ul>
                      <p className="text-[10px] text-zinc-400 mt-1">Dispatch every {t.dispatchFreqHours}h</p>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void subscribe(c.creatorId, t)}
                        className="mt-1.5 w-full bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white text-[11px] py-1.5 rounded focus:outline-none focus:ring-2 focus:ring-amber-500"
                      >Subscribe</button>
                    </div>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
