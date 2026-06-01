// Shared MapLibre GL basemap config for the Concord map components.
//
// We swapped off react-leaflet (Hippocratic-2.1, a non-OSI "ethical source" license)
// to MapLibre GL (BSD-3) — see docs/LICENSING.md. The four map components
// (common/MapView, aviation/TrackMap, logistics/ShipmentsMap, government/PinDropMap)
// share this OSM raster basemap so the appearance is identical to the old Leaflet
// OpenStreetMap tile layer. MapLibre is a WebGL renderer; a `raster` source pointed
// at the OSM tile endpoint reproduces the same basemap with no API key.
//
// NOTE: MapLibre uses [lng, lat] order (GeoJSON convention), the OPPOSITE of Leaflet's
// [lat, lng]. The helpers below make the conversion explicit so callers don't transpose.

import type { StyleSpecification } from 'maplibre-gl';

// OpenStreetMap raster basemap. MapLibre drops Leaflet's {s} subdomain token — the
// canonical single-host tile endpoint is used instead (OSM deprecated subdomains).
export const OSM_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      // @env-config-ok: OpenStreetMap tile URL — by-design hardcoded per RFC 6570 template
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
};

/** Leaflet [lat, lng] → MapLibre [lng, lat]. */
export function toLngLat(latLng: [number, number]): [number, number] {
  return [latLng[1], latLng[0]];
}

/** Compute a MapLibre LngLatBounds tuple [[w,s],[e,n]] from Leaflet [lat,lng] points. */
export function boundsFromLatLngs(
  points: Array<[number, number]>,
): [[number, number], [number, number]] | null {
  if (!points.length) return null;
  let minLat = Infinity, minLng = Infinity, maxLat = -Infinity, maxLng = -Infinity;
  for (const [lat, lng] of points) {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
  }
  return [[minLng, minLat], [maxLng, maxLat]];
}

/** Minimal HTML escaper for popup content (we build popups as HTML strings). */
export function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
