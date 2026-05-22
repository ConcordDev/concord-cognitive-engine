'use client';

/**
 * ComponentMarket — cross-user marketplace of reusable component blocks.
 * Publish from a project's library, browse, and install into a project.
 * Backed by `app-maker` market.* + library.* macros.
 */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { Store, Download, Upload, Loader2, Trash2, Package } from 'lucide-react';

interface Listing {
  id: string; name: string; description: string; category: string;
  baseType: string; installs: number; publishedAt: string;
}
interface LibComponent { id: string; name: string; baseType: string }

export function ComponentMarket({
  projectId,
  onLibraryChanged,
}: {
  projectId: string | null;
  onLibraryChanged: () => void;
}) {
  const [listings, setListings] = useState<Listing[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [category, setCategory] = useState('all');
  const [q, setQ] = useState('');
  const [library, setLibrary] = useState<LibComponent[]>([]);
  const [busy, setBusy] = useState(false);
  const [publishId, setPublishId] = useState('');
  const [publishCat, setPublishCat] = useState('general');

  const browse = useCallback(async () => {
    const r = await lensRun('app-maker', 'marketBrowse', {
      category: category === 'all' ? undefined : category,
      q: q || undefined,
    });
    if (r.data?.ok) {
      setListings(r.data.result?.listings ?? []);
      setCategories(r.data.result?.categories ?? []);
    }
  }, [category, q]);

  const loadLibrary = useCallback(async () => {
    if (!projectId) { setLibrary([]); return; }
    const r = await lensRun('app-maker', 'libraryList', { projectId });
    if (r.data?.ok) setLibrary(r.data.result?.library ?? []);
  }, [projectId]);

  useEffect(() => { void browse(); }, [browse]);
  useEffect(() => { void loadLibrary(); }, [loadLibrary]);

  async function publish() {
    if (!projectId || !publishId) return;
    setBusy(true);
    const r = await lensRun('app-maker', 'marketPublish', {
      projectId, componentId: publishId, category: publishCat,
    });
    setBusy(false);
    if (r.data?.ok) { setPublishId(''); await browse(); }
  }

  async function install(listingId: string) {
    if (!projectId) return;
    const r = await lensRun('app-maker', 'marketInstall', { projectId, listingId });
    if (r.data?.ok) { await browse(); await loadLibrary(); onLibraryChanged(); }
  }

  async function unpublish(listingId: string) {
    const r = await lensRun('app-maker', 'marketUnpublish', { listingId });
    if (r.data?.ok) await browse();
  }

  return (
    <div className="grid gap-3 lg:grid-cols-[1fr_280px]">
      <div>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-pink-300">
            <Store className="h-4 w-4" /> Component marketplace
          </h3>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search…"
            className="rounded border border-pink-900/40 bg-black/40 px-2 py-1 text-[11px] text-pink-100"
          />
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="rounded border border-pink-900/40 bg-black/40 px-1.5 py-1 text-[11px] text-pink-100"
          >
            <option value="all">All categories</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {listings.map((l) => (
            <div key={l.id} className="rounded-lg border border-pink-900/30 bg-pink-950/10 p-2.5">
              <div className="flex items-center gap-1.5">
                <Package className="h-3.5 w-3.5 text-pink-400" />
                <span className="text-[12px] font-semibold text-pink-100">{l.name}</span>
                <span className="rounded bg-pink-900/40 px-1.5 py-0.5 text-[9px] text-pink-300">{l.category}</span>
              </div>
              {l.description && <p className="mt-1 text-[10px] text-pink-600">{l.description}</p>}
              <div className="mt-2 flex items-center gap-2 text-[10px]">
                <span className="text-pink-700">{l.baseType} · {l.installs} install{l.installs === 1 ? '' : 's'}</span>
                <button
                  onClick={() => install(l.id)}
                  disabled={!projectId}
                  className="ml-auto inline-flex items-center gap-1 rounded bg-pink-600 px-2 py-0.5 text-white hover:bg-pink-500 disabled:opacity-40"
                >
                  <Download className="h-2.5 w-2.5" /> Install
                </button>
                <button onClick={() => unpublish(l.id)} className="text-rose-400 hover:text-rose-300" title="Unpublish (publisher only)">
                  <Trash2 className="h-2.5 w-2.5" />
                </button>
              </div>
            </div>
          ))}
          {!listings.length && (
            <p className="col-span-full rounded border border-pink-900/30 bg-pink-950/10 px-4 py-6 text-center text-[11px] text-pink-700">
              No published components yet — publish one from your project library.
            </p>
          )}
        </div>
      </div>

      <aside className="rounded-lg border border-pink-900/40 bg-pink-950/10 p-2.5">
        <h4 className="mb-2 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-pink-500">
          <Upload className="h-3 w-3" /> Publish a component
        </h4>
        {!projectId && <p className="text-[11px] text-pink-700">Select a project to publish or install components.</p>}
        {projectId && (
          <div className="space-y-2">
            <select
              value={publishId}
              onChange={(e) => setPublishId(e.target.value)}
              className="w-full rounded border border-pink-900/40 bg-black/40 px-1.5 py-1 text-[11px] text-pink-100"
            >
              <option value="">Library component…</option>
              {library.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.baseType})</option>)}
            </select>
            <input
              value={publishCat}
              onChange={(e) => setPublishCat(e.target.value)}
              placeholder="Category"
              className="w-full rounded border border-pink-900/40 bg-black/40 px-1.5 py-1 text-[11px] text-pink-100"
            />
            <button
              onClick={publish}
              disabled={busy || !publishId}
              className="inline-flex w-full items-center justify-center gap-1 rounded bg-pink-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-pink-500 disabled:opacity-40"
            >
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />} Publish
            </button>
            {!library.length && <p className="text-[10px] text-pink-700">Project library is empty — save a styled element as a component first.</p>}
          </div>
        )}
      </aside>
    </div>
  );
}
