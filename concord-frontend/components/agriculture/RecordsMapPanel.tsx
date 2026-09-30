'use client';

import dynamic from 'next/dynamic';
import { Map as MapIcon } from 'lucide-react';
import { ds } from '@/lib/design-system';
import { ErrorState } from '@/components/common/EmptyState';
import { useLensData } from '@/lib/hooks/use-lens-data';
import type { AgricultureArtifact } from './ag-types';

const MapView = dynamic(() => import('@/components/common/MapView'), { ssr: false });

/** Artifact field map — lat/lng from Field records, not the Ops Center GPS layer. */
export function RecordsMapPanel() {
  const { items, isLoading, isError, error, refetch } = useLensData<AgricultureArtifact>(
    'agriculture',
    'Field',
    { noSeed: true },
  );

  if (isLoading) {
    return (
      <div className={ds.panel} role="status" aria-live="polite" aria-busy="true">
        <p className={ds.textMuted}>Loading field coordinates…</p>
      </div>
    );
  }

  if (isError) {
    return (
      <div role="alert">
        <ErrorState error={error?.message} onRetry={() => refetch()} />
      </div>
    );
  }

  const markers = items
    .filter((i) => {
      const d = i.data;
      return d.lat && d.lng;
    })
    .map((i) => {
      const d = i.data;
      return {
        lat: d.lat as number,
        lng: d.lng as number,
        label: d.name || i.title,
        popup: `${d.location || ''} ${d.acreage ? d.acreage + ' acres' : ''}`.trim(),
      };
    });

  return (
    <div className={ds.panel}>
      <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
        <MapIcon className="w-4 h-4 text-neon-blue" /> Field Mapping
      </h3>
      {markers.length === 0 ? (
        <p className={ds.textMuted}>
          No fields with GPS yet. Add lat/lng on a Field record to plot it here.
        </p>
      ) : (
        <MapView markers={markers} className="h-[500px]" />
      )}
    </div>
  );
}

export default RecordsMapPanel;
