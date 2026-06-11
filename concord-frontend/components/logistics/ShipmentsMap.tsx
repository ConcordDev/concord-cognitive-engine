'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { OSM_STYLE, toLngLat, esc } from '@/lib/maplibre/osm';

// Swapped off react-leaflet (Hippocratic-2.1) → MapLibre GL (BSD-3). Props unchanged.

interface ShipmentRoute {
  id: string;
  trackingNumber: string;
  origin: string;
  destination: string;
  originCoords?: [number, number];
  destCoords?: [number, number];
  status: string;
  mode: string;
}

// Quick lookup for common US cities — keeps the map functional without
// a geocoder. For unknown cities, the shipment is omitted (honest empty
// state rather than guessing).
const CITY_COORDS: Record<string, [number, number]> = {
  'austin, tx': [30.2672, -97.7431],
  'dallas, tx': [32.7767, -96.7970],
  'houston, tx': [29.7604, -95.3698],
  'boston, ma': [42.3601, -71.0589],
  'new york, ny': [40.7128, -74.0060],
  'chicago, il': [41.8781, -87.6298],
  'denver, co': [39.7392, -104.9903],
  'seattle, wa': [47.6062, -122.3321],
  'la, ca': [34.0522, -118.2437],
  'los angeles, ca': [34.0522, -118.2437],
  'sf, ca': [37.7749, -122.4194],
  'san francisco, ca': [37.7749, -122.4194],
  'atlanta, ga': [33.7490, -84.3880],
  'memphis, tn': [35.1495, -90.0490],
  'phoenix, az': [33.4484, -112.0740],
  'miami, fl': [25.7617, -80.1918],
  'philadelphia, pa': [39.9526, -75.1652],
  'long beach, ca': [33.7701, -118.1937],
  'shanghai': [31.2304, 121.4737],
  'tokyo': [35.6762, 139.6503],
  'london': [51.5074, -0.1278],
  'rotterdam': [51.9244, 4.4777],
};

function geocode(label: string): [number, number] | null {
  const key = label.toLowerCase().trim();
  if (CITY_COORDS[key]) return CITY_COORDS[key];
  // Try city-only match
  for (const [k, v] of Object.entries(CITY_COORDS)) {
    if (key.includes(k.split(',')[0])) return v;
  }
  return null;
}

const STATUS_COLOUR: Record<string, string> = {
  label_created: '#94a3b8',
  picked_up: '#22d3ee',
  in_transit: '#22d3ee',
  out_for_delivery: '#a78bfa',
  delivered: '#34d399',
  exception: '#fb7185',
  returned: '#fbbf24',
};

export function ShipmentsMap({ shipments, className }: { shipments: Array<{ id: string; trackingNumber: string; origin: string; destination: string; status: string; mode: string }>; className?: string }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const routes = useMemo<ShipmentRoute[]>(() => shipments.map(s => {
    const o = geocode(s.origin);
    const d = geocode(s.destination);
    return { ...s, originCoords: o || undefined, destCoords: d || undefined };
  }).filter(r => r.originCoords && r.destCoords), [shipments]);

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);

  useEffect(() => {
    if (!mounted || !containerRef.current || routes.length === 0) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: OSM_STYLE,
      center: toLngLat([39.8, -98.5]),
      zoom: 4,
      attributionControl: { compact: true },
    });
    mapRef.current = map;

    const draw = () => {
      const features = routes.map((r) => ({
        type: 'Feature' as const,
        properties: {
          color: STATUS_COLOUR[r.status] || '#22d3ee',
          dashed: r.status === 'delivered' ? 0 : 1,
        },
        geometry: {
          type: 'LineString' as const,
          coordinates: [
            [r.originCoords![1], r.originCoords![0]],
            [r.destCoords![1], r.destCoords![0]],
          ],
        },
      }));
      const data = { type: 'FeatureCollection' as const, features };
      if (map.getSource('routes')) {
        (map.getSource('routes') as maplibregl.GeoJSONSource).setData(data);
      } else {
        map.addSource('routes', { type: 'geojson', data });
        // solid leg (delivered) + dashed leg (in-flight), filtered by the `dashed` prop
        map.addLayer({
          id: 'routes-solid', type: 'line', source: 'routes', filter: ['==', ['get', 'dashed'], 0],
          paint: { 'line-color': ['get', 'color'], 'line-width': 2, 'line-opacity': 0.7 },
        });
        map.addLayer({
          id: 'routes-dashed', type: 'line', source: 'routes', filter: ['==', ['get', 'dashed'], 1],
          paint: { 'line-color': ['get', 'color'], 'line-width': 2, 'line-opacity': 0.7, 'line-dasharray': [3, 3] },
        });
      }
      markersRef.current.forEach((mk) => mk.remove());
      markersRef.current = [];
      for (const r of routes) {
        const oPopup = new maplibregl.Popup({ offset: 24 }).setHTML(
          `<div style="font-weight:600">${esc(r.trackingNumber)}</div>` +
            `<div style="font-size:11px">From: ${esc(r.origin)}</div>` +
            `<div style="font-size:10px;color:#666">Status: ${esc(r.status.replace(/_/g, ' '))}</div>`,
        );
        const dPopup = new maplibregl.Popup({ offset: 24 }).setHTML(
          `<div style="font-weight:600">${esc(r.trackingNumber)}</div>` +
            `<div style="font-size:11px">To: ${esc(r.destination)}</div>` +
            `<div style="font-size:10px;color:#666">Mode: ${esc(r.mode)}</div>`,
        );
        markersRef.current.push(new maplibregl.Marker().setLngLat([r.originCoords![1], r.originCoords![0]]).setPopup(oPopup).addTo(map));
        markersRef.current.push(new maplibregl.Marker().setLngLat([r.destCoords![1], r.destCoords![0]]).setPopup(dPopup).addTo(map));
      }
    };

    if (map.isStyleLoaded()) draw(); else map.once('load', draw);
    return () => { map.remove(); mapRef.current = null; markersRef.current = []; };
  }, [mounted, routes]);

  if (!mounted) return <div className={className} style={{ background: 'rgba(34, 211, 238, 0.05)' }} />;

  if (routes.length === 0) {
    return (
      <div className={className} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: '11px', background: 'rgba(34, 211, 238, 0.05)' }}>
        Add shipments with recognisable city names (e.g. &quot;Austin, TX → Boston, MA&quot;) to plot routes.
      </div>
    );
  }

  return (
    <div className={className} style={{ overflow: 'hidden' }}>
      <div ref={containerRef} style={{ height: '100%', width: '100%' }} />
    </div>
  );
}

export default ShipmentsMap;
