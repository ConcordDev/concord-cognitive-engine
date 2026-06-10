'use client';

/**
 * FashionResalePanel — declutter flagging + resale listing handoff.
 * Surfaces items the closet should let go of and lets the user list
 * them for resale. Backed by fashion.declutter-* and resale-* macros.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Recycle, Tag, X } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Flagged {
  id: string; name: string; category: string; brand: string | null;
  cost: number; timesWorn: number; reasons: string[]; resaleEstimate: number; listed: boolean;
}
interface Listing {
  id: string; name: string; category: string; askingPrice: number;
  channel: string; condition: string; note: string | null;
}

const CHANNELS = ['depop', 'vinted', 'poshmark', 'ebay', 'local'];

export function FashionResalePanel({ onChange }: { onChange: () => void }) {
  const [flagged, setFlagged] = useState<Flagged[]>([]);
  const [listings, setListings] = useState<Listing[]>([]);
  const [potential, setPotential] = useState(0);
  const [totalAsking, setTotalAsking] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [listForm, setListForm] = useState<{ id: string; price: string; channel: string } | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [d, l] = await Promise.all([
      lensRun('fashion', 'declutter-suggestions', {}),
      lensRun('fashion', 'resale-listings', {}),
    ]);
    setFlagged((d.data?.result?.flagged as Flagged[]) || []);
    setPotential((d.data?.result?.potentialResale as number) || 0);
    setListings((l.data?.result?.listings as Listing[]) || []);
    setTotalAsking((l.data?.result?.totalAsking as number) || 0);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const list = async () => {
    if (!listForm) return;
    const price = Number(listForm.price);
    if (!Number.isFinite(price) || price <= 0) { setError('Enter a valid asking price.'); return; }
    const r = await lensRun('fashion', 'resale-list-item', {
      id: listForm.id, askingPrice: price, channel: listForm.channel,
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setListForm(null); setError(null);
    await refresh(); onChange();
  };
  const unlist = async (id: string) => {
    await lensRun('fashion', 'resale-unlist-item', { id });
    await refresh(); onChange();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      {/* Declutter suggestions */}
      <section>
        <h3 className="flex items-center justify-between text-xs font-semibold text-zinc-300 mb-2">
          <span className="flex items-center gap-1"><Recycle className="w-3.5 h-3.5 text-fuchsia-400" /> Declutter suggestions</span>
          {potential > 0 && <span className="text-[11px] text-emerald-400">~${potential} resale potential</span>}
        </h3>
        {flagged.length === 0 ? (
          <p className="text-[11px] text-emerald-400 italic">Nothing flagged — your closet earns its keep.</p>
        ) : (
          <ul className="space-y-2">
            {flagged.map((f) => (
              <li key={f.id} className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
                <div className="flex items-start justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-zinc-100 truncate">{f.name}</p>
                    <p className="text-[10px] text-zinc-400 capitalize">
                      {f.category}{f.brand ? ` · ${f.brand}` : ''} · worn {f.timesWorn}×
                    </p>
                  </div>
                  <span className="text-[11px] text-emerald-400 shrink-0">~${f.resaleEstimate}</span>
                </div>
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {f.reasons.map((rsn, idx) => (
                    <span key={idx} className="text-[10px] px-1.5 py-0.5 rounded bg-amber-950/50 text-amber-300">{rsn}</span>
                  ))}
                </div>
                {f.listed ? (
                  <p className="text-[11px] text-fuchsia-300 mt-2">Already listed for resale.</p>
                ) : listForm?.id === f.id ? (
                  <div className="flex items-center gap-1.5 mt-2">
                    <input inputMode="decimal" value={listForm.price}
                      onChange={(e) => setListForm({ ...listForm, price: e.target.value })}
                      placeholder={`Ask ($) · est ${f.resaleEstimate}`}
                      className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-xs text-zinc-100" />
                    <select value={listForm.channel} onChange={(e) => setListForm({ ...listForm, channel: e.target.value })}
                      className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-xs text-zinc-100">
                      {CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <button type="button" onClick={list}
                      className="px-2 py-1 text-[11px] bg-fuchsia-600 hover:bg-fuchsia-500 text-white rounded-lg">List</button>
                    <button aria-label="Close" type="button" onClick={() => setListForm(null)} className="text-zinc-400 hover:text-zinc-300">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <button type="button"
                    onClick={() => setListForm({ id: f.id, price: String(f.resaleEstimate), channel: 'depop' })}
                    className="flex items-center gap-1 mt-2 text-[11px] px-2 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg">
                    <Tag className="w-3 h-3" /> List for resale
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Active listings */}
      <section>
        <h3 className="flex items-center justify-between text-xs font-semibold text-zinc-300 mb-2">
          <span className="flex items-center gap-1"><Tag className="w-3.5 h-3.5 text-fuchsia-400" /> Active resale listings</span>
          {totalAsking > 0 && <span className="text-[11px] text-emerald-400">${totalAsking} asking total</span>}
        </h3>
        {listings.length === 0 ? (
          <p className="text-[11px] text-zinc-400 italic">No items listed for resale.</p>
        ) : (
          <ul className="space-y-2">
            {listings.map((l) => (
              <li key={l.id} className="flex items-center justify-between bg-zinc-900/70 border border-zinc-800 rounded-xl px-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-zinc-100 truncate">{l.name}</p>
                  <p className="text-[10px] text-zinc-400 capitalize">
                    ${l.askingPrice} on <span className="text-fuchsia-300">{l.channel}</span> · {l.condition}
                  </p>
                </div>
                <button type="button" onClick={() => unlist(l.id)}
                  className={cn('text-[11px] px-2 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 shrink-0')}>
                  Unlist
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
