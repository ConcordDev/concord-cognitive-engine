'use client';

import dynamic from 'next/dynamic';
import { useMemo } from 'react';
import type { RealtorListing } from './RealtorShell';

const MapView = dynamic(() => import('@/components/common/MapView'), { ssr: false });

function fmtPrice(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${n.toLocaleString()}`;
}

export interface ListingWithCoords extends RealtorListing {
  lat?: number;
  lng?: number;
}

export function ListingsMap({ listings, onSelect, className }: { listings: ListingWithCoords[]; onSelect?: (l: RealtorListing) => void; className?: string }) {
  const markers = useMemo(() => listings.filter(l => l.lat != null && l.lng != null).map(l => ({
    lat: Number(l.lat),
    lng: Number(l.lng),
    label: fmtPrice(l.price),
    popup: `<div style="font-weight:600">${fmtPrice(l.price)}</div><div style="font-size:11px;color:#666">${l.address}</div><div style="font-size:10px;color:#888">${l.beds}bd · ${l.baths}ba · ${l.sqft.toLocaleString()} sqft</div>`,
  })), [listings]);

  if (markers.length === 0) {
    return (
      <div className={className} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: '11px', background: 'rgba(34, 211, 238, 0.05)', borderRadius: 8 }}>
        Add listings with lat/lng coords to see them on the map.
      </div>
    );
  }

  return (
    <div className={className} style={{ overflow: 'hidden', borderRadius: 8 }}>
      <MapView
        center={[markers[0].lat, markers[0].lng]}
        zoom={10}
        markers={markers}
        onMarkerClick={(m) => {
          const listing = listings.find(l => l.lat === m.lat && l.lng === m.lng);
          if (listing && onSelect) onSelect(listing);
        }}
      />
    </div>
  );
}

export default ListingsMap;
