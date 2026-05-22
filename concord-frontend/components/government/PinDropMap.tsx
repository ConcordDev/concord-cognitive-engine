'use client';

import { useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMapEvents } from 'react-leaflet';
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

const PinIcon = L.divIcon({
  className: '',
  html: '<div style="width:18px;height:18px;border-radius:50%;background:#06b6d4;border:3px solid #fff;box-shadow:0 0 6px rgba(0,0,0,0.5)"></div>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

export interface ExistingMarker {
  lat: number; lng: number; label: string; category: string; status: string;
}

interface PinDropMapProps {
  existing: ExistingMarker[];
  pin: { lat: number; lng: number } | null;
  onPick: (lat: number, lng: number) => void;
}

function ClickHandler({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) { onPick(e.latlng.lat, e.latlng.lng); },
  });
  return null;
}

export function PinDropMap({ existing, pin, onPick }: PinDropMapProps) {
  const center: [number, number] = pin
    ? [pin.lat, pin.lng]
    : existing.length > 0
      ? [existing[0].lat, existing[0].lng]
      : [39.5, -98.35];
  const zoom = pin || existing.length > 0 ? 12 : 4;

  const [mapKey] = useState(() => `pin-${Math.random().toString(36).slice(2, 10)}`);

  return (
    <div className="rounded-lg overflow-hidden border border-white/10" style={{ height: 320 }}>
      <MapContainer
        key={mapKey}
        center={center}
        zoom={zoom}
        scrollWheelZoom
        style={{ height: '100%', width: '100%' }}
        className="z-0"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          // @env-config-ok: OpenStreetMap tile URL pattern — by-design hardcoded per RFC 6570 template
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <ClickHandler onPick={onPick} />
        {existing.map((m, i) => (
          <Marker key={`${m.lat}-${m.lng}-${i}`} position={[m.lat, m.lng]}>
            <Popup>
              <div className="text-sm">
                <strong>{m.label}</strong>
                <p className="mt-1" style={{ textTransform: 'capitalize' }}>{m.category.replace(/_/g, ' ')}</p>
                <p style={{ fontSize: 11, color: '#666' }}>{m.status.replace(/_/g, ' ')}</p>
              </div>
            </Popup>
          </Marker>
        ))}
        {pin && (
          <Marker position={[pin.lat, pin.lng]} icon={PinIcon}>
            <Popup>New report location</Popup>
          </Marker>
        )}
      </MapContainer>
    </div>
  );
}

export default PinDropMap;
