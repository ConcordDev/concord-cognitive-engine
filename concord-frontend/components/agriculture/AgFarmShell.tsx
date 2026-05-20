'use client';

/**
 * AgFarmShell — John Deere Operations Center + Climate FieldView shape.
 *
 * Top metric strip (Acres / Equipment working / Yield this season / Grain
 * stored), field map placeholder with zone overlays on left, equipment
 * status rail middle, work-order today list right.
 */

import React from 'react';
import {
  Wheat, Tractor, BarChart3, Warehouse, MapPin, Activity, Calendar,
  Fuel, Droplet, AlertTriangle, CheckCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export interface AgField { id: string; name: string; acreage: number; currentCrop?: string }
export interface AgEquipment {
  id: string; name: string; kind: string; status: 'idle' | 'working' | 'transporting' | 'maintenance' | 'offline';
  fuelLevelPct?: number; speedMph?: number;
}
export interface AgWorkOrder { id: string; operation: string; kind: string; status: string; scheduledFor?: string | null }

export interface AgFarmShellProps {
  totalFields: number;
  totalAcres: number;
  equipmentCount: number;
  equipmentWorking: number;
  seasonYieldBushels: number;
  avgYieldPerAcre: number;
  grainStored: number;
  grainCapacity: number;
  grainUtilizationPct: number;
  fields: AgField[];
  equipment: AgEquipment[];
  workOrders: AgWorkOrder[];
  className?: string;
}

const EQUIP_STATUS_COLOUR: Record<AgEquipment['status'], string> = {
  idle: 'bg-gray-500/15 text-gray-300',
  working: 'bg-emerald-500/20 text-emerald-300',
  transporting: 'bg-cyan-500/15 text-cyan-300',
  maintenance: 'bg-amber-500/15 text-amber-300',
  offline: 'bg-rose-500/15 text-rose-300',
};

export function AgFarmShell({
  totalFields, totalAcres, equipmentCount, equipmentWorking,
  seasonYieldBushels, avgYieldPerAcre, grainStored, grainCapacity, grainUtilizationPct,
  fields, equipment, workOrders, className,
}: AgFarmShellProps) {
  return (
    <div className={cn('flex flex-col gap-3 p-4 bg-[#0d1117] text-gray-100', className)}>
      {/* Metric strip */}
      <div className="grid grid-cols-4 gap-2">
        <Metric icon={Wheat} label="Acres farmed" value={totalAcres.toFixed(0)} caption={`${totalFields} fields`} tone="emerald" />
        <Metric icon={Tractor} label="Equipment" value={`${equipmentWorking}/${equipmentCount}`} caption="working" tone="amber" />
        <Metric icon={BarChart3} label="Season yield" value={`${(seasonYieldBushels / 1000).toFixed(1)}K bu`} caption={`${avgYieldPerAcre}/ac avg`} tone="cyan" />
        <Metric icon={Warehouse} label="Grain stored" value={`${grainUtilizationPct}%`} caption={`${(grainStored / 1000).toFixed(1)}K / ${(grainCapacity / 1000).toFixed(1)}K bu`} tone="violet" />
      </div>

      {/* Three-column main */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-3">
        {/* Field map placeholder - 2 cols */}
        <section className="lg:col-span-2 rounded-lg border border-emerald-500/20 bg-gradient-to-br from-emerald-900/30 to-amber-900/20 min-h-[280px] relative overflow-hidden">
          <div className="absolute inset-0 grid grid-cols-6 grid-rows-5 opacity-15">
            {Array.from({ length: 30 }).map((_, i) => <div key={i} className="border border-emerald-500/20" />)}
          </div>
          {fields.slice(0, 6).map((f, i) => {
            const left = 10 + (i % 3) * 30;
            const top = 15 + Math.floor(i / 3) * 35;
            const w = 22;
            const h = 28;
            return (
              <div key={f.id} className="absolute rounded border border-emerald-400/40 bg-emerald-500/10 hover:bg-emerald-500/20 transition cursor-pointer p-1" style={{ left: `${left}%`, top: `${top}%`, width: `${w}%`, height: `${h}%` }}>
                <div className="text-[10px] font-bold text-emerald-200">{f.name}</div>
                <div className="text-[9px] text-emerald-300/70">{f.acreage}ac · {f.currentCrop}</div>
              </div>
            );
          })}
          <div className="absolute bottom-2 left-2 text-[10px] uppercase tracking-wider text-emerald-300/70 inline-flex items-center gap-1">
            <MapPin className="w-3 h-3" /> {fields.length} fields
          </div>
        </section>

        {/* Equipment status - 2 cols */}
        <section className="lg:col-span-2 rounded-lg border border-white/10 overflow-hidden">
          <header className="px-3 py-2 bg-white/[0.03] border-b border-white/10 flex items-center gap-2">
            <Tractor className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-xs uppercase font-semibold tracking-wider text-gray-300">Equipment fleet</span>
            <span className="ml-auto text-[10px] text-gray-500">{equipment.length}</span>
          </header>
          {equipment.length === 0 ? (
            <div className="p-6 text-center text-xs text-gray-500">No equipment.</div>
          ) : (
            <ul className="divide-y divide-white/5 max-h-64 overflow-y-auto">
              {equipment.slice(0, 8).map(e => (
                <li key={e.id} className="px-3 py-2 hover:bg-white/[0.03] flex items-center gap-2">
                  <Tractor className="w-4 h-4 text-amber-300" />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-white truncate">{e.name}</div>
                    <div className="text-[10px] text-gray-500">{e.kind}</div>
                  </div>
                  {typeof e.fuelLevelPct === 'number' && (
                    <div className="flex items-center gap-1 text-[10px]">
                      <Fuel className="w-2.5 h-2.5 text-gray-500" />
                      <span className={cn('font-mono', e.fuelLevelPct < 25 ? 'text-rose-300' : 'text-gray-400')}>{e.fuelLevelPct}%</span>
                    </div>
                  )}
                  <span className={cn('text-[9px] uppercase px-1.5 py-0.5 rounded', EQUIP_STATUS_COLOUR[e.status])}>{e.status}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Work orders - 1 col */}
        <section className="rounded-lg border border-white/10 overflow-hidden">
          <header className="px-3 py-2 bg-white/[0.03] border-b border-white/10 flex items-center gap-2">
            <Calendar className="w-3.5 h-3.5 text-cyan-400" />
            <span className="text-xs uppercase font-semibold tracking-wider text-gray-300">Today's work</span>
            <span className="ml-auto text-[10px] text-gray-500">{workOrders.length}</span>
          </header>
          {workOrders.length === 0 ? (
            <div className="p-6 text-center text-xs text-gray-500">No work orders.</div>
          ) : (
            <ul className="divide-y divide-white/5 max-h-64 overflow-y-auto">
              {workOrders.slice(0, 8).map(w => (
                <li key={w.id} className="px-3 py-2 hover:bg-white/[0.03]">
                  <div className="text-xs text-white truncate">{w.operation}</div>
                  <div className="text-[10px] text-gray-500 flex items-center gap-1.5">
                    <span className="text-cyan-300">{w.kind}</span>
                    {w.status === 'completed' ? <CheckCircle className="w-2.5 h-2.5 text-emerald-400" /> : w.status === 'scheduled' ? <Activity className="w-2.5 h-2.5 text-amber-400" /> : <AlertTriangle className="w-2.5 h-2.5 text-rose-400" />}
                    <span className="capitalize">{w.status}</span>
                  </div>
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
  emerald: 'border-emerald-500/20 text-emerald-300',
  amber: 'border-amber-500/20 text-amber-300',
  cyan: 'border-cyan-500/20 text-cyan-300',
  violet: 'border-violet-500/20 text-violet-300',
};

function Metric({ icon: Icon, label, value, caption, tone }: { icon: typeof Wheat; label: string; value: string; caption: string; tone: string }) {
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

export default AgFarmShell;
