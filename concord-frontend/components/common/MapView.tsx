'use client';

import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
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
  className?: string;
  onMarkerClick?: (marker: MapMarker) => void;
}

export default function MapView({
  center = [20, 0],
  zoom = 2,
  markers = [],
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
          marker.getElement().addEventListener('click', (ev) => {
            ev.stopPropagation();
            onMarkerClickRef.current?.(m);
          });
        }
        markersRef.current.push(marker);
      });

      // Recenter: single marker → zoom to it; multiple → fit bounds; none → leave seed view.
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

  return (
    <div className={`rounded-lg overflow-hidden border border-white/10 ${className}`} style={{ minHeight: 320 }}>
      <div ref={containerRef} style={{ height: '100%', width: '100%', minHeight: 320 }} className="z-0" />
    </div>
  );
}
