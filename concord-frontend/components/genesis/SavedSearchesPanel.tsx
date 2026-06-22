'use client';

/**
 * SavedSearchesPanel — surfaces the genesis lens's saved searches (the
 * genesis.search-* macros existed backend-side but had no UI). Save a labelled
 * search (query + optional role/state/focus filters), list, delete, and re-run.
 */

import { useCallback, useEffect, useState } from 'react';
import { Search, Plus, Trash2, Loader2, AlertTriangle } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface SavedSearch { id: string; label: string; query?: string; role?: string; state?: string; focus?: string }

export function SavedSearchesPanel({ className, onRun }: { className?: string; onRun?: (s: SavedSearch) => void }) {
  const [searches, setSearches] = useState<SavedSearch[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [label, setLabel] = useState('');
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await lensRun('genesis', 'search-list', {});
      const list = (r?.data?.result?.searches || []) as SavedSearch[];
      setSearches(Array.isArray(list) ? list : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load saved searches');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const save = useCallback(async () => {
    if (!label.trim()) return;
    setSaving(true); setError(null);
    try {
      const r = await lensRun('genesis', 'search-save', { label: label.trim(), query: query.trim() });
      if (r?.data?.error) setError(String(r.data.error));
      else { setLabel(''); setQuery(''); await load(); }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save search');
    } finally { setSaving(false); }
  }, [label, query, load]);

  const remove = useCallback(async (id: string) => {
    setSearches((prev) => prev.filter((s) => s.id !== id));
    try { await lensRun('genesis', 'search-delete', { id }); } catch { void load(); }
  }, [load]);

  return (
    <div className={cn('rounded-xl border border-zinc-800 bg-zinc-950/40 p-4', className)}>
      <div className="flex items-center gap-2 mb-3">
        <Search className="w-4 h-4 text-violet-400" />
        <h3 className="text-sm font-semibold text-zinc-100">Saved searches</h3>
        {loading && <Loader2 className="w-3.5 h-3.5 animate-spin text-zinc-500" />}
      </div>

      {error && (
        <div className="mb-3 flex items-center gap-2 text-xs text-rose-300">
          <AlertTriangle className="w-3.5 h-3.5" /> {error}
        </div>
      )}

      <div className="space-y-1.5 mb-3">
        {searches.length === 0 && !loading && <p className="text-xs text-zinc-500">No saved searches yet.</p>}
        {searches.map((s) => (
          <div key={s.id} className="flex items-center gap-2 text-xs group">
            <button type="button" onClick={() => onRun?.(s)} className="text-violet-300 font-medium hover:underline text-left flex-1 truncate" title={s.query || ''}>
              {s.label}
            </button>
            {s.query && <span className="text-zinc-500 font-mono truncate max-w-[10rem]">{s.query}</span>}
            <button type="button" onClick={() => void remove(s.id)} aria-label="Delete saved search"
              className="opacity-0 group-hover:opacity-100 p-1 text-rose-300 hover:bg-rose-500/20 rounded"><Trash2 className="w-3 h-3" /></button>
          </div>
        ))}
      </div>

      <form onSubmit={(e) => { e.preventDefault(); void save(); }} className="flex flex-wrap items-center gap-2">
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label" maxLength={40}
          className="w-28 bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-100 focus:border-violet-500 focus:outline-none" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Query / filters" maxLength={120}
          className="flex-1 min-w-[8rem] bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-100 focus:outline-none" />
        <button type="submit" disabled={saving || !label.trim()}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded bg-violet-500/20 border border-violet-500/40 text-violet-300 text-xs font-medium hover:bg-violet-500/30 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50">
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Save
        </button>
      </form>
    </div>
  );
}

export default SavedSearchesPanel;
