'use client';

import { useEffect, useRef } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { OSM_STYLE, toLngLat, boundsFromLatLngs, esc } from '@/lib/maplibre/osm';

// Swapped off react-leaflet (Hippocratic-2.1) → MapLibre GL (BSD-3). The public
// API (props below) is unchanged so the ~30 consumers don't need edits.

export interface MapMarker {
  lat: number;
  lng: number;
  label: string;
  popup?: string;
}

export interface MapViewProps {
  center?: [number, number];
  zoom?: number;
  markers?: MapMarker[];
  /** Ordered waypoints to connect with a real route line (e.g. an optimized
   * stop sequence) — separate from `markers` so callers can show both the
   * pins and the path between them without duplicating point data. */
  route?: Array<{ lat: number; lng: number }>;
  className?: string;
  onMarkerClick?: (marker: MapMarker) => void;
}

const ROUTE_SOURCE_ID = 'concord-route-line';
const ROUTE_LAYER_ID = 'concord-route-line-layer';

export default function MapView({
  center = [20, 0],
  zoom = 2,
  markers = [],
  route = [],
  className = '',
  onMarkerClick,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const onMarkerClickRef = useRef(onMarkerClick);
  onMarkerClickRef.current = onMarkerClick;

  // Create the map once.
  useEffect(() => {
    if (!containerRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: OSM_STYLE,
      center: toLngLat(center),
      zoom,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
    // center/zoom only seed the initial view; marker-driven recentering is below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync markers + view whenever the marker set changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const apply = () => {
      // clear prior markers
      markersRef.current.forEach((mk) => mk.remove());
      markersRef.current = [];

      markers.forEach((m) => {
        const popup =
          new maplibregl.Popup({ offset: 24 }).setHTML(
            `<div style="font-size:13px"><strong>${esc(m.label)}</strong>${
              m.popup ? `<p style="margin-top:4px">${esc(m.popup)}</p>` : ''
            }</div>`,
          );
        const marker = new maplibregl.Marker().setLngLat(toLngLat([m.lat, m.lng])).setPopup(popup).addTo(map);
        if (onMarkerClickRef.current) {
          marker.getElement().style.cursor = 'pointer';
          // The listener lives on the marker's own DOM element; mk.remove()
          // above (next apply() pass) detaches that element entirely, taking
          // the listener with it — no separate removeEventListener needed.
          marker.getElement().addEventListener('click', (ev) => { // @resource-leak-ok
            ev.stopPropagation();
            onMarkerClickRef.current?.(m);
          });
        }
        markersRef.current.push(marker);
      });

      // Recenter over markers + route points combined, so a route with no
      // separate markers (or vice versa) still frames correctly.
      const framePoints = [
        ...markers.map((m) => [m.lat, m.lng] as [number, number]),
        ...route.map((r) => [r.lat, r.lng] as [number, number]),
      ];
      if (framePoints.length === 1) {
        map.easeTo({ center: toLngLat(framePoints[0]), zoom: 10, duration: 300 });
      } else if (framePoints.length > 1) {
        const b = boundsFromLatLngs(framePoints);
        if (b) map.fitBounds(b, { padding: 40, duration: 300, maxZoom: 12 });
      }
    };

    if (map.isStyleLoaded()) apply();
    else map.once('load', apply);
  }, [markers, route]);

  // Draw (or clear) the real route line separately from markers — a
  // GeoJSON LineString source/layer rather than per-marker DOM elements,
  // since a route is a path, not a set of independent points.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const apply = () => {
      const existing = map.getSource(ROUTE_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;

      // A GeoJSON LineString needs 2+ positions — if the route shrank below
      // that (or is empty), tear the layer/source down rather than feed it
      // an invalid geometry.
      if (route.length < 2) {
        if (map.getLayer(ROUTE_LAYER_ID)) map.removeLayer(ROUTE_LAYER_ID);
        if (existing) map.removeSource(ROUTE_SOURCE_ID);
        return;
      }

      const lineString = {
        type: 'Feature' as const,
        properties: {},
        geometry: {
          type: 'LineString' as const,
          coordinates: route.map((r) => toLngLat([r.lat, r.lng])),
        },
      };
      if (existing) {
        existing.setData(lineString);
      } else {
        map.addSource(ROUTE_SOURCE_ID, { type: 'geojson', data: lineString });
        map.addLayer({
          id: ROUTE_LAYER_ID,
          type: 'line',
          source: ROUTE_SOURCE_ID,
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: { 'line-color': '#22d3ee', 'line-width': 3, 'line-opacity': 0.85, 'line-dasharray': [2, 1] },
        });
      }
    };

    if (map.isStyleLoaded()) apply();
    else map.once('load', apply);
  }, [route]);

  return (
    <div className={`rounded-lg overflow-hidden border border-white/10 ${className}`} style={{ minHeight: 320 }}>
      <div ref={containerRef} style={{ height: '100%', width: '100%', minHeight: 320 }} className="z-0" />
    </div>
  );
}
