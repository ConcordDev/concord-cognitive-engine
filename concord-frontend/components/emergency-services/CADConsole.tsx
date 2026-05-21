'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * CADConsole — computer-aided-dispatch operational console.
 *
 * Wires the emergency-services CAD macros into one purpose-built surface:
 *   incident-create-geo · unit-add · unit-position · map-state ·
 *   triage-queue · nearest-unit · dispatch-unit · unit-status-advance ·
 *   incident-timeline · readiness-rollup · active-alerts
 *
 * No seed/mock data — every value rendered comes from a live macro call.
 */

import { useState, useCallback, useEffect, useMemo } from 'react';
import {
  Siren, Truck, MapPin, AlertTriangle, Radio, ListChecks,
  Loader2, Check, Crosshair, Plus, RefreshCw, Activity, ArrowRight,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { MapView, TimelineView } from '@/components/viz';
import type { MapMarker, TimelineEvent } from '@/components/viz';
import { cn } from '@/lib/utils';

const DOMAIN = 'emergency-services';

interface Incident {
  id: string;
  summary: string;
  kind: string;
  priority: number;
  location: string;
  lat: number | null;
  lng: number | null;
  status: string;
  assignedUnitId: string | null;
  createdAt: string;
}
interface Unit {
  id: string;
  name: string;
  kind: string;
  status: string;
  station: string;
  lat?: number;
  lng?: number;
  assignedIncidentId?: string | null;
}
interface MapPin {
  id: string;
  lat: number;
  lng: number;
  summary?: string;
  name?: string;
  kind: string;
  priority?: number;
  status: string;
  assignedUnitId?: string | null;
}
interface QueueRow {
  id: string;
  summary: string;
  kind: string;
  priority: number;
  priorityLabel: string;
  status: string;
  assignedUnitId: string | null;
  ageMinutes: number;
  dispatchScore: number;
  slaBreached: boolean;
}
interface AlertRow {
  incidentId: string;
  summary: string;
  kind: string;
  priority: number;
  level: string;
  status: string;
  assignedUnitId: string | null;
  ageMinutes: number;
  slaBreached: boolean;
}
interface NearestUnit {
  id: string;
  name: string;
  kind: string;
  station: string;
  distanceKm: number;
  etaMinutes: number;
}
interface Rollup {
  totalUnits: number;
  available: number;
  committed: number;
  outOfService: number;
  readinessPct: number;
  status: string;
  byStatus: Record<string, number>;
  byKind: Record<string, number>;
  kindCoverageGaps: string[];
}
interface TimelineEv {
  id: string;
  incidentId: string;
  kind: string;
  detail: string;
  at: string;
}

const INCIDENT_KINDS = ['medical', 'fire', 'police', 'rescue', 'hazmat', 'traffic', 'other'];
const UNIT_KINDS = ['ambulance', 'fire_engine', 'ladder', 'patrol', 'rescue', 'command', 'hazmat'];

const PRIORITY_TONE: Record<number, MapMarker['tone']> = {
  1: 'bad', 2: 'bad', 3: 'warn', 4: 'info', 5: 'default',
};
const UNIT_STATUS_TONE: Record<string, string> = {
  available: 'text-emerald-400 bg-emerald-400/10',
  dispatched: 'text-amber-400 bg-amber-400/10',
  en_route: 'text-orange-400 bg-orange-400/10',
  on_scene: 'text-cyan-400 bg-cyan-400/10',
  transporting: 'text-blue-400 bg-blue-400/10',
  clear: 'text-zinc-400 bg-zinc-400/10',
  out_of_service: 'text-rose-400 bg-rose-400/10',
};

async function call<T = any>(action: string, input: Record<string, unknown> = {}): Promise<T | null> {
  try {
    const r = await lensRun<T>(DOMAIN, action, input);
    if (r?.data?.ok) return (r.data.result as T) ?? null;
    return null;
  } catch {
    return null;
  }
}

export function CADConsole() {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [incidentPins, setIncidentPins] = useState<MapPin[]>([]);
  const [unitPins, setUnitPins] = useState<MapPin[]>([]);
  const [queue, setQueue] = useState<QueueRow[]>([]);
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [rollup, setRollup] = useState<Rollup | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<TimelineEv[]>([]);
  const [nearest, setNearest] = useState<{ recommended: NearestUnit | null; ranked: NearestUnit[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // incident form
  const [iSummary, setISummary] = useState('');
  const [iKind, setIKind] = useState('medical');
  const [iPriority, setIPriority] = useState('2');
  const [iLocation, setILocation] = useState('');
  const [iLat, setILat] = useState('');
  const [iLng, setILng] = useState('');

  // unit form
  const [uName, setUName] = useState('');
  const [uKind, setUKind] = useState('ambulance');
  const [uStation, setUStation] = useState('');
  const [uLat, setULat] = useState('');
  const [uLng, setULng] = useState('');

  const flash = (kind: 'ok' | 'err', text: string) => {
    setMsg({ kind, text });
    setTimeout(() => setMsg((m) => (m?.text === text ? null : m)), 4500);
  };

  const refreshAll = useCallback(async () => {
    setBusy(true);
    const [incRes, unitRes, mapRes, qRes, alertRes, rollRes] = await Promise.all([
      call<{ incidents: Incident[] }>('incident-list'),
      call<{ units: Unit[] }>('unit-list'),
      call<{ incidentPins: MapPin[]; unitPins: MapPin[] }>('map-state'),
      call<{ queue: QueueRow[] }>('triage-queue'),
      call<{ alerts: AlertRow[] }>('active-alerts'),
      call<Rollup>('readiness-rollup'),
    ]);
    if (incRes) setIncidents(incRes.incidents || []);
    if (unitRes) setUnits(unitRes.units || []);
    if (mapRes) { setIncidentPins(mapRes.incidentPins || []); setUnitPins(mapRes.unitPins || []); }
    if (qRes) setQueue(qRes.queue || []);
    if (alertRes) setAlerts(alertRes.alerts || []);
    if (rollRes) setRollup(rollRes);
    setBusy(false);
  }, []);

  useEffect(() => {
    refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadDetail = useCallback(async (incidentId: string) => {
    setSelectedId(incidentId);
    const [tl, nr] = await Promise.all([
      call<{ events: TimelineEv[] }>('incident-timeline', { incidentId }),
      call<{ recommended: NearestUnit | null; ranked: NearestUnit[] }>('nearest-unit', { incidentId }),
    ]);
    setTimeline(tl?.events || []);
    setNearest(nr ? { recommended: nr.recommended, ranked: nr.ranked || [] } : null);
  }, []);

  async function createIncident() {
    if (!iSummary.trim()) { flash('err', 'Incident summary required.'); return; }
    setBusy(true);
    const params: Record<string, unknown> = {
      summary: iSummary.trim(), kind: iKind, priority: Number(iPriority), location: iLocation.trim(),
    };
    if (iLat.trim() && iLng.trim()) { params.lat = Number(iLat); params.lng = Number(iLng); }
    const res = await call<{ incident: Incident; alert: { fired: boolean; message?: string } }>(
      'incident-create-geo', params,
    );
    setBusy(false);
    if (!res) { flash('err', 'Create failed.'); return; }
    if (res.alert?.fired) flash('err', `ALERT — ${res.alert.message}`);
    else flash('ok', `Incident ${res.incident.id.slice(0, 10)} logged.`);
    setISummary(''); setILocation(''); setILat(''); setILng('');
    await refreshAll();
  }

  async function addUnit() {
    if (!uName.trim()) { flash('err', 'Unit call-sign required.'); return; }
    setBusy(true);
    const res = await call<{ unit: Unit }>('unit-add', {
      name: uName.trim(), kind: uKind, station: uStation.trim(), status: 'available',
    });
    if (res?.unit && uLat.trim() && uLng.trim()) {
      await call('unit-position', { id: res.unit.id, lat: Number(uLat), lng: Number(uLng) });
    }
    setBusy(false);
    if (!res) { flash('err', 'Add unit failed.'); return; }
    flash('ok', `Unit ${res.unit.name} on roster.`);
    setUName(''); setUStation(''); setULat(''); setULng('');
    await refreshAll();
  }

  async function dispatch(incidentId: string, unitId: string) {
    setBusy(true);
    const res = await call<{ distanceKm: number | null }>('dispatch-unit', { incidentId, unitId });
    setBusy(false);
    if (!res) { flash('err', 'Dispatch failed (unit unavailable?).'); return; }
    flash('ok', `Unit dispatched${res.distanceKm != null ? ` — ${res.distanceKm} km` : ''}.`);
    await refreshAll();
    if (selectedId === incidentId) await loadDetail(incidentId);
  }

  async function advanceUnit(unitId: string, next: string) {
    setBusy(true);
    const res = await call<{ transition: { from: string; to: string } }>(
      'unit-status-advance', { id: unitId, status: next },
    );
    setBusy(false);
    if (!res) { flash('err', `Illegal transition → ${next}.`); return; }
    flash('ok', `${res.transition.from} → ${res.transition.to}`);
    await refreshAll();
    if (selectedId) await loadDetail(selectedId);
  }

  const mapMarkers: MapMarker[] = useMemo(() => {
    const im: MapMarker[] = incidentPins.map((p) => ({
      id: `inc-${p.id}`,
      lat: p.lat,
      lon: p.lng,
      label: `${p.summary} (${p.kind} · P${p.priority})`,
      tone: PRIORITY_TONE[p.priority || 3] || 'warn',
    }));
    const um: MapMarker[] = unitPins.map((p) => ({
      id: `unit-${p.id}`,
      lat: p.lat,
      lon: p.lng,
      label: `${p.name} (${p.kind} · ${p.status})`,
      tone: p.status === 'available' ? 'good' : 'info',
    }));
    return [...im, ...um];
  }, [incidentPins, unitPins]);

  const timelineEvents: TimelineEvent[] = useMemo(
    () => timeline.map((e) => ({
      id: e.id,
      label: e.kind,
      time: e.at,
      detail: e.detail,
      tone: e.kind === 'alert' ? 'bad' : e.kind === 'dispatched' ? 'warn' : 'info',
    })),
    [timeline],
  );

  const selectedIncident = incidents.find((i) => i.id === selectedId) || null;
  const NEXT_STATUS: Record<string, string[]> = {
    available: ['dispatched'],
    dispatched: ['en_route'],
    en_route: ['on_scene'],
    on_scene: ['clear', 'transporting'],
    transporting: ['clear'],
  };

  return (
    <div className="space-y-4">
      <header className="flex items-center gap-2">
        <Radio className="h-5 w-5 text-red-400" />
        <h2 className="text-base font-semibold text-white">Computer-Aided Dispatch</h2>
        <button
          onClick={refreshAll}
          disabled={busy}
          className="ml-auto flex items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Refresh
        </button>
      </header>

      {msg && (
        <div className={cn(
          'flex items-start gap-2 rounded-md border px-3 py-2 text-xs',
          msg.kind === 'ok'
            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
            : 'border-rose-500/30 bg-rose-500/10 text-rose-300',
        )}>
          {msg.kind === 'ok' ? <Check className="mt-0.5 h-3.5 w-3.5" /> : <AlertTriangle className="mt-0.5 h-3.5 w-3.5" />}
          <span>{msg.text}</span>
        </div>
      )}

      {/* Readiness rollup — derived live from unit roster */}
      {rollup && (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
          {[
            { label: 'Units', value: rollup.totalUnits, tone: 'text-white' },
            { label: 'Available', value: rollup.available, tone: 'text-emerald-400' },
            { label: 'Committed', value: rollup.committed, tone: 'text-amber-400' },
            { label: 'Out of Service', value: rollup.outOfService, tone: 'text-rose-400' },
            { label: `Readiness · ${rollup.status}`, value: `${rollup.readinessPct}%`, tone: 'text-cyan-400' },
          ].map((s) => (
            <div key={s.label} className="rounded-lg border border-zinc-800 bg-zinc-900 p-2.5">
              <p className={cn('text-xl font-bold', s.tone)}>{s.value}</p>
              <p className="text-[10px] uppercase tracking-wide text-zinc-500">{s.label}</p>
            </div>
          ))}
        </div>
      )}
      {rollup && rollup.kindCoverageGaps.length > 0 && (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-[11px] text-amber-300">
          ⚠ No available unit of type: {rollup.kindCoverageGaps.join(', ')}
        </p>
      )}

      {/* Active alerts — high-priority incidents needing attention */}
      {alerts.length > 0 && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-3">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-rose-300">
            <Siren className="h-3.5 w-3.5" /> Active Alerts ({alerts.length})
          </p>
          <div className="space-y-1.5">
            {alerts.map((a) => (
              <button
                key={a.incidentId}
                onClick={() => loadDetail(a.incidentId)}
                className="flex w-full items-center gap-2 rounded-md border border-rose-500/20 bg-zinc-900/60 px-2.5 py-1.5 text-left text-xs hover:bg-zinc-800"
              >
                <span className={cn(
                  'rounded px-1.5 py-0.5 font-mono text-[10px] font-bold',
                  a.level === 'critical' ? 'bg-rose-500/30 text-rose-200' : 'bg-amber-500/30 text-amber-200',
                )}>
                  P{a.priority}
                </span>
                <span className="flex-1 truncate text-zinc-200">{a.summary}</span>
                <span className="text-[10px] text-zinc-500">{a.ageMinutes}m · {a.kind}</span>
                {a.slaBreached && <span className="font-bold text-rose-400">SLA</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Live incident map */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
        <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-400">
          <MapPin className="h-3.5 w-3.5 text-red-400" /> Live Map — {incidentPins.length} incidents · {unitPins.length} units
        </p>
        <MapView
          markers={mapMarkers}
          height={300}
          onSelect={(m) => { if (m.id.startsWith('inc-')) loadDetail(m.id.slice(4)); }}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Incident intake */}
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 space-y-2">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-red-400">
            <Plus className="h-3.5 w-3.5" /> New Incident
          </p>
          <input
            value={iSummary} onChange={(e) => setISummary(e.target.value)}
            placeholder="Incident summary"
            className="w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs text-white"
          />
          <div className="grid grid-cols-3 gap-1.5">
            <select value={iKind} onChange={(e) => setIKind(e.target.value)} className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs text-white">
              {INCIDENT_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
            <select value={iPriority} onChange={(e) => setIPriority(e.target.value)} className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs text-white">
              {[1, 2, 3, 4, 5].map((p) => <option key={p} value={p}>P{p}</option>)}
            </select>
            <input value={iLocation} onChange={(e) => setILocation(e.target.value)} placeholder="Location" className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs text-white" />
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <input value={iLat} onChange={(e) => setILat(e.target.value)} placeholder="Lat (map pin)" className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs text-white" />
            <input value={iLng} onChange={(e) => setILng(e.target.value)} placeholder="Lng (map pin)" className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs text-white" />
          </div>
          <button onClick={createIncident} disabled={busy} className="w-full rounded bg-red-600 py-1.5 text-xs font-medium text-white hover:bg-red-500 disabled:opacity-40">
            Log Incident
          </button>
        </div>

        {/* Unit roster intake */}
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 space-y-2">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-emerald-400">
            <Truck className="h-3.5 w-3.5" /> Add Unit
          </p>
          <input value={uName} onChange={(e) => setUName(e.target.value)} placeholder="Call-sign (e.g. Engine 3)" className="w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs text-white" />
          <div className="grid grid-cols-2 gap-1.5">
            <select value={uKind} onChange={(e) => setUKind(e.target.value)} className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs text-white">
              {UNIT_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
            <input value={uStation} onChange={(e) => setUStation(e.target.value)} placeholder="Station" className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs text-white" />
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <input value={uLat} onChange={(e) => setULat(e.target.value)} placeholder="Lat (map)" className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs text-white" />
            <input value={uLng} onChange={(e) => setULng(e.target.value)} placeholder="Lng (map)" className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs text-white" />
          </div>
          <button onClick={addUnit} disabled={busy} className="w-full rounded bg-emerald-600 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-40">
            Add to Roster
          </button>
        </div>
      </div>

      {/* Triage queue — priority-ordered with dispatch score */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
        <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-400">
          <ListChecks className="h-3.5 w-3.5 text-amber-400" /> Triage Queue ({queue.length})
        </p>
        {queue.length === 0 && <p className="py-3 text-center text-[11px] text-zinc-600">No open incidents.</p>}
        <div className="space-y-1.5">
          {queue.map((q) => (
            <div
              key={q.id}
              className={cn(
                'rounded-md border px-2.5 py-1.5',
                q.slaBreached ? 'border-rose-500/40 bg-rose-500/5' : 'border-zinc-800 bg-zinc-900/60',
                selectedId === q.id && 'ring-1 ring-cyan-500/50',
              )}
            >
              <div className="flex items-center gap-2 text-xs">
                <span className={cn(
                  'rounded px-1.5 py-0.5 font-mono text-[10px] font-bold',
                  q.priority <= 2 ? 'bg-rose-500/30 text-rose-200' : q.priority === 3 ? 'bg-amber-500/30 text-amber-200' : 'bg-zinc-700 text-zinc-300',
                )}>
                  {q.priorityLabel}
                </span>
                <button onClick={() => loadDetail(q.id)} className="flex-1 truncate text-left text-zinc-200 hover:text-white">
                  {q.summary}
                </button>
                <span className="text-[10px] text-zinc-500">{q.kind} · {q.ageMinutes}m</span>
                <span className="font-mono text-[10px] text-cyan-400" title="dispatch score">⌖{q.dispatchScore}</span>
                {q.slaBreached && <span className="text-[10px] font-bold text-rose-400">SLA BREACH</span>}
                <span className={cn('rounded px-1.5 py-0.5 text-[10px]', UNIT_STATUS_TONE[q.status] || 'bg-zinc-700 text-zinc-300')}>
                  {q.status}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Selected-incident detail: nearest-unit dispatch + timeline */}
      {selectedIncident && (
        <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/5 p-3 space-y-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-cyan-300">
            <Crosshair className="h-3.5 w-3.5" /> Incident Detail — {selectedIncident.summary}
          </p>

          {/* Nearest-unit recommendation */}
          <div>
            <p className="mb-1.5 text-[10px] uppercase tracking-wide text-zinc-500">Nearest available units</p>
            {!nearest && <p className="text-[11px] text-zinc-600">No map position on incident — add lat/lng to enable dispatch routing.</p>}
            {nearest && nearest.ranked.length === 0 && <p className="text-[11px] text-zinc-600">No available geo-located units.</p>}
            <div className="space-y-1">
              {nearest?.ranked.slice(0, 4).map((u, i) => (
                <div key={u.id} className={cn(
                  'flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs',
                  i === 0 ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-zinc-800 bg-zinc-900/60',
                )}>
                  {i === 0 && <span className="rounded bg-emerald-500/30 px-1.5 py-0.5 text-[9px] font-bold text-emerald-200">RECOMMEND</span>}
                  <span className="flex-1 text-zinc-200">{u.name} <span className="text-zinc-500">({u.kind})</span></span>
                  <span className="text-[10px] text-zinc-400">{u.distanceKm} km · ETA {u.etaMinutes}m</span>
                  <button
                    onClick={() => dispatch(selectedIncident.id, u.id)}
                    disabled={busy}
                    className="flex items-center gap-1 rounded bg-cyan-600 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-cyan-500 disabled:opacity-40"
                  >
                    Dispatch <ArrowRight className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Incident timeline */}
          {timelineEvents.length > 0 && (
            <div>
              <p className="mb-1.5 text-[10px] uppercase tracking-wide text-zinc-500">Incident timeline</p>
              <TimelineView events={timelineEvents} height={110} />
            </div>
          )}
        </div>
      )}

      {/* Unit roster — drive the dispatch lifecycle */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
        <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-400">
          <Activity className="h-3.5 w-3.5 text-emerald-400" /> Unit Roster ({units.length})
        </p>
        {units.length === 0 && <p className="py-3 text-center text-[11px] text-zinc-600">No units on roster.</p>}
        <div className="grid grid-cols-1 gap-1.5 md:grid-cols-2">
          {units.map((u) => {
            const nextOptions = NEXT_STATUS[u.status] || [];
            return (
              <div key={u.id} className="rounded-md border border-zinc-800 bg-zinc-900/60 px-2.5 py-1.5">
                <div className="flex items-center gap-2 text-xs">
                  <span className="flex-1 truncate font-medium text-zinc-200">{u.name}</span>
                  <span className="text-[10px] text-zinc-500">{u.kind}</span>
                  <span className={cn('rounded px-1.5 py-0.5 text-[10px]', UNIT_STATUS_TONE[u.status] || 'bg-zinc-700 text-zinc-300')}>
                    {u.status}
                  </span>
                </div>
                {nextOptions.length > 0 && (
                  <div className="mt-1.5 flex gap-1.5">
                    {nextOptions.map((next) => (
                      <button
                        key={next}
                        onClick={() => advanceUnit(u.id, next)}
                        disabled={busy}
                        className="rounded border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-300 hover:bg-zinc-700 disabled:opacity-40"
                      >
                        → {next}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
