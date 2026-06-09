'use client';

/**
 * PaperLibrary — Semantic Scholar / Zotero-shape reading library:
 * save papers, track reading status, rate, take notes and organise
 * into collections. Wires the paper.paper-* and paper.collection-*
 * macros.
 */

import { useCallback, useEffect, useState } from 'react';
import { Library, Plus, Trash2, Loader2, Star } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Paper {
  id: string; title: string; authors: string[]; year: number | null; venue: string | null;
  abstract: string; status: string; rating: number | null; tags: string[]; notes: string; collectionIds: string[];
}
interface CollectionMeta { id: string; name: string; paperCount: number }
interface Dash { totalPapers: number; toRead: number; reading: number; read: number; collections: number }

const STATUS = [
  { id: 'to_read', label: 'To read', cls: 'bg-zinc-700 text-zinc-200' },
  { id: 'reading', label: 'Reading', cls: 'bg-amber-700 text-amber-100' },
  { id: 'read', label: 'Read', cls: 'bg-emerald-700 text-emerald-100' },
];

export function PaperLibrary() {
  const [papers, setPapers] = useState<Paper[]>([]);
  const [collections, setCollections] = useState<CollectionMeta[]>([]);
  const [dash, setDash] = useState<Dash | null>(null);
  const [filter, setFilter] = useState('');
  const [active, setActive] = useState<Paper | null>(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ title: '', authors: '', year: '', venue: '' });
  const [newCollection, setNewCollection] = useState('');

  const refresh = useCallback(async () => {
    const [pl, cl, d] = await Promise.all([
      lensRun('paper', 'paper-list', filter ? { status: filter } : {}),
      lensRun('paper', 'collection-list', {}),
      lensRun('paper', 'library-dashboard', {}),
    ]);
    setPapers((pl.data?.result?.papers as Paper[]) || []);
    setCollections((cl.data?.result?.collections as CollectionMeta[]) || []);
    setDash((d.data?.result as Dash) || null);
    setLoading(false);
  }, [filter]);
  useEffect(() => { void refresh(); }, [refresh]);

  async function save() {
    if (!form.title.trim()) return;
    await lensRun('paper', 'paper-save', {
      title: form.title.trim(),
      authors: form.authors.split(',').map(a => a.trim()).filter(Boolean),
      year: form.year ? Number(form.year) : undefined,
      venue: form.venue.trim(),
    });
    setForm({ title: '', authors: '', year: '', venue: '' });
    await refresh();
  }
  async function update(id: string, patch: Record<string, unknown>) {
    const r = await lensRun('paper', 'paper-update', { id, ...patch });
    if (r.data?.ok && active?.id === id) setActive(r.data.result?.paper as Paper);
    await refresh();
  }
  async function del(id: string) {
    await lensRun('paper', 'paper-delete', { id });
    if (active?.id === id) setActive(null);
    await refresh();
  }
  async function addCollection() {
    if (!newCollection.trim()) return;
    await lensRun('paper', 'collection-create', { name: newCollection.trim() });
    setNewCollection('');
    await refresh();
  }

  if (loading) return <div className="flex items-center justify-center py-6 text-zinc-400"><Loader2 className="w-4 h-4 animate-spin" /></div>;

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
      <div className="flex items-center gap-2 mb-3">
        <Library className="w-4 h-4 text-cyan-400" />
        <h3 className="text-sm font-bold text-zinc-100">Paper Library</h3>
        <span className="text-[11px] text-zinc-400">Zotero shape</span>
      </div>

      {dash && (
        <div className="grid grid-cols-4 gap-2 mb-3">
          {([['Papers', dash.totalPapers], ['To read', dash.toRead], ['Reading', dash.reading], ['Read', dash.read]] as const).map(([l, v]) => (
            <div key={l} className="bg-zinc-900/60 border border-zinc-800 rounded-lg px-2 py-1.5 text-center">
              <p className="text-sm font-bold text-zinc-100">{v}</p>
              <p className="text-[9px] text-zinc-400 uppercase tracking-wide">{l}</p>
            </div>
          ))}
        </div>
      )}

      {/* Add paper */}
      <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-2.5 mb-3 flex flex-wrap gap-1.5">
        <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Paper title"
          className="flex-1 min-w-[160px] bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
        <input value={form.authors} onChange={e => setForm({ ...form, authors: e.target.value })} placeholder="authors (comma sep)"
          className="w-36 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
        <input value={form.year} onChange={e => setForm({ ...form, year: e.target.value })} placeholder="year"
          className="w-16 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
        <button onClick={save} disabled={!form.title.trim()}
          className="px-2.5 py-1 text-xs rounded bg-cyan-600 hover:bg-cyan-500 text-white font-semibold disabled:opacity-40 inline-flex items-center gap-1">
          <Plus className="w-3 h-3" />Save
        </button>
      </div>

      {/* Status filter */}
      <div className="flex gap-1 mb-2">
        <button onClick={() => setFilter('')} className={cn('px-2 py-0.5 text-[11px] rounded', !filter ? 'bg-cyan-600 text-white' : 'text-zinc-400')}>All</button>
        {STATUS.map(s => (
          <button key={s.id} onClick={() => setFilter(s.id)} className={cn('px-2 py-0.5 text-[11px] rounded', filter === s.id ? 'bg-cyan-600 text-white' : 'text-zinc-400')}>{s.label}</button>
        ))}
        <div className="ml-auto flex gap-1">
          <input value={newCollection} onChange={e => setNewCollection(e.target.value)} placeholder="+ collection"
            className="w-28 bg-zinc-950 border border-zinc-800 rounded px-2 py-0.5 text-[11px] text-zinc-200" />
          <button aria-label="Add" onClick={addCollection} className="text-zinc-400 hover:text-cyan-300"><Plus className="w-3.5 h-3.5" /></button>
        </div>
      </div>

      <ul className="space-y-1">
        {papers.length === 0 && <li className="text-xs text-zinc-400 italic py-4 text-center">No papers — save one above or from arXiv search.</li>}
        {papers.map(p => (
          <li key={p.id} className="group bg-zinc-900/60 border border-zinc-800 rounded-lg px-3 py-2">
            <div className="flex items-center gap-2">
              <button onClick={() => setActive(active?.id === p.id ? null : p)} className="text-left min-w-0 flex-1">
                <p className="text-xs font-semibold text-zinc-100 truncate">{p.title}</p>
                <p className="text-[10px] text-zinc-400 truncate">{p.authors.join(', ') || 'Unknown'}{p.year ? ` · ${p.year}` : ''}{p.venue ? ` · ${p.venue}` : ''}</p>
              </button>
              <select value={p.status} onChange={e => update(p.id, { status: e.target.value })}
                className={cn('text-[10px] rounded px-1.5 py-0.5 border-0', STATUS.find(s => s.id === p.status)?.cls)}>
                {STATUS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
              <div className="flex">
                {[1, 2, 3, 4, 5].map(n => (
                  <button key={n} onClick={() => update(p.id, { rating: n })}>
                    <Star className={cn('w-3 h-3', (p.rating || 0) >= n ? 'text-amber-400' : 'text-zinc-700')} fill={(p.rating || 0) >= n ? 'currentColor' : 'none'} />
                  </button>
                ))}
              </div>
              <button aria-label="Delete" onClick={() => del(p.id)} className="opacity-0 group-hover:opacity-100 text-rose-400"><Trash2 className="w-3 h-3" /></button>
            </div>
            {active?.id === p.id && (
              <div className="mt-2 pt-2 border-t border-zinc-800">
                {p.abstract && <p className="text-[11px] text-zinc-400 mb-1">{p.abstract}</p>}
                <textarea defaultValue={p.notes} rows={2} placeholder="Your notes…"
                  onBlur={e => { if (e.target.value !== p.notes) void update(p.id, { notes: e.target.value }); }}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-[11px] text-zinc-200" />
              </div>
            )}
          </li>
        ))}
      </ul>
      {collections.length > 0 && (
        <p className="text-[10px] text-zinc-400 mt-2">{collections.length} collection{collections.length === 1 ? '' : 's'}: {collections.map(c => `${c.name} (${c.paperCount})`).join(' · ')}</p>
      )}
    </div>
  );
}
