'use client';

/**
 * FashionPlanPanel — packing lists, lookbooks and wear insights.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Luggage, BookImage, TrendingUp, ChevronRight } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Item { id: string; name: string }
interface Outfit { id: string; name: string }
interface PackingList { id: string; name: string; destination: string | null; itemCount: number }
interface Lookbook { id: string; name: string; outfitCount: number }
interface Insights {
  mostWorn: { name: string; timesWorn: number }[];
  bestValue: { name: string; costPerWear: number }[];
  neverWorn: { name: string; cost: number }[];
}

export function FashionPlanPanel() {
  const [packingLists, setPackingLists] = useState<PackingList[]>([]);
  const [lookbooks, setLookbooks] = useState<Lookbook[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [outfits, setOutfits] = useState<Outfit[]>([]);
  const [insights, setInsights] = useState<Insights | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pkName, setPkName] = useState('');
  const [lbName, setLbName] = useState('');
  const [openPk, setOpenPk] = useState<string | null>(null);
  const [pkItems, setPkItems] = useState<Item[]>([]);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [p, l, i, o, ins] = await Promise.all([
      lensRun('fashion', 'packing-list', {}),
      lensRun('fashion', 'lookbook-list', {}),
      lensRun('fashion', 'item-list', {}),
      lensRun('fashion', 'outfit-list', {}),
      lensRun('fashion', 'wear-insights', {}),
    ]);
    setPackingLists(p.data?.result?.packingLists || []);
    setLookbooks(l.data?.result?.lookbooks || []);
    setItems(i.data?.result?.items || []);
    setOutfits(o.data?.result?.outfits || []);
    setInsights((ins.data?.result as Insights | null) || null);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const createPacking = async () => {
    if (!pkName.trim()) { setError('Packing list name is required.'); return; }
    const r = await lensRun('fashion', 'packing-create', { name: pkName.trim() });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setPkName(''); setError(null);
    await refresh();
  };
  const createLookbook = async () => {
    if (!lbName.trim()) { setError('Lookbook name is required.'); return; }
    const r = await lensRun('fashion', 'lookbook-create', { name: lbName.trim() });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setLbName(''); setError(null);
    await refresh();
  };
  const openPacking = async (id: string) => {
    if (openPk === id) { setOpenPk(null); return; }
    setOpenPk(id);
    const r = await lensRun('fashion', 'packing-detail', { id });
    setPkItems(r.data?.ok === false ? [] : (r.data?.result?.items || []));
  };
  const togglePackItem = async (packingId: string, itemId: string, inList: boolean) => {
    await lensRun('fashion', 'packing-add-item', { packingId, itemId, remove: inList });
    const r = await lensRun('fashion', 'packing-detail', { id: packingId });
    setPkItems(r.data?.result?.items || []);
    await refresh();
  };
  const addLookbookOutfit = async (lookbookId: string, outfitId: string) => {
    await lensRun('fashion', 'lookbook-add-outfit', { lookbookId, outfitId });
    await refresh();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-500"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      {/* Insights */}
      {insights && (insights.mostWorn.length > 0 || insights.neverWorn.length > 0) && (
        <section>
          <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
            <TrendingUp className="w-3.5 h-3.5 text-fuchsia-400" /> Wear insights
          </h3>
          <div className="grid sm:grid-cols-2 gap-2">
            <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
              <p className="text-[10px] text-zinc-500 uppercase mb-1">Most worn</p>
              {insights.mostWorn.length === 0 ? <p className="text-[11px] text-zinc-600">—</p> :
                insights.mostWorn.map((m) => (
                  <p key={m.name} className="text-[11px] text-zinc-300">{m.name} <span className="text-zinc-600">· {m.timesWorn}×</span></p>
                ))}
            </div>
            <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
              <p className="text-[10px] text-zinc-500 uppercase mb-1">Never worn ({insights.neverWorn.length})</p>
              {insights.neverWorn.length === 0 ? <p className="text-[11px] text-emerald-400">Everything earns its place</p> :
                insights.neverWorn.slice(0, 4).map((m) => (
                  <p key={m.name} className="text-[11px] text-zinc-300">{m.name} <span className="text-zinc-600">· ${m.cost}</span></p>
                ))}
            </div>
          </div>
        </section>
      )}

      {/* Packing lists */}
      <section>
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
          <Luggage className="w-3.5 h-3.5 text-fuchsia-400" /> Packing lists
        </h3>
        <div className="flex gap-2 mb-2">
          <input value={pkName} onChange={(e) => setPkName(e.target.value)} placeholder="New packing list…"
            className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-zinc-100" />
          <button type="button" onClick={createPacking}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-fuchsia-600 hover:bg-fuchsia-500 text-white rounded-lg">
            <Plus className="w-3.5 h-3.5" /> Create
          </button>
        </div>
        {packingLists.length === 0 ? (
          <p className="text-[11px] text-zinc-500 italic">No packing lists.</p>
        ) : (
          <ul className="space-y-2">
            {packingLists.map((p) => (
              <li key={p.id} className="bg-zinc-900/70 border border-zinc-800 rounded-xl overflow-hidden">
                <button type="button" onClick={() => openPacking(p.id)}
                  className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-zinc-900">
                  <ChevronRight className={cn('w-4 h-4 text-zinc-600 transition-transform', openPk === p.id && 'rotate-90')} />
                  <span className="text-sm font-semibold text-zinc-100">{p.name}</span>
                  <span className="text-[11px] text-zinc-500">{p.itemCount} items</span>
                </button>
                {openPk === p.id && (
                  <div className="border-t border-zinc-800 p-3 bg-zinc-950/50 flex flex-wrap gap-1">
                    {items.length === 0 ? <p className="text-[11px] text-zinc-500 italic">Add closet items first.</p> :
                      items.map((i) => {
                        const inList = pkItems.some((x) => x.id === i.id);
                        return (
                          <button key={i.id} type="button" onClick={() => togglePackItem(p.id, i.id, inList)}
                            className={cn('text-[11px] px-2 py-0.5 rounded-full border',
                              inList ? 'border-fuchsia-700/50 bg-fuchsia-950/40 text-fuchsia-300' : 'border-zinc-700 text-zinc-400')}>
                            {i.name}
                          </button>
                        );
                      })}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Lookbooks */}
      <section>
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
          <BookImage className="w-3.5 h-3.5 text-fuchsia-400" /> Lookbooks
        </h3>
        <div className="flex gap-2 mb-2">
          <input value={lbName} onChange={(e) => setLbName(e.target.value)} placeholder="New lookbook…"
            className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-zinc-100" />
          <button type="button" onClick={createLookbook}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-fuchsia-600 hover:bg-fuchsia-500 text-white rounded-lg">
            <Plus className="w-3.5 h-3.5" /> Create
          </button>
        </div>
        {lookbooks.length === 0 ? (
          <p className="text-[11px] text-zinc-500 italic">No lookbooks.</p>
        ) : (
          <ul className="space-y-2">
            {lookbooks.map((l) => (
              <li key={l.id} className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
                <p className="text-sm font-semibold text-zinc-100">{l.name} <span className="text-[11px] text-zinc-500">· {l.outfitCount} outfits</span></p>
                {outfits.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {outfits.map((o) => (
                      <button key={o.id} type="button" onClick={() => addLookbookOutfit(l.id, o.id)}
                        className="text-[11px] px-2 py-0.5 rounded-full border border-zinc-700 text-zinc-300 hover:border-fuchsia-700/50 hover:text-fuchsia-300">
                        + {o.name}
                      </button>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
