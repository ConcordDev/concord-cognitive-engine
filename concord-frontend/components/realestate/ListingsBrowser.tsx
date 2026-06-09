'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { MapPin, Plus, Trash2, Loader2, Heart, BedDouble, Bath, Maximize2, SlidersHorizontal } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

export interface Listing {
  id: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  price: number;
  beds: number;
  baths: number;
  sqft: number;
  yearBuilt: number | null;
  kind: 'single_family' | 'condo' | 'townhouse' | 'multi_family' | 'land';
  status: 'for_sale' | 'pending' | 'sold' | 'off_market';
  daysOnMarket: number;
  imageUrl?: string;
}

interface Filters {
  minPrice?: number; maxPrice?: number;
  minBeds?: number; minBaths?: number; minSqft?: number;
  kinds?: string[]; city?: string; status?: string;
}

export function ListingsBrowser({
  onSelect, onPickForCompare, comparePicks = [],
}: {
  onSelect?: (l: Listing) => void;
  onPickForCompare?: (id: string) => void;
  comparePicks?: string[];
}) {
  const [listings, setListings] = useState<Listing[]>([]);
  const [favIds, setFavIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<Filters>({});
  const [sortBy, setSortBy] = useState<'newest' | 'price_asc' | 'price_desc' | 'beds' | 'sqft'>('newest');
  const [form, setForm] = useState({ address: '', city: '', state: '', zip: '', price: '', beds: '', baths: '', sqft: '', kind: 'single_family' });

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [a, b] = await Promise.all([
        Object.keys(filters).length > 0
          ? lensRun({ domain: 'realestate', action: 'listings-search', input: { filters } })
          : lensRun({ domain: 'realestate', action: 'listings-list', input: { sortBy } }),
        lensRun({ domain: 'realestate', action: 'favourites-list', input: {} }),
      ]);
      const items = (a.data?.result?.matches || a.data?.result?.listings || []) as Listing[];
      setListings(items);
      setFavIds((b.data?.result?.ids || []) as string[]);
    } catch (e) { console.error('[Listings] refresh failed', e); }
    finally { setLoading(false); }
  }, [filters, sortBy]);

  useEffect(() => { refresh(); }, [refresh]);

  async function add() {
    if (!form.address.trim() || !form.price) return;
    try {
      await lensRun({
        domain: 'realestate', action: 'listings-add',
        input: {
          address: form.address.trim(), city: form.city, state: form.state, zip: form.zip,
          price: Number(form.price), beds: Number(form.beds) || 0, baths: Number(form.baths) || 0,
          sqft: Number(form.sqft) || 0, kind: form.kind,
        },
      });
      setForm({ address: '', city: '', state: '', zip: '', price: '', beds: '', baths: '', sqft: '', kind: 'single_family' });
      setCreating(false);
      await refresh();
    } catch (e) { console.error('[Listings] add failed', e); }
  }

  async function toggleFav(id: string) {
    try {
      await lensRun({ domain: 'realestate', action: 'favourites-toggle', input: { id } });
      setFavIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
    } catch (e) { console.error('[Listings] favourite failed', e); }
  }

  async function remove(id: string) {
    try {
      await lensRun({ domain: 'realestate', action: 'listings-delete', input: { id } });
      setListings(prev => prev.filter(l => l.id !== id));
    } catch (e) { console.error('[Listings] delete failed', e); }
  }

  const activeFilterCount = useMemo(() => Object.values(filters).filter(v => v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0)).length, [filters]);

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <MapPin className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Listings</span>
        <span className="ml-auto text-[10px] text-gray-400">{listings.length} results</span>
        <select value={sortBy} onChange={e => setSortBy(e.target.value as typeof sortBy)} className="text-[10px] bg-lattice-deep border border-lattice-border rounded px-1.5 py-0.5 text-gray-300">
          <option value="newest">Newest</option>
          <option value="price_asc">Price ↑</option>
          <option value="price_desc">Price ↓</option>
          <option value="beds">Beds</option>
          <option value="sqft">Sqft</option>
        </select>
        <button onClick={() => setShowFilters(v => !v)} className={cn('p-1 hover:text-white', showFilters ? 'text-cyan-300' : 'text-gray-400')} title="Filters">
          <SlidersHorizontal className="w-3.5 h-3.5" />
          {activeFilterCount > 0 && <span className="text-[9px] ml-0.5">{activeFilterCount}</span>}
        </button>
        <button onClick={() => setCreating(v => !v)} className="p-1 text-gray-400 hover:text-white" title="Add listing"><Plus className="w-4 h-4" /></button>
      </header>

      {showFilters && (
        <div className="p-3 border-b border-white/10 grid grid-cols-6 gap-2 text-xs">
          <input type="number" value={filters.minPrice ?? ''} onChange={e => setFilters({ ...filters, minPrice: e.target.value ? Number(e.target.value) : undefined })} placeholder="Min $" className="px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-white" />
          <input type="number" value={filters.maxPrice ?? ''} onChange={e => setFilters({ ...filters, maxPrice: e.target.value ? Number(e.target.value) : undefined })} placeholder="Max $" className="px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-white" />
          <input type="number" value={filters.minBeds ?? ''} onChange={e => setFilters({ ...filters, minBeds: e.target.value ? Number(e.target.value) : undefined })} placeholder="Min beds" className="px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-white" />
          <input type="number" value={filters.minBaths ?? ''} onChange={e => setFilters({ ...filters, minBaths: e.target.value ? Number(e.target.value) : undefined })} placeholder="Min baths" className="px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-white" />
          <input type="number" value={filters.minSqft ?? ''} onChange={e => setFilters({ ...filters, minSqft: e.target.value ? Number(e.target.value) : undefined })} placeholder="Min sqft" className="px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-white" />
          <input value={filters.city ?? ''} onChange={e => setFilters({ ...filters, city: e.target.value || undefined })} placeholder="City" className="px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-white" />
          <button onClick={() => setFilters({})} className="col-span-6 px-2 py-1 text-[10px] text-gray-400 hover:text-white text-left">Clear filters</button>
        </div>
      )}

      {creating && (
        <div className="p-3 border-b border-white/10 grid grid-cols-6 gap-2">
          <input value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} placeholder="Address" className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input value={form.city} onChange={e => setForm({ ...form, city: e.target.value })} placeholder="City" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input value={form.state} onChange={e => setForm({ ...form, state: e.target.value })} placeholder="ST" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input value={form.zip} onChange={e => setForm({ ...form, zip: e.target.value })} placeholder="Zip" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input type="number" value={form.price} onChange={e => setForm({ ...form, price: e.target.value })} placeholder="Price" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input type="number" value={form.beds} onChange={e => setForm({ ...form, beds: e.target.value })} placeholder="Beds" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input type="number" value={form.baths} onChange={e => setForm({ ...form, baths: e.target.value })} placeholder="Baths" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input type="number" value={form.sqft} onChange={e => setForm({ ...form, sqft: e.target.value })} placeholder="Sqft" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <select value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value })} className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
            <option value="single_family">SFH</option><option value="condo">Condo</option><option value="townhouse">TH</option><option value="multi_family">Multi</option><option value="land">Land</option>
          </select>
          <button onClick={add} className="col-span-1 px-3 py-1.5 text-xs rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400">Add</button>
        </div>
      )}

      <div className="max-h-[36rem] overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : listings.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-400"><MapPin className="w-6 h-6 mx-auto mb-2 opacity-30" />No listings. Hit + to add one or relax filters.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {listings.map(l => {
              const fav = favIds.includes(l.id);
              const picked = comparePicks.includes(l.id);
              return (
                <li key={l.id} className={cn('px-3 py-3 hover:bg-white/[0.03] group flex items-center gap-3', picked && 'bg-cyan-500/5')}>
                  <div className="w-20 h-16 bg-gradient-to-br from-emerald-900/30 to-cyan-900/20 rounded flex items-center justify-center flex-shrink-0">
                    <MapPin className="w-6 h-6 text-cyan-500/40" />
                  </div>
                  <div className="flex-1 min-w-0 cursor-pointer" onClick={() => onSelect?.(l)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
                    <div className="flex items-baseline gap-2">
                      <span className="text-base font-mono font-semibold text-white">${l.price.toLocaleString()}</span>
                      <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-white/5 text-gray-400">{l.status.replace('_', ' ')}</span>
                      {l.daysOnMarket < 7 && <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300">{l.daysOnMarket}d on mkt</span>}
                    </div>
                    <div className="text-xs text-gray-300 truncate">{l.address}</div>
                    <div className="text-[10px] text-gray-400 truncate">{l.city}{l.state ? `, ${l.state}` : ''} {l.zip}</div>
                    <div className="mt-1 flex items-center gap-3 text-[11px] text-gray-400">
                      <span className="inline-flex items-center gap-1"><BedDouble className="w-3 h-3" />{l.beds}</span>
                      <span className="inline-flex items-center gap-1"><Bath className="w-3 h-3" />{l.baths}</span>
                      <span className="inline-flex items-center gap-1"><Maximize2 className="w-3 h-3" />{l.sqft.toLocaleString()}</span>
                    </div>
                  </div>
                  <button onClick={() => toggleFav(l.id)} className={cn('p-1.5 rounded hover:bg-white/10', fav ? 'text-rose-400' : 'text-gray-400')} aria-label={fav ? 'Unfavourite' : 'Favourite'}>
                    <Heart className={cn('w-4 h-4', fav && 'fill-rose-400')} />
                  </button>
                  {onPickForCompare && (
                    <button onClick={() => onPickForCompare(l.id)} className={cn('px-2 py-1 text-[10px] rounded uppercase tracking-wider', picked ? 'bg-cyan-500 text-black font-bold' : 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white')}>
                      {picked ? '✓' : 'Compare'}
                    </button>
                  )}
                  <button aria-label="Delete" onClick={() => remove(l.id)} className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-rose-400"><Trash2 className="w-3.5 h-3.5" /></button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

export default ListingsBrowser;
