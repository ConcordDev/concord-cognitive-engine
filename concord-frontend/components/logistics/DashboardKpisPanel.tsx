'use client';

import { useQuery } from '@tanstack/react-query';
import { lensRun } from '@/lib/api/client';
import { ds } from '@/lib/design-system';
import { StatCard } from '@/components/logistics/StatCard';
import {
  Truck, Package, Warehouse, ShieldCheck, AlertTriangle, CheckCircle, DollarSign, Gauge,
} from 'lucide-react';

export interface DashboardSummary {
  totalShipments: number;
  inTransit: number;
  deliveredToday: number;
  exceptions: number;
  onTimePct: number;
  carrierCount: number;
  vehicles: number;
  vehiclesInUse: number;
  pickupsToday: number;
  dockCount: number;
  loadsAvailable: number;
  loadsBooked: number;
}

const EMPTY_SUMMARY: DashboardSummary = {
  totalShipments: 0,
  inTransit: 0,
  deliveredToday: 0,
  exceptions: 0,
  onTimePct: 100,
  carrierCount: 0,
  vehicles: 0,
  vehiclesInUse: 0,
  pickupsToday: 0,
  dockCount: 0,
  loadsAvailable: 0,
  loadsBooked: 0,
};

export function useDashboardSummary() {
  return useQuery<DashboardSummary>({
    queryKey: ['logistics', 'dashboard-summary'],
    queryFn: async () => {
      const res = await lensRun('logistics', 'dashboard-summary', {});
      if (!res.data?.ok) throw new Error(res.data?.error || 'Failed to load dashboard summary');
      return res.data.result as DashboardSummary;
    },
    staleTime: 15000,
  });
}

export function DashboardKpisPanel({ summary }: { summary?: DashboardSummary | null }) {
  const s = summary || EMPTY_SUMMARY;
  return (
    <>
      <div className={ds.grid4}>
        <StatCard icon={Package} label="Total Shipments" value={s.totalShipments} />
        <StatCard icon={Truck} label="In Transit" value={s.inTransit} color="text-neon-purple" />
        <StatCard icon={CheckCircle} label="On-Time Rate" value={`${s.onTimePct}%`} color="text-green-400" />
        <StatCard icon={Warehouse} label="Fleet Vehicles" value={`${s.vehiclesInUse}/${s.vehicles}`} sub="in use / total" color="text-amber-400" />
      </div>
      <div className={ds.grid4}>
        <StatCard icon={AlertTriangle} label="Exceptions" value={s.exceptions} color="text-red-400" />
        <StatCard icon={Gauge} label="Delivered Today" value={s.deliveredToday} />
        <StatCard icon={DollarSign} label="Loads Available" value={s.loadsAvailable} sub={`${s.loadsBooked} booked`} />
        <StatCard icon={ShieldCheck} label="Dock Locations" value={s.dockCount} />
      </div>
    </>
  );
}
