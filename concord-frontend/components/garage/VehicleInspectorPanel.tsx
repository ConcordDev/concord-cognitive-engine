'use client';

/**
 * VehicleInspectorPanel — detail drawer for a single vehicle.
 *
 * Backed by the `garage.get` macro (server/domains/garage.js), which is the
 * one path in the garage domain that returns a full row (heading +
 * condition_pct) plus a LIVE occupant count read straight off
 * `vehicle_occupants`. Nothing here is computed client-side beyond simple
 * formatting — every field traces to that macro's response.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Copy, Check, ExternalLink, X } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { ds } from '@/lib/design-system';
import { StatusDot } from '@/components/ui/StatusDot';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { cn } from '@/lib/utils';

export interface InspectedVehicle {
  id: string;
  world_id: string;
  kind: string;
  owner_kind: string;
  owner_id?: string;
  capacity: number;
  fare_cc: number;
  route_id?: string | null;
  pos_x?: number;
  pos_y?: number;
  pos_z?: number;
  heading?: number;
  condition_pct?: number;
}

interface GarageGetResult {
  vehicle: InspectedVehicle;
  occupants: number;
}

export function VehicleInspectorPanel({
  vehicleId,
  onClose,
}: {
  vehicleId: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<GarageGetResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);
    lensRun<GarageGetResult>('garage', 'get', { vehicleId }).then(({ data: res }) => {
      if (cancelled) return;
      if (!res.ok || !res.result) {
        setError(res.error || 'vehicle not found');
      } else {
        setData(res.result);
      }
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [vehicleId]);

  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(vehicleId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard permission denied — non-fatal, just skip the confirmation */
    }
  };

  return (
    <aside
      role="dialog"
      aria-label="Vehicle inspector"
      className="rounded-lg border border-lattice-border bg-lattice-surface p-4 space-y-3"
    >
      <div className="flex items-center justify-between">
        <h2 className={ds.heading3}>Inspector</h2>
        <button
          type="button"
          onClick={onClose}
          className={cn(ds.btnGhost, 'p-1.5')}
          aria-label="Close inspector"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      {loading && (
        <div className="space-y-2">
          <Skeleton variant="line" lines={5} />
        </div>
      )}

      {!loading && error && (
        <ErrorState message={error} variant="inline" title="Couldn't load vehicle" />
      )}

      {!loading && !error && data && (
        <div className="space-y-3 text-sm">
          <div className="flex items-center justify-between">
            <span className={cn(ds.monoLg, 'capitalize')}>{data.vehicle.kind.replace('_', ' ')}</span>
            <StatusDot
              state={data.occupants > 0 ? 'live' : 'idle'}
              label={`${data.occupants}/${data.vehicle.capacity} aboard`}
              showLabel
            />
          </div>

          <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5">
            <dt className={ds.caption}>Owner</dt>
            <dd className={cn(ds.monoXs, 'text-right truncate')}>
              {data.vehicle.owner_kind}
              {data.vehicle.owner_id ? `:${data.vehicle.owner_id.slice(0, 10)}` : ''}
            </dd>

            <dt className={ds.caption}>Capacity</dt>
            <dd className={cn(ds.monoXs, 'text-right')}>{data.vehicle.capacity} seats</dd>

            <dt className={ds.caption}>Fare</dt>
            <dd className={cn(ds.monoXs, 'text-right')}>{data.vehicle.fare_cc} cc</dd>

            {data.vehicle.route_id && (
              <>
                <dt className={ds.caption}>Route</dt>
                <dd className={cn(ds.monoXs, 'text-right truncate')}>{data.vehicle.route_id}</dd>
              </>
            )}

            <dt className={ds.caption}>Position</dt>
            <dd className={cn(ds.monoXs, 'text-right')}>
              ({(data.vehicle.pos_x ?? 0).toFixed(1)}, {(data.vehicle.pos_z ?? 0).toFixed(1)})
            </dd>

            <dt className={ds.caption}>Heading</dt>
            <dd className={cn(ds.monoXs, 'text-right')}>
              {data.vehicle.heading != null ? `${data.vehicle.heading.toFixed(0)}°` : '—'}
            </dd>
          </dl>

          {data.vehicle.condition_pct != null && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className={ds.caption}>Condition</span>
                <span className={ds.monoXs}>{data.vehicle.condition_pct.toFixed(0)}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-lattice-border overflow-hidden">
                <div
                  className={cn(
                    'h-full rounded-full transition-all',
                    data.vehicle.condition_pct > 60
                      ? 'bg-emerald-400'
                      : data.vehicle.condition_pct > 25
                        ? 'bg-amber-400'
                        : 'bg-red-500',
                  )}
                  style={{ width: `${Math.max(0, Math.min(100, data.vehicle.condition_pct))}%` }}
                />
              </div>
            </div>
          )}

          <div className="flex items-center gap-2 pt-1">
            <button type="button" onClick={copyId} className={cn(ds.btnSecondary, 'flex-1 text-xs py-1.5 gap-1.5')}>
              {copied ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
              {copied ? 'Copied' : 'Copy ID'}
            </button>
            <Link
              href="/lenses/world"
              className={cn(ds.btnSecondary, 'flex-1 text-xs py-1.5 gap-1.5 text-center')}
            >
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              Open world
            </Link>
          </div>
          <p className={cn(ds.caption, 'text-center')}>
            Boarding, driving, and parking happen live in the 3D world — walk up and press E.
          </p>
        </div>
      )}
    </aside>
  );
}

export default VehicleInspectorPanel;
