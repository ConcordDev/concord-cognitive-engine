'use client';

/* eslint-disable react-hooks/exhaustive-deps */

/**
 * MaterialPriceList — editable contractor material catalog used by the
 * estimate builder. Seeds from a real-trade default catalog on first
 * access. Persists via the electrical.priceList* macros.
 */

import { useState, useEffect, useCallback } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Tags, Plus, Trash2, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface MaterialPrice { id: string; name: string; unit: string; price: number; category: string }

const CATEGORIES = ['wire', 'conduit', 'device', 'breaker', 'panel', 'box', 'fixture', 'misc'];

export function MaterialPriceList() {
  const [materials, setMaterials] = useState<MaterialPrice[]>([]);
  const [source, setSource] = useState<string>('');
  const [draft, setDraft] = useState({ name: '', unit: 'each', price: '', category: 'misc' });
  const [edits, setEdits] = useState<Record<string, { price: string }>>({});

  const refresh = useCallback(async () => {
    const r = await lensRun<{ materials: MaterialPrice[]; source: string }>('electrical', 'priceListGet', {});
    setMaterials(r.data.result?.materials || []);
    setSource(r.data.result?.source || '');
  }, []);

  useEffect(() => { refresh(); }, []);

  const addMaterial = useMutation({
    mutationFn: async () => {
      await lensRun('electrical', 'priceListUpsert', {
        name: draft.name || 'New Material',
        unit: draft.unit,
        price: parseFloat(draft.price) || 0,
        category: draft.category,
      });
      setDraft({ name: '', unit: 'each', price: '', category: 'misc' });
      await refresh();
    },
  });

  const updatePrice = useMutation({
    mutationFn: async (id: string) => {
      const v = edits[id];
      if (!v) return;
      await lensRun('electrical', 'priceListUpsert', { id, price: parseFloat(v.price) || 0 });
      setEdits((e) => { const n = { ...e }; delete n[id]; return n; });
      await refresh();
    },
  });

  const removeMaterial = useMutation({
    mutationFn: async (id: string) => {
      await lensRun('electrical', 'priceListRemove', { id });
      await refresh();
    },
  });

  return (
    <div className="overflow-hidden rounded-xl border border-lime-500/20 bg-gradient-to-br from-zinc-950 via-lime-950/10 to-zinc-950">
      <header className="flex items-center gap-2 border-b border-lime-500/20 bg-zinc-900/40 px-4 py-2">
        <Tags className="h-4 w-4 text-lime-400" />
        <span className="text-sm font-semibold text-white">Material price list</span>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">electrical.priceList*</span>
        {source && <span className="ml-auto text-[10px] text-zinc-400">{source === 'default-catalog' ? 'seeded from default catalog' : 'your catalog'} · {materials.length} items</span>}
      </header>

      <div className="p-4 space-y-2">
        {/* add row */}
        <div className="grid grid-cols-[1fr_80px_72px_96px_56px] gap-1.5 rounded-lg border border-lime-500/15 bg-zinc-950/40 p-2">
          <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Material name" className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-[11px] text-white" />
          <input value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value })} placeholder="unit" className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-[11px] text-white" />
          <input type="number" value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} placeholder="$ price" className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-[11px] text-white font-mono" />
          <select value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-[11px] text-white">
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <button type="button" onClick={() => addMaterial.mutate()} disabled={addMaterial.isPending || !draft.name} className="rounded bg-lime-500 px-2 py-1 text-[11px] font-semibold text-black hover:bg-lime-400 disabled:opacity-50">
            {addMaterial.isPending ? <Loader2 className="mx-auto h-3 w-3 animate-spin" /> : <Plus className="mx-auto h-3 w-3" />}
          </button>
        </div>

        {materials.length === 0 && <div className="rounded border border-dashed border-zinc-800 p-4 text-center text-[11px] text-zinc-400">Loading catalog…</div>}

        <div className="space-y-1">
          {materials.map((m) => {
            const editing = edits[m.id];
            return (
              <div key={m.id} className="grid grid-cols-[1fr_72px_92px_80px_28px] items-center gap-1.5 rounded border border-lime-500/10 bg-zinc-950/40 px-2 py-1 text-[10px]">
                <span className="truncate text-zinc-100">{m.name}</span>
                <span className="font-mono text-zinc-400">per {m.unit}</span>
                <div className="flex items-center gap-1">
                  <span className="text-zinc-400">$</span>
                  <input
                    type="number"
                    value={editing ? editing.price : String(m.price)}
                    onChange={(e) => setEdits((ed) => ({ ...ed, [m.id]: { price: e.target.value } }))}
                    onBlur={() => editing && updatePrice.mutate(m.id)}
                    className="w-full rounded border border-zinc-800 bg-zinc-950 px-1 py-0.5 font-mono text-[10px] text-lime-200"
                  />
                </div>
                <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-center text-[9px] text-zinc-400">{m.category}</span>
                <button aria-label="Delete" type="button" onClick={() => removeMaterial.mutate(m.id)} className="text-zinc-600 hover:text-rose-300"><Trash2 className="mx-auto h-3 w-3" /></button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
