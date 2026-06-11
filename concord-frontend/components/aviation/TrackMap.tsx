'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { OSM_STYLE, toLngLat, esc } from '@/lib/maplibre/osm';

// Swapped off react-leaflet (Hippocratic-2.1) → MapLibre GL (BSD-3). Props unchanged.

interface Track {
  id: string; tail: string; from: string | null; to: string | null;
  startedAt: string; endedAt: string | null;
  points: Array<{ lat: number; lng: number; altitudeFt: number; groundSpeedKts: number; timestamp: string }>;
  maxAltitudeFt: number; totalDistanceNm: number;
}

export function TrackMap({ tracks, className }: { tracks: Track[]; className?: string }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const tracksWithPoints = useMemo(() => tracks.filter(t => t.points && t.points.length > 0), [tracks]);

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);

  const center: [number, number] | null = useMemo(() => {
    const allPoints = tracksWithPoints.flatMap(t => t.points);
    if (allPoints.length === 0) return null;
    return [
      allPoints.reduce((s, p) => s + p.lat, 0) / allPoints.length,
      allPoints.reduce((s, p) => s + p.lng, 0) / allPoints.length,
    ];
  }, [tracksWithPoints]);

  useEffect(() => {
    if (!mounted || !containerRef.current || !center) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: OSM_STYLE,
      center: toLngLat(center),
      zoom: 8,
      attributionControl: { compact: true },
    });
    mapRef.current = map;

    const draw = () => {
      const features = tracksWithPoints.map((t) => ({
        type: 'Feature' as const,
        properties: { color: t.endedAt ? '#34d399' : '#fbbf24' },
        geometry: { type: 'LineString' as const, coordinates: t.points.map((p) => [p.lng, p.lat]) },
      }));
      const data = { type: 'FeatureCollection' as const, features };
      if (map.getSource('tracks')) {
        (map.getSource('tracks') as maplibregl.GeoJSONSource).setData(data);
      } else {
        map.addSource('tracks', { type: 'geojson', data });
        map.addLayer({
          id: 'tracks-line', type: 'line', source: 'tracks',
          paint: { 'line-color': ['get', 'color'], 'line-width': 2.5, 'line-opacity': 0.85 },
        });
      }
      markersRef.current.forEach((mk) => mk.remove());
      markersRef.current = [];
      for (const t of tracksWithPoints) {
        const startPt = t.points[0];
        const endPt = t.points[t.points.length - 1];
        const startPopup = new maplibregl.Popup({ offset: 24 }).setHTML(
          `<div style="font-weight:600">Start · ${esc(t.tail)}</div>` +
            `<div style="font-size:11px">${esc(t.from || 'unknown')}</div>` +
            `<div style="font-size:10px;color:#666">${esc(new Date(t.startedAt).toLocaleString())}</div>`,
        );
        const endPopup = new maplibregl.Popup({ offset: 24 }).setHTML(
          `<div style="font-weight:600">${t.endedAt ? 'End' : 'Last position'} · ${esc(t.tail)}</div>` +
            `<div style="font-size:11px">${esc(t.to || 'unknown')}</div>` +
            `<div style="font-size:10px;color:#666">${esc(t.totalDistanceNm.toFixed(1))} nm · max ${esc(t.maxAltitudeFt)} ft</div>`,
        );
        markersRef.current.push(new maplibregl.Marker().setLngLat([startPt.lng, startPt.lat]).setPopup(startPopup).addTo(map));
        markersRef.current.push(new maplibregl.Marker().setLngLat([endPt.lng, endPt.lat]).setPopup(endPopup).addTo(map));
      }
    };

    if (map.isStyleLoaded()) draw(); else map.once('load', draw);
    return () => { map.remove(); mapRef.current = null; markersRef.current = []; };
  }, [mounted, center, tracksWithPoints]);

  if (!mounted) return <div className={className} style={{ background: 'rgba(34, 211, 238, 0.05)' }} />;
  if (tracksWithPoints.length === 0) {
    return (
      <div className={className} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: '11px', background: 'rgba(34, 211, 238, 0.05)' }}>
        Start a track + log GPS positions to see your flown paths here.
      </div>
    );
  }

  return (
    <div className={className} style={{ overflow: 'hidden' }}>
      <div ref={containerRef} style={{ height: '100%', width: '100%' }} />
    </div>
  );
}

export default TrackMap;
