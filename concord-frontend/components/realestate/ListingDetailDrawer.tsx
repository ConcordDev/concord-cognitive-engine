'use client';

import { useEffect, useState } from 'react';
import { X, MapPin, BedDouble, Bath, Maximize2, Heart, Calendar, Flame } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import type { Listing } from './ListingsBrowser';

interface FullListing extends Listing {
  lat: number | null; lng: number | null; description: string;
  priceHistory: Array<{ date: string; price: number; kind: string }>;
  lotSqft: number;
}
interface HotScore { score: number; tag: string; daysOnMarket: number; tourCount: number }

export function ListingDetailDrawer({ listing, onClose, onRequestTour }: { listing: Listing | null; onClose: () => void; onRequestTour?: (id: string) => void }) {
  const [full, setFull] = useState<FullListing | null>(null);
  const [hot, setHot] = useState<HotScore | null>(null);
  const [fav, setFav] = useState(false);

  useEffect(() => {
    if (!listing) { setFull(null); setHot(null); return; }
    (async () => {
      try {
        const [g, h, f] = await Promise.all([
          lensRun({ domain: 'realestate', action: 'listings-get', input: { id: listing.id } }),
          lensRun({ domain: 'realestate', action: 'hot-score', input: { listingId: listing.id } }),
          lensRun({ domain: 'realestate', action: 'favourites-list', input: {} }),
        ]);
        setFull((g.data?.result?.listing as FullListing) || null);
        setHot((h.data?.result as HotScore) || null);
        setFav(((f.data?.result?.ids || []) as string[]).includes(listing.id));
      } catch (e) { console.error('[ListingDetail] load failed', e); }
    })();
  }, [listing]);

  async function toggleFav() {
    if (!listing) return;
    try {
      const res = await lensRun({ domain: 'realestate', action: 'favourites-toggle', input: { id: listing.id } });
      setFav(Boolean(res.data?.result?.favourited));
    } catch (e) { console.error('[Detail] favourite failed', e); }
  }

  if (!listing) return null;
  const data = full || (listing as unknown as FullListing);
  const ppsf = data.sqft > 0 ? Math.round(data.price / data.sqft) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-end bg-black/60 backdrop-blur-sm" onClick={onClose} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
      <aside className="w-full max-w-2xl h-full overflow-y-auto bg-[#0d1117] border-l border-cyan-500/30" onClick={e => e.stopPropagation()}>
        <header className="sticky top-0 z-10 px-4 py-2 border-b border-white/10 bg-[#0d1117]/95 backdrop-blur flex items-center gap-2">
          <MapPin className="w-4 h-4 text-cyan-400" />
          <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Listing detail</span>
          <button aria-label="Close" onClick={onClose} className="ml-auto p-1 text-gray-400 hover:text-white"><X className="w-4 h-4" /></button>
        </header>

        <div className="aspect-video bg-gradient-to-br from-emerald-900/40 to-cyan-900/30 relative flex items-center justify-center">
          <MapPin className="w-20 h-20 text-cyan-500/30" />
          {hot && hot.score >= 65 && (
            <span className="absolute top-3 left-3 inline-flex items-center gap-1 px-2 py-1 rounded bg-rose-500 text-white text-xs font-bold uppercase">
              <Flame className="w-3 h-3" /> {hot.tag} · {hot.score}
            </span>
          )}
        </div>

        <div className="p-4 space-y-4">
          <div>
            <div className="flex items-baseline gap-3">
              <span className="text-3xl font-mono font-semibold text-white tabular-nums">${data.price.toLocaleString()}</span>
              <span className="text-[11px] uppercase tracking-wider px-2 py-0.5 rounded bg-white/5 text-gray-400">{data.status.replace('_', ' ')}</span>
            </div>
            <div className="text-sm text-gray-300">{data.address}</div>
            <div className="text-xs text-gray-400">{data.city}{data.state ? `, ${data.state}` : ''} {data.zip}</div>
          </div>

          <div className="grid grid-cols-4 gap-2 text-center">
            <Tile icon={BedDouble} label="Beds" value={String(data.beds)} />
            <Tile icon={Bath} label="Baths" value={String(data.baths)} />
            <Tile icon={Maximize2} label="Sqft" value={data.sqft.toLocaleString()} />
            <Tile icon={Maximize2} label="$/sqft" value={ppsf ? `$${ppsf}` : '—'} />
          </div>

          <div className="flex items-center gap-2">
            <button onClick={toggleFav} className={cn('flex-1 px-3 py-2 rounded text-sm font-semibold inline-flex items-center justify-center gap-2', fav ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30' : 'bg-white/5 text-gray-200 border border-white/10 hover:border-rose-500/30')}>
              <Heart className={cn('w-4 h-4', fav && 'fill-rose-300')} /> {fav ? 'Saved' : 'Save home'}
            </button>
            <button onClick={() => onRequestTour?.(data.id)} className="flex-1 px-3 py-2 rounded text-sm font-bold bg-cyan-500 text-black hover:bg-cyan-400 inline-flex items-center justify-center gap-2">
              <Calendar className="w-4 h-4" /> Tour this home
            </button>
          </div>

          {data.description && (
            <div>
              <h3 className="text-xs uppercase tracking-wider text-gray-400 mb-1.5">Description</h3>
              <p className="text-xs text-gray-200 leading-relaxed">{data.description}</p>
            </div>
          )}

          {data.priceHistory && data.priceHistory.length > 0 && (
            <div>
              <h3 className="text-xs uppercase tracking-wider text-gray-400 mb-1.5">Price history</h3>
              <ul className="divide-y divide-white/5 rounded border border-white/10">
                {data.priceHistory.slice().reverse().map((p, i) => (
                  <li key={i} className="px-3 py-1.5 flex items-center gap-3 text-xs">
                    <span className="font-mono text-gray-400 w-24">{p.date}</span>
                    <span className="flex-1 capitalize text-gray-300">{p.kind.replace('_', ' ')}</span>
                    <span className="font-mono tabular-nums text-white">${p.price.toLocaleString()}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {hot && (
            <div className="rounded-md border border-white/10 bg-white/[0.03] p-3 text-xs">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-gray-400">Hot score</span>
                <span className="font-mono text-cyan-300">{hot.score}/100 · {hot.tag}</span>
              </div>
              <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                <div className={cn('h-full transition-all', hot.score >= 65 ? 'bg-rose-500' : hot.score >= 45 ? 'bg-amber-500' : 'bg-cyan-500')} style={{ width: `${hot.score}%` }} />
              </div>
              <div className="mt-1 text-[10px] text-gray-400">{hot.daysOnMarket}d on market · {hot.tourCount} tour{hot.tourCount === 1 ? '' : 's'} requested</div>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

function Tile({ icon: Icon, label, value }: { icon: typeof BedDouble; label: string; value: string }) {
  return (
    <div className="rounded-md border border-white/10 bg-white/[0.03] py-2">
      <Icon className="w-4 h-4 text-cyan-300 mx-auto mb-0.5" />
      <div className="text-[10px] uppercase tracking-wider text-gray-400">{label}</div>
      <div className="text-sm font-mono tabular-nums text-white">{value}</div>
    </div>
  );
}

export default ListingDetailDrawer;
