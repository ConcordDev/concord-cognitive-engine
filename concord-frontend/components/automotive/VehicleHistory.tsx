'use client';

/**
 * VehicleHistory — Carfax-style vehicle health dashboard for the
 * automotive lens. Patterned on Carfax + RepairPal's vehicle-history
 * report: a license-plate-style VIN hero strip, an odometer gauge,
 * a vertical timeline rail with mixed event types (recalls /
 * maintenance / inspections), and severity-coded markers.
 *
 * Backend (no changes): uses already-wired
 *   • automotive.vin-decode — vehicle metadata
 *   • automotive.recall-lookup — NHTSA recall feed
 *   • automotive.maintenanceSchedule — interval-based service suggestions
 *
 * Distinct from existing VinDecoder (search-style) and FuelRepairPanel
 * (calc form). Timeline-rail layout is the Carfax signature.
 */

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  Loader2, AlertTriangle, Wrench, Gauge, Car, ChevronDown, ChevronUp,
  ShieldAlert, ShieldCheck, FileText,
} from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface VinData {
  vin?: string; make?: string; model?: string; year?: number; trim?: string;
  engine?: string; transmission?: string; bodyClass?: string; fuelType?: string;
  driveType?: string; plant?: string; manufacturer?: string; vehicleType?: string;
}
interface Recall { campaignId?: string; component?: string; summary?: string; consequence?: string; remedy?: string; recallDate?: string }
interface ScheduleItem { service: string; intervalMiles: number; intervalMonths: number; priority: 'low' | 'medium' | 'high'; notes?: string; milesUntilDue: number; overdue: boolean; status: 'due-now' | 'upcoming' | 'ok' }
interface ScheduleResult { mileage?: number; services?: ScheduleItem[]; allCaughtUp?: boolean }

async function callAuto<T>(action: string, input: Record<string, unknown>): Promise<T | null> {
  try {
    const r = await apiHelpers.lens.runDomain('automotive', action, { input });
    const env = (r as { data?: { ok: boolean; result?: T } }).data;
    if (!env?.ok) return null;
    const raw = env.result as unknown as { ok?: boolean; result?: T } | T;
    if (raw && typeof raw === 'object' && 'result' in raw && (raw as { result?: T }).result) {
      return (raw as { result: T }).result;
    }
    return env.result as T;
  } catch { return null; }
}

type TimelineEvent =
  | { kind: 'recall'; date?: string; recall: Recall }
  | { kind: 'maintenance'; mileage: number; item: ScheduleItem };

