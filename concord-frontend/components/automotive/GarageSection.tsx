'use client';

/**
 * GarageSection — Drivvo + Fuelly + CARFAX Car Care 2026 parity.
 * Multi-vehicle garage, fuel log + MPG, service log + schedule
 * reminders, expense breakdown, trips, documents, per-vehicle stats.
 * Wired to the automotive.* macros.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Car, Loader2, Plus, Trash2, Fuel, Wrench, Receipt, Route, FileText,
  AlertTriangle, Gauge, Bell, Pencil,
} from 'lucide-react';
import { Icon as SvgIcon } from '@/components/icons/Icon';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { lensRun } from '@/lib/api/client';
import { StickyDeleteConfirm } from '@/components/common/StickyDeleteConfirm';
import { cn } from '@/lib/utils';

type Tab = 'overview' | 'fuel' | 'service' | 'expenses' | 'trips' | 'documents';

interface Vehicle { id: string; number: string; name: string; make: string; model: string; year: number | null; odometer: number; odometerUnit: string; fuelUnit: string; licensePlate: string }
interface FuelEntry { id: string; date: string; odometer: number; volume: number; totalCost: number; pricePerUnit: number; fuelGrade: string; mpg: number | null; station: string }
interface ServiceEntry { id: string; serviceType: string; date: string; odometer: number; cost: number; shop: string; notes: string }
interface Reminder { scheduleId: string; serviceType: string; status: 'overdue' | 'due_soon' | 'ok'; milesStatus: { milesRemaining: number } | null; dateStatus: { daysRemaining: number } | null }
interface Expense { id: string; category: string; amount: number; date: string; note: string }
interface Trip { id: string; number: string; date: string; distance: number; purpose: string; from: string; to: string }
interface VehicleDoc { id: string; kind: string; title: string; provider: string; expiryDate: string | null; expired: boolean; expiringSoon: boolean }
interface Stats { lifetimeMpg: number | null; totalSpend: number; fuelSpend: number; fillCount: number; serviceCount: number; milesTracked: number; costPerMile: number | null }

const CAT_COLOURS: Record<string, string> = {
  fuel: '#f59e0b', repair: '#ef4444', maintenance: '#3b82f6', insurance: '#8b5cf6',
  registration: '#06b6d4', tax: '#84cc16', parking: '#ec4899', toll: '#f97316', cleaning: '#14b8a6', other: '#6b7280',
};

export function GarageSection({ onDataChanged }: { onDataChanged?: () => void } = {}) {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [garageQuery, setGarageQuery] = useState('');
  const [garageSort, setGarageSort] = useState<'name' | 'miles'>('name');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [fuel, setFuel] = useState<FuelEntry[]>([]);
  const [service, setService] = useState<ServiceEntry[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [expenses, setExpenses] = useState<{ expenses: Expense[]; total: number; byCategory: Record<string, number> } | null>(null);
  const [trips, setTrips] = useState<{ trips: Trip[]; totalMiles: number; businessMiles: number } | null>(null);
  const [documents, setDocuments] = useState<VehicleDoc[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);

  const refreshVehicles = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const r = await lensRun({ domain: 'automotive', action: 'vehicles-list', input: {} });
      // lensRun never throws — an HTTP/macro failure surfaces as data.ok=false.
      // Surface it instead of silently rendering an empty garage.
      if (!r.data?.ok) { setLoadError(r.data?.error || 'Failed to load garage'); return; }
      const list = (r.data?.result?.vehicles || []) as Vehicle[];
      setVehicles(list);
      if (list.length > 0 && !activeId) setActiveId(list[0].id);
      if (list.length === 0) setActiveId(null);
    } catch (e) { console.error('[Garage] vehicles', e); setLoadError(e instanceof Error ? e.message : 'Failed to load garage'); }
    finally { setLoading(false); }
  }, [activeId]);

  useEffect(() => { refreshVehicles(); }, [refreshVehicles]);

  const refreshVehicleData = useCallback(async (id: string) => {
    try {
      const [f, sv, rem, ex, tr, doc, st] = await Promise.all([
        lensRun({ domain: 'automotive', action: 'fuel-list', input: { vehicleId: id } }),
        lensRun({ domain: 'automotive', action: 'service-list', input: { vehicleId: id } }),
        lensRun({ domain: 'automotive', action: 'service-reminders', input: { vehicleId: id } }),
        lensRun({ domain: 'automotive', action: 'expenses-list', input: { vehicleId: id } }),
        lensRun({ domain: 'automotive', action: 'trips-list', input: { vehicleId: id } }),
        lensRun({ domain: 'automotive', action: 'documents-list', input: { vehicleId: id } }),
        lensRun({ domain: 'automotive', action: 'vehicle-stats', input: { vehicleId: id } }),
      ]);
      setFuel((f.data?.result?.fuel || []) as FuelEntry[]);
      setService((sv.data?.result?.service || []) as ServiceEntry[]);
      setReminders((rem.data?.result?.reminders || []) as Reminder[]);
      setExpenses(ex.data?.result || null);
      setTrips(tr.data?.result || null);
      setDocuments((doc.data?.result?.documents || []) as VehicleDoc[]);
      setStats(st.data?.result || null);
    } catch (e) { console.error('[Garage] vehicleData', e); }
  }, []);

  useEffect(() => { if (activeId) refreshVehicleData(activeId); }, [activeId, refreshVehicleData]);

  const activeVehicle = useMemo(() => vehicles.find(v => v.id === activeId) || null, [vehicles, activeId]);

  async function reloadAll() {
    await refreshVehicles();
    if (activeId) await refreshVehicleData(activeId);
    // The page-level summary strip / renewals widget read the same data —
    // tell the page to refetch so they never sit stale after a mutation.
    onDataChanged?.();
  }

  async function addVehicle() {
    const name = prompt('Vehicle name (e.g. "Daily driver")?'); if (!name?.trim()) return;
    const make = prompt('Make?') || '';
    const model = prompt('Model?') || '';
    const year = prompt('Year?') || '';
    const odometer = prompt('Current odometer?') || '0';
    try {
      const r = await lensRun({ domain: 'automotive', action: 'vehicles-create', input: { name: name.trim(), make, model, year: year.trim() || undefined, odometer: odometer.trim() } });
      if (r.data?.ok === false) { alert(r.data?.message || r.data?.error || 'Could not add the vehicle.'); return; }
      await refreshVehicles();
      onDataChanged?.();
      if (r.data?.result?.vehicle) setActiveId(r.data.result.vehicle.id);
    } catch (e) { console.error('[Garage] addVehicle', e); }
  }
  async function delVehicle(id: string) {
    try { await lensRun({ domain: 'automotive', action: 'vehicles-delete', input: { id } }); setActiveId(null); await refreshVehicles(); onDataChanged?.(); }
    catch (e) { console.error('[Garage] delVehicle', e); }
  }
  async function editVehicle(v: Vehicle) {
    const name = prompt('Vehicle name?', v.name); if (name === null) return;
    const make = prompt('Make?', v.make) ?? v.make;
    const model = prompt('Model?', v.model) ?? v.model;
    const year = prompt('Year?', v.year != null ? String(v.year) : '') ?? '';
    const odometer = prompt('Current odometer?', String(v.odometer)) ?? String(v.odometer);
    try {
      const r = await lensRun({ domain: 'automotive', action: 'vehicles-update', input: {
        id: v.id, name: name.trim() || v.name, make, model,
        year: year.trim() || undefined, odometer: odometer.trim(),
      } });
      if (r.data?.ok === false) { alert(r.data?.message || r.data?.error); return; }
      await reloadAll();
    } catch (e) { console.error('[Garage] editVehicle', e); }
  }
  async function delSchedule(scheduleId: string) {
    if (!confirm('Remove this scheduled service? You will stop getting reminders for it.')) return;
    try { await lensRun({ domain: 'automotive', action: 'schedule-delete', input: { id: scheduleId } }); await reloadAll(); }
    catch (e) { console.error('[Garage] delSchedule', e); }
  }

  async function logFuel() {
    if (!activeId) return;
    const volume = prompt(`Volume (${activeVehicle?.fuelUnit || 'gal'})?`); if (!volume) return;
    const totalCost = prompt('Total cost ($)?'); if (!totalCost) return;
    const odometer = prompt('Odometer reading?', String(activeVehicle?.odometer || '')); if (!odometer) return;
    try {
      const r = await lensRun({ domain: 'automotive', action: 'fuel-log', input: { vehicleId: activeId, volume: Number(volume), totalCost: Number(totalCost), odometer: Number(odometer) } });
      if (r.data?.ok === false) { alert(r.data?.error); return; }
      await reloadAll();
    } catch (e) { console.error('[Garage] logFuel', e); }
  }
  async function delFuel(id: string) {
    try { await lensRun({ domain: 'automotive', action: 'fuel-delete', input: { id } }); await reloadAll(); }
    catch (e) { console.error('[Garage] delFuel', e); }
  }
  async function editFuel(f: { id: string; volume: number; totalCost: number; odometer: number; station?: string }) {
    const volume = prompt('Volume?', String(f.volume)); if (volume === null) return;
    const totalCost = prompt('Total cost ($)?', String(f.totalCost)); if (totalCost === null) return;
    const odometer = prompt('Odometer?', String(f.odometer)); if (odometer === null) return;
    const station = prompt('Station?', f.station || '') ?? (f.station || '');
    const r = await lensRun({ domain: 'automotive', action: 'fuel-update', input: { id: f.id, volume: Number(volume), totalCost: Number(totalCost), odometer: Number(odometer), station } });
    if (r.data?.ok === false) { alert(r.data?.message || r.data?.error || 'Could not update that fill-up.'); return; }
    await reloadAll();
  }

  async function logService() {
    if (!activeId) return;
    const serviceType = prompt('Service type (e.g. Oil change)?'); if (!serviceType?.trim()) return;
    const cost = prompt('Cost ($)?') || '0';
    const odometer = prompt('Odometer?', String(activeVehicle?.odometer || '')) || '';
    try {
      await lensRun({ domain: 'automotive', action: 'service-log', input: { vehicleId: activeId, serviceType: serviceType.trim(), cost: Number(cost), odometer: Number(odometer) || undefined } });
      await reloadAll();
    } catch (e) { console.error('[Garage] logService', e); }
  }
  async function editService(sv: { id: string; serviceType: string; cost: number; odometer: number; shop: string }) {
    const serviceType = prompt('Service type?', sv.serviceType); if (serviceType === null || !serviceType.trim()) return;
    const cost = prompt('Cost ($)?', String(sv.cost)); if (cost === null) return;
    const odometer = prompt('Odometer?', String(sv.odometer)); if (odometer === null) return;
    const shop = prompt('Shop?', sv.shop || '') ?? (sv.shop || '');
    const r = await lensRun({ domain: 'automotive', action: 'service-update', input: { id: sv.id, serviceType: serviceType.trim(), cost: Number(cost), odometer: Number(odometer), shop } });
    if (r.data?.ok === false) { alert(r.data?.message || r.data?.error || 'Could not update that service.'); return; }
    await reloadAll();
  }
  async function delService(id: string) {
    try { await lensRun({ domain: 'automotive', action: 'service-delete', input: { id } }); await reloadAll(); }
    catch (e) { console.error('[Garage] delService', e); }
  }
  async function addSchedule() {
    if (!activeId) return;
    const serviceType = prompt('Recurring service (e.g. Oil change)?'); if (!serviceType?.trim()) return;
    const intervalMiles = prompt('Every how many miles? (blank to skip)') || '';
    const intervalMonths = prompt('Every how many months? (blank to skip)') || '';
    const lastDoneOdometer = prompt('Odometer when last done?') || '';
    try {
      const r = await lensRun({ domain: 'automotive', action: 'schedule-create', input: {
        vehicleId: activeId, serviceType: serviceType.trim(),
        intervalMiles: Number(intervalMiles) || undefined,
        intervalMonths: Number(intervalMonths) || undefined,
        lastDoneOdometer: Number(lastDoneOdometer) || undefined,
      } });
      if (r.data?.ok === false) { alert(r.data?.error); return; }
      await reloadAll();
    } catch (e) { console.error('[Garage] addSchedule', e); }
  }

  async function logExpense() {
    if (!activeId) return;
    const category = prompt('Category (fuel/repair/maintenance/insurance/registration/tax/parking/toll/cleaning/other)?') || 'other';
    const amount = prompt('Amount ($)?'); if (!amount) return;
    const note = prompt('Note?') || '';
    try {
      await lensRun({ domain: 'automotive', action: 'expenses-log', input: { vehicleId: activeId, category: category.trim(), amount: Number(amount), note } });
      await reloadAll();
    } catch (e) { console.error('[Garage] logExpense', e); }
  }
  async function editExpense(e: { id: string; amount: number; note: string; category: string }) {
    const amount = prompt('Amount ($)?', String(e.amount)); if (amount === null) return;
    const note = prompt('Note?', e.note || '') ?? (e.note || '');
    const r = await lensRun({ domain: 'automotive', action: 'expenses-update', input: { id: e.id, amount: Number(amount), note, category: e.category } });
    if (r.data?.ok === false) { alert(r.data?.message || r.data?.error || 'Could not update that expense.'); return; }
    await reloadAll();
  }
  async function delExpense(id: string) {
    try { await lensRun({ domain: 'automotive', action: 'expenses-delete', input: { id } }); await reloadAll(); }
    catch (e) { console.error('[Garage] delExpense', e); }
  }

  async function logTrip() {
    if (!activeId) return;
    const distance = prompt('Distance?'); if (!distance) return;
    const purpose = prompt('Purpose (business/personal/commute/other)?') || 'personal';
    const from = prompt('From?') || '';
    const to = prompt('To?') || '';
    try {
      await lensRun({ domain: 'automotive', action: 'trips-log', input: { vehicleId: activeId, distance: Number(distance), purpose: purpose.trim(), from, to } });
      await reloadAll();
    } catch (e) { console.error('[Garage] logTrip', e); }
  }
  async function editTrip(t: { id: string; distance: number; from: string; to: string; purpose: string }) {
    const distance = prompt('Distance (mi)?', String(t.distance)); if (distance === null) return;
    const from = prompt('From?', t.from || '') ?? (t.from || '');
    const to = prompt('To?', t.to || '') ?? (t.to || '');
    const r = await lensRun({ domain: 'automotive', action: 'trips-update', input: { id: t.id, distance: Number(distance), from, to, purpose: t.purpose } });
    if (r.data?.ok === false) { alert(r.data?.message || r.data?.error || 'Could not update that trip.'); return; }
    await reloadAll();
  }
  async function delTrip(id: string) {
    try { await lensRun({ domain: 'automotive', action: 'trips-delete', input: { id } }); await reloadAll(); }
    catch (e) { console.error('[Garage] delTrip', e); }
  }

  async function addDoc() {
    if (!activeId) return;
    const kind = prompt('Document kind (insurance/registration/inspection/warranty/title/other)?') || 'other';
    const title = prompt('Title?') || kind;
    const provider = prompt('Provider?') || '';
    const expiryDate = prompt('Expiry date (YYYY-MM-DD, blank for none)?') || '';
    try {
      await lensRun({ domain: 'automotive', action: 'documents-create', input: { vehicleId: activeId, kind: kind.trim(), title, provider, expiryDate: expiryDate || undefined } });
      await reloadAll();
    } catch (e) { console.error('[Garage] addDoc', e); }
  }
  async function editDoc(d: { id: string; title: string; provider: string; expiryDate?: string | null }) {
    const title = prompt('Title?', d.title); if (title === null || !title.trim()) return;
    const provider = prompt('Provider?', d.provider || '') ?? (d.provider || '');
    const expiryDate = prompt('Expiry (YYYY-MM-DD)?', d.expiryDate || '') ?? '';
    const r = await lensRun({ domain: 'automotive', action: 'documents-update', input: { id: d.id, title: title.trim(), provider, expiryDate: expiryDate.trim() || undefined } });
    if (r.data?.ok === false) { alert(r.data?.message || r.data?.error || 'Could not update that document.'); return; }
    await reloadAll();
  }
  async function delDoc(id: string) {
    try { await lensRun({ domain: 'automotive', action: 'documents-delete', input: { id } }); await reloadAll(); }
    catch (e) { console.error('[Garage] delDoc', e); }
  }

  const pieData = expenses ? Object.entries(expenses.byCategory).map(([cat, amt]) => ({ name: cat, value: amt, fill: CAT_COLOURS[cat] || '#6b7280' })) : [];
  const shownVehicles = vehicles
    .filter((v) => `${v.name} ${v.make} ${v.model} ${v.year || ''}`.toLowerCase().includes(garageQuery.trim().toLowerCase()))
    .slice()
    .sort((a, b) => garageSort === 'miles' ? b.odometer - a.odometer : a.name.localeCompare(b.name));

  return (
    <div className="flex h-[calc(100vh-180px)] min-h-[600px] bg-[#0d1117] border border-sky-500/15 rounded-lg overflow-hidden">
      {/* Garage rail */}
      <aside className="w-52 bg-[#0a0c10] border-r border-white/5 flex flex-col flex-shrink-0">
        <header className="px-3 py-2.5 border-b border-white/5 flex items-center gap-2">
          <Car className="w-4 h-4 text-sky-400" />
          <span className="text-xs font-semibold text-gray-200 flex-1">Garage</span>
          <button aria-label="Add" onClick={addVehicle} className="p-0.5 text-sky-300 hover:text-sky-200"><Plus className="w-3.5 h-3.5" /></button>
        </header>
        <div className="px-2 py-2 border-b border-white/5 space-y-1">
          <input value={garageQuery} onChange={(e) => setGarageQuery(e.target.value)} placeholder="Search garage" aria-label="Search garage" className="w-full px-2 py-1 text-[11px] bg-black/40 border border-white/10 rounded text-white" />
          <select value={garageSort} onChange={(e) => setGarageSort(e.target.value as 'name' | 'miles')} aria-label="Sort garage" className="w-full px-2 py-1 text-[11px] bg-black/40 border border-white/10 rounded text-white">
            <option value="name">Sort by name</option>
            <option value="miles">Sort by odometer</option>
          </select>
        </div>
        <ul className="flex-1 overflow-y-auto" aria-label="Garage vehicles">
          {loading ? (
            <li role="status" aria-live="polite" className="px-3 py-3 text-xs text-gray-400"><Loader2 className="w-3 h-3 animate-spin inline mr-1" />Loading garage…</li>
          ) : loadError ? (
            <li role="alert" className="px-3 py-4 text-xs text-rose-300 text-center">
              <AlertTriangle className="w-4 h-4 mx-auto mb-1" />
              <div className="mb-2">{loadError}</div>
              <button onClick={() => refreshVehicles()} className="text-sky-300 underline">Retry</button>
            </li>
          ) : vehicles.length === 0 ? (
            <li className="px-3 py-6 text-xs text-gray-400 text-center italic">
              <SvgIcon name="car-silhouette" size={40} className="mx-auto mb-2 not-italic text-gray-600" />
              No vehicles yet. <button onClick={addVehicle} className="text-sky-300 underline">Add your first vehicle</button>
            </li>
          ) : shownVehicles.length === 0 ? (
            <li className="px-3 py-6 text-xs text-gray-400 text-center">No vehicles match that search.</li>
          ) : shownVehicles.map(v => (
            <li key={v.id} onClick={() => setActiveId(v.id)} className={cn('group px-3 py-2 cursor-pointer flex items-center gap-2 hover:bg-white/[0.04]', activeId === v.id && 'bg-sky-500/10 border-l-2 border-sky-400')}>
              <Car className={cn('w-4 h-4', activeId === v.id ? 'text-sky-300' : 'text-gray-400')} />
              <div className="flex-1 min-w-0">
                <div className="text-xs text-white truncate">{v.name}</div>
                <div className="text-[10px] text-gray-400 truncate">{[v.year, v.make, v.model].filter(Boolean).join(' ') || 'no details'} · {v.odometer.toLocaleString()} {v.odometerUnit}</div>
              </div>
              <span onClick={(e) => e.stopPropagation()}>
                <StickyDeleteConfirm onConfirm={() => delVehicle(v.id)} armAriaLabel="Delete vehicle" confirmAriaLabel="Confirm delete vehicle" confirmLabel={`Delete "${v.name}" and its records?`} className="p-0.5 text-rose-300" armLabel={<Trash2 className="w-3 h-3" />} />
              </span>
            </li>
          ))}
        </ul>
      </aside>

      {/* Main */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {!activeVehicle ? (
          <div className="flex-1 flex items-center justify-center text-xs text-gray-400">Add a vehicle to start tracking.</div>
        ) : (
          <>
            <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
              <span className="text-sm font-semibold text-gray-200">{activeVehicle.name}</span>
              <span className="text-[10px] text-gray-400">{activeVehicle.odometer.toLocaleString()} {activeVehicle.odometerUnit}</span>
              <button
                onClick={() => editVehicle(activeVehicle)}
                aria-label={`Edit ${activeVehicle.name}`}
                title="Edit vehicle details"
                className="p-0.5 text-gray-500 hover:text-sky-300"
              >
                <Pencil className="w-3 h-3" />
              </button>
              <nav className="ml-3 flex items-center gap-1">
                {([['overview','Overview',Gauge],['fuel','Fuel',Fuel],['service','Service',Wrench],['expenses','Expenses',Receipt],['trips','Trips',Route],['documents','Docs',FileText]] as const).map(([id,label,Icon]) => (
                  <button key={id} onClick={() => setTab(id)} className={cn('inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded', tab === id ? 'bg-sky-500/15 text-sky-300 border border-sky-500/30' : 'text-gray-400 hover:text-white border border-transparent')}>
                    <Icon className="w-3 h-3" />{label}
                  </button>
                ))}
              </nav>
            </header>

            <div className="flex-1 overflow-y-auto p-4">
              {/* OVERVIEW */}
              {tab === 'overview' && (
                <div className="space-y-3">
                  {stats && (
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                      <Stat label="Lifetime MPG" value={stats.lifetimeMpg !== null ? String(stats.lifetimeMpg) : '—'} />
                      <Stat label="Total spend" value={`$${stats.totalSpend.toLocaleString()}`} />
                      <Stat label="Cost / mile" value={stats.costPerMile !== null ? `$${stats.costPerMile}` : '—'} />
                      <Stat label="Fill-ups" value={String(stats.fillCount)} sub={`${stats.serviceCount} services`} />
                    </div>
                  )}
                  {/* Reminders */}
                  <div className="rounded border border-white/10 bg-black/30 p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <Bell className="w-3.5 h-3.5 text-amber-400" />
                      <span className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold flex-1">Service reminders</span>
                      <button onClick={addSchedule} className="px-2 py-0.5 text-[11px] rounded bg-sky-500 text-white font-bold hover:bg-sky-400 inline-flex items-center gap-1"><Plus className="w-3 h-3" />Schedule</button>
                    </div>
                    {reminders.length === 0 ? (
                      <div className="text-[11px] text-gray-400 italic py-1">No scheduled services. Add one to get mileage/date reminders.</div>
                    ) : (
                      <ul className="space-y-1">
                        {reminders.map(r => (
                          <li key={r.scheduleId} className="group flex items-center gap-2 text-xs">
                            {r.status === 'overdue' ? <AlertTriangle className="w-3.5 h-3.5 text-rose-400" /> : r.status === 'due_soon' ? <Bell className="w-3.5 h-3.5 text-amber-400" /> : <Wrench className="w-3.5 h-3.5 text-emerald-400" />}
                            <span className="text-white flex-1">{r.serviceType}</span>
                            <span className={cn('text-[10px] font-mono', r.status === 'overdue' ? 'text-rose-300' : r.status === 'due_soon' ? 'text-amber-300' : 'text-gray-400')}>
                              {r.milesStatus ? (r.milesStatus.milesRemaining < 0 ? `${Math.abs(r.milesStatus.milesRemaining).toLocaleString()} mi overdue` : `${r.milesStatus.milesRemaining.toLocaleString()} mi left`) :
                               r.dateStatus ? (r.dateStatus.daysRemaining < 0 ? `${Math.abs(r.dateStatus.daysRemaining)} days overdue` : `${r.dateStatus.daysRemaining} days left`) : '—'}
                            </span>
                            <button
                              onClick={() => delSchedule(r.scheduleId)}
                              aria-label={`Remove ${r.serviceType} schedule`}
                              title="Remove this scheduled service"
                              className="opacity-0 group-hover:opacity-100 p-0.5 text-rose-300"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  {/* Expense pie */}
                  {pieData.length > 0 && (
                    <div className="rounded border border-white/10 bg-black/30 p-3">
                      <div className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold mb-1">Spend by category · ${expenses?.total.toLocaleString()}</div>
                      <div className="h-44">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={36} outerRadius={66} paddingAngle={1} stroke="#0d1117" strokeWidth={1.5}>
                              {pieData.map(d => <Cell key={d.name} fill={d.fill} />)}
                            </Pie>
                            <Tooltip contentStyle={{ background: '#0d1117', border: '1px solid #ffffff20', fontSize: 11 }} formatter={(v) => `$${Number(v).toLocaleString()}`} />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* FUEL */}
              {tab === 'fuel' && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">{fuel.length} fill-up(s)</span>
                    <button onClick={logFuel} className="ml-auto px-2.5 py-1 text-xs rounded bg-sky-500 text-white font-semibold hover:bg-sky-400 inline-flex items-center gap-1"><Plus className="w-3 h-3" />Log fill-up</button>
                  </div>
                  {fuel.length === 0 ? <Empty icon={Fuel} label="No fill-ups logged." /> : (
                    <table className="w-full text-xs">
                      <thead className="text-[10px] uppercase text-gray-400 border-b border-white/5">
                        <tr><th className="text-left py-1.5">Date</th><th className="text-right">Odometer</th><th className="text-right">Volume</th><th className="text-right">Cost</th><th className="text-right">$/unit</th><th className="text-right">MPG</th><th></th></tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {fuel.map(f => (
                          <tr key={f.id} className="hover:bg-white/[0.03] group">
                            <td className="py-1.5 text-gray-400 font-mono">{f.date}</td>
                            <td className="text-right font-mono text-gray-300">{f.odometer.toLocaleString()}</td>
                            <td className="text-right font-mono text-gray-300">{f.volume}</td>
                            <td className="text-right font-mono text-white">${f.totalCost.toFixed(2)}</td>
                            <td className="text-right font-mono text-gray-400">{f.pricePerUnit}</td>
                            <td className="text-right font-mono text-sky-300">{f.mpg !== null ? f.mpg : '—'}</td>
                            <td className="text-right whitespace-nowrap"><button type="button" className="mr-2 text-[10px] text-sky-300" onClick={() => editFuel(f)}>Edit</button><StickyDeleteConfirm onConfirm={() => delFuel(f.id)} armAriaLabel="Delete fuel entry" confirmAriaLabel="Confirm delete fuel entry" className="text-rose-300" armLabel={<Trash2 className="w-3 h-3" />} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}

              {/* SERVICE */}
              {tab === 'service' && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">{service.length} service record(s)</span>
                    <button onClick={addSchedule} className="ml-auto px-2.5 py-1 text-xs rounded border border-sky-500/30 text-sky-300 hover:bg-sky-500/10 inline-flex items-center gap-1"><Bell className="w-3 h-3" />Add schedule</button>
                    <button onClick={logService} className="px-2.5 py-1 text-xs rounded bg-sky-500 text-white font-semibold hover:bg-sky-400 inline-flex items-center gap-1"><Plus className="w-3 h-3" />Log service</button>
                  </div>
                  {service.length === 0 ? <Empty icon={Wrench} label="No service records." /> : (
                    <ul className="divide-y divide-white/5">
                      {service.map(sv => (
                        <li key={sv.id} className="py-2 flex items-center gap-3 group">
                          <Wrench className="w-3.5 h-3.5 text-sky-400" />
                          <div className="flex-1 min-w-0">
                            <div className="text-xs text-white">{sv.serviceType}</div>
                            <div className="text-[10px] text-gray-400">{sv.date} · {sv.odometer.toLocaleString()} mi{sv.shop && ` · ${sv.shop}`}</div>
                          </div>
                          <span className="text-xs font-mono text-white">{sv.cost > 0 ? `$${sv.cost.toFixed(2)}` : '—'}</span>
                          <button type="button" className="text-[10px] text-sky-300" onClick={() => editService(sv)}>Edit</button>
                          <StickyDeleteConfirm onConfirm={() => delService(sv.id)} armAriaLabel="Delete service" confirmAriaLabel="Confirm delete service" className="text-rose-300" armLabel={<Trash2 className="w-3 h-3" />} />
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {/* EXPENSES */}
              {tab === 'expenses' && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">${expenses?.total.toLocaleString() || 0} total</span>
                    <button onClick={logExpense} className="ml-auto px-2.5 py-1 text-xs rounded bg-sky-500 text-white font-semibold hover:bg-sky-400 inline-flex items-center gap-1"><Plus className="w-3 h-3" />Log expense</button>
                  </div>
                  {!expenses || expenses.expenses.length === 0 ? <Empty icon={Receipt} label="No expenses logged." /> : (
                    <ul className="divide-y divide-white/5">
                      {expenses.expenses.map(e => (
                        <li key={e.id} className="py-2 flex items-center gap-3 group">
                          <span className="w-2 h-2 rounded-full" style={{ background: CAT_COLOURS[e.category] || '#6b7280' }} />
                          <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-white/5 text-gray-400 w-20 text-center">{e.category}</span>
                          <span className="text-[10px] text-gray-400 font-mono w-20">{e.date}</span>
                          <span className="flex-1 text-xs text-gray-300 truncate">{e.note}</span>
                          <span className="text-xs font-mono text-white">${e.amount.toFixed(2)}</span>
                          <button type="button" className="text-[10px] text-sky-300" onClick={() => editExpense(e)}>Edit</button>
                          <StickyDeleteConfirm onConfirm={() => delExpense(e.id)} armAriaLabel="Delete expense" confirmAriaLabel="Confirm delete expense" className="text-rose-300" armLabel={<Trash2 className="w-3 h-3" />} />
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {/* TRIPS */}
              {tab === 'trips' && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">{trips?.totalMiles || 0} mi · {trips?.businessMiles || 0} business</span>
                    <button onClick={logTrip} className="ml-auto px-2.5 py-1 text-xs rounded bg-sky-500 text-white font-semibold hover:bg-sky-400 inline-flex items-center gap-1"><Plus className="w-3 h-3" />Log trip</button>
                  </div>
                  {!trips || trips.trips.length === 0 ? <Empty icon={Route} label="No trips logged." /> : (
                    <ul className="divide-y divide-white/5">
                      {trips.trips.map(t => (
                        <li key={t.id} className="py-2 flex items-center gap-3 group">
                          <Route className="w-3.5 h-3.5 text-sky-400" />
                          <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-white/5 text-gray-400 w-16 text-center">{t.purpose}</span>
                          <span className="text-[10px] text-gray-400 font-mono w-20">{t.date}</span>
                          <span className="flex-1 text-xs text-gray-300 truncate">{[t.from, t.to].filter(Boolean).join(' → ') || '—'}</span>
                          <span className="text-xs font-mono text-white">{t.distance} mi</span>
                          <button type="button" className="text-[10px] text-sky-300" onClick={() => editTrip(t)}>Edit</button>
                          <StickyDeleteConfirm onConfirm={() => delTrip(t.id)} armAriaLabel="Delete trip" confirmAriaLabel="Confirm delete trip" className="text-rose-300" armLabel={<Trash2 className="w-3 h-3" />} />
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {/* DOCUMENTS */}
              {tab === 'documents' && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">{documents.length} document(s)</span>
                    <button onClick={addDoc} className="ml-auto px-2.5 py-1 text-xs rounded bg-sky-500 text-white font-semibold hover:bg-sky-400 inline-flex items-center gap-1"><Plus className="w-3 h-3" />Add document</button>
                  </div>
                  {documents.length === 0 ? <Empty icon={FileText} label="No documents." /> : (
                    <ul className="divide-y divide-white/5">
                      {documents.map(d => (
                        <li key={d.id} className="py-2 flex items-center gap-3 group">
                          <FileText className={cn('w-3.5 h-3.5', d.expired ? 'text-rose-400' : d.expiringSoon ? 'text-amber-400' : 'text-sky-400')} />
                          <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-white/5 text-gray-400 w-20 text-center">{d.kind}</span>
                          <div className="flex-1 min-w-0">
                            <div className="text-xs text-white truncate">{d.title}</div>
                            <div className="text-[10px] text-gray-400">{d.provider}{d.expiryDate && ` · expires ${d.expiryDate}`}</div>
                          </div>
                          {d.expired && <span className="text-[9px] uppercase text-rose-300">expired</span>}
                          {d.expiringSoon && <span className="text-[9px] uppercase text-amber-300">expiring</span>}
                          <button type="button" className="text-[10px] text-sky-300" onClick={() => editDoc(d)}>Edit</button>
                          <StickyDeleteConfirm onConfirm={() => delDoc(d.id)} armAriaLabel="Delete document" confirmAriaLabel="Confirm delete document" className="text-rose-300" armLabel={<Trash2 className="w-3 h-3" />} />
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded border border-white/10 bg-black/30 p-2.5">
      <div className="text-[10px] uppercase tracking-wider text-gray-400">{label}</div>
      <div className="text-lg font-mono text-white">{value}</div>
      {sub && <div className="text-[10px] text-gray-400">{sub}</div>}
    </div>
  );
}
function Empty({ icon: Icon, label }: { icon: typeof Fuel; label: string }) {
  return <div className="py-10 text-center text-xs text-gray-400"><Icon className="w-6 h-6 mx-auto mb-2 opacity-30" />{label}</div>;
}

export default GarageSection;
