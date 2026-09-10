'use client';

/**
 * Listing inspector — Zillow/Redfin right-rail. Overview is listings-get +
 * hot-score; remaining panes mount the existing photo/history/schools/notes/
 * contact macros. Never invents comps.
 */

import { useEffect, useState } from 'react';
import {
  X, MapPin, BedDouble, Bath, Maximize2, Heart, Calendar, Flame,
  Camera, TrendingUp, GraduationCap, StickyNote, Phone, Loader2,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { ds } from '@/lib/design-system';
import type { Listing } from './ListingsBrowser';
import ListingPhotoGallery from './ListingPhotoGallery';
import PriceHistoryPanel from './PriceHistoryPanel';
import SchoolWalkPanel from './SchoolWalkPanel';
import PropertyNotes from './PropertyNotes';
import ContactAgentForm from './ContactAgentForm';
import PropertyDetailPanel from './PropertyDetailPanel';

interface FullListing extends Listing {
  lat: number | null;
  lng: number | null;
  description: string;
  priceHistory: Array<{ date: string; price: number; kind: string }>;
  lotSqft: number;
}
interface HotScore { score: number; tag: string; daysOnMarket: number; tourCount: number }

type InspectorPane = 'overview' | 'photos' | 'history' | 'schools' | 'notes' | 'contact' | 'detail';

const PANES: { id: InspectorPane; label: string; icon: typeof Camera }[] = [
  { id: 'overview', label: 'Home', icon: MapPin },
  { id: 'photos', label: 'Photos', icon: Camera },
  { id: 'history', label: 'History', icon: TrendingUp },
  { id: 'schools', label: 'Schools', icon: GraduationCap },
  { id: 'notes', label: 'Notes', icon: StickyNote },
  { id: 'contact', label: 'Contact', icon: Phone },
  { id: 'detail', label: 'Facts', icon: Maximize2 },
];

export function ListingInspectorPanel({
  listing,
  onClose,
  onRequestTour,
  className,
}: {
  listing: Listing | null;
  onClose: () => void;
  onRequestTour?: (id: string) => void;
  className?: string;
}) {
  const [full, setFull] = useState<FullListing | null>(null);
  const [hot, setHot] = useState<HotScore | null>(null);
  const [fav, setFav] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pane, setPane] = useState<InspectorPane>('overview');

  useEffect(() => {
    if (!listing) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const [g, h, f] = await Promise.all([
          lensRun({ domain: 'realestate', action: 'listings-get', input: { id: listing.id } }),
          lensRun({ domain: 'realestate', action: 'hot-score', input: { listingId: listing.id } }),
          lensRun({ domain: 'realestate', action: 'favourites-list', input: {} }),
        ]);
        if (cancelled) return;
        if (g.data?.ok === false) {
          setLoadError(String(g.data?.error || 'listing not found'));
          setFull(null);
        } else {
          setFull((g.data?.result?.listing as FullListing) || null);
        }
        setHot((h.data?.result as HotScore) || null);
        setFav(((f.data?.result?.ids || []) as string[]).includes(listing.id));
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : 'failed to load listing');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [listing]);

  async function toggleFav() {
    if (!listing) return;
    try {
      const res = await lensRun({ domain: 'realestate', action: 'favourites-toggle', input: { id: listing.id } });
      setFav(Boolean(res.data?.result?.favourited));
    } catch (e) {
      console.error('[Inspector] favourite failed', e);
    }
  }

  if (!listing) {
    return (
      <aside className={cn('flex flex-col items-center justify-center p-6 text-center border border-lattice-border rounded-xl bg-lattice-surface', className)}>
        <MapPin className="w-8 h-8 text-gray-600 mb-2" />
        <p className="text-sm text-gray-400">Select a listing on the map or in the rail to inspect it.</p>
      </aside>
    );
  }

  const data = full || (listing as unknown as FullListing);
  const ppsf = data.sqft > 0 ? Math.round(data.price / data.sqft) : null;
  const addressForSchools = [data.address, data.city, data.state, data.zip].filter(Boolean).join(', ');

  return (
    <aside className={cn('flex flex-col min-h-0 overflow-hidden border border-lattice-border rounded-xl bg-lattice-surface', className)}>
      <header className="sticky top-0 z-10 px-3 py-2 border-b border-lattice-border bg-lattice-surface/95 backdrop-blur flex items-center gap-2">
        <MapPin className="w-4 h-4 text-[var(--lens-secondary)]" />
        <span className="text-[11px] uppercase font-semibold tracking-wider text-gray-300 truncate">
          {data.address || 'Listing'}
        </span>
        <button type="button" aria-label="Close inspector" onClick={onClose} className={cn(ds.btnGhost, 'ml-auto p-1')}>
          <X className="w-4 h-4" />
        </button>
      </header>

      <nav className="flex items-center gap-0.5 px-2 py-1.5 border-b border-lattice-border overflow-x-auto" aria-label="Listing inspector">
        {PANES.map((p) => {
          const Icon = p.icon;
          const on = pane === p.id;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => setPane(p.id)}
              className={cn(
                'flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium whitespace-nowrap',
                on
                  ? 'bg-[var(--lens-accent)]/20 text-[var(--lens-secondary)]'
                  : 'text-gray-400 hover:text-white',
              )}
              aria-current={on ? 'page' : undefined}
            >
              <Icon className="w-3 h-3" />
              {p.label}
            </button>
          );
        })}
      </nav>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {loading && (
          <div className="flex items-center justify-center py-8 text-xs text-gray-400" aria-busy="true">
            <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading listing…
          </div>
        )}
        {loadError && (
          <div role="alert" className="m-3 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {loadError}
          </div>
        )}

        {pane === 'overview' && !loading && (
          <div>
            <div className="aspect-video bg-gradient-to-br from-emerald-900/40 to-cyan-900/30 relative flex items-center justify-center">
              <MapPin className="w-16 h-16 text-cyan-500/30" />
              {hot && hot.score >= 65 && (
                <span className="absolute top-3 left-3 inline-flex items-center gap-1 px-2 py-1 rounded bg-rose-500 text-white text-xs font-bold uppercase">
                  <Flame className="w-3 h-3" /> {hot.tag} · {hot.score}
                </span>
              )}
            </div>
            <div className="p-4 space-y-4">
              <div>
                <div className="flex items-baseline gap-3 flex-wrap">
                  <span className="text-3xl font-mono font-semibold text-white tabular-nums">${data.price.toLocaleString()}</span>
                  <span className="text-[11px] uppercase tracking-wider px-2 py-0.5 rounded bg-white/5 text-gray-400">{String(data.status || '').replace('_', ' ')}</span>
                </div>
                <div className="text-sm text-gray-300">{data.address}</div>
                <div className="text-xs text-gray-400">{data.city}{data.state ? `, ${data.state}` : ''} {data.zip}</div>
              </div>

              <div className="grid grid-cols-4 gap-2 text-center">
                <Tile icon={BedDouble} label="Beds" value={String(data.beds ?? '—')} />
                <Tile icon={Bath} label="Baths" value={String(data.baths ?? '—')} />
                <Tile icon={Maximize2} label="Sqft" value={(data.sqft || 0).toLocaleString()} />
                <Tile icon={Maximize2} label="$/sqft" value={ppsf ? `$${ppsf}` : '—'} />
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={toggleFav}
                  className={cn(
                    'flex-1 px-3 py-2 rounded text-sm font-semibold inline-flex items-center justify-center gap-2',
                    fav ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30' : 'bg-white/5 text-gray-200 border border-white/10 hover:border-rose-500/30',
                  )}
                >
                  <Heart className={cn('w-4 h-4', fav && 'fill-rose-300')} /> {fav ? 'Saved' : 'Save home'}
                </button>
                <button
                  type="button"
                  onClick={() => onRequestTour?.(data.id)}
                  className="flex-1 px-3 py-2 rounded text-sm font-bold bg-[var(--lens-accent)] text-white hover:opacity-90 inline-flex items-center justify-center gap-2"
                >
                  <Calendar className="w-4 h-4" /> Tour
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
                      <li key={`${p.date}-${i}`} className="px-3 py-1.5 flex items-center gap-3 text-xs">
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
                    <span className="font-mono text-[var(--lens-secondary)]">{hot.score}/100 · {hot.tag}</span>
                  </div>
                  <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                    <div
                      className={cn('h-full transition-all', hot.score >= 65 ? 'bg-rose-500' : hot.score >= 45 ? 'bg-amber-500' : 'bg-cyan-500')}
                      style={{ width: `${hot.score}%` }}
                    />
                  </div>
                  <div className="mt-1 text-[10px] text-gray-400">{hot.daysOnMarket}d on market · {hot.tourCount} tour{hot.tourCount === 1 ? '' : 's'} requested</div>
                </div>
              )}
            </div>
          </div>
        )}

        {pane === 'photos' && <div className="p-2"><ListingPhotoGallery listingId={listing.id} /></div>}
        {pane === 'history' && <div className="p-2"><PriceHistoryPanel listingId={listing.id} /></div>}
        {pane === 'schools' && (
          <div className="p-2">
            <SchoolWalkPanel key={addressForSchools} initialAddress={addressForSchools} />
          </div>
        )}
        {pane === 'notes' && <div className="p-2"><PropertyNotes listingId={listing.id} /></div>}
        {pane === 'contact' && <div className="p-2"><ContactAgentForm listingId={listing.id} /></div>}
        {pane === 'detail' && <div className="p-2"><PropertyDetailPanel listingId={listing.id} /></div>}
      </div>
    </aside>
  );
}

function Tile({ icon: Icon, label, value }: { icon: typeof BedDouble; label: string; value: string }) {
  return (
    <div className="rounded-md border border-white/10 bg-white/[0.03] py-2">
      <Icon className="w-4 h-4 text-[var(--lens-secondary)] mx-auto mb-0.5" />
      <div className="text-[10px] uppercase tracking-wider text-gray-400">{label}</div>
      <div className="text-sm font-mono tabular-nums text-white">{value}</div>
    </div>
  );
}

export default ListingInspectorPanel;
