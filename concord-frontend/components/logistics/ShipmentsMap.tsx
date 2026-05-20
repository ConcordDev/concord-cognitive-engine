'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const DefaultIcon = L.icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});
L.Marker.prototype.options.icon = DefaultIcon;

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
      <MapContainer center={[39.8, -98.5]} zoom={4} style={{ height: '100%', width: '100%' }}>
        <TileLayer attribution='&copy; OpenStreetMap' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        {routes.map(r => (
          <React.Fragment key={r.id}>
            <Marker position={r.originCoords!}>
              <Popup>
                <div style={{ fontWeight: 600 }}>{r.trackingNumber}</div>
                <div style={{ fontSize: 11 }}>From: {r.origin}</div>
                <div style={{ fontSize: 10, color: '#666' }}>Status: {r.status.replace(/_/g, ' ')}</div>
              </Popup>
            </Marker>
            <Marker position={r.destCoords!}>
              <Popup>
                <div style={{ fontWeight: 600 }}>{r.trackingNumber}</div>
                <div style={{ fontSize: 11 }}>To: {r.destination}</div>
                <div style={{ fontSize: 10, color: '#666' }}>Mode: {r.mode}</div>
              </Popup>
            </Marker>
            <Polyline positions={[r.originCoords!, r.destCoords!]} pathOptions={{ color: STATUS_COLOUR[r.status] || '#22d3ee', weight: 2, dashArray: r.status === 'delivered' ? undefined : '6 6', opacity: 0.7 }} />
          </React.Fragment>
        ))}
      </MapContainer>
    </div>
  );
}

export default ShipmentsMap;
