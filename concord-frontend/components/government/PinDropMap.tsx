'use client';

import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { OSM_STYLE, toLngLat, esc } from '@/lib/maplibre/osm';

// Swapped off react-leaflet (Hippocratic-2.1) → MapLibre GL (BSD-3). Props unchanged.

export interface ExistingMarker {
  lat: number; lng: number; label: string; category: string; status: string;
}

interface PinDropMapProps {
  existing: ExistingMarker[];
  pin: { lat: number; lng: number } | null;
  onPick: (lat: number, lng: number) => void;
}

function pinElement(): HTMLDivElement {
  const el = document.createElement('div');
  el.style.cssText =
    'width:18px;height:18px;border-radius:50%;background:#06b6d4;border:3px solid #fff;box-shadow:0 0 6px rgba(0,0,0,0.5)';
  return el;
}

export function PinDropMap({ existing, pin, onPick }: PinDropMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const existingMarkersRef = useRef<maplibregl.Marker[]>([]);
  const pinMarkerRef = useRef<maplibregl.Marker | null>(null);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;

  const center: [number, number] = pin
    ? [pin.lat, pin.lng]
    : existing.length > 0
      ? [existing[0].lat, existing[0].lng]
      : [39.5, -98.35];
  const zoom = pin || existing.length > 0 ? 12 : 4;

  // Create map + click handler once.
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
    map.on('click', (e) => onPickRef.current(e.lngLat.lat, e.lngLat.lng));
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Existing markers.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      existingMarkersRef.current.forEach((mk) => mk.remove());
      existingMarkersRef.current = [];
      existing.forEach((m) => {
        const popup = new maplibregl.Popup({ offset: 24 }).setHTML(
          `<div style="font-size:13px"><strong>${esc(m.label)}</strong>` +
            `<p style="margin-top:4px;text-transform:capitalize">${esc(m.category.replace(/_/g, ' '))}</p>` +
            `<p style="font-size:11px;color:#666">${esc(m.status.replace(/_/g, ' '))}</p></div>`,
        );
        const mk = new maplibregl.Marker().setLngLat(toLngLat([m.lat, m.lng])).setPopup(popup).addTo(map);
        existingMarkersRef.current.push(mk);
      });
    };
    if (map.isStyleLoaded()) apply(); else map.once('load', apply);
  }, [existing]);

  // The dropped pin (custom cyan dot).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      if (pinMarkerRef.current) { pinMarkerRef.current.remove(); pinMarkerRef.current = null; }
      if (pin) {
        pinMarkerRef.current = new maplibregl.Marker({ element: pinElement(), anchor: 'center' })
          .setLngLat(toLngLat([pin.lat, pin.lng]))
          .setPopup(new maplibregl.Popup({ offset: 16 }).setText('New report location'))
          .addTo(map);
        map.easeTo({ center: toLngLat([pin.lat, pin.lng]), duration: 300 });
      }
    };
    if (map.isStyleLoaded()) apply(); else map.once('load', apply);
  }, [pin]);

  return (
    <div className="rounded-lg overflow-hidden border border-white/10" style={{ height: 320 }}>
      <div ref={containerRef} style={{ height: '100%', width: '100%' }} className="z-0" />
    </div>
  );
}

export default PinDropMap;
