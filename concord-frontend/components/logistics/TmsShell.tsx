'use client';

/**
 * TmsShell — Project44 / SAP TMS-shape silhouette.
 *
 * Top metric strip (Shipments / In transit / On time % / Exceptions),
 * map placeholder with shipment route lines, three-column main:
 * shipments list left, fleet status middle, dock appointments right.
 */

import React from 'react';
import {
  Package, Truck, MapPin, AlertTriangle, CheckCircle, Clock,
  Anchor, Plane, Calendar, ArrowRight, TrendingUp,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export interface TmsShipment {
  id: string;
  trackingNumber: string;
  origin: string;
  destination: string;
  carrierCode?: string;
  mode: 'parcel' | 'ltl' | 'ftl' | 'ocean' | 'air' | 'intermodal' | 'drayage';
  status: 'label_created' | 'picked_up' | 'in_transit' | 'out_for_delivery' | 'delivered' | 'exception' | 'returned';
  estimatedDelivery?: string | null;
}

export interface TmsVehicle { id: string; number: string; status: string; kind: string }
export interface TmsAppointment { id: string; dockName: string; date: string; startTime: string; truckNumber: string; kind: 'pickup' | 'delivery'; status: string }

export interface TmsShellProps {
  totalShipments: number;
  inTransit: number;
  onTimePct: number;
  exceptions: number;
  deliveredToday: number;
  shipments: TmsShipment[];
  vehicles: TmsVehicle[];
  appointments: TmsAppointment[];
  className?: string;
}

const MODE_ICON: Record<TmsShipment['mode'], typeof Package> = {
  parcel: Package, ltl: Truck, ftl: Truck, ocean: Anchor, air: Plane, intermodal: Truck, drayage: Anchor,
};

const STATUS_COLOUR: Record<TmsShipment['status'], string> = {
  label_created: 'bg-gray-500/15 text-gray-300',
  picked_up: 'bg-cyan-500/15 text-cyan-300',
  in_transit: 'bg-cyan-500/20 text-cyan-300',
  out_for_delivery: 'bg-violet-500/20 text-violet-300',
  delivered: 'bg-emerald-500/15 text-emerald-300',
  exception: 'bg-rose-500/15 text-rose-300',
  returned: 'bg-amber-500/15 text-amber-300',
};

const VEHICLE_STATUS: Record<string, string> = {
  available: 'bg-emerald-400', in_use: 'bg-cyan-400', maintenance: 'bg-amber-400', out_of_service: 'bg-gray-500',
};

export function TmsShell({
  totalShipments, inTransit, onTimePct, exceptions, deliveredToday,
  shipments, vehicles, appointments, className,
}: TmsShellProps) {
  return (
    <div className={cn('flex flex-col gap-3 p-4 bg-[#0d1117] text-gray-100', className)}>
      {/* Metric strip */}
      <div className="grid grid-cols-5 gap-2">
        <Metric icon={Package} label="Total" value={String(totalShipments)} caption="shipments" tone="cyan" />
        <Metric icon={Truck} label="In transit" value={String(inTransit)} caption="active" tone="cyan" />
        <Metric icon={TrendingUp} label="On time" value={`${onTimePct}%`} caption="delivery rate" tone="emerald" />
        <Metric icon={CheckCircle} label="Delivered" value={String(deliveredToday)} caption="today" tone="emerald" />
        <Metric icon={AlertTriangle} label="Exceptions" value={String(exceptions)} caption="needs attention" tone="rose" />
      </div>

      {/* Map placeholder with route lines */}
      <section className="rounded-lg border border-cyan-500/20 bg-gradient-to-br from-cyan-900/20 to-violet-900/10 h-32 relative overflow-hidden">
        <div className="absolute inset-0 grid grid-cols-8 grid-rows-3 opacity-10">
          {Array.from({ length: 24 }).map((_, i) => <div key={i} className="border border-white/10" />)}
        </div>
        <svg viewBox="0 0 800 128" className="absolute inset-0 w-full h-full" preserveAspectRatio="none">
          {shipments.slice(0, 6).map((s, i) => {
            const x1 = 60 + (i % 3) * 80;
            const y1 = 30 + (i % 2) * 50;
            const x2 = 600 + (i % 3) * 50;
            const y2 = 30 + ((i + 1) % 2) * 50;
            return (
              <g key={s.id}>
                <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#22d3ee" strokeWidth="1.5" strokeDasharray={s.status === 'delivered' ? '0' : '4 4'} opacity="0.6" />
                <circle cx={x1} cy={y1} r="3" fill="#22d3ee" />
                <circle cx={x2} cy={y2} r="3" fill={s.status === 'delivered' ? '#34d399' : '#a78bfa'} />
              </g>
            );
          })}
        </svg>
        <div className="absolute bottom-2 left-2 text-[10px] uppercase tracking-wider text-cyan-300/70">Real-time visibility · {shipments.length} active routes</div>
      </section>

      {/* Three columns */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* Shipments */}
        <section className="rounded-lg border border-white/10 overflow-hidden">
          <header className="px-3 py-2 bg-white/[0.03] border-b border-white/10 flex items-center gap-2">
            <Package className="w-3.5 h-3.5 text-cyan-400" />
            <span className="text-xs uppercase font-semibold tracking-wider text-gray-300">Active shipments</span>
            <span className="ml-auto text-[10px] text-gray-500">{shipments.length}</span>
          </header>
          {shipments.length === 0 ? (
            <div className="p-4 text-center text-xs text-gray-500">No shipments.</div>
          ) : (
            <ul className="divide-y divide-white/5 max-h-72 overflow-y-auto">
              {shipments.slice(0, 8).map(s => {
                const Icon = MODE_ICON[s.mode];
                return (
                  <li key={s.id} className="px-3 py-2 hover:bg-white/[0.03]">
                    <div className="flex items-center gap-2">
                      <Icon className="w-3.5 h-3.5 text-cyan-300 flex-shrink-0" />
                      <span className="text-[10px] font-mono text-gray-400 flex-shrink-0">{s.trackingNumber.slice(0, 10)}…</span>
                      <span className={cn('text-[9px] uppercase px-1.5 py-0.5 rounded ml-auto', STATUS_COLOUR[s.status])}>{s.status.replace(/_/g, ' ')}</span>
                    </div>
                    <div className="mt-1 flex items-center gap-1.5 text-xs text-gray-200">
                      <span className="truncate flex-1">{s.origin}</span>
                      <ArrowRight className="w-3 h-3 text-gray-500" />
                      <span className="truncate flex-1">{s.destination}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Fleet */}
        <section className="rounded-lg border border-white/10 overflow-hidden">
          <header className="px-3 py-2 bg-white/[0.03] border-b border-white/10 flex items-center gap-2">
            <Truck className="w-3.5 h-3.5 text-violet-400" />
            <span className="text-xs uppercase font-semibold tracking-wider text-gray-300">Fleet status</span>
            <span className="ml-auto text-[10px] text-gray-500">{vehicles.length}</span>
          </header>
          {vehicles.length === 0 ? (
            <div className="p-4 text-center text-xs text-gray-500">No vehicles.</div>
          ) : (
            <ul className="divide-y divide-white/5 max-h-72 overflow-y-auto">
              {vehicles.slice(0, 8).map(v => (
                <li key={v.id} className="px-3 py-2 hover:bg-white/[0.03] flex items-center gap-2">
                  <span className={cn('w-2 h-2 rounded-full', VEHICLE_STATUS[v.status] || 'bg-gray-500')} />
                  <span className="text-xs font-mono text-white">{v.number}</span>
                  <span className="text-[10px] text-gray-500">{v.kind.replace('_', ' ')}</span>
                  <span className="ml-auto text-[10px] uppercase text-gray-400">{v.status.replace('_', ' ')}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Dock appointments */}
        <section className="rounded-lg border border-white/10 overflow-hidden">
          <header className="px-3 py-2 bg-white/[0.03] border-b border-white/10 flex items-center gap-2">
            <Calendar className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-xs uppercase font-semibold tracking-wider text-gray-300">Dock appts</span>
            <span className="ml-auto text-[10px] text-gray-500">{appointments.length}</span>
          </header>
          {appointments.length === 0 ? (
            <div className="p-4 text-center text-xs text-gray-500">No appointments.</div>
          ) : (
            <ul className="divide-y divide-white/5 max-h-72 overflow-y-auto">
              {appointments.slice(0, 8).map(a => (
                <li key={a.id} className="px-3 py-2 hover:bg-white/[0.03]">
                  <div className="flex items-center gap-2">
                    <Clock className="w-3 h-3 text-amber-300" />
                    <span className="text-xs font-mono text-white">{a.startTime}</span>
                    <span className="text-[10px] text-gray-500">{a.dockName}</span>
                    <span className={cn('ml-auto text-[9px] uppercase px-1.5 py-0.5 rounded', a.kind === 'pickup' ? 'bg-cyan-500/15 text-cyan-300' : 'bg-violet-500/15 text-violet-300')}>{a.kind}</span>
                  </div>
                  <div className="text-[10px] text-gray-500 ml-5">{a.truckNumber || '—'} · {a.date}</div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

const TILE_TONE: Record<string, string> = {
  cyan: 'border-cyan-500/20 text-cyan-300',
  emerald: 'border-emerald-500/20 text-emerald-300',
  rose: 'border-rose-500/20 text-rose-300',
  violet: 'border-violet-500/20 text-violet-300',
};

function Metric({ icon: Icon, label, value, caption, tone }: { icon: typeof Package; label: string; value: string; caption: string; tone: string }) {
  return (
    <div className={cn('rounded-lg border bg-white/[0.02] p-2.5', TILE_TONE[tone])}>
      <div className="flex items-center gap-1.5 mb-0.5">
        <Icon className="w-3 h-3" />
        <span className="text-[10px] uppercase tracking-wider text-gray-500">{label}</span>
      </div>
      <div className="text-lg font-mono font-bold tabular-nums text-white">{value}</div>
      <div className="text-[10px] text-gray-500">{caption}</div>
    </div>
  );
}

export default TmsShell;
