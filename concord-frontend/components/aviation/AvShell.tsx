'use client';

/**
 * AvShell — ForeFlight + FlightAware-shape silhouette.
 *
 * Top metric strip (Total hours / 30-day hours / Aircraft / Active tracks),
 * three-column main: map placeholder with track lines on the left,
 * aircraft fleet rail middle, currency/logbook quick-view right.
 *
 * Per "everything must be real": expects real props hydrated from
 * dashboard-summary + list macros — no client-side seed data.
 */

import React from 'react';
import {
  Plane, Clock, BookOpen, Activity, MapPin, AlertCircle, CheckCircle, Fuel,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export interface AvAircraft { id: string; tail: string; make: string; model: string; hobbsHours: number; cruiseKts: number; fuelBurnGph: number }
export interface AvTrack { id: string; tail?: string; from?: string | null; to?: string | null; endedAt: string | null; totalDistanceNm: number; durationMin?: number }
export interface AvCurrency {
  bfr?: { current: boolean; expiresInDays: number | null };
  medical?: { current: boolean; kind: string | null };
  passenger90?: { dayCurrent: boolean; dayCount: number; nightCurrent: boolean; nightCount: number };
  ifr180?: { current: boolean; approaches: number };
}

export interface AvShellProps {
  totalHours: number;
  hours30d: number;
  aircraftCount: number;
  activeTracks: number;
  totalFlights: number;
  aircraft: AvAircraft[];
  tracks: AvTrack[];
  currency?: AvCurrency;
  className?: string;
}

export function AvShell({
  totalHours, hours30d, aircraftCount, activeTracks, totalFlights,
  aircraft, tracks, currency, className,
}: AvShellProps) {
  return (
    <div className={cn('flex flex-col gap-3 p-4 bg-[#0d1117] text-gray-100', className)}>
      {/* Metric strip */}
      <div className="grid grid-cols-4 gap-2">
        <Metric icon={Clock} label="Total hours" value={totalHours.toFixed(1)} caption={`${totalFlights} flights`} tone="cyan" />
        <Metric icon={Activity} label="Last 30d" value={hours30d.toFixed(1)} caption="hours flown" tone="emerald" />
        <Metric icon={Plane} label="Aircraft" value={String(aircraftCount)} caption="in fleet" tone="amber" />
        <Metric icon={MapPin} label="Active tracks" value={String(activeTracks)} caption="recording now" tone="violet" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-3">
        {/* Map placeholder with track lines */}
        <section className="lg:col-span-2 rounded-lg border border-cyan-500/20 bg-gradient-to-br from-cyan-900/20 to-violet-900/10 min-h-[280px] relative overflow-hidden">
          <div className="absolute inset-0 grid grid-cols-8 grid-rows-5 opacity-15">
            {Array.from({ length: 40 }).map((_, i) => <div key={i} className="border border-cyan-500/20" />)}
          </div>
          <svg viewBox="0 0 800 280" className="absolute inset-0 w-full h-full" preserveAspectRatio="none">
            {tracks.slice(0, 6).map((t, i) => {
              const y1 = 40 + (i % 3) * 70;
              const x1 = 60 + (i % 2) * 100;
              const y2 = y1 + (Math.sin(i) * 40);
              const x2 = 640 + (i % 3) * 50;
              return (
                <g key={t.id}>
                  <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#22d3ee" strokeWidth="1.5" strokeDasharray={t.endedAt ? '0' : '4 4'} opacity="0.7" />
                  <circle cx={x1} cy={y1} r="3" fill="#22d3ee" />
                  <circle cx={x2} cy={y2} r="3" fill={t.endedAt ? '#34d399' : '#fbbf24'} />
                  {t.tail && <text x={x1 + 6} y={y1 - 4} fontSize="10" fill="#22d3ee" fontFamily="monospace">{t.tail}</text>}
                </g>
              );
            })}
          </svg>
          <div className="absolute bottom-2 left-2 text-[10px] uppercase tracking-wider text-cyan-300/70">
            {tracks.length === 0 ? 'No track logs yet' : `${tracks.length} recorded flight${tracks.length === 1 ? '' : 's'}`}
          </div>
        </section>

        {/* Aircraft fleet */}
        <section className="lg:col-span-2 rounded-lg border border-white/10 overflow-hidden">
          <header className="px-3 py-2 bg-white/[0.03] border-b border-white/10 flex items-center gap-2">
            <Plane className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-xs uppercase font-semibold tracking-wider text-gray-300">My aircraft</span>
            <span className="ml-auto text-[10px] text-gray-500">{aircraft.length}</span>
          </header>
          {aircraft.length === 0 ? (
            <div className="p-6 text-center text-xs text-gray-500">No aircraft yet — add one from the workbench below.</div>
          ) : (
            <ul className="divide-y divide-white/5 max-h-64 overflow-y-auto">
              {aircraft.slice(0, 8).map(a => (
                <li key={a.id} className="px-3 py-2 hover:bg-white/[0.03] flex items-center gap-3">
                  <Plane className="w-3.5 h-3.5 text-amber-300" />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-mono font-semibold text-white">{a.tail}</div>
                    <div className="text-[10px] text-gray-500">{a.make} {a.model}</div>
                  </div>
                  <span className="text-[10px] text-gray-400 font-mono inline-flex items-center gap-1"><Fuel className="w-2.5 h-2.5" />{a.fuelBurnGph}gph</span>
                  <span className="text-[10px] text-amber-300 font-mono">{a.hobbsHours.toFixed(1)}h</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Currency */}
        <section className="rounded-lg border border-white/10 overflow-hidden">
          <header className="px-3 py-2 bg-white/[0.03] border-b border-white/10 flex items-center gap-2">
            <BookOpen className="w-3.5 h-3.5 text-violet-400" />
            <span className="text-xs uppercase font-semibold tracking-wider text-gray-300">Currency</span>
          </header>
          {!currency ? (
            <div className="p-4 text-center text-xs text-gray-500">No currency events logged yet.</div>
          ) : (
            <ul className="divide-y divide-white/5">
              <CurrencyRow label="BFR" current={currency.bfr?.current} sub={currency.bfr?.expiresInDays != null ? `${currency.bfr.expiresInDays}d left` : 'not set'} />
              <CurrencyRow label="Medical" current={currency.medical?.current} sub={currency.medical?.kind?.replace('medical_', '').replace('_', ' ') || 'not set'} />
              <CurrencyRow label="Day pax" current={currency.passenger90?.dayCurrent} sub={`${currency.passenger90?.dayCount ?? 0}/3 in 90d`} />
              <CurrencyRow label="Night pax" current={currency.passenger90?.nightCurrent} sub={`${currency.passenger90?.nightCount ?? 0}/3 in 90d`} />
              <CurrencyRow label="IFR" current={currency.ifr180?.current} sub={`${currency.ifr180?.approaches ?? 0}/6 in 180d`} />
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function CurrencyRow({ label, current, sub }: { label: string; current?: boolean; sub: string }) {
  return (
    <li className="px-3 py-1.5 flex items-center gap-2">
      {current === true ? <CheckCircle className="w-3 h-3 text-emerald-400" /> : current === false ? <AlertCircle className="w-3 h-3 text-rose-400" /> : <span className="w-3 h-3 rounded-full bg-gray-500/30" />}
      <span className="text-xs text-white">{label}</span>
      <span className="ml-auto text-[10px] text-gray-500">{sub}</span>
    </li>
  );
}

const TILE_TONE: Record<string, string> = {
  cyan: 'border-cyan-500/20 text-cyan-300',
  emerald: 'border-emerald-500/20 text-emerald-300',
  amber: 'border-amber-500/20 text-amber-300',
  violet: 'border-violet-500/20 text-violet-300',
};

function Metric({ icon: Icon, label, value, caption, tone }: { icon: typeof Plane; label: string; value: string; caption: string; tone: string }) {
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

export default AvShell;
