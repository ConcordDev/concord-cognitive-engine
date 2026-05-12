'use client';

import { useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix Leaflet default marker icon paths broken by webpack
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
  const bounds = useMemo(() => {
    if (markers.length === 0) return undefined;
    if (markers.length === 1) return undefined;
    return L.latLngBounds(markers.map(m => [m.lat, m.lng] as [number, number]));
  }, [markers]);

  const mapCenter = useMemo(() => {
    if (markers.length === 1) return [markers[0].lat, markers[0].lng] as [number, number];
    return center;
  }, [markers, center]);

  const mapZoom = useMemo(() => {
    if (markers.length === 1) return 10;
    return zoom;
  }, [markers, zoom]);

  return (
    <div className={`rounded-lg overflow-hidden border border-white/10 ${className}`} style={{ minHeight: 320 }}>
      <MapContainer
        center={mapCenter}
        zoom={mapZoom}
        bounds={bounds}
        boundsOptions={{ padding: [40, 40] }}
        scrollWheelZoom
        style={{ height: '100%', width: '100%', minHeight: 320 }}
        className="z-0"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          // @env-config-ok: OpenStreetMap tile URL pattern — by-design hardcoded per RFC 6570 template
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {markers.map((m, i) => (
          <Marker
            key={`${m.lat}-${m.lng}-${i}`}
            position={[m.lat, m.lng]}
            eventHandlers={onMarkerClick ? { click: () => onMarkerClick(m) } : undefined}
          >
            <Popup>
              <div className="text-sm">
                <strong>{m.label}</strong>
                {m.popup && <p className="mt-1">{m.popup}</p>}
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
