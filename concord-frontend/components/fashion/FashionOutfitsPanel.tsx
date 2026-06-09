'use client';

/**
 * FashionOutfitsPanel — build outfits from closet items and log wears.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Layers, Repeat, Trash2, ChevronRight } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Item { id: string; name: string; category: string }
interface Outfit { id: string; name: string; occasion: string; itemIds: string[]; itemNames: string[]; timesWorn: number }

const OCCASIONS = ['casual', 'work', 'formal', 'date', 'workout', 'travel'];

export function FashionOutfitsPanel({ onChange }: { onChange: () => void }) {
  const [outfits, setOutfits] = useState<Outfit[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [occasion, setOccasion] = useState('casual');
  const [chosen, setChosen] = useState<string[]>([]);
  const [open, setOpen] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [o, i] = await Promise.all([
      lensRun('fashion', 'outfit-list', {}),
      lensRun('fashion', 'item-list', {}),
    ]);
    setOutfits(o.data?.result?.outfits || []);
    setItems(i.data?.result?.items || []);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const create = async () => {
    if (!name.trim()) { setError('Outfit name is required.'); return; }
    const r = await lensRun('fashion', 'outfit-create', { name: name.trim(), occasion, itemIds: chosen });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setName(''); setChosen([]); setShowCreate(false); setError(null);
    await refresh(); onChange();
  };
  const wear = async (id: string) => { await lensRun('fashion', 'outfit-wear', { id }); await refresh(); onChange(); };
  const del = async (id: string) => { await lensRun('fashion', 'outfit-delete', { id }); await refresh(); onChange(); };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-zinc-400"><span className="text-zinc-100 font-semibold">{outfits.length}</span> outfits</span>
        <button type="button" onClick={() => setShowCreate((v) => !v)}
          className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-fuchsia-600 hover:bg-fuchsia-500 text-white rounded-lg">
          <Plus className="w-3.5 h-3.5" /> New outfit
        </button>
      </div>

      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      {showCreate && (
        <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <input placeholder="Outfit name" value={name} onChange={(e) => setName(e.target.value)}
              className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
            <select value={occasion} onChange={(e) => setOccasion(e.target.value)}
              className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
              {OCCASIONS.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
          {items.length === 0 ? (
            <p className="text-[11px] text-zinc-400 italic">Add closet items first.</p>
          ) : (
            <div className="flex flex-wrap gap-1">
              {items.map((i) => (
                <button key={i.id} type="button"
                  onClick={() => setChosen((c) => c.includes(i.id) ? c.filter((x) => x !== i.id) : [...c, i.id])}
                  className={cn('text-[11px] px-2 py-0.5 rounded-full border',
                    chosen.includes(i.id) ? 'border-fuchsia-700/50 bg-fuchsia-950/40 text-fuchsia-300' : 'border-zinc-700 text-zinc-400')}>
                  {i.name}
                </button>
              ))}
            </div>
          )}
          <button type="button" onClick={create}
            className="w-full bg-fuchsia-600 hover:bg-fuchsia-500 text-white text-xs font-medium rounded-lg px-2 py-1.5">
            Create outfit ({chosen.length} items)
          </button>
        </div>
      )}

      {outfits.length === 0 ? (
        <div className="text-center text-zinc-400 text-sm italic py-10 border border-zinc-800 rounded-xl">
          No outfits. Combine closet items into outfits.
        </div>
      ) : (
        <ul className="space-y-2">
          {outfits.map((o) => (
            <li key={o.id} className="bg-zinc-900/70 border border-zinc-800 rounded-xl overflow-hidden">
              <div className="flex items-center px-3 py-2.5">
                <button type="button" onClick={() => setOpen(open === o.id ? null : o.id)} className="flex-1 flex items-center gap-2 text-left">
                  <Layers className="w-4 h-4 text-fuchsia-400" />
                  <div>
                    <p className="text-sm font-semibold text-zinc-100">{o.name}</p>
                    <p className="text-[11px] text-zinc-400 capitalize">{o.occasion} · {o.itemIds.length} items · worn {o.timesWorn}×</p>
                  </div>
                  <ChevronRight className={cn('w-4 h-4 text-zinc-600 ml-auto transition-transform', open === o.id && 'rotate-90')} />
                </button>
                <button type="button" onClick={() => wear(o.id)}
                  className="ml-2 flex items-center gap-1 px-2 py-1 text-[11px] bg-fuchsia-600 hover:bg-fuchsia-500 text-white rounded-lg">
                  <Repeat className="w-3 h-3" /> Wear
                </button>
                <button aria-label="Delete" type="button" onClick={() => del(o.id)} className="ml-1 text-zinc-600 hover:text-rose-400">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              {open === o.id && (
                <div className="border-t border-zinc-800 px-3 py-2 bg-zinc-950/50">
                  {o.itemNames.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {o.itemNames.map((n, idx) => (
                        <span key={idx} className="text-[11px] px-2 py-0.5 rounded bg-zinc-800 text-zinc-300">{n}</span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[11px] text-zinc-400 italic">No items in this outfit.</p>
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
