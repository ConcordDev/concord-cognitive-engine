'use client';

/**
 * ProductivityFiltersPanel — saved smart lists. Build a query across
 * tasks (project, label, priority, due bucket, text search), preview
 * the matches live, save it as a reusable filter and re-run it later.
 * Backed by productivity.filter-* macros — no demo data.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Filter, Save, Play } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { ProductivityTaskRow, type ProdTask } from './ProductivityTaskRow';

interface SavedFilter {
  id: string;
  name: string;
  query: Record<string, unknown>;
  matchCount: number;
}
interface Project { id: string; name: string }

type DueBucket = '' | 'overdue' | 'today' | 'upcoming' | 'none';

export function ProductivityFiltersPanel({ onChange }: { onChange: () => void }) {
  const [filters, setFilters] = useState<SavedFilter[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<ProdTask[] | null>(null);
  const [activeName, setActiveName] = useState<string | null>(null);
  const [query, setQuery] = useState({ projectId: '', label: '', priority: '', due: '' as DueBucket, search: '' });
  const [filterName, setFilterName] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    const [f, p] = await Promise.all([
      lensRun('productivity', 'filter-list', {}),
      lensRun('productivity', 'project-list', {}),
    ]);
    setFilters(f.data?.result?.filters || []);
    setProjects((p.data?.result?.projects || []).map((x: { id: string; name: string }) => ({ id: x.id, name: x.name })));
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const buildQuery = () => ({
    projectId: query.projectId || undefined,
    label: query.label.trim() || undefined,
    priority: query.priority ? Number(query.priority) : undefined,
    due: query.due || undefined,
    search: query.search.trim() || undefined,
  });

  const runAdHoc = async () => {
    const r = await lensRun('productivity', 'filter-run', { query: buildQuery() });
    if (r.data?.ok && r.data.result) { setResults(r.data.result.tasks || []); setActiveName('Ad-hoc query'); }
    else setError(r.data?.error || 'Filter run failed.');
  };
  const save = async () => {
    if (!filterName.trim()) { setError('Filter name is required.'); return; }
    const r = await lensRun('productivity', 'filter-save', { name: filterName.trim(), query: buildQuery() });
    if (r.data?.ok === false) { setError(r.data?.error || 'Save failed.'); return; }
    setFilterName(''); setError(null);
    await refresh();
    onChange();
  };
  const runSaved = async (f: SavedFilter) => {
    const r = await lensRun('productivity', 'filter-run', { id: f.id });
    if (r.data?.ok && r.data.result) { setResults(r.data.result.tasks || []); setActiveName(f.name); }
  };
  const del = async (id: string) => {
    await lensRun('productivity', 'filter-delete', { id });
    await refresh();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-3">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      {/* Query builder */}
      <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-2">
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-zinc-400">
          <Filter className="w-3 h-3" /> Build a query
        </div>
        <div className="grid grid-cols-2 gap-2">
          <select value={query.projectId} onChange={(e) => setQuery({ ...query, projectId: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
            <option value="">Any project</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select value={query.priority} onChange={(e) => setQuery({ ...query, priority: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
            <option value="">Any priority</option>
            {[1, 2, 3, 4].map((p) => <option key={p} value={p}>Priority {p}</option>)}
          </select>
          <select value={query.due} onChange={(e) => setQuery({ ...query, due: e.target.value as DueBucket })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
            <option value="">Any due date</option>
            <option value="overdue">Overdue</option>
            <option value="today">Due today</option>
            <option value="upcoming">Upcoming</option>
            <option value="none">No due date</option>
          </select>
          <input placeholder="Label" value={query.label} onChange={(e) => setQuery({ ...query, label: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="Text search" value={query.search} onChange={(e) => setQuery({ ...query, search: e.target.value })}
            className="col-span-2 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={runAdHoc}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg">
            <Play className="w-3.5 h-3.5" /> Run
          </button>
          <input placeholder="Save as…" value={filterName} onChange={(e) => setFilterName(e.target.value)}
            className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-zinc-100" />
          <button type="button" onClick={save}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-red-600 hover:bg-red-500 text-white rounded-lg">
            <Save className="w-3.5 h-3.5" /> Save
          </button>
        </div>
      </div>

      {/* Saved filters */}
      {filters.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {filters.map((f) => (
            <span key={f.id} className="inline-flex items-center">
              <button type="button" onClick={() => runSaved(f)}
                className={cn('text-[11px] pl-2.5 pr-1.5 py-1 rounded-l-full border-y border-l',
                  activeName === f.name ? 'border-red-700/50 bg-red-950/40 text-red-300' : 'border-zinc-700 text-zinc-300 hover:text-zinc-100')}>
                {f.name} ({f.matchCount})
              </button>
              <button type="button" onClick={() => del(f.id)}
                className="text-[11px] px-1.5 py-1 rounded-r-full border-y border-r border-zinc-700 text-zinc-400 hover:text-rose-400">
                ✕
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Results */}
      {results !== null && (
        <div className="space-y-1">
          <p className="text-[11px] text-zinc-400">{activeName} — {results.length} task{results.length === 1 ? '' : 's'}</p>
          {results.length === 0 ? (
            <div className="text-center text-zinc-400 text-sm italic py-6 border border-zinc-800 rounded-xl">
              No tasks match this query.
            </div>
          ) : (
            <ul className="space-y-1">
              {results.map((t) => <ProductivityTaskRow key={t.id} task={t} onChange={() => { void runAdHoc(); onChange(); }} />)}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
