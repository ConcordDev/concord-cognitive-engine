'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';

const MapView = dynamic(() => import('@/components/common/MapView'), { ssr: false });

interface Field { id: string; name: string; lat?: number; lng?: number; acreage: number; currentCrop?: string; soilType?: string }
interface Equipment { id: string; name: string; lat: number | null; lng: number | null; status: string; kind: string }

const CROP_EMOJI: Record<string, string> = {
  corn: '🌽', soybeans: '🫘', wheat: '🌾', cotton: '☁️', rice: '🌾', alfalfa: '🍀',
};

export function FieldsMap({ fields, equipment = [], className }: { fields: Field[]; equipment?: Equipment[]; className?: string }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const fieldMarkers = fields.filter(f => Number.isFinite(f.lat) && Number.isFinite(f.lng)).map(f => ({
    lat: Number(f.lat),
    lng: Number(f.lng),
    label: `${CROP_EMOJI[String(f.currentCrop || '').toLowerCase()] || '🌱'} ${f.name}`,
    popup: `<div style="font-weight:600">${f.name}</div><div style="font-size:11px">${f.acreage} ac · ${f.currentCrop || 'fallow'}</div><div style="font-size:10px;color:#666">${f.soilType || ''}</div>`,
  }));
  const equipMarkers = equipment.filter(e => e.lat != null && e.lng != null).map(e => ({
    lat: e.lat!,
    lng: e.lng!,
    label: `🚜 ${e.name}`,
    popup: `<div style="font-weight:600">${e.name}</div><div style="font-size:11px">${e.kind.replace(/_/g, ' ')} · ${e.status.replace(/_/g, ' ')}</div>`,
  }));
  const markers = [...fieldMarkers, ...equipMarkers];

  if (!mounted) return <div className={className} style={{ background: 'rgba(34, 197, 94, 0.05)' }} />;
  if (markers.length === 0) {
    return (
      <div className={className} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: '11px', background: 'rgba(34, 197, 94, 0.05)' }}>
        Add fields with lat/lng (and equipment telemetry) to see them on the farm map.
      </div>
    );
  }
  return (
    <div className={className} style={{ overflow: 'hidden' }}>
      <MapView center={[markers[0].lat, markers[0].lng]} zoom={11} markers={markers} />
    </div>
  );
}

export default FieldsMap;
