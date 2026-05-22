'use client';

/**
 * SavedViewsPanel — smart collections over the DTU corpus. Wired to the
 * persistent per-user `dtus.listViews` / `dtus.saveView` / `dtus.deleteView`
 * macros. Selecting a view re-applies its stored facet filter.
 */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { Bookmark, Trash2, Loader2, Plus } from 'lucide-react';
import type { DtuFilter } from './FacetedSearchPanel';

interface SavedView {
  id: string;
  name: string;
  filter: DtuFilter;
  createdAt: string;
}

function describeFilter(f: DtuFilter): string {
  const parts: string[] = [];
  if (f.query) parts.push(`"${f.query}"`);
  if (f.tiers?.length) parts.push(`tier:${f.tiers.join('/')}`);
  if (f.layers?.length) parts.push(`layer:${f.layers.join('/')}`);
  if (f.scopes?.length) parts.push(`scope:${f.scopes.join('/')}`);
  if (f.tags?.length) parts.push(`#${f.tags.join(' #')}`);
  if (f.minQuality) parts.push(`q≥${f.minQuality}`);
  return parts.length ? parts.join(' · ') : 'all DTUs';
}

export function SavedViewsPanel({
  pendingFilter,
  onClearPending,
  onApply,
}: {
  pendingFilter: DtuFilter | null;
  onClearPending: () => void;
  onApply: (filter: DtuFilter) => void;
}) {
  const [views, setViews] = useState<SavedView[]>([]);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const res = await lensRun<{ views: SavedView[] }>('dtus', 'listViews', {});
    setLoading(false);
    if (res.data.ok && res.data.result) setViews(res.data.result.views);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const save = useCallback(async () => {
    if (!name.trim() || !pendingFilter) return;
    setSaving(true);
    setError(null);
    const res = await lensRun('dtus', 'saveView', { name: name.trim(), filter: pendingFilter });
    setSaving(false);
    if (res.data.ok) {
      setName('');
      onClearPending();
      refresh();
    } else {
      setError(res.data.error || 'Save failed');
    }
  }, [name, pendingFilter, onClearPending, refresh]);

  const remove = useCallback(
    async (id: string) => {
      const res = await lensRun('dtus', 'deleteView', { viewId: id });
      if (res.data.ok) refresh();
    },
    [refresh],
  );

  return (
    <div className="space-y-3 rounded-xl border border-lattice-border bg-lattice-deep p-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <Bookmark className="h-4 w-4 text-neon-purple" /> Smart Collections
        {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-500" />}
      </h3>

      {pendingFilter && (
        <div className="space-y-2 rounded-lg border border-neon-purple/30 bg-neon-purple/5 p-2">
          <p className="text-[11px] text-gray-400">
            New collection from filter:{' '}
            <span className="text-neon-purple">{describeFilter(pendingFilter)}</span>
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Collection name…"
              className="flex-1 rounded border border-lattice-border bg-lattice-surface px-2 py-1 text-xs text-white placeholder-gray-500 focus:outline-none"
            />
            <button
              onClick={save}
              disabled={!name.trim() || saving}
              className="flex items-center gap-1 rounded bg-neon-purple/20 px-2 py-1 text-xs text-neon-purple hover:bg-neon-purple/30 disabled:opacity-40"
            >
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
              Save
            </button>
          </div>
          {error && <p className="text-[11px] text-red-400">{error}</p>}
        </div>
      )}

      {views.length === 0 ? (
        <p className="text-xs text-gray-600">
          No saved collections. Build a filter and save it to pin a view.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {views.map((v) => (
            <li
              key={v.id}
              className="flex items-center justify-between rounded-lg border border-lattice-border bg-lattice-surface px-2.5 py-1.5"
            >
              <button
                onClick={() => onApply(v.filter)}
                className="min-w-0 flex-1 text-left"
              >
                <p className="truncate text-xs font-medium text-white">{v.name}</p>
                <p className="truncate text-[10px] text-gray-500">{describeFilter(v.filter)}</p>
              </button>
              <button
                onClick={() => remove(v.id)}
                className="ml-2 text-gray-500 hover:text-red-400"
                aria-label={`Delete ${v.name}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
