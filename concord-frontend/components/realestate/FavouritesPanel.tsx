'use client';

import { useEffect, useState } from 'react';
import { Heart, Loader2, BedDouble, Bath, Maximize2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import type { Listing } from './ListingsBrowser';

export function FavouritesPanel({ onSelect }: { onSelect?: (l: Listing) => void }) {
  const [favourites, setFavourites] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    try {
      const res = await lensRun({ domain: 'realestate', action: 'favourites-list', input: {} });
      setFavourites((res.data?.result?.favourites || []) as Listing[]);
    } catch (e) { console.error('[Favourites] list failed', e); }
    finally { setLoading(false); }
  }

  async function unfav(id: string) {
    try {
      await lensRun({ domain: 'realestate', action: 'favourites-toggle', input: { id } });
      setFavourites(prev => prev.filter(l => l.id !== id));
    } catch (e) { console.error('[Favourites] toggle failed', e); }
  }

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Heart className="w-4 h-4 text-rose-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Saved homes</span>
        <span className="ml-auto text-[10px] text-gray-500">{favourites.length}</span>
      </header>
      <div className="max-h-96 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-500"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : favourites.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-500"><Heart className="w-6 h-6 mx-auto mb-2 opacity-30" />Heart a listing to save it here.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {favourites.map(l => (
              <li key={l.id} className="px-3 py-2 hover:bg-white/[0.03] group flex items-center gap-3">
                <div className="flex-1 min-w-0 cursor-pointer" onClick={() => onSelect?.(l)}>
                  <div className="text-base font-mono font-semibold text-white">${l.price.toLocaleString()}</div>
                  <div className="text-xs text-gray-300 truncate">{l.address}</div>
                  <div className="mt-0.5 flex items-center gap-3 text-[11px] text-gray-400">
                    <span className="inline-flex items-center gap-1"><BedDouble className="w-3 h-3" />{l.beds}</span>
                    <span className="inline-flex items-center gap-1"><Bath className="w-3 h-3" />{l.baths}</span>
                    <span className="inline-flex items-center gap-1"><Maximize2 className="w-3 h-3" />{l.sqft.toLocaleString()}</span>
                  </div>
                </div>
                <button onClick={() => unfav(l.id)} className="p-1.5 rounded hover:bg-white/10 text-rose-400" aria-label="Remove">
                  <Heart className="w-4 h-4 fill-rose-400" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default FavouritesPanel;
