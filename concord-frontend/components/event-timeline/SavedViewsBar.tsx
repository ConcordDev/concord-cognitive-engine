'use client';

/**
 * SavedViewsBar — per-user filter presets for the event-timeline lens.
 * Backed by event_timeline.saveView / listViews / deleteView. A view
 * captures the channel filter, worldId, and search query so an operator
 * can flip between "combat-only", "errors", etc. with one click.
 */

import { useCallback, useEffect, useState } from 'react';
import { Bookmark, Plus, X, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

export interface TimelineFilterState {
  channels: string[];
  worldId: string;
  query: string;
}

interface SavedView {
  id: string;
  name: string;
  channels: string[];
  worldId: string | null;
  query: string;
  createdAt: number;
}

interface ListViewsResult {
  ok: boolean;
  views?: SavedView[];
}

export function SavedViewsBar({
  current,
  onApply,
}: {
  current: TimelineFilterState;
  onApply: (filter: TimelineFilterState) => void;
}) {
  const [views, setViews] = useState<SavedView[]>([]);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const r = await lensRun<ListViewsResult>('event_timeline', 'listViews', {});
    if (r.data?.result?.ok && Array.isArray(r.data.result.views)) {
      setViews(r.data.result.views);
    }
  }, []);

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    const r = await lensRun('event_timeline', 'saveView', {
      name: trimmed,
      channels: current.channels,
      worldId: current.worldId || null,
      query: current.query,
    });
    setBusy(false);
    if (r.data?.result?.ok) {
      setName('');
      setNaming(false);
      await refresh();
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    await lensRun('event_timeline', 'deleteView', { id });
    setBusy(false);
    await refresh();
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="flex items-center gap-1 text-[11px] font-medium text-zinc-500">
        <Bookmark className="h-3 w-3" /> Views
      </span>

      {views.map((v) => (
        <span
          key={v.id}
          className="group flex items-center gap-1 rounded-full bg-zinc-800 px-2.5 py-1 text-xs text-zinc-200 ring-1 ring-zinc-700"
        >
          <button
            onClick={() =>
              onApply({
                channels: v.channels || [],
                worldId: v.worldId || '',
                query: v.query || '',
              })
            }
            className="hover:text-white"
            title={`Apply "${v.name}" filter`}
          >
            {v.name}
          </button>
          <button
            onClick={() => remove(v.id)}
            className="text-zinc-600 hover:text-red-400"
            aria-label={`Delete view ${v.name}`}
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}

      {naming ? (
        <span className="flex items-center gap-1">
          <input
            autoFocus
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') save();
              if (e.key === 'Escape') { setNaming(false); setName(''); }
            }}
            placeholder="view name…"
            maxLength={60}
            className="w-32 rounded bg-zinc-900 px-2 py-1 text-xs text-zinc-200 ring-1 ring-zinc-700 focus:outline-none focus:ring-zinc-500"
          />
          <button
            onClick={save}
            disabled={busy || !name.trim()}
            className="rounded bg-indigo-600 px-2 py-1 text-xs text-white disabled:opacity-40"
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Save'}
          </button>
        </span>
      ) : (
        <button
          onClick={() => setNaming(true)}
          className="flex items-center gap-1 rounded-full px-2.5 py-1 text-xs text-zinc-500 ring-1 ring-zinc-800 hover:text-zinc-200 hover:ring-zinc-600"
          title="Save current filter as a view"
        >
          <Plus className="h-3 w-3" /> Save view
        </button>
      )}
    </div>
  );
}
