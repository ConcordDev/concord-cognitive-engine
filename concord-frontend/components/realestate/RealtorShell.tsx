'use client';

/**
 * RealtorShell — Zillow / Redfin-shape silhouette.
 *
 * Top hero with a search bar + filter chips, a map placeholder on the
 * left and a scrolling listings rail on the right, summary stats
 * across the top, recent activity at the bottom. Drop into the
 * realestate lens above the existing workbench and the page reads as
 * a home-search app inside 200ms.
 */

import React, { useState } from 'react';
import dynamic from 'next/dynamic';
import {
  Search, MapPin, Heart, Calendar, MessageSquare, Star,
  BedDouble, Bath, Maximize2, TrendingUp, ChevronRight, Filter,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const ListingsMap = dynamic(() => import('./ListingsMap').then(m => m.ListingsMap), { ssr: false });

export interface RealtorListing {
  id: string;
  address: string;
  city?: string;
  state?: string;
  zip?: string;
  price: number;
  beds: number;
  baths: number;
  sqft: number;
  status: 'for_sale' | 'pending' | 'sold' | 'off_market';
  daysOnMarket?: number;
  imageUrl?: string;
  hotScore?: number;
  favourited?: boolean;
  lat?: number;
  lng?: number;
}

export interface RealtorActivity {
  id: string;
  kind: 'favourite' | 'tour' | 'message' | 'price_drop' | 'open_house';
  label: string;
  timestamp: string;
}

export interface RealtorShellProps {
  query: string;
  onQueryChange?: (q: string) => void;
  onSubmitQuery?: () => void;
  filterChips?: string[];
  listings: RealtorListing[];
  totalCount: number;
  medianPrice?: number;
  favouriteCount?: number;
  upcomingTourCount?: number;
  activity?: RealtorActivity[];
  onSelectListing?: (l: RealtorListing) => void;
  onToggleFavourite?: (l: RealtorListing) => void;
  className?: string;
}

function fmtPrice(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${n.toLocaleString()}`;
}

export function RealtorShell({
  query, onQueryChange, onSubmitQuery,
  filterChips = [],
  listings, totalCount,
  medianPrice, favouriteCount = 0, upcomingTourCount = 0,
  activity = [],
  onSelectListing, onToggleFavourite,
  className,
}: RealtorShellProps) {
  return (
    <div className={cn('flex flex-col gap-3 p-4 bg-[#0d0e12] text-gray-100', className)}>
      {/* Search bar */}
      <form
        onSubmit={(e) => { e.preventDefault(); onSubmitQuery?.(); }}
        className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2"
      >
        <Search className="w-4 h-4 text-gray-400" aria-hidden="true" />
        <input
          value={query}
          onChange={(e) => onQueryChange?.(e.target.value)}
          placeholder="Search by city, address, or natural language — e.g. '3 bed condo under $500k in Austin'"
          className="flex-1 bg-transparent text-sm outline-none placeholder-gray-500"
        />
        <button type="submit" className="px-3 py-1 text-xs rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400">Search</button>
      </form>

      {/* Filter chips */}
      {filterChips.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <Filter className="w-3.5 h-3.5 text-gray-500" aria-hidden="true" />
          {filterChips.map((c) => (
            <span key={c} className="px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wider bg-cyan-500/15 text-cyan-300 border border-cyan-500/20">{c}</span>
          ))}
        </div>
      )}

      {/* Top metrics */}
      <div className="grid grid-cols-4 gap-2">
        <Tile icon={MapPin} label="Listings" value={String(totalCount)} />
        <Tile icon={TrendingUp} label="Median" value={medianPrice ? fmtPrice(medianPrice) : '—'} />
        <Tile icon={Heart} label="Favourites" value={String(favouriteCount)} />
        <Tile icon={Calendar} label="Tours" value={String(upcomingTourCount)} />
      </div>

      {/* Two-column: real Leaflet map + listings rail */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-3">
        <section className="lg:col-span-2 rounded-lg border border-white/10 overflow-hidden">
          <ListingsMap listings={listings} onSelect={onSelectListing} className="h-[320px] w-full" />
        </section>

        {/* Listings rail (Redfin-shape cards) */}
        <section className="lg:col-span-3 space-y-2 max-h-[480px] overflow-y-auto">
          {listings.length === 0 ? (
            <div className="text-center text-xs text-gray-500 py-12 border border-dashed border-white/10 rounded-lg">
              No listings match your filters.
            </div>
          ) : (
            listings.map((l) => (
              <article
                key={l.id}
                className="rounded-lg border border-white/10 bg-white/[0.02] hover:bg-white/[0.05] transition cursor-pointer overflow-hidden"
                onClick={() => onSelectListing?.(l)}
              >
                <div className="flex">
                  {/* Image placeholder */}
                  <div className="w-32 h-24 bg-gradient-to-br from-emerald-900/30 to-cyan-900/20 flex items-center justify-center flex-shrink-0 relative">
                    {l.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={l.imageUrl} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <MapPin className="w-8 h-8 text-cyan-500/40" aria-hidden="true" />
                    )}
                    {l.hotScore != null && l.hotScore >= 65 && (
                      <span className="absolute top-1 left-1 text-[9px] px-1 py-0.5 rounded bg-rose-500 text-white font-bold uppercase">🔥 Hot</span>
                    )}
                  </div>

                  <div className="flex-1 p-3 min-w-0">
                    <div className="flex items-baseline gap-2 mb-1">
                      <span className="text-lg font-mono font-semibold text-white">{fmtPrice(l.price)}</span>
                      <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-white/5 text-gray-400">{l.status.replace('_', ' ')}</span>
                      {l.daysOnMarket != null && l.daysOnMarket < 7 && (
                        <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300">{l.daysOnMarket}d</span>
                      )}
                    </div>
                    <div className="text-xs text-gray-300 truncate">{l.address}</div>
                    <div className="text-[11px] text-gray-500 truncate">{l.city}{l.state ? `, ${l.state}` : ''} {l.zip}</div>
                    <div className="mt-1 flex items-center gap-3 text-[11px] text-gray-400">
                      <span className="inline-flex items-center gap-1"><BedDouble className="w-3 h-3" />{l.beds}</span>
                      <span className="inline-flex items-center gap-1"><Bath className="w-3 h-3" />{l.baths}</span>
                      <span className="inline-flex items-center gap-1"><Maximize2 className="w-3 h-3" />{l.sqft.toLocaleString()}</span>
                    </div>
                  </div>

                  <div className="flex flex-col gap-1 p-2 flex-shrink-0">
                    <button
                      onClick={(e) => { e.stopPropagation(); onToggleFavourite?.(l); }}
                      className={cn('p-1.5 rounded hover:bg-white/10', l.favourited ? 'text-rose-400' : 'text-gray-500')}
                      aria-label={l.favourited ? 'Unfavourite' : 'Favourite'}
                    >
                      <Heart className={cn('w-4 h-4', l.favourited && 'fill-rose-400')} />
                    </button>
                    <ChevronRight className="w-4 h-4 text-gray-600 mt-auto" />
                  </div>
                </div>
              </article>
            ))
          )}
        </section>
      </div>

      {/* Recent activity */}
      {activity.length > 0 && (
        <section>
          <h2 className="text-xs uppercase tracking-wider text-gray-500 mb-1.5">Recent activity</h2>
          <ul className="space-y-0.5">
            {activity.slice(0, 6).map((a) => (
              <li key={a.id} className="flex items-center gap-3 px-2 py-1.5 rounded hover:bg-white/[0.03] text-[11px]">
                <span className={cn(
                  'w-7 h-7 rounded-full flex items-center justify-center',
                  a.kind === 'favourite' ? 'bg-rose-500/15 text-rose-300'
                    : a.kind === 'tour' ? 'bg-cyan-500/15 text-cyan-300'
                    : a.kind === 'message' ? 'bg-violet-500/15 text-violet-300'
                    : a.kind === 'price_drop' ? 'bg-emerald-500/15 text-emerald-300'
                    : 'bg-amber-500/15 text-amber-300'
                )}>
                  {a.kind === 'favourite' ? <Heart className="w-3.5 h-3.5" />
                    : a.kind === 'tour' ? <Calendar className="w-3.5 h-3.5" />
                    : a.kind === 'message' ? <MessageSquare className="w-3.5 h-3.5" />
                    : a.kind === 'price_drop' ? <TrendingUp className="w-3.5 h-3.5" />
                    : <Star className="w-3.5 h-3.5" />}
                </span>
                <span className="flex-1 text-gray-200 truncate">{a.label}</span>
                <span className="text-gray-500 font-mono">{new Date(a.timestamp).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

interface TileProps { icon: typeof MapPin; label: string; value: string }
function Tile({ icon: Icon, label, value }: TileProps) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
      <div className="flex items-center gap-1.5 mb-0.5">
        <Icon className="w-3 h-3 text-cyan-300" aria-hidden="true" />
        <span className="text-[10px] uppercase tracking-wider text-gray-500">{label}</span>
      </div>
      <div className="text-base font-mono tabular-nums text-white">{value}</div>
    </div>
  );
}

export default RealtorShell;
