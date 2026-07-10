'use client';

/**
 * SavedSearchesPanel — surfaces the genesis lens's saved searches (the
 * genesis.search-* macros existed backend-side but had no UI caller for
 * search-list/search-delete's actual purpose — see fixes below). Save the
 * roster's CURRENT live filters (query + role + focus + activity state)
 * under a label, list them, re-run one (re-applies all four filters to the
 * live RosterExplorer), and delete.
 *
 * Two real bugs fixed here (2026-07-10 audit): (1) the stored shape from
 * `genesis.search-save` nests filters under `.filters.{query,role,state,focus}`
 * (server/domains/genesis.js) — this component previously read flat
 * `s.query`/`s.role` fields that never existed, so the query preview always
 * rendered blank; (2) `onRun` was declared but never passed a handler by
 * `app/lenses/genesis/page.tsx`, so clicking a saved search did nothing.
 */

import { useCallback, useEffect, useState } from 'react';
import { Search, Bookmark, Play, Trash2, Loader2, AlertTriangle } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import type { RosterFilters } from './RosterExplorer';

interface SavedSearchFilters { query?: string; role?: string; state?: string; focus?: string }
interface SavedSearch { id: string; label: string; filters?: SavedSearchFilters; createdAt?: number }

function filterSummary(f?: SavedSearchFilters): string {
  if (!f) return '';
  const parts: string[] = [];
  if (f.query) parts.push(`"${f.query}"`);
  if (f.role) parts.push(`role:${f.role}`);
  if (f.focus) parts.push(`focus:${f.focus}`);
  if (f.state && f.state !== 'all') parts.push(f.state);
  return parts.join(' · ');
}

export function SavedSearchesPanel({
  className,
  currentFilters,
  onRun,
}: {
  className?: string;
  /** The roster's live filter set, lifted from RosterExplorer via onFiltersChange — what "Save current filters" captures. */
  currentFilters?: RosterFilters;
  /** Called with the saved search's filters when the user clicks Run — apply them back to RosterExplorer. */
  onRun?: (filters: RosterFilters) => void;
}) {
  const [searches, setSearches] = useState<SavedSearch[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [label, setLabel] = useState('');
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

  const hasActiveFilters = Boolean(
    currentFilters && (currentFilters.query || currentFilters.role || currentFilters.focus || currentFilters.state !== 'all'),
  );

  const save = useCallback(async () => {
    if (!label.trim()) return;
    setSaving(true); setError(null);
    try {
      const r = await lensRun('genesis', 'search-save', {
        label: label.trim(),
        query: currentFilters?.query || '',
        role: currentFilters?.role || '',
        focus: currentFilters?.focus || '',
        state: currentFilters?.state || 'all',
      });
      if (r?.data?.error) setError(String(r.data.error));
      else { setLabel(''); await load(); }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save search');
    } finally { setSaving(false); }
  }, [label, currentFilters, load]);

  const remove = useCallback(async (id: string) => {
    setSearches((prev) => prev.filter((s) => s.id !== id));
    try { await lensRun('genesis', 'search-delete', { id }); } catch { void load(); }
  }, [load]);

  const run = useCallback((s: SavedSearch) => {
    onRun?.({
      query: s.filters?.query || '',
      role: s.filters?.role || '',
      focus: s.filters?.focus || '',
      state: (s.filters?.state as RosterFilters['state']) || 'all',
    });
  }, [onRun]);

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
        {searches.length === 0 && !loading && <p className="text-xs text-zinc-500">No saved searches yet — filter the roster below, then save it.</p>}
        {searches.map((s) => {
          const summary = filterSummary(s.filters);
          return (
            <div key={s.id} className="flex items-center gap-2 text-xs group">
              <button
                type="button"
                onClick={() => run(s)}
                disabled={!onRun}
                title={summary || 'no filters (all emergents)'}
                className="flex flex-1 items-center gap-1.5 truncate text-left font-medium text-violet-300 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Play className="h-3 w-3 flex-shrink-0" />
                {s.label}
              </button>
              {summary && <span className="truncate max-w-[10rem] font-mono text-zinc-500">{summary}</span>}
              <button type="button" onClick={() => void remove(s.id)} aria-label={`Delete saved search "${s.label}"`}
                className="opacity-0 group-hover:opacity-100 p-1 text-rose-300 hover:bg-rose-500/20 rounded"><Trash2 className="w-3 h-3" /></button>
            </div>
          );
        })}
      </div>

      <form onSubmit={(e) => { e.preventDefault(); void save(); }} className="flex flex-wrap items-center gap-2">
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label this search" maxLength={40}
          className="w-40 bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-100 focus:border-violet-500 focus:outline-none" />
        <span className="flex-1 min-w-[8rem] truncate text-[11px] text-zinc-500" title={filterSummary(currentFilters) || undefined}>
          {hasActiveFilters ? `Saves: ${filterSummary(currentFilters)}` : 'No active filters on the roster below'}
        </span>
        <button type="submit" disabled={saving || !label.trim() || !hasActiveFilters}
          title={!hasActiveFilters ? 'Set a filter on the roster below first' : undefined}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded bg-violet-500/20 border border-violet-500/40 text-violet-300 text-xs font-medium hover:bg-violet-500/30 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50">
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Bookmark className="w-3.5 h-3.5" />} Save current filters
        </button>
      </form>
    </div>
  );
}

export default SavedSearchesPanel;
