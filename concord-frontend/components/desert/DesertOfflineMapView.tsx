'use client';

/**
 * DesertOfflineMapView — the desert lens's map, with a real client-side
 * tile cache for no-signal fieldwork.
 *
 * Closes the WAVE4 desert-lens defect "No offline map caching for
 * no-signal fieldwork" (docs/WAVE4_INVENTORY.md capability-map reasoning:
 * "a client-side tile-cache layer Concord doesn't have").
 *
 * This is a NEW, desert-scoped component — it does NOT modify or wrap
 * `components/common/MapView.tsx`, which ~25 other lenses (atlas,
 * agriculture, realestate, logistics, …) also render unmodified. MapView
 * has no `transformRequest`/custom-style prop to hook into from outside,
 * so offline tile caching is implemented here as a sibling component
 * with the same public prop surface (center/zoom/markers/className/
 * onMarkerClick) that ResourceNodeMap / TerrainOverlay / ExpeditionPlanner
 * import instead. The actual cache engine lives in
 * `lib/desert/tile-cache.ts` (Cache-API-backed; see that file's header
 * for the storage-choice rationale).
 *
 * Interception mechanism: MapLibre GL's `addProtocol` lets a style
 * reference a custom URL scheme (`desert-tile://{z}/{x}/{y}`) whose
 * requests are resolved by our own loader instead of a raw fetch. The
 * loader always resolves (never throws to MapLibre) — a genuine network
 * tile, a cached tile, or an honest "tile unavailable offline" placeholder
 * tile it draws itself. That's what satisfies "no broken image, no
 * silent blank" — MapLibre always gets *something* to paint.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { StyleSpecification } from 'maplibre-gl';
import { CloudOff, Database, Download } from 'lucide-react';
import {
  getTile,
  getTileCacheStats,
  isOffline,
  precacheTiles,
  tileUrl as realTileUrl,
  tilesForBounds,
  MAX_PRECACHE_TILES,
  STORAGE_CAP_BYTES,
  type TileCacheStats,
} from '@/lib/desert/tile-cache';

export interface MapMarker {
  lat: number;
  lng: number;
  label: string;
  popup?: string;
}

export interface DesertOfflineMapViewProps {
  center?: [number, number];
  zoom?: number;
  markers?: MapMarker[];
  className?: string;
  onMarkerClick?: (marker: MapMarker) => void;
}

const DESERT_TILE_PROTOCOL = 'desert-tile';
let protocolRegistered = false;

// @fake-data-ok: the "placeholder" here is an honest unavailable-state graphic — a tile
// that reads "cached tile isn't available offline". No data is fabricated.
let placeholderBlobPromise: Promise<Blob> | null = null;

/** Draws the honest "cached tile isn't available offline" placeholder once, memoized. */
function getPlaceholderTileBlob(): Promise<Blob> {
  if (placeholderBlobPromise) return placeholderBlobPromise;
  // @fake-data-ok: memoizes the honest "tile unavailable offline" graphic, not fake data.
  placeholderBlobPromise = new Promise((resolve, reject) => {
    try {
      const size = 256;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('canvas 2d context unavailable'));
        return;
      }
      ctx.fillStyle = '#1c1917';
      ctx.fillRect(0, 0, size, size);
      ctx.strokeStyle = '#44403c';
      ctx.lineWidth = 1;
      ctx.strokeRect(0.5, 0.5, size - 1, size - 1);
      ctx.fillStyle = '#78716c';
      ctx.font = '12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Tile unavailable', size / 2, size / 2 - 8);
      ctx.fillText('offline', size / 2, size / 2 + 8);
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('canvas toBlob failed'));
      }, 'image/png');
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
  return placeholderBlobPromise;
}

function ensureProtocolRegistered() {
  if (protocolRegistered) return;
  protocolRegistered = true;
  maplibregl.addProtocol(DESERT_TILE_PROTOCOL, async (params) => {
    const path = params.url.replace(`${DESERT_TILE_PROTOCOL}://`, '');
    const [z, x, y] = path.split('/').map(Number);
    const real = realTileUrl(z, x, y);
    const { blob } = await getTile(real, { allowNetwork: !isOffline() });
    const resolved = blob ?? (await getPlaceholderTileBlob());
    return { data: await resolved.arrayBuffer() };
  });
}

const DESERT_OSM_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: [`${DESERT_TILE_PROTOCOL}://{z}/{x}/{y}`],
      tileSize: 256,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors (offline-cached)',
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
};

function toLngLat([lat, lng]: [number, number]): [number, number] {
  return [lng, lat];
}

function boundsFromLatLngs(points: Array<[number, number]>): [[number, number], [number, number]] | null {
  if (!points.length) return null;
  let minLat = Infinity;
  let minLng = Infinity;
  let maxLat = -Infinity;
  let maxLng = -Infinity;
  for (const [lat, lng] of points) {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
  }
  return [[minLng, minLat], [maxLng, maxLat]];
}

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatMb(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}

