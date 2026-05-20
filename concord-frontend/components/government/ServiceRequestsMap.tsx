'use client';

import dynamic from 'next/dynamic';
import { useMemo } from 'react';

const MapView = dynamic(() => import('@/components/common/MapView'), { ssr: false });

interface Request {
  id: string; referenceNumber: string; category: string; description: string;
  lat: number; lng: number; address: string;
  status: string; priority: 'low' | 'medium' | 'high' | 'urgent';
}

const PRIORITY_LABEL: Record<Request['priority'], string> = {
  urgent: '🔴', high: '🟠', medium: '🟡', low: '⚪',
};

export function ServiceRequestsMap({ requests, className }: { requests: Request[]; className?: string }) {
  const markers = useMemo(() => requests.filter(r => Number.isFinite(r.lat) && Number.isFinite(r.lng)).map(r => ({
    lat: r.lat,
    lng: r.lng,
    label: `${PRIORITY_LABEL[r.priority] || '⚪'} ${r.referenceNumber}`,
    popup: `<div style="font-weight:600">${r.referenceNumber}</div><div style="font-size:11px;text-transform:uppercase;color:#888">${r.category.replace(/_/g, ' ')}</div><div style="font-size:11px;color:#444">${r.description}</div><div style="font-size:10px;color:#888;margin-top:4px">${r.address || ''}</div><div style="font-size:10px;color:#666">Status: ${r.status.replace(/_/g, ' ')}</div>`,
  })), [requests]);

  if (markers.length === 0) {
    return (
      <div className={className} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: '11px' }}>
        No geocoded service requests to map yet.
      </div>
    );
  }

  return (
    <div className={className} style={{ overflow: 'hidden', borderRadius: 8 }}>
      <MapView
        center={[markers[0].lat, markers[0].lng]}
        zoom={12}
        markers={markers}
      />
    </div>
  );
}

export default ServiceRequestsMap;
