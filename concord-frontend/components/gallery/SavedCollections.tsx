'use client';

/**
 * SavedCollections — museum-app "favorites": curate artworks from the
 * museum browsers into named collections. Wires the gallery.collection-*
 * and gallery.artwork-* macros.
 */

import { useCallback, useEffect, useState } from 'react';
import { FolderHeart, Plus, Trash2, Loader2, ImageOff } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface CollectionMeta { id: string; name: string; artworkCount: number; cover: string | null }
interface Artwork { id: string; title: string; artist: string; date: string | null; image: string | null; museum: string | null }
interface Collection { id: string; name: string; artworks: Artwork[] }
interface Dash { collections: number; savedArtworks: number; artists: number }

export function SavedCollections() {
  const [collections, setCollections] = useState<CollectionMeta[]>([]);
  const [active, setActive] = useState<Collection | null>(null);
  const [dash, setDash] = useState<Dash | null>(null);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');

  const refresh = useCallback(async () => {
    const [cl, d] = await Promise.all([
      lensRun('gallery', 'collection-list', {}),
      lensRun('gallery', 'gallery-dashboard', {}),
    ]);
    setCollections((cl.data?.result?.collections as CollectionMeta[]) || []);
    setDash((d.data?.result as Dash) || null);
    setLoading(false);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const open = useCallback(async (id: string) => {
    const r = await lensRun('gallery', 'collection-detail', { id });
    if (r.data?.ok) setActive(r.data.result?.collection as Collection);
  }, []);

  async function create() {
    if (!newName.trim()) return;
    const r = await lensRun('gallery', 'collection-create', { name: newName.trim() });
    setNewName('');
    await refresh();
    if (r.data?.ok) await open(r.data.result?.collection.id);
  }
  async function del(id: string) {
    if (!confirm('Delete this collection?')) return;
    await lensRun('gallery', 'collection-delete', { id });
    if (active?.id === id) setActive(null);
    await refresh();
  }
  async function removeArtwork(artworkId: string) {
    if (!active) return;
    await lensRun('gallery', 'artwork-remove', { collectionId: active.id, artworkId });
    await open(active.id);
    await refresh();
  }

  if (loading) return <div className="flex items-center justify-center py-6 text-zinc-400"><Loader2 className="w-4 h-4 animate-spin" /></div>;

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
      <div className="flex items-center gap-2 mb-3">
        <FolderHeart className="w-4 h-4 text-rose-400" />
        <h3 className="text-sm font-bold text-zinc-100">My Collections</h3>
        {dash && <span className="ml-auto text-[10px] text-zinc-400">{dash.savedArtworks} artworks · {dash.artists} artists</span>}
      </div>

      <div className="flex gap-1.5 mb-3">
        <input value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void create(); }}
          placeholder="New collection name…"
          className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200" />
        <button onClick={create} disabled={!newName.trim()}
          className="px-3 py-1.5 text-xs rounded bg-rose-600 hover:bg-rose-500 text-white font-semibold disabled:opacity-40 inline-flex items-center gap-1">
          <Plus className="w-3 h-3" />Create
        </button>
      </div>

      <div className="grid sm:grid-cols-[180px_1fr] gap-3">
        <ul className="space-y-1">
          {collections.map(c => (
            <li key={c.id} className="group flex items-center gap-1">
              <button onClick={() => open(c.id)}
                className={cn('flex-1 text-left rounded-lg px-2.5 py-2 border', active?.id === c.id ? 'bg-rose-600/15 border-rose-700/50' : 'bg-zinc-900/60 border-zinc-800 hover:border-zinc-700')}>
                <p className="text-xs font-semibold text-zinc-100 truncate">{c.name}</p>
                <p className="text-[10px] text-zinc-400">{c.artworkCount} artworks</p>
              </button>
              <button aria-label="Delete" onClick={() => del(c.id)} className="opacity-0 group-hover:opacity-100 p-1 text-rose-400"><Trash2 className="w-3 h-3" /></button>
            </li>
          ))}
        </ul>

        {active ? (
          <div className="bg-zinc-900/40 border border-zinc-800 rounded-lg p-3">
            <h4 className="text-sm font-bold text-zinc-100 mb-2">{active.name}</h4>
            {active.artworks.length === 0 ? (
              <p className="text-xs text-zinc-400 italic">No artworks yet — save pieces from the museum browser above.</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {active.artworks.map(a => (
                  <div key={a.id} className="group relative bg-zinc-950 border border-zinc-800 rounded-lg overflow-hidden">
                    {a.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={a.image} alt={a.title} className="w-full h-24 object-cover" />
                    ) : (
                      <div className="w-full h-24 flex items-center justify-center text-zinc-700"><ImageOff className="w-5 h-5" /></div>
                    )}
                    <div className="p-1.5">
                      <p className="text-[11px] font-semibold text-zinc-100 truncate">{a.title}</p>
                      <p className="text-[9px] text-zinc-400 truncate">{a.artist}{a.date ? ` · ${a.date}` : ''}</p>
                    </div>
                    <button aria-label="Delete" onClick={() => removeArtwork(a.id)}
                      className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 p-1 rounded bg-black/60 text-rose-300">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="bg-zinc-900/20 border border-dashed border-zinc-800 rounded-lg flex items-center justify-center text-xs text-zinc-400 min-h-[120px]">
            Select a collection.
          </div>
        )}
      </div>
    </div>
  );
}
