'use client';

/**
 * FleetManager — equipment / fleet management + production scheduling.
 * Wires the mining domain macros equipment-add / equipment-update /
 * equipment-delete / fleet-dashboard and production-schedule /
 * schedule-list. Every metric is computed server-side.
 */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz';
import { Truck, Plus, Trash2, Loader2, Gauge, CalendarClock, Wrench } from 'lucide-react';
import { cn } from '@/lib/utils';

interface FleetUnit {
  id: string; name: string; kind: string; status: string;
  engineHours: number; utilization: number; fuelLitres: number;
  hoursToService: number; serviceDue: boolean;
}
interface FleetDash {
  units: FleetUnit[]; fleetSize: number; operating: number; inMaintenance: number;
  serviceDue: number; totalFuelLitres: number; totalEngineHours: number;
  avgUtilization: number; availability: number;
}
interface DailyPlanPoint { day: number; plannedTonnes: number; cumulativeTonnes: number; haulCycles: number; percentComplete: number; }
interface Schedule {
  id: string; name: string; siteId: string | null; targetTonnage: number;
  truckCount: number; truckCapacity: number; cycleMinutes: number;
  dailyCapacity: number; dailyTarget: number; daysToTarget: number;
  feasible: boolean; utilizationPercent: number; dailyPlan: DailyPlanPoint[];
}
interface ScheduleSummary {
  id: string; name: string; siteId: string | null; targetTonnage: number;
  daysToTarget: number; feasible: boolean; createdAt: string;
}

const EQUIP_KINDS = ['haul_truck', 'excavator', 'loader', 'drill_rig', 'dozer', 'grader', 'water_cart', 'other'];
const EQUIP_STATUS = ['operating', 'standby', 'maintenance', 'breakdown'];
const STATUS_COLOR: Record<string, string> = {
  operating: 'text-emerald-400', standby: 'text-sky-400',
  maintenance: 'text-amber-400', breakdown: 'text-red-400',
};

function num(s: string): number { const n = Number(s); return Number.isFinite(n) ? n : 0; }

