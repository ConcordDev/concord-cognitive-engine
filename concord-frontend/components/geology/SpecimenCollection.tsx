'use client';

/**
 * SpecimenCollection — a "rocks & minerals identified" checklist /
 * life-list. Tracks unique specimens, specimen counts and identified
 * vs. unidentified status. Wires geology.collection-add / -list /
 * -toggle / -remove. Every entry is user-recorded — no seed data.
 */

import { useCallback, useEffect, useState } from 'react';
import { Gem, Plus, Trash2, Loader2, Check, Circle } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Entry {
  id: string; name: string; kind: string; identified: boolean; count: number;
  locality: string | null; notes: string; firstFoundAt: string; lastFoundAt: string;
}

const KINDS = ['mineral', 'rock', 'fossil', 'gem'] as const;
const KIND_COLOR: Record<string, string> = {
  mineral: 'bg-cyan-900/60 text-cyan-300',
  rock: 'bg-stone-700 text-stone-200',
  fossil: 'bg-amber-900/60 text-amber-300',
  gem: 'bg-fuchsia-900/60 text-fuchsia-300',
};

export function SpecimenCollection() {
  const [rows, setRows] = useState<Entry[]>([]);
  const [stats, setStats] = useState({ unique: 0, total: 0, identified: 0 });
  const [byKind, setByKind] = useState<Record<string, number>>({});
  const [filter, setFilter] = useState<'all' | (typeof KINDS)[number]>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', kind: 'mineral' as (typeof KINDS)[number], locality: '' });

  const refresh = useCallback(async () => {
    const r = await lensRun('geology', 'collection-list', filter === 'all' ? {} : { kind: filter });
    if (r.data?.ok) {
      const res = r.data.result as {
        collection: Entry[]; uniqueCount: number; totalSpecimens: number;
        identifiedCount: number; byKind: Record<string, number>;
      };
      setRows(res.collection || []);
      setStats({ unique: res.uniqueCount, total: res.totalSpecimens, identified: res.identifiedCount });
      setByKind(res.byKind || {});
    }
    setLoading(false);
  }, [filter]);
  useEffect(() => { void refresh(); }, [refresh]);

  const add = useCallback(async () => {
    if (!form.name.trim()) return;
    setError(null);
    const r = await lensRun('geology', 'collection-add', {
      name: form.name.trim(), kind: form.kind, locality: form.locality.trim(),
    });
    const inner = r.data?.result as { ok?: boolean; error?: string } | undefined;
    if (r.data?.ok && inner?.ok !== false) { setForm({ name: '', kind: form.kind, locality: '' }); await refresh(); }
    else setError(inner?.error || r.data?.error || 'Could not add specimen');
  }, [form, refresh]);

  const toggle = useCallback(async (id: string) => {
    await lensRun('geology', 'collection-toggle', { id });
    await refresh();
  }, [refresh]);

  const remove = useCallback(async (id: string) => {
    await lensRun('geology', 'collection-remove', { id });
    await refresh();
  }, [refresh]);

  if (loading) return <div className="flex items-center justify-center py-6 text-zinc-400"><Loader2 className="w-4 h-4 animate-spin" /></div>;

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Gem className="w-4 h-4 text-cyan-400" />
        <h3 className="text-sm font-bold text-zinc-100">Specimen Collection</h3>
        <span className="text-[11px] text-zinc-400">life-list</span>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-3">
        {([['Unique', stats.unique], ['Specimens', stats.total], ['Identified', stats.identified]] as const).map(([l, v]) => (
          <div key={l} className="bg-zinc-900/60 border border-zinc-800 rounded-lg px-2 py-1.5 text-center">
            <p className="text-sm font-bold text-zinc-100">{v}</p>
            <p className="text-[9px] text-zinc-400 uppercase tracking-wide">{l}</p>
          </div>
        ))}
      </div>

      <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-2.5 mb-3 flex gap-1.5">
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="Specimen name (e.g. Quartz)"
          className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
        <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as (typeof KINDS)[number] })}
          className="bg-zinc-950 border border-zinc-800 rounded px-1.5 py-1 text-xs text-zinc-200 capitalize">
          {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        <input value={form.locality} onChange={(e) => setForm({ ...form, locality: e.target.value })}
          placeholder="Locality"
          className="w-28 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
        <button onClick={add} disabled={!form.name.trim()}
          className="px-3 py-1 text-xs rounded bg-cyan-600 hover:bg-cyan-500 text-white font-semibold disabled:opacity-40 inline-flex items-center gap-1">
          <Plus className="w-3 h-3" />Add
        </button>
      </div>

      <div className="flex gap-1 mb-2">
        <button onClick={() => setFilter('all')}
          className={cn('px-2 py-0.5 text-[11px] rounded', filter === 'all' ? 'bg-cyan-600 text-white' : 'text-zinc-400')}>All</button>
        {KINDS.map((k) => (
          <button key={k} onClick={() => setFilter(k)}
            className={cn('px-2 py-0.5 text-[11px] rounded capitalize', filter === k ? 'bg-cyan-600 text-white' : 'text-zinc-400')}>
            {k}{byKind[k] ? ` ${byKind[k]}` : ''}
          </button>
        ))}
      </div>

      {error && <p className="text-xs text-rose-400 mb-2">{error}</p>}

      {rows.length === 0 ? (
        <p className="text-xs text-zinc-400 italic">No specimens collected yet.</p>
      ) : (
        <ul className="space-y-1 max-h-72 overflow-y-auto">
          {rows.map((c) => (
            <li key={c.id} className="group bg-zinc-900/60 border border-zinc-800 rounded-lg px-3 py-1.5 flex items-center gap-2">
              <button onClick={() => toggle(c.id)} aria-label={c.identified ? 'Mark unidentified' : 'Mark identified'}
                className={c.identified ? 'text-emerald-400' : 'text-zinc-600'}>
                {c.identified ? <Check className="w-4 h-4" /> : <Circle className="w-4 h-4" />}
              </button>
              <span className={cn('text-[9px] px-1.5 py-0.5 rounded capitalize', KIND_COLOR[c.kind] || KIND_COLOR.mineral)}>{c.kind}</span>
              <span className="text-xs font-semibold text-zinc-100 flex-1 truncate">{c.name}</span>
              {c.count > 1 && <span className="text-[10px] text-zinc-400">×{c.count}</span>}
              {c.locality && <span className="text-[10px] text-zinc-400 truncate max-w-[8rem]">{c.locality}</span>}
              <button onClick={() => remove(c.id)} aria-label="Remove specimen"
                className="opacity-0 group-hover:opacity-100 text-rose-400">
                <Trash2 className="w-3 h-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
