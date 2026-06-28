'use client';

import { useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import type { Tier } from './DiscoverPanel';

export interface Sponsorship {
  id: string;
  creatorId: string;
  creatorName: string;
  tierId: string;
  tierName: string;
  monthlyCc: number;
  dispatchFreqHours: number;
  status: string;
  startedAt: number;
  nextChargeAt: number;
  totalContributed: number;
}
interface Dispatch { id: string; title: string; body: string; publishedAt: number; }

export function MySponsorships({ refreshKey, onChange }: { refreshKey: number; onChange: () => void }) {
  const [items, setItems] = useState<Sponsorship[]>([]);
  const [tiersByCreator, setTiersByCreator] = useState<Record<string, Tier[]>>({});
  const [history, setHistory] = useState<Record<string, Dispatch[]>>({});
  const [openHistory, setOpenHistory] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    const r = await lensRun('sponsorship', 'list_for_user', {});
    setLoading(false);
    if (r.data?.ok && r.data.result) {
      const list: Sponsorship[] = r.data.result.sponsorships || [];
      setItems(list);
      const tmap: Record<string, Tier[]> = {};
      for (const sp of list) {
        const tr = await lensRun('sponsorship', 'list_tiers', { creatorId: sp.creatorId });
        if (tr.data?.ok && tr.data.result) tmap[sp.creatorId] = tr.data.result.tiers || [];
      }
      setTiersByCreator(tmap);
    } else {
      setError(r.data?.error || 'Could not load your memberships.');
    }
  };

  useEffect(() => { void load(); }, [refreshKey]);

  const flash = (m: string) => { setMsg(m); window.setTimeout(() => setMsg(null), 3500); };

  const act = async (name: string, params: Record<string, unknown>, label: string) => {
    const r = await lensRun('sponsorship', name, params);
    if (r.data?.ok) { flash(label); await load(); onChange(); }
    else flash(`Failed: ${r.data?.error || 'unknown'}`);
  };

  const changeTier = async (sp: Sponsorship, tierId: string) => {
    if (!tierId || tierId === sp.tierId) return;
    await act('change_tier', { sponsorshipId: sp.id, tierId }, 'Tier changed');
  };

  const loadHistory = async (sp: Sponsorship) => {
    if (openHistory === sp.id) { setOpenHistory(null); return; }
    const r = await lensRun('sponsorship', 'dispatch_history', { sponsorshipId: sp.id });
    if (r.data?.ok && r.data.result) {
      setHistory((h) => ({ ...h, [sp.id]: r.data!.result.dispatches || [] }));
      setOpenHistory(sp.id);
    }
  };

  return (
    <div className="space-y-3">
      {msg && (
        <div className="bg-emerald-950/50 border border-emerald-700/50 text-emerald-200 px-3 py-2 rounded-lg text-sm">{msg}</div>
      )}
      {loading ? (
        <div role="status" aria-live="polite" className="text-center text-zinc-400 italic py-6 border border-zinc-800 rounded-xl">
          Loading your memberships…
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
      ) : items.length === 0 ? (
        <div className="text-center text-zinc-400 italic py-6 border border-zinc-800 rounded-xl">
          No active sponsorships. Browse the Discover tab to find a creator.
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((sp) => (
            <li key={sp.id} className="bg-zinc-900/80 border border-zinc-700/50 rounded-xl p-3 text-sm">
              <div className="flex justify-between items-start gap-3">
                <div>
                  <p className="text-zinc-100 font-medium">
                    {sp.creatorName}
                    <span className={`ml-2 text-[10px] px-1.5 py-0.5 rounded ${sp.status === 'active' ? 'bg-emerald-900/60 text-emerald-300' : 'bg-amber-900/60 text-amber-300'}`}>{sp.status}</span>
                  </p>
                  <p className="text-[10px] text-zinc-400 mt-0.5 font-mono">
                    {sp.tierName} · {sp.monthlyCc} CC/mo · every {sp.dispatchFreqHours}h · since {new Date(sp.startedAt * 1000).toLocaleDateString()}
                  </p>
                  <p className="text-[10px] text-zinc-400 font-mono">
                    contributed {sp.totalContributed} CC · next charge {new Date(sp.nextChargeAt * 1000).toLocaleDateString()}
                  </p>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <select
                  value={sp.tierId}
                  onChange={(e) => void changeTier(sp, e.target.value)}
                  className="bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-[11px] text-zinc-100"
                >
                  {(tiersByCreator[sp.creatorId] || []).map((t) => (
                    <option key={t.tierId} value={t.tierId}>{t.name} — {t.monthlyCc} CC</option>
                  ))}
                </select>
                {sp.status === 'active' ? (
                  <button type="button" onClick={() => void act('pause', { sponsorshipId: sp.id }, 'Paused')}
                    className="text-[11px] text-amber-400 hover:text-amber-300">Pause</button>
                ) : (
                  <button type="button" onClick={() => void act('resume', { sponsorshipId: sp.id }, 'Resumed')}
                    className="text-[11px] text-emerald-400 hover:text-emerald-300">Resume</button>
                )}
                <button type="button" onClick={() => void loadHistory(sp)}
                  className="text-[11px] text-cyan-400 hover:text-cyan-300">
                  {openHistory === sp.id ? 'Hide dispatches' : 'Dispatch history'}
                </button>
                <button type="button" onClick={() => void act('cancel', { sponsorshipId: sp.id }, 'Cancelled')}
                  className="text-[11px] text-rose-400 hover:text-rose-300 ml-auto">Cancel</button>
              </div>
              {openHistory === sp.id && (
                <div className="mt-2 border-t border-zinc-800 pt-2 space-y-1.5">
                  {(history[sp.id] || []).length === 0 ? (
                    <p className="text-[11px] text-zinc-400 italic">No dispatches yet for this sponsorship.</p>
                  ) : (
                    (history[sp.id] || []).map((d) => (
                      <div key={d.id} className="bg-zinc-950 border border-zinc-800 rounded p-2">
                        <p className="text-[12px] text-zinc-200 font-medium">{d.title}</p>
                        {d.body && <p className="text-[11px] text-zinc-400 mt-0.5">{d.body}</p>}
                        <p className="text-[9px] text-zinc-400 mt-0.5">{new Date(d.publishedAt * 1000).toLocaleString()}</p>
                      </div>
                    ))
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
