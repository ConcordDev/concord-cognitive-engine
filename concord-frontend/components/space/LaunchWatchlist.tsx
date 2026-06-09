'use client';

/**
 * LaunchWatchlist — Heavens-Above / Launch Library-shape launch
 * tracking: add upcoming launches to a watchlist, see a days-until
 * countdown, mark them watched. Wires the space.launch-* macros.
 */

import { useCallback, useEffect, useState } from 'react';
import { Rocket, Plus, Trash2, Check, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface WatchItem {
  id: string; name: string; provider: string; net: string | null;
  daysUntil: number | null; status: string; watched: boolean;
}

export function LaunchWatchlist() {
  const [items, setItems] = useState<WatchItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: '', provider: '', net: '' });

  const refresh = useCallback(async () => {
    const r = await lensRun('space', 'launch-watchlist', {});
    setItems((r.data?.result?.items as WatchItem[]) || []);
    setLoading(false);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  async function track() {
    if (!form.name.trim()) return;
    await lensRun('space', 'launch-track', {
      name: form.name.trim(), provider: form.provider.trim(), net: form.net,
    });
    setForm({ name: '', provider: '', net: '' });
    await refresh();
  }
  async function toggleWatched(id: string) {
    await lensRun('space', 'launch-mark-watched', { id });
    await refresh();
  }
  async function untrack(id: string) {
    await lensRun('space', 'launch-untrack', { id });
    await refresh();
  }

  if (loading) return <div className="flex items-center justify-center py-6 text-zinc-400"><Loader2 className="w-4 h-4 animate-spin" /></div>;

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Rocket className="w-4 h-4 text-indigo-400" />
        <h3 className="text-sm font-bold text-zinc-100">Launch Watchlist</h3>
        <span className="text-[11px] text-zinc-400">Heavens-Above shape</span>
      </div>

      <div className="flex flex-wrap gap-1.5 mb-3">
        <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Launch name"
          className="flex-1 min-w-[140px] bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200" />
        <input value={form.provider} onChange={e => setForm({ ...form, provider: e.target.value })} placeholder="Provider"
          className="w-28 bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200" />
        <input type="date" value={form.net} onChange={e => setForm({ ...form, net: e.target.value })}
          className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200" />
        <button onClick={track} disabled={!form.name.trim()}
          className="px-2.5 py-1.5 text-xs rounded bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-40 inline-flex items-center gap-1">
          <Plus className="w-3 h-3" />Track
        </button>
      </div>

      {items.length === 0 ? (
        <p className="text-xs text-zinc-400 italic">No tracked launches — add one above.</p>
      ) : (
        <ul className="space-y-1">
          {items.map(i => (
            <li key={i.id} className="group flex items-center gap-2 bg-zinc-900/60 border border-zinc-800 rounded-lg px-3 py-2">
              <button aria-label="Confirm" onClick={() => toggleWatched(i.id)}
                className={cn('w-5 h-5 rounded-full flex items-center justify-center shrink-0',
                  i.watched ? 'bg-emerald-600 text-white' : 'border border-zinc-600 text-transparent hover:border-emerald-500')}>
                <Check className="w-3 h-3" />
              </button>
              <div className="min-w-0 flex-1">
                <p className={cn('text-xs font-semibold truncate', i.watched ? 'text-zinc-400 line-through' : 'text-zinc-100')}>{i.name}</p>
                <p className="text-[10px] text-zinc-400">{i.provider}{i.net ? ` · ${i.net}` : ''}</p>
              </div>
              <span className={cn('text-[10px] px-1.5 py-0.5 rounded shrink-0',
                i.status === 'today' ? 'bg-amber-900/50 text-amber-300'
                : i.status === 'upcoming' ? 'bg-indigo-900/50 text-indigo-300'
                : i.status === 'launched' ? 'bg-zinc-800 text-zinc-400' : 'bg-zinc-800 text-zinc-400')}>
                {i.daysUntil == null ? 'TBD' : i.status === 'launched' ? 'launched' : i.status === 'today' ? 'today' : `T-${i.daysUntil}d`}
              </span>
              <button aria-label="Delete" onClick={() => untrack(i.id)} className="opacity-0 group-hover:opacity-100 text-rose-400"><Trash2 className="w-3 h-3" /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