export function FleetManager() {
  const [dash, setDash] = useState<FleetDash | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // add-equipment form
  const [eName, setEName] = useState('');
  const [eKind, setEKind] = useState('haul_truck');
  const [eEngineHours, setEEngineHours] = useState('0');
  const [eScheduled, setEScheduled] = useState('200');
  const [eFuel, setEFuel] = useState('0');
  const [eNextService, setENextService] = useState('500');

  // production-schedule form
  const [target, setTarget] = useState('500000');
  const [truckCount, setTruckCount] = useState('6');
  const [truckCap, setTruckCap] = useState('90');
  const [cycleMin, setCycleMin] = useState('22');
  const [shiftHours, setShiftHours] = useState('12');
  const [shiftsPerDay, setShiftsPerDay] = useState('2');
  const [days, setDays] = useState('30');
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [savedSchedules, setSavedSchedules] = useState<ScheduleSummary[]>([]);

  const loadDash = useCallback(async () => {
    const r = await lensRun<FleetDash>('mining', 'fleet-dashboard', {});
    if (r.data.ok && r.data.result) setDash(r.data.result);
    else if (r.data.error) setErr(r.data.error);
  }, []);

  const loadSchedules = useCallback(async () => {
    const r = await lensRun<{ schedules: ScheduleSummary[] }>('mining', 'schedule-list', {});
    if (r.data.ok && r.data.result) setSavedSchedules(r.data.result.schedules);
  }, []);

  useEffect(() => { void loadDash(); void loadSchedules(); }, [loadDash, loadSchedules]);

  async function addEquipment() {
    if (!eName.trim()) { setErr('Equipment name required.'); return; }
    setBusy('add-eq'); setErr(null);
    const r = await lensRun('mining', 'equipment-add', {
      name: eName.trim(), kind: eKind, engineHours: num(eEngineHours),
      scheduledHours: num(eScheduled), fuelLitres: num(eFuel), nextServiceHours: num(eNextService),
    });
    setBusy(null);
    if (r.data.ok) { setEName(''); await loadDash(); }
    else setErr(r.data.error || 'add failed');
  }

  async function cycleStatus(unit: FleetUnit) {
    const next = EQUIP_STATUS[(EQUIP_STATUS.indexOf(unit.status) + 1) % EQUIP_STATUS.length];
    setBusy(`st-${unit.id}`); setErr(null);
    const r = await lensRun('mining', 'equipment-update', { id: unit.id, status: next });
    setBusy(null);
    if (r.data.ok) await loadDash();
    else setErr(r.data.error || 'update failed');
  }

  async function delEquipment(id: string) {
    setBusy(`del-${id}`); setErr(null);
    const r = await lensRun('mining', 'equipment-delete', { id });
    setBusy(null);
    if (r.data.ok) await loadDash();
    else setErr(r.data.error || 'delete failed');
  }

  async function runSchedule(save: boolean) {
    setBusy(save ? 'save-sch' : 'run-sch'); setErr(null);
    const r = await lensRun<{ schedule: Schedule }>('mining', 'production-schedule', {
      name: `${target} t plan`, targetTonnage: num(target), truckCount: num(truckCount),
      truckCapacityTonnes: num(truckCap), haulCycleMinutes: num(cycleMin),
      shiftHours: num(shiftHours), shiftsPerDay: num(shiftsPerDay), days: num(days), save,
    });
    setBusy(null);
    if (r.data.ok && r.data.result) {
      setSchedule(r.data.result.schedule);
      if (save) await loadSchedules();
    } else setErr(r.data.error || 'schedule failed');
  }

  return (
    <div className="rounded-lg border border-stone-500/20 bg-zinc-950/60 p-3 space-y-4">
      <header className="flex items-center gap-2 border-b border-stone-500/10 pb-2">
        <Truck className="h-4 w-4 text-sky-400" />
        <h3 className="text-sm font-semibold text-white">Fleet management & production scheduling</h3>
      </header>

      {err && <div className="text-[11px] text-red-300 bg-red-500/10 border border-red-500/30 rounded px-2 py-1">{err}</div>}

      {/* ── Fleet dashboard ── */}
      {dash && (
        <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
          <Stat label="Fleet" value={String(dash.fleetSize)} />
          <Stat label="Operating" value={String(dash.operating)} accent="#22c55e" />
          <Stat label="Maint." value={String(dash.inMaintenance)} accent="#f59e0b" />
          <Stat label="Service due" value={String(dash.serviceDue)} accent="#ef4444" />
          <Stat label="Avail %" value={String(dash.availability)} accent="#06b6d4" />
          <Stat label="Avg util %" value={String(dash.avgUtilization)} accent="#a855f7" />
        </div>
      )}

      {/* ── Add equipment ── */}
      <div className="grid grid-cols-2 md:grid-cols-7 gap-1.5">
        <input value={eName} onChange={(e) => setEName(e.target.value)} placeholder="Unit name"
          className="md:col-span-2 bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-[12px] text-white" />
        <select value={eKind} onChange={(e) => setEKind(e.target.value)}
          className="bg-zinc-900 border border-zinc-800 rounded px-1 py-1.5 text-[11px] text-white">
          {EQUIP_KINDS.map((k) => <option key={k} value={k}>{k.replace(/_/g, ' ')}</option>)}
        </select>
        <input value={eEngineHours} onChange={(e) => setEEngineHours(e.target.value.replace(/[^\d.]/g, ''))} placeholder="Engine h"
          className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-[11px] text-white font-mono" />
        <input value={eScheduled} onChange={(e) => setEScheduled(e.target.value.replace(/[^\d.]/g, ''))} placeholder="Sched h"
          className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-[11px] text-white font-mono" />
        <input value={eFuel} onChange={(e) => setEFuel(e.target.value.replace(/[^\d.]/g, ''))} placeholder="Fuel L"
          className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-[11px] text-white font-mono" />
        <input value={eNextService} onChange={(e) => setENextService(e.target.value.replace(/[^\d.]/g, ''))} placeholder="Service @ h"
          className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-[11px] text-white font-mono" />
      </div>
      <button type="button" onClick={addEquipment} disabled={!!busy}
        className="flex items-center gap-1.5 px-3 py-1.5 bg-sky-700 hover:bg-sky-600 disabled:opacity-40 text-white rounded text-[12px]">
        {busy === 'add-eq' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Add equipment
      </button>

      {/* ── Fleet list ── */}
      <div className="space-y-1.5">
        <div className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold flex items-center gap-1">
          <Gauge className="w-3 h-3" /> Fleet units ({dash?.units.length ?? 0})
        </div>
        {(!dash || dash.units.length === 0) && <div className="text-[11px] text-zinc-600 py-2">No equipment registered.</div>}
        {dash?.units.map((u) => (
          <div key={u.id} className="flex items-center gap-2 rounded border border-zinc-800 bg-zinc-900/40 p-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-[12px] font-semibold text-white">
                <Truck className="w-3 h-3 text-sky-400" /> {u.name}
                <span className="text-[10px] text-zinc-500">· {u.kind.replace(/_/g, ' ')}</span>
              </div>
              <div className="text-[10px] text-zinc-500">
                {u.engineHours}h engine · util {u.utilization}% · fuel {u.fuelLitres}L ·{' '}
                <span className={u.serviceDue ? 'text-red-400' : 'text-zinc-500'}>
                  {u.serviceDue ? 'service overdue' : `${u.hoursToService}h to service`}
                </span>
              </div>
            </div>
            {u.serviceDue && <Wrench className="w-3.5 h-3.5 text-red-400" />}
            <button type="button" onClick={() => cycleStatus(u)} disabled={!!busy}
              className={cn('text-[10px] font-semibold uppercase tracking-wide px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700', STATUS_COLOR[u.status])}>
              {busy === `st-${u.id}` ? '…' : u.status}
            </button>
            <button type="button" onClick={() => delEquipment(u.id)} disabled={!!busy}
              className="p-1 text-zinc-500 hover:text-red-400" aria-label="Delete unit">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>

      {/* ── Production schedule ── */}
      <div className="border-t border-zinc-800 pt-3 space-y-2">
        <div className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold flex items-center gap-1">
          <CalendarClock className="w-3 h-3" /> Production schedule — haul cycles & daily targets
        </div>
        <div className="grid grid-cols-3 md:grid-cols-7 gap-1.5">
          <Field label="Target t" value={target} onChange={setTarget} />
          <Field label="Trucks" value={truckCount} onChange={setTruckCount} />
          <Field label="Truck cap t" value={truckCap} onChange={setTruckCap} />
          <Field label="Cycle min" value={cycleMin} onChange={setCycleMin} />
          <Field label="Shift h" value={shiftHours} onChange={setShiftHours} />
          <Field label="Shifts/day" value={shiftsPerDay} onChange={setShiftsPerDay} />
          <Field label="Days" value={days} onChange={setDays} />
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => runSchedule(false)} disabled={!!busy}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-700 hover:bg-violet-600 disabled:opacity-40 text-white rounded text-[12px]">
            {busy === 'run-sch' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CalendarClock className="w-3.5 h-3.5" />} Compute schedule
          </button>
          <button type="button" onClick={() => runSchedule(true)} disabled={!!busy}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 text-white rounded text-[12px]">
            {busy === 'save-sch' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Save schedule
          </button>
        </div>

        {schedule && (
          <div className="rounded-lg border border-violet-500/20 bg-zinc-900/40 p-3 space-y-2">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
              <Stat label="Daily cap t" value={schedule.dailyCapacity.toLocaleString()} />
              <Stat label="Daily target t" value={schedule.dailyTarget.toLocaleString()} accent="#8b5cf6" />
              <Stat label="Days to target" value={schedule.daysToTarget === null ? '∞' : String(schedule.daysToTarget)} />
              <Stat label="Utilisation %" value={String(schedule.utilizationPercent)} accent="#06b6d4" />
              <Stat label="Feasible" value={schedule.feasible ? 'yes' : 'no'} accent={schedule.feasible ? '#22c55e' : '#ef4444'} />
            </div>
            <ChartKit kind="area" data={schedule.dailyPlan as unknown as Array<Record<string, unknown>>} xKey="day"
              series={[{ key: 'cumulativeTonnes', label: 'Cumulative tonnes', color: '#8b5cf6' }]} height={180} showLegend={false} />
            <div className="text-[9px] text-zinc-600">X = production day. Curve plateaus once the target tonnage is moved.</div>
          </div>
        )}

        {savedSchedules.length > 0 && (
          <div className="space-y-1">
            <div className="text-[9px] uppercase tracking-wide text-zinc-500">Saved schedules ({savedSchedules.length})</div>
            {savedSchedules.map((s) => (
              <div key={s.id} className="flex items-center justify-between text-[11px] bg-zinc-900/60 rounded px-2 py-1">
                <span className="text-zinc-300">{s.name}</span>
                <span className="font-mono text-zinc-500">
                  {s.targetTonnage.toLocaleString()} t ·{' '}
                  <span className={s.feasible ? 'text-emerald-400' : 'text-red-400'}>{s.daysToTarget} days</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="text-[9px] text-zinc-500 block mb-0.5">{label}</label>
      <input value={value} onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ''))}
        className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white font-mono" />
    </div>
  );
}

function Stat({ label, value, accent = '#e4e4e7' }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-900/60 px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="text-[13px] font-bold truncate" style={{ color: accent }}>{value}</div>
    </div>
  );
}
