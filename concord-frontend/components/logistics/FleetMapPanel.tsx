'use client';

import dynamic from 'next/dynamic';
import { useQuery } from '@tanstack/react-query';
import { lensRun } from '@/lib/api/client';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { ErrorState } from '@/components/ui';
import { Map } from 'lucide-react';

const MapView = dynamic(() => import('@/components/common/MapView'), { ssr: false });

interface MapVehicle {
  id: string;
  number: string;
  status: string;
  lat: number | null;
  lng: number | null;
}

export function FleetMapPanel() {
  const {
    data: mapVehicles,
    isError: isMapError,
    error: mapError,
    refetch: refetchMap,
  } = useQuery<MapVehicle[]>({
    queryKey: ['logistics', 'map-vehicles'],
    queryFn: async () => {
      const res = await lensRun('logistics', 'fleet-vehicles-list', {});
      if (res.data?.ok === false) throw new Error(res.data?.error || 'Could not load fleet vehicles.');
      return (res.data?.result?.vehicles || []) as MapVehicle[];
    },
    staleTime: 15000,
  });

  return (
    <div className={ds.panel}>
      <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
        <Map className="w-4 h-4 text-neon-cyan" /> Fleet Map
      </h3>
      {isMapError ? (
        <ErrorState message={(mapError as Error | null)?.message || 'Could not load fleet vehicles.'} onRetry={() => void refetchMap()} />
      ) : (
        <>
          <MapView
            markers={(mapVehicles || [])
              .filter((v) => v.lat != null && v.lng != null)
              .map((v) => ({
                lat: v.lat as number,
                lng: v.lng as number,
                label: v.number,
                popup: v.status,
              }))}
            className="h-[500px]"
          />
          {(mapVehicles || []).filter((v) => v.lat != null && v.lng != null).length === 0 && (
            <p className={cn(ds.textMuted, 'text-center py-4')}>
              No vehicle GPS positions yet — positions are set via fleet dispatch status updates.
            </p>
          )}
        </>
      )}
    </div>
  );
}