export function VehicleHistory() {
  const [vin, setVin] = useState('');
  const [odometer, setOdometer] = useState(0);
  const [vinData, setVinData] = useState<VinData | null>(null);
  const [recalls, setRecalls] = useState<Recall[]>([]);
  const [schedule, setSchedule] = useState<ScheduleResult | null>(null);
  const [expandedRecall, setExpandedRecall] = useState<string | null>(null);

  const pull = useMutation({
    mutationFn: async () => {
      const v = await callAuto<VinData>('vin-decode', { vin: vin.trim() });
      setVinData(v);
      const make = v?.make; const model = v?.model; const year = v?.year;
      const [recallsEnv, schedEnv] = await Promise.all([
        callAuto<{ recalls?: Recall[] }>('recall-lookup', { make, model, year }),
        callAuto<ScheduleResult>('maintenanceSchedule', { artifact: { data: { mileage: odometer, year } } }),
      ]);
      setRecalls(recallsEnv?.recalls || []);
      setSchedule(schedEnv);
      return { v, recallsEnv, schedEnv };
    },
  });

  const events: TimelineEvent[] = [
    ...recalls.map((r) => ({ kind: 'recall' as const, date: r.recallDate, recall: r })),
    ...(schedule?.services || []).filter((i) => i.status !== 'ok').map((i) => ({ kind: 'maintenance' as const, mileage: odometer + i.milesUntilDue, item: i })),
  ].sort((a, b) => {
    if (a.kind === 'recall' && b.kind === 'recall') return (b.date || '').localeCompare(a.date || '');
    if (a.kind === 'maintenance' && b.kind === 'maintenance') return a.mileage - b.mileage;
    return a.kind === 'recall' ? -1 : 1;
  });

  const odoPct = Math.min(100, Math.round((odometer / 200000) * 100));
  const odoColour = odometer > 150000 ? 'text-rose-300' : odometer > 100000 ? 'text-amber-300' : 'text-emerald-300';
  const overdueCount = (schedule?.services || []).filter((i) => i.overdue).length;
  const upcomingCount = (schedule?.services || []).filter((i) => i.status === 'upcoming').length;

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950">
      {/* Carfax-style VIN hero — license-plate aesthetic */}
      <div className="border-b border-zinc-800 bg-gradient-to-br from-zinc-900 via-blue-950/30 to-zinc-900 p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="grid h-12 w-12 place-items-center rounded-lg border border-blue-500/30 bg-blue-500/10">
              <Car className="h-6 w-6 text-blue-300" />
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-400">Vehicle Identification</div>
              <input
                className="block w-full rounded border border-transparent bg-transparent font-mono text-xl tracking-wider text-white hover:border-zinc-700 focus:border-blue-500/40 focus:outline-none"
                value={vin}
                onChange={(e) => setVin(e.target.value.toUpperCase())}
                spellCheck={false}
                maxLength={17}
              />
              {vinData && (
                <div className="text-[12px] text-zinc-300">
                  <span className="font-semibold text-white">{vinData.year} {vinData.make} {vinData.model}</span>
                  {vinData.trim && <span className="text-zinc-400"> · {vinData.trim}</span>}
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 rounded border border-zinc-800 bg-zinc-950 px-2 py-1">
              <Gauge className="h-3.5 w-3.5 text-zinc-400" />
              <input type="number" min={0} value={odometer} onChange={(e) => setOdometer(Math.max(0, Number(e.target.value) || 0))} className="w-20 bg-transparent text-right text-xs text-white font-mono focus:outline-none" />
              <span className="text-[10px] text-zinc-400">mi</span>
            </label>
            <button type="button" onClick={() => pull.mutate()} disabled={pull.isPending || vin.trim().length < 11} className="rounded bg-blue-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-400 disabled:opacity-50">
              {pull.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Pull report'}
            </button>
            {(vinData || recalls.length > 0 || schedule) && (
              <SaveAsDtuButton
                compact
                apiSource="concord-auto-vehicle-history"
                title={`${vinData?.year ?? ''} ${vinData?.make ?? ''} ${vinData?.model ?? ''} VIN ${vin} — ${recalls.length} recalls · ${overdueCount} overdue services`}
                content={`VIN: ${vin}\nVehicle: ${vinData?.year} ${vinData?.make} ${vinData?.model} ${vinData?.trim || ''}\nEngine: ${vinData?.engine || 'unknown'}\nOdometer: ${odometer.toLocaleString()} mi\n\nRecalls (${recalls.length}):\n${recalls.map((r) => `  [${r.recallDate || 'undated'}] ${r.component} — ${r.summary}`).join('\n') || '  None'}\n\nMaintenance (${overdueCount} overdue, ${upcomingCount} upcoming):\n${(schedule?.services || []).filter((i) => i.status !== 'ok').map((i) => `  ${i.status === 'due-now' ? '⚠' : '○'} ${i.service} (${i.milesUntilDue} mi)`).join('\n') || '  All caught up'}`}
                extraTags={['automotive', 'vin', vinData?.make?.toLowerCase() || 'unknown']}
                rawData={{ vin, odometer, vinData, recalls, schedule }}
              />
            )}
          </div>
        </div>

        {/* Carfax-style stat row */}
        <div className="mt-4 grid grid-cols-4 gap-2">
          <div className="rounded border border-zinc-800 bg-zinc-950/40 px-2 py-1.5">
            <div className="text-[9px] uppercase tracking-wider text-zinc-400">Odometer</div>
            <div className={`font-mono text-lg ${odoColour}`}>{odometer.toLocaleString()}</div>
            <div className="mt-1 h-1 overflow-hidden rounded-full bg-zinc-800">
              <div className={`h-full ${odometer > 150000 ? 'bg-rose-500' : odometer > 100000 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${odoPct}%` }} />
            </div>
          </div>
          <div className="rounded border border-zinc-800 bg-zinc-950/40 px-2 py-1.5">
            <div className="text-[9px] uppercase tracking-wider text-zinc-400">Recalls</div>
            <div className={`flex items-baseline gap-1 ${recalls.length > 0 ? 'text-rose-300' : 'text-emerald-300'}`}>
              {recalls.length > 0 ? <ShieldAlert className="h-3.5 w-3.5" /> : <ShieldCheck className="h-3.5 w-3.5" />}
              <span className="font-mono text-lg">{recalls.length}</span>
            </div>
          </div>
          <div className="rounded border border-zinc-800 bg-zinc-950/40 px-2 py-1.5">
            <div className="text-[9px] uppercase tracking-wider text-zinc-400">Overdue</div>
            <div className={`font-mono text-lg ${overdueCount > 0 ? 'text-rose-300' : 'text-emerald-300'}`}>{overdueCount}</div>
          </div>
          <div className="rounded border border-zinc-800 bg-zinc-950/40 px-2 py-1.5">
            <div className="text-[9px] uppercase tracking-wider text-zinc-400">Upcoming</div>
            <div className={`font-mono text-lg ${upcomingCount > 0 ? 'text-amber-300' : 'text-zinc-300'}`}>{upcomingCount}</div>
          </div>
        </div>

        {/* Vehicle facts grid */}
        {vinData && (
          <div className="mt-3 grid grid-cols-2 gap-1 text-[10px] sm:grid-cols-4">
            {[['Engine', vinData.engine], ['Trans', vinData.transmission], ['Body', vinData.bodyClass], ['Fuel', vinData.fuelType], ['Drive', vinData.driveType], ['Plant', vinData.plant], ['Mfgr', vinData.manufacturer], ['Type', vinData.vehicleType]].filter(([, v]) => v).map(([k, v]) => (
              <div key={k} className="flex items-center justify-between rounded border border-zinc-800 bg-zinc-950/40 px-1.5 py-1">
                <span className="text-zinc-400">{k}</span>
                <span className="font-mono text-zinc-300">{v}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Vertical timeline rail — Carfax signature */}
      <div className="p-4">
        <div className="mb-3 flex items-center gap-2 text-[11px] uppercase tracking-wider text-zinc-400">
          <FileText className="h-3 w-3" />Vehicle history timeline
        </div>
        {!pull.isPending && events.length === 0 && !vinData && (
          <div className="rounded border border-dashed border-zinc-800 p-6 text-center text-[11px] text-zinc-400">Enter a VIN and odometer above, then "Pull report".</div>
        )}
        {!pull.isPending && events.length === 0 && vinData && (
          <div className="rounded border border-emerald-500/20 bg-emerald-500/5 p-6 text-center text-[11px] text-emerald-200">No active recalls. All maintenance current.</div>
        )}
        {pull.isPending && (
          <div className="flex items-center gap-2 text-xs text-zinc-400"><Loader2 className="h-4 w-4 animate-spin" />Pulling NHTSA data…</div>
        )}
        {events.length > 0 && (
          <div className="relative space-y-2 pl-6">
            <div className="pointer-events-none absolute left-[10px] top-2 bottom-2 w-[2px] bg-zinc-800" aria-hidden="true" />
            {events.map((ev, i) => {
              if (ev.kind === 'recall') {
                const r = ev.recall;
                const id = r.campaignId || `r-${i}`;
                const expanded = expandedRecall === id;
                return (
                  <div key={id} className="relative">
                    <span className="absolute -left-[19px] top-2 grid h-4 w-4 place-items-center rounded-full border-2 border-zinc-950 bg-rose-500"><AlertTriangle className="h-2.5 w-2.5 text-white" /></span>
                    <button type="button" onClick={() => setExpandedRecall(expanded ? null : id)} className="block w-full rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-left hover:bg-rose-500/10">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline gap-2">
                            <span className="font-mono text-[10px] text-rose-300">{r.recallDate || 'Undated'}</span>
                            <span className="truncate text-[12px] font-semibold text-rose-100">{r.component || 'Recall'}</span>
                          </div>
                          <div className="line-clamp-1 text-[11px] text-zinc-400">{r.summary}</div>
                        </div>
                        {expanded ? <ChevronUp className="h-3.5 w-3.5 shrink-0 text-zinc-400" /> : <ChevronDown className="h-3.5 w-3.5 shrink-0 text-zinc-400" />}
                      </div>
                      {expanded && (
                        <div className="mt-2 space-y-1 border-t border-rose-500/20 pt-2 text-[11px] text-zinc-300">
                          {r.consequence && <div><span className="text-rose-300">Consequence: </span>{r.consequence}</div>}
                          {r.remedy && <div><span className="text-emerald-300">Remedy: </span>{r.remedy}</div>}
                          {r.campaignId && <div className="font-mono text-[10px] text-zinc-400">Campaign ID: {r.campaignId}</div>}
                        </div>
                      )}
                    </button>
                  </div>
                );
              }
              const item = ev.item;
              const colour = item.status === 'due-now' ? 'rose' : 'amber';
              return (
                <div key={`m-${i}`} className="relative">
                  <span className={`absolute -left-[19px] top-2 grid h-4 w-4 place-items-center rounded-full border-2 border-zinc-950 bg-${colour}-500`}><Wrench className="h-2.5 w-2.5 text-white" /></span>
                  <div className={`rounded-lg border border-${colour}-500/30 bg-${colour}-500/5 px-3 py-2`}>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className={`text-[12px] font-semibold text-${colour}-100`}>{item.service}</span>
                      <span className={`font-mono text-[10px] text-${colour}-300 uppercase`}>{item.status === 'due-now' ? `${Math.abs(item.milesUntilDue)} mi overdue` : `due in ${item.milesUntilDue} mi`}</span>
                    </div>
                    <div className="text-[11px] text-zinc-400">at ~{(ev.mileage).toLocaleString()} mi · interval {item.intervalMiles.toLocaleString()} mi / {item.intervalMonths} mo</div>
                    {item.notes && <div className="mt-1 text-[10px] text-zinc-400">{item.notes}</div>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
