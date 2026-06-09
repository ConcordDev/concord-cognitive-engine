'use client';

/**
 * YelpCollectionsPanel — curated restaurant lists. Create collections
 * and add directory businesses to them.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Bookmark, Trash2, ChevronRight } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Collection { id: string; name: string; description: string | null; bizCount: number }
interface Business { id: string; name: string; cuisine: string; rating: number }

export function YelpCollectionsPanel() {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [allBiz, setAllBiz] = useState<Business[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [openBiz, setOpenBiz] = useState<Business[]>([]);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [c, b] = await Promise.all([
      lensRun('food', 'collection-list', {}),
      lensRun('food', 'biz-list', {}),
    ]);
    setCollections(c.data?.result?.collections || []);
    setAllBiz(b.data?.result?.businesses || []);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const create = async () => {
    if (!name.trim()) { setError('Collection name is required.'); return; }
    const r = await lensRun('food', 'collection-create', { name: name.trim() });
    if (r.data?.ok === false) { setError(r.data?.error || 'Could not create'); return; }
    setName('');
    setError(null);
    await refresh();
  };

  const openCollection = async (id: string) => {
    if (open === id) { setOpen(null); return; }
    setOpen(id);
    const r = await lensRun('food', 'collection-detail', { id });
    setOpenBiz(r.data?.ok === false ? [] : (r.data?.result?.businesses || []));
  };

  const addBiz = async (collectionId: string, bizId: string) => {
    await lensRun('food', 'collection-add-biz', { collectionId, bizId });
    const r = await lensRun('food', 'collection-detail', { id: collectionId });
    setOpenBiz(r.data?.result?.businesses || []);
    await refresh();
  };
  const removeBiz = async (collectionId: string, bizId: string) => {
    await lensRun('food', 'collection-add-biz', { collectionId, bizId, remove: true });
    const r = await lensRun('food', 'collection-detail', { id: collectionId });
    setOpenBiz(r.data?.result?.businesses || []);
    await refresh();
  };
  const del = async (id: string) => {
    await lensRun('food', 'collection-delete', { id });
    if (open === id) setOpen(null);
    await refresh();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-12 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New list — e.g. Date night spots"
          className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-zinc-100" />
        <button type="button" onClick={create}
          className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-red-600 hover:bg-red-500 text-white rounded-lg">
          <Plus className="w-3.5 h-3.5" /> Create
        </button>
      </div>

      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      {collections.length === 0 ? (
        <div className="text-center text-zinc-400 text-sm italic py-10 border border-zinc-800 rounded-xl">
          No lists yet. Create one to bookmark restaurants.
        </div>
      ) : (
        <ul className="space-y-2">
          {collections.map((c) => (
            <li key={c.id} className="bg-zinc-900/70 border border-zinc-800 rounded-xl overflow-hidden">
              <div className="flex items-center">
                <button type="button" onClick={() => openCollection(c.id)}
                  className="flex-1 flex items-center gap-2 px-3 py-2.5 text-left hover:bg-zinc-900">
                  <Bookmark className="w-4 h-4 text-red-400" />
                  <div>
                    <p className="text-sm font-semibold text-zinc-100">{c.name}</p>
                    <p className="text-[11px] text-zinc-400">{c.bizCount} restaurants</p>
                  </div>
                  <ChevronRight className={cn('w-4 h-4 text-zinc-600 ml-auto transition-transform', open === c.id && 'rotate-90')} />
                </button>
                <button aria-label="Delete" type="button" onClick={() => del(c.id)} className="px-3 text-zinc-600 hover:text-rose-400">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>

              {open === c.id && (
                <div className="border-t border-zinc-800 p-3 bg-zinc-950/50 space-y-2">
                  {openBiz.length > 0 ? (
                    <ul className="space-y-1">
                      {openBiz.map((b) => (
                        <li key={b.id} className="flex items-center justify-between text-xs">
                          <span className="text-zinc-200">{b.name} <span className="text-zinc-600 capitalize">· {b.cuisine}</span></span>
                          <button type="button" onClick={() => removeBiz(c.id, b.id)} className="text-zinc-600 hover:text-rose-400">Remove</button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-[11px] text-zinc-400 italic">No restaurants in this list yet.</p>
                  )}
                  {allBiz.filter((b) => !openBiz.some((x) => x.id === b.id)).length > 0 && (
                    <div>
                      <p className="text-[10px] text-zinc-400 uppercase tracking-wide mb-1">Add from directory</p>
                      <div className="flex flex-wrap gap-1">
                        {allBiz.filter((b) => !openBiz.some((x) => x.id === b.id)).slice(0, 12).map((b) => (
                          <button key={b.id} type="button" onClick={() => addBiz(c.id, b.id)}
                            className="text-[11px] px-2 py-0.5 rounded-full border border-zinc-700 text-zinc-300 hover:border-red-700/50 hover:text-red-300">
                            + {b.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