export default function DesertOfflineMapView({
  center = [20, 0],
  zoom = 2,
  markers = [],
  className = '',
  onMarkerClick,
}: DesertOfflineMapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const onMarkerClickRef = useRef(onMarkerClick);
  onMarkerClickRef.current = onMarkerClick;

  const [online, setOnline] = useState(() => !isOffline());
  const [stats, setStats] = useState<TileCacheStats>({ count: 0, bytes: 0 });
  const [caching, setCaching] = useState<{ active: boolean; done: number; total: number; capped: boolean }>({
    active: false,
    done: 0,
    total: 0,
    capped: false,
  });
  const [err, setErr] = useState<string | null>(null);

  const refreshStats = useCallback(async () => {
    const s = await getTileCacheStats();
    setStats(s);
  }, []);

  useEffect(() => {
    refreshStats();
  }, [refreshStats]);

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  // Create the map once.
  useEffect(() => {
    if (!containerRef.current) return;
    ensureProtocolRegistered();
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: DESERT_OSM_STYLE,
      center: toLngLat(center),
      zoom,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // center/zoom only seed the initial view; marker-driven recentering is below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync markers + view whenever the marker set changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const apply = () => {
      markersRef.current.forEach((mk) => mk.remove());
      markersRef.current = [];

      markers.forEach((m) => {
        const popup = new maplibregl.Popup({ offset: 24 }).setHTML(
          `<div style="font-size:13px"><strong>${esc(m.label)}</strong>${
            m.popup ? `<p style="margin-top:4px">${esc(m.popup)}</p>` : ''
          }</div>`,
        );
        const marker = new maplibregl.Marker().setLngLat(toLngLat([m.lat, m.lng])).setPopup(popup).addTo(map);
        if (onMarkerClickRef.current) {
          marker.getElement().style.cursor = 'pointer';
          marker.getElement().addEventListener('click', (ev) => { // @resource-leak-ok
            ev.stopPropagation();
            onMarkerClickRef.current?.(m);
          });
        }
        markersRef.current.push(marker);
      });

      if (markers.length === 1) {
        map.easeTo({ center: toLngLat([markers[0].lat, markers[0].lng]), zoom: 10, duration: 300 });
      } else if (markers.length > 1) {
        const b = boundsFromLatLngs(markers.map((m) => [m.lat, m.lng] as [number, number]));
        if (b) map.fitBounds(b, { padding: 40, duration: 300, maxZoom: 12 });
      }
    };

    if (map.isStyleLoaded()) apply();
    else map.once('load', apply);
  }, [markers]);

  const cacheVisibleArea = useCallback(async () => {
    const map = mapRef.current;
    if (!map) return;
    setErr(null);
    try {
      const b = map.getBounds();
      const centerZoom = Math.round(map.getZoom());
      const zoomLevels = [centerZoom - 1, centerZoom, centerZoom + 1].filter((z) => z >= 0 && z <= 19);
      const urlSet = new Set<string>();
      for (const z of zoomLevels) {
        for (const t of tilesForBounds(
          { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() },
          z,
        )) {
          urlSet.add(realTileUrl(t.z, t.x, t.y));
        }
      }
      let list = Array.from(urlSet);
      const capped = list.length > MAX_PRECACHE_TILES;
      if (capped) list = list.slice(0, MAX_PRECACHE_TILES);

      setCaching({ active: true, done: 0, total: list.length, capped });
      await precacheTiles(list, (done, total) => {
        setCaching((c) => ({ ...c, done, total }));
      });
      setCaching((c) => ({ ...c, active: false }));
      await refreshStats();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to cache area');
      setCaching((c) => ({ ...c, active: false }));
    }
  }, [refreshStats]);

  return (
    <div className="space-y-2">
      {!online && (
        <div className="flex items-center gap-2 rounded border border-amber-800 bg-amber-950/40 px-3 py-1.5 text-xs text-amber-300">
          <CloudOff className="h-3.5 w-3.5" />
          Offline — showing cached tiles only. Uncached areas render as &ldquo;tile unavailable offline&rdquo;.
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs">
        <div className="flex items-center gap-1.5 text-zinc-400">
          <Database className="h-3.5 w-3.5" />
          <span>
            {stats.count} tiles cached &middot; {formatMb(stats.bytes)} MB / {formatMb(STORAGE_CAP_BYTES)} MB
          </span>
        </div>
        <button
          onClick={cacheVisibleArea}
          disabled={caching.active || !online}
          className="flex items-center gap-1 rounded bg-amber-700 hover:bg-amber-600 disabled:opacity-50 px-2.5 py-1 text-xs text-white"
          title={!online ? 'Reconnect to cache new tiles' : 'Pre-fetch the visible area for offline use'}
        >
          <Download className="h-3.5 w-3.5" />
          {caching.active ? `Caching ${caching.done}/${caching.total}…` : 'Cache this area for offline use'}
        </button>
      </div>
      {caching.capped && !caching.active && (
        <p className="text-[10px] text-zinc-500">
          Capped at {MAX_PRECACHE_TILES} tiles for this click — pan/zoom and cache again to cover more ground.
        </p>
      )}
      {err && <p className="text-xs text-red-400">{err}</p>}

      <div className={`rounded-lg overflow-hidden border border-white/10 ${className}`} style={{ minHeight: 320 }}>
        <div ref={containerRef} style={{ height: '100%', width: '100%', minHeight: 320 }} className="z-0" />
      </div>
    </div>
  );
}
