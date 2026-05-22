'use client';

/**
 * DispatchShell — ServiceTitan + Jobber-shape silhouette.
 *
 * Top metric strip (Today's jobs / Techs deployed / Revenue / Avg rating),
 * three-column main: Dispatch board on left (tech rows × hour slots),
 * Pending bookings + Quotes in middle, Today's revenue + reviews on right.
 * Drop into the trades lens above the existing workbench and the page
 * reads as a field-service ops dashboard inside 200ms.
 */

import React from 'react';
import {
  Wrench, Calendar, DollarSign, Star, Users, FileText, Plus,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export interface DispatchTech {
  id: string;
  name: string;
  status: 'available' | 'on_route' | 'on_site' | 'break' | 'off';
}

export interface DispatchJob {
  id: string;
  customerName: string;
  description: string;
  hour: number;
  durationHours?: number;
  status: string;
  priority?: 'low' | 'normal' | 'high' | 'emergency';
}

export interface DispatchRow {
  tech: DispatchTech;
  jobs: DispatchJob[];
}

export interface DispatchShellProps {
  date: string;
  rows: DispatchRow[];
  unassigned: DispatchJob[];
  jobsToday: number;
  techsTotal: number;
  techsOnJob: number;
  revenueToday: number;
  avgRating: number;
  pendingBookings?: Array<{ id: string; customerName: string; serviceType: string; preferredDate: string | null }>;
  pendingQuotes?: Array<{ id: string; title: string; total: number; status: string }>;
  className?: string;
}

const STATUS_COLOUR: Record<DispatchTech['status'], string> = {
  available: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  on_route: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
  on_site: 'bg-violet-500/20 text-violet-300 border-violet-500/30',
  break: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  off: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
};

const PRIORITY_COLOUR: Record<NonNullable<DispatchJob['priority']>, string> = {
  emergency: 'bg-rose-500 text-white',
  high: 'bg-amber-500 text-black',
  normal: 'bg-cyan-500 text-black',
  low: 'bg-gray-500 text-gray-100',
};

const HOURS = Array.from({ length: 12 }, (_, i) => i + 7); // 7am - 6pm

export function DispatchShell({
  date, rows, unassigned, jobsToday, techsTotal, techsOnJob, revenueToday, avgRating,
  pendingBookings = [], pendingQuotes = [],
  className,
}: DispatchShellProps) {
  return (
    <div className={cn('flex flex-col gap-3 p-4 bg-[#0d1117] text-gray-100', className)}>
      {/* Metric strip */}
      <div className="grid grid-cols-4 gap-2">
        <Metric icon={Calendar} label="Jobs today" value={String(jobsToday)} caption={date} tone="cyan" />
        <Metric icon={Users} label="Techs deployed" value={`${techsOnJob}/${techsTotal}`} caption="of total" tone="violet" />
        <Metric icon={DollarSign} label="Revenue" value={`$${revenueToday.toFixed(0)}`} caption="paid this period" tone="emerald" />
        <Metric icon={Star} label="Avg rating" value={avgRating > 0 ? avgRating.toFixed(1) : '—'} caption="customer reviews" tone="amber" />
      </div>

      {/* Three-column main */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-3">
        {/* Dispatch board - 3 cols */}
        <section className="lg:col-span-3 rounded-lg border border-cyan-500/20 overflow-hidden">
          <header className="px-3 py-2 bg-cyan-500/5 border-b border-cyan-500/20 flex items-center gap-2">
            <Wrench className="w-4 h-4 text-cyan-400" />
            <span className="text-xs uppercase font-semibold tracking-wider text-gray-200">Dispatch board · {date}</span>
            <span className="ml-auto text-[10px] text-gray-500">{rows.length} techs · {jobsToday} jobs</span>
          </header>
          {rows.length === 0 ? (
            <div className="p-6 text-center text-xs text-gray-500">No technicians added.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs min-w-[640px]">
                <thead className="bg-white/[0.02] border-b border-white/5">
                  <tr>
                    <th className="text-left px-3 py-1.5 text-[10px] uppercase tracking-wider text-gray-500 sticky left-0 bg-[#0d1117]">Tech</th>
                    {HOURS.map(h => (
                      <th key={h} className="text-[10px] text-gray-500 font-mono">{h}{h < 12 ? 'a' : 'p'}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {rows.map(r => (
                    <tr key={r.tech.id} className="hover:bg-white/[0.02]">
                      <td className="px-3 py-2 sticky left-0 bg-[#0d1117]">
                        <div className="flex items-center gap-2">
                          <span className={cn('w-2 h-2 rounded-full', r.tech.status === 'available' ? 'bg-emerald-400' : r.tech.status === 'on_site' ? 'bg-violet-400' : r.tech.status === 'on_route' ? 'bg-cyan-400' : 'bg-gray-500')} />
                          <span className="text-white text-xs truncate max-w-[100px]">{r.tech.name}</span>
                        </div>
                        <div className={cn('inline-block text-[9px] uppercase mt-0.5 px-1.5 py-0.5 rounded border', STATUS_COLOUR[r.tech.status])}>{r.tech.status.replace('_', ' ')}</div>
                      </td>
                      {HOURS.map(h => {
                        const job = r.jobs.find(j => j.hour === h);
                        return (
                          <td key={h} className="px-0.5 py-1">
                            {job ? (
                              <div className={cn('rounded px-1 py-0.5 text-[10px] font-medium truncate cursor-pointer', PRIORITY_COLOUR[job.priority || 'normal'])} title={`${job.customerName} · ${job.description}`}>
                                {job.customerName}
                              </div>
                            ) : (
                              <div className="h-4" />
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {unassigned.length > 0 && (
            <div className="px-3 py-2 border-t border-white/5 bg-white/[0.02]">
              <div className="text-[10px] uppercase tracking-wider text-amber-400 mb-1">Unassigned · {unassigned.length}</div>
              <div className="flex flex-wrap gap-1">
                {unassigned.slice(0, 6).map(j => (
                  <span key={j.id} className={cn('text-[10px] px-1.5 py-0.5 rounded', PRIORITY_COLOUR[j.priority || 'normal'])}>{j.customerName}</span>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* Bookings + quotes - 2 cols */}
        <aside className="lg:col-span-2 space-y-3">
          <section className="rounded-lg border border-amber-500/20 overflow-hidden">
            <header className="px-3 py-2 bg-amber-500/5 border-b border-amber-500/20 flex items-center gap-2">
              <Plus className="w-3.5 h-3.5 text-amber-400" />
              <span className="text-xs uppercase font-semibold tracking-wider text-gray-200">Pending bookings</span>
              <span className="ml-auto text-[10px] text-gray-500">{pendingBookings.length}</span>
            </header>
            {pendingBookings.length === 0 ? (
              <div className="p-4 text-center text-xs text-gray-500">No bookings waiting.</div>
            ) : (
              <ul className="divide-y divide-white/5">
                {pendingBookings.slice(0, 4).map(b => (
                  <li key={b.id} className="px-3 py-2 hover:bg-white/[0.03]">
                    <div className="text-xs text-white">{b.customerName}</div>
                    <div className="text-[10px] text-gray-500">{b.serviceType} · {b.preferredDate || 'flexible'}</div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-lg border border-violet-500/20 overflow-hidden">
            <header className="px-3 py-2 bg-violet-500/5 border-b border-violet-500/20 flex items-center gap-2">
              <FileText className="w-3.5 h-3.5 text-violet-400" />
              <span className="text-xs uppercase font-semibold tracking-wider text-gray-200">Quotes pending</span>
              <span className="ml-auto text-[10px] text-gray-500">{pendingQuotes.length}</span>
            </header>
            {pendingQuotes.length === 0 ? (
              <div className="p-4 text-center text-xs text-gray-500">No open quotes.</div>
            ) : (
              <ul className="divide-y divide-white/5">
                {pendingQuotes.slice(0, 4).map(q => (
                  <li key={q.id} className="px-3 py-2 flex items-center justify-between hover:bg-white/[0.03]">
                    <span className="text-xs text-white truncate">{q.title}</span>
                    <span className="text-xs font-mono tabular-nums text-violet-300">${q.total.toFixed(0)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}

const TILE_TONE: Record<string, string> = {
  cyan: 'border-cyan-500/20 text-cyan-300',
  violet: 'border-violet-500/20 text-violet-300',
  emerald: 'border-emerald-500/20 text-emerald-300',
  amber: 'border-amber-500/20 text-amber-300',
};

function Metric({ icon: Icon, label, value, caption, tone }: { icon: typeof Calendar; label: string; value: string; caption: string; tone: string }) {
  return (
    <div className={cn('rounded-lg border bg-white/[0.02] p-3', TILE_TONE[tone])}>
      <div className="flex items-center gap-1.5 mb-0.5">
        <Icon className="w-3 h-3" />
        <span className="text-[10px] uppercase tracking-wider text-gray-500">{label}</span>
      </div>
      <div className="text-xl font-mono font-bold tabular-nums text-white">{value}</div>
      <div className="text-[10px] text-gray-500">{caption}</div>
    </div>
  );
}

export default DispatchShell;
