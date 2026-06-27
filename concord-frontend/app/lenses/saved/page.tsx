'use client';

/**
 * /lenses/saved — cross-lens saved-items surface (parity vs X Bookmarks + Pocket).
 *
 * Saves anything (social posts, DTUs, articles, lens artifacts, links),
 * organises into folders/collections, freeform tags, search + sort +
 * filter, read-later / archive states, and full-list export. Every value
 * rendered comes from a real saved.* macro — no fake data.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bookmark, Search, Download, ArrowDownUp, RefreshCw,
} from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { BookmarksList } from '@/components/social/BookmarksList';
import { FoldersSidebar } from '@/components/saved/FoldersSidebar';
import { SaveItemForm } from '@/components/saved/SaveItemForm';
import { SavedItemCard } from '@/components/saved/SavedItemCard';
import type {
  SavedItem, SavedFolder, SavedStats, TagCount, SavedListResult,
} from '@/components/saved/types';
import { api, lensRun } from '@/lib/api/client';
import Link from 'next/link';

interface MeResponse { ok: boolean; user?: { id: string; username?: string }; }

const KIND_FILTERS = ['all', 'post', 'dtu', 'article', 'artifact', 'link', 'other'];
const STATE_FILTERS = ['all', 'unread', 'read', 'archived'];
const SORT_OPTIONS: { value: string; label: string }[] = [
  { value: 'savedAt', label: 'Date saved' },
  { value: 'updatedAt', label: 'Last updated' },
  { value: 'title', label: 'Title' },
  { value: 'author', label: 'Author' },
];

export default function SavedLensPage() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [items, setItems] = useState<SavedItem[]>([]);
  const [folders, setFolders] = useState<SavedFolder[]>([]);
  const [unfiledCount, setUnfiledCount] = useState(0);
  const [stats, setStats] = useState<SavedStats | null>(null);
  const [tags, setTags] = useState<TagCount[]>([]);
  const [matched, setMatched] = useState(0);
  const [total, setTotal] = useState(0);

  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('all');
  const [stateFilter, setStateFilter] = useState('all');
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [activeFolder, setActiveFolder] = useState<string | null | undefined>(undefined);
  const [sortBy, setSortBy] = useState('savedAt');
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showBookmarks, setShowBookmarks] = useState(false);
  const [notice, setNotice] = useState('');

  const loadFolders = useCallback(async () => {
    const r = await lensRun<{ folders: SavedFolder[]; unfiledCount: number }>(
      'saved', 'folderList', {});
    if (r.data.ok && r.data.result) {
      setFolders(r.data.result.folders || []);
      setUnfiledCount(r.data.result.unfiledCount || 0);
    }
  }, []);

  const loadStats = useCallback(async () => {
    const r = await lensRun<SavedStats>('saved', 'stats', {});
    if (r.data.ok && r.data.result) setStats(r.data.result);
    const t = await lensRun<{ tags: TagCount[] }>('saved', 'tags', {});
    if (t.data.ok && t.data.result) setTags(t.data.result.tags || []);
  }, []);

  const loadItems = useCallback(async () => {
    setLoading(true);
    const input: Record<string, unknown> = { sortBy, order, limit: 200 };
    if (query.trim()) input.query = query.trim();
    if (kind !== 'all') input.kind = kind;
    if (stateFilter !== 'all') input.state = stateFilter;
    if (activeTag) input.tag = activeTag;
    if (activeFolder === null) input.folderId = '__none__';
    else if (typeof activeFolder === 'string') input.folderId = activeFolder;
    const r = await lensRun<SavedListResult>('saved', 'list', input);
    if (r.data.ok && r.data.result) {
      setItems(r.data.result.items || []);
      setMatched(r.data.result.matched || 0);
      setTotal(r.data.result.total || 0);
      setError(null);
    } else {
      setError(r.data.error || 'Could not load your saved items.');
    }
    setLoading(false);
  }, [query, kind, stateFilter, activeTag, activeFolder, sortBy, order]);

  // Initial load.
  useEffect(() => {
    (async () => {
      try {
        const r = await api.get<MeResponse>('/api/auth/me');
        setMe(r?.data ?? null);
      } catch { setMe(null); }
      await loadFolders();
      await loadStats();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-list whenever a filter changes.
  useEffect(() => { loadItems(); }, [loadItems]);

  const refreshAll = useCallback(async () => {
    await Promise.all([loadItems(), loadFolders(), loadStats()]);
  }, [loadItems, loadFolders, loadStats]);

  const flash = useCallback((msg: string) => {
    setNotice(msg);
    window.setTimeout(() => setNotice(''), 2600);
  }, []);

  // -------- item mutations --------
  const handleSave = useCallback(async (payload: Record<string, unknown>) => {
    const r = await lensRun<{ deduped: boolean }>('saved', 'add', payload);
    if (r.data.ok) {
      flash(r.data.result?.deduped ? 'Already saved' : 'Saved');
      await refreshAll();
    } else {
      flash(r.data.error || 'Save failed');
    }
  }, [flash, refreshAll]);

  const handleRemove = useCallback(async (id: string) => {
    const r = await lensRun('saved', 'remove', { id });
    if (r.data.ok) { flash('Removed'); await refreshAll(); }
  }, [flash, refreshAll]);

  const handleUpdate = useCallback(async (id: string, patch: Record<string, unknown>) => {
    const r = await lensRun('saved', 'update', { id, ...patch });
    if (r.data.ok) await refreshAll();
  }, [refreshAll]);

  // -------- folder mutations --------
  const handleFolderCreate = useCallback(async (name: string) => {
    const r = await lensRun('saved', 'folderCreate', { name });
    if (r.data.ok) { flash('Collection created'); await loadFolders(); await loadStats(); }
    else flash(r.data.error || 'Create failed');
  }, [flash, loadFolders, loadStats]);

  const handleFolderRename = useCallback(async (id: string, name: string) => {
    const r = await lensRun('saved', 'folderUpdate', { id, name });
    if (r.data.ok) await loadFolders();
  }, [loadFolders]);

  const handleFolderDelete = useCallback(async (id: string) => {
    const r = await lensRun('saved', 'folderDelete', { id });
    if (r.data.ok) {
      if (activeFolder === id) setActiveFolder(undefined);
      flash('Collection deleted');
      await refreshAll();
    }
  }, [activeFolder, flash, refreshAll]);

  // -------- export --------
  const handleExport = useCallback(async (format: 'json' | 'csv') => {
    const r = await lensRun<{ content: string; filename: string; count: number }>(
      'saved', 'export', { format });
    if (!r.data.ok || !r.data.result) { flash('Export failed'); return; }
    const { content, filename } = r.data.result;
    const blob = new Blob([content], {
      type: format === 'csv' ? 'text/csv' : 'application/json',
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
    flash(`Exported ${r.data.result.count} items`);
  }, [flash]);

  const filtersActive = useMemo(
    () => Boolean(query.trim()) || kind !== 'all' || stateFilter !== 'all'
      || activeTag !== null || activeFolder !== undefined,
    [query, kind, stateFilter, activeTag, activeFolder],
  );

  return (
    <LensShell lensId="saved" asMain={false}>
      <FirstRunTour lensId="saved" />
      <ManifestActionBar />
      <DepthBadge lensId="saved" size="sm" className="ml-2" />

      <div className="min-h-screen bg-lattice-void text-zinc-100">
        <header className="border-b border-zinc-800 bg-zinc-950/70">
          <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-2 flex-wrap">
            <Bookmark className="w-5 h-5 text-amber-300" />
            <h1 className="text-base font-semibold">Saved</h1>
            {stats && (
              <span className="text-[10px] text-zinc-400 font-mono">
                {stats.total ?? 0} items · {stats.byState?.unread || 0} to read · {stats.folders ?? 0} collections
              </span>
            )}
            <div className="ml-auto flex items-center gap-3">
              <button
                type="button"
                onClick={() => handleExport('json')}
                className="text-xs text-zinc-400 hover:text-amber-300 inline-flex items-center gap-1"
              >
                <Download className="w-3.5 h-3.5" /> JSON
              </button>
              <button
                type="button"
                onClick={() => handleExport('csv')}
                className="text-xs text-zinc-400 hover:text-amber-300 inline-flex items-center gap-1"
              >
                <Download className="w-3.5 h-3.5" /> CSV
              </button>
              <Link href="/lenses/social" className="text-xs text-indigo-400 hover:underline">
                ← Social
              </Link>
            </div>
          </div>
        </header>

        <main className="max-w-6xl mx-auto px-4 py-4 grid grid-cols-1 lg:grid-cols-[200px_1fr] gap-5">
          {/* Collections rail */}
          <div className="space-y-4">
            <FoldersSidebar
              folders={folders}
              unfiledCount={unfiledCount}
              totalCount={stats?.total ?? total}
              activeFolderId={activeFolder}
              onSelect={setActiveFolder}
              onCreate={handleFolderCreate}
              onRename={handleFolderRename}
              onDelete={handleFolderDelete}
            />

            {tags.length > 0 && (
              <div>
                <h2 className="text-[11px] uppercase tracking-wide text-zinc-400 mb-1">Tags</h2>
                <ul className="flex flex-wrap gap-1">
                  {tags.map((t) => (
                    <li key={t.tag}>
                      <button
                        type="button"
                        onClick={() => setActiveTag(activeTag === t.tag ? null : t.tag)}
                        className={`text-[10px] px-1.5 py-0.5 rounded border ${
                          activeTag === t.tag
                            ? 'bg-amber-500/25 text-amber-100 border-amber-500/50'
                            : 'bg-amber-500/10 text-amber-300 border-amber-500/30 hover:bg-amber-500/20'
                        }`}
                      >
                        #{t.tag} <span className="text-zinc-400">{t.count}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Items column */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <SaveItemForm folders={folders} onSave={handleSave} />
              <button
                type="button"
                onClick={refreshAll}
                className="inline-flex items-center gap-1 text-xs px-2 py-1.5 rounded border border-zinc-700 text-zinc-400 hover:text-amber-300"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
              </button>
              {notice && <span className="text-xs text-emerald-300">{notice}</span>}
            </div>

            {/* Search + sort + filter bar */}
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2 space-y-2">
              <div className="flex items-center gap-2">
                <Search className="w-4 h-4 text-zinc-400 shrink-0" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search saved items by text, author, tag…"
                  className="flex-1 text-xs bg-transparent text-zinc-100 outline-none"
                />
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <select
                  value={kind}
                  onChange={(e) => setKind(e.target.value)}
                  aria-label="Filter by kind"
                  className="text-[11px] bg-zinc-950 border border-zinc-700 rounded px-1.5 py-1 text-zinc-300"
                >
                  {KIND_FILTERS.map((k) => (
                    <option key={k} value={k}>{k === 'all' ? 'All kinds' : k}</option>
                  ))}
                </select>
                <select
                  value={stateFilter}
                  onChange={(e) => setStateFilter(e.target.value)}
                  aria-label="Filter by state"
                  className="text-[11px] bg-zinc-950 border border-zinc-700 rounded px-1.5 py-1 text-zinc-300"
                >
                  {STATE_FILTERS.map((s) => (
                    <option key={s} value={s}>{s === 'all' ? 'Any state' : s}</option>
                  ))}
                </select>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                  aria-label="Sort by"
                  className="text-[11px] bg-zinc-950 border border-zinc-700 rounded px-1.5 py-1 text-zinc-300"
                >
                  {SORT_OPTIONS.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setOrder(order === 'desc' ? 'asc' : 'desc')}
                  aria-label="Toggle sort order"
                  className="inline-flex items-center gap-1 text-[11px] px-1.5 py-1 rounded border border-zinc-700 text-zinc-300 hover:border-amber-500/40"
                >
                  <ArrowDownUp className="w-3 h-3" /> {order === 'desc' ? 'Newest' : 'Oldest'}
                </button>
                {filtersActive && (
                  <button
                    type="button"
                    onClick={() => {
                      setQuery(''); setKind('all'); setStateFilter('all');
                      setActiveTag(null); setActiveFolder(undefined);
                    }}
                    className="text-[11px] text-rose-300 hover:underline"
                  >
                    Clear filters
                  </button>
                )}
                <span className="text-[10px] text-zinc-400 ml-auto">
                  {matched} of {total} shown
                </span>
              </div>
            </div>

            {/* Item list — four UX states: error / loading / empty / populated */}
            {error ? (
              <div
                data-testid="saved-error"
                role="alert"
                className="rounded-lg border border-rose-700/50 bg-rose-950/30 py-8 px-4 text-center"
              >
                <p className="text-sm text-rose-200">Couldn&apos;t load your saved items.</p>
                <p className="text-xs text-rose-300/80 mt-1 font-mono">{error}</p>
                <button
                  type="button"
                  onClick={() => loadItems()}
                  className="mt-3 inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded border border-rose-600/50 text-rose-200 hover:bg-rose-900/40"
                >
                  <RefreshCw className="w-3.5 h-3.5" /> Retry
                </button>
              </div>
            ) : loading && items.length === 0 ? (
              <p
                data-testid="saved-loading"
                role="status"
                aria-busy="true"
                aria-live="polite"
                className="text-xs text-zinc-400 py-8 text-center"
              >
                Loading your saved items…
              </p>
            ) : items.length === 0 ? (
              <div
                data-testid="saved-empty"
                className="rounded-lg border border-dashed border-zinc-800 bg-zinc-950/40 py-10 text-center"
              >
                <Bookmark className="w-7 h-7 mx-auto text-zinc-700 mb-2" />
                <p className="text-sm text-zinc-400">
                  {filtersActive ? 'No saved items match your filters.' : 'Nothing saved yet.'}
                </p>
                <p className="text-xs text-zinc-400 mt-1">
                  {filtersActive
                    ? 'Try clearing filters.'
                    : 'Bookmark posts, DTUs, articles, links — anything — to see it here.'}
                </p>
              </div>
            ) : (
              <ul data-testid="saved-list" className="space-y-2">
                {items.map((it) => (
                  <li key={it.id}>
                    <SavedItemCard
                      item={it}
                      folders={folders}
                      onRemove={handleRemove}
                      onUpdate={handleUpdate}
                    />
                  </li>
                ))}
              </ul>
            )}

            {/* Legacy social bookmarks — still surfaced for posts saved via BookmarkButton. */}
            <div className="pt-2">
              <button
                type="button"
                onClick={() => setShowBookmarks((v) => !v)}
                className="text-xs text-zinc-400 hover:text-amber-300"
              >
                {showBookmarks ? '▾' : '▸'} Social posts bookmarked via the post button
              </button>
              {showBookmarks && (
                <div className="mt-2">
                  <BookmarksList currentUserId={me?.user?.id} />
                </div>
              )}
            </div>

            <CrossLensRecentsPanel lensId="saved" sinceDays={30} limit={6} hideWhenEmpty />
          </div>
        </main>
      </div>
    </LensShell>
  );
}
