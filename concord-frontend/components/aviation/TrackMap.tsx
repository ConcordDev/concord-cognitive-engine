'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const DefaultIcon = L.icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41],
});
L.Marker.prototype.options.icon = DefaultIcon;

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

  if (!mounted) return <div className={className} style={{ background: 'rgba(34, 211, 238, 0.05)' }} />;
  if (tracksWithPoints.length === 0) {
    return (
      <div className={className} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: '11px', background: 'rgba(34, 211, 238, 0.05)' }}>
        Start a track + log GPS positions to see your flown paths here.
      </div>
    );
  }

  const allPoints = tracksWithPoints.flatMap(t => t.points);
  const center: [number, number] = [
    allPoints.reduce((s, p) => s + p.lat, 0) / allPoints.length,
    allPoints.reduce((s, p) => s + p.lng, 0) / allPoints.length,
  ];

  return (
    <div className={className} style={{ overflow: 'hidden' }}>
      <MapContainer center={center} zoom={8} style={{ height: '100%', width: '100%' }}>
        <TileLayer attribution='&copy; OpenStreetMap' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        {tracksWithPoints.map(t => {
          const path = t.points.map(p => [p.lat, p.lng] as [number, number]);
          const startPt = t.points[0];
          const endPt = t.points[t.points.length - 1];
          const colour = t.endedAt ? '#34d399' : '#fbbf24';
          return (
            <React.Fragment key={t.id}>
              <Polyline positions={path} pathOptions={{ color: colour, weight: 2.5, opacity: 0.85 }} />
              <Marker position={[startPt.lat, startPt.lng]}>
                <Popup>
                  <div style={{ fontWeight: 600 }}>Start · {t.tail}</div>
                  <div style={{ fontSize: 11 }}>{t.from || 'unknown'}</div>
                  <div style={{ fontSize: 10, color: '#666' }}>{new Date(t.startedAt).toLocaleString()}</div>
                </Popup>
              </Marker>
              <Marker position={[endPt.lat, endPt.lng]}>
                <Popup>
                  <div style={{ fontWeight: 600 }}>{t.endedAt ? 'End' : 'Last position'} · {t.tail}</div>
                  <div style={{ fontSize: 11 }}>{t.to || 'unknown'}</div>
                  <div style={{ fontSize: 10, color: '#666' }}>{t.totalDistanceNm.toFixed(1)} nm · max {t.maxAltitudeFt} ft</div>
                </Popup>
              </Marker>
            </React.Fragment>
          );
        })}
      </MapContainer>
    </div>
  );
}

export default TrackMap;
