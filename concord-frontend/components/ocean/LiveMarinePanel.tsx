'use client';

/**
 * LiveMarinePanel — live marine data for the ocean lens. Wires the
 * seven backlog macros against Open-Meteo / NOAA NDBC / AISHub free
 * APIs:
 *   ocean.marine-forecast  — wave/swell/period forecast at a point
 *   ocean.ais-vessels      — live AIS vessel positions in a bbox
 *   ocean.ndbc-buoy        — NOAA NDBC real-time buoy observation
 *   ocean.surf-score       — combined swell+wind+tide surf rating
 *   ocean.sea-surface-temp — SST current value + 24h series
 *   ocean.tide-alert-*     — tide reminder CRUD + next-tide check
 *   ocean.session-export   — GPX / CSV logbook export
 *
 * All inputs are user-supplied — nothing is pre-filled with demo data.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Waves, Ship, Radio, Activity, Thermometer, Bell, Download,
  Loader2, Trash2, MapPin, RefreshCw,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz';
import { cn } from '@/lib/utils';

// ── shared types ────────────────────────────────────────────────
interface ForecastPoint {
  time: string;
  waveHeight: number | null;
  wavePeriod: number | null;
  swellHeight: number | null;
  swellPeriod: number | null;
  windWaveHeight: number | null;
  seaSurfaceTemp: number | null;
}
interface ForecastResult {
  lat: number; lon: number; hours: number;
  units: Record<string, string>;
  series: ForecastPoint[];
  peakWaveHeight: number | null;
}
interface AisVessel {
  mmsi: string | number; name: string; type: string;
  lat: number; lon: number; speed: number; heading: number;
  destination: string | null; lastSeen: string | null;
}
interface AisResult { vessels: AisVessel[]; count: number }
interface BuoyResult {
  buoyId: string; observedAt: string;
  waveHeightM: number | null; dominantWavePeriodS: number | null;
  meanWaveDirectionDeg: number | null; windSpeedMs: number | null;
  windGustMs: number | null; airTempC: number | null;
  waterTempC: number | null; pressureHpa: number | null;
}
interface SurfResult {
  spotName: string | null; score: number; rating: string;
  components: { swellHeightM: number; swellPeriodS: number; windWaveHeightM: number; windSpeedKmh: number };
  summary: string;
}
interface SstResult {
  lat: number; lon: number; current: number | null;
  min: number | null; max: number | null;
  series: Array<{ time: string; temp: number | null }>;
}
interface TideAlert {
  id: string; stationId: string; stationName: string;
  tideType: string; leadMinutes: number; label: string;
}
interface AlertCheck {
  alertId: string; stationName: string; tideType?: string;
  label?: string; nextTide?: { time: string; height: number; type: string };
  notifyAt?: string; minutesUntilNotify?: number; due?: boolean; error?: string;
}
interface Spot { id: string; name: string; kind: string; lat: number | null; lon: number | null }

type SubTab = 'Forecast' | 'AIS' | 'Buoy' | 'Surf' | 'SST' | 'Alerts' | 'Export';

const SUB_TABS: { key: SubTab; label: string; icon: typeof Waves }[] = [
  { key: 'Forecast', label: 'Marine Forecast', icon: Waves },
  { key: 'AIS', label: 'Live Vessels', icon: Ship },
  { key: 'Buoy', label: 'NDBC Buoy', icon: Radio },
  { key: 'Surf', label: 'Surf Score', icon: Activity },
  { key: 'SST', label: 'Sea Temp', icon: Thermometer },
  { key: 'Alerts', label: 'Tide Alerts', icon: Bell },
  { key: 'Export', label: 'Logbook Export', icon: Download },
];

const inputCls =
  'w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white placeholder-zinc-600 focus:border-cyan-500/50 focus:outline-none';
const btnCls =
  'inline-flex items-center justify-center gap-1.5 rounded bg-cyan-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-cyan-500 disabled:opacity-40';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[9px] uppercase tracking-wider text-zinc-400">{label}</span>
      {children}
    </label>
  );
}

function ErrLine({ msg }: { msg: string }) {
  return (
    <div className="rounded border border-rose-500/30 bg-rose-500/10 px-2.5 py-1.5 text-[11px] text-rose-200">
      {msg}
    </div>
  );
}

// ── Marine Forecast ─────────────────────────────────────────────
function ForecastTab() {
  const [lat, setLat] = useState('');
  const [lon, setLon] = useState('');
  const [hours, setHours] = useState('48');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [res, setRes] = useState<ForecastResult | null>(null);

  async function run() {
    if (!lat.trim() || !lon.trim()) { setErr('Enter a latitude and longitude.'); return; }
    setBusy(true); setErr(''); setRes(null);
    try {
      const r = await lensRun('ocean', 'marine-forecast', {
        lat: Number(lat), lon: Number(lon), hours: Number(hours) || 48,
      });
      if (r.data?.ok) setRes(r.data.result as ForecastResult);
      else setErr(r.data?.error || 'Forecast unavailable.');
    } catch { setErr('Request failed.'); } finally { setBusy(false); }
  }

  const chartData = (res?.series || []).map((p) => ({
    time: p.time.slice(5, 16).replace('T', ' '),
    wave: p.waveHeight ?? 0,
    swell: p.swellHeight ?? 0,
    windWave: p.windWaveHeight ?? 0,
  }));

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <Field label="Latitude"><input className={inputCls} placeholder="e.g. 37.7" value={lat} onChange={(e) => setLat(e.target.value)} /></Field>
        <Field label="Longitude"><input className={inputCls} placeholder="e.g. -122.5" value={lon} onChange={(e) => setLon(e.target.value)} /></Field>
        <Field label="Hours (max 168)"><input className={inputCls} placeholder="48" value={hours} onChange={(e) => setHours(e.target.value)} /></Field>
      </div>
      <button className={btnCls} onClick={run} disabled={busy}>
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Waves className="h-3.5 w-3.5" />}
        Get marine forecast
      </button>
      {err && <ErrLine msg={err} />}
      {res && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2 text-[11px]">
            <span className="rounded border border-cyan-500/20 bg-cyan-500/5 px-2 py-1 text-cyan-200">
              Peak wave: <span className="font-mono">{res.peakWaveHeight ?? '—'} {res.units?.wave_height || 'm'}</span>
            </span>
            <span className="rounded border border-zinc-800 bg-zinc-950/40 px-2 py-1 text-zinc-400">{res.hours}h · Open-Meteo Marine</span>
          </div>
          <ChartKit
            kind="area"
            data={chartData}
            xKey="time"
            series={[
              { key: 'wave', label: 'Wave (m)', color: '#06b6d4' },
              { key: 'swell', label: 'Swell (m)', color: '#6366f1' },
              { key: 'windWave', label: 'Wind wave (m)', color: '#f59e0b' },
            ]}
            height={220}
          />
        </div>
      )}
    </div>
  );
}

// ── AIS live vessels ────────────────────────────────────────────
function AisTab() {
  const [box, setBox] = useState({ latMin: '', latMax: '', lonMin: '', lonMax: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [res, setRes] = useState<AisResult | null>(null);

  async function run() {
    const { latMin, latMax, lonMin, lonMax } = box;
    if (!latMin || !latMax || !lonMin || !lonMax) { setErr('Enter all four bounding-box coordinates.'); return; }
    setBusy(true); setErr(''); setRes(null);
    try {
      const r = await lensRun('ocean', 'ais-vessels', {
        latMin: Number(latMin), latMax: Number(latMax), lonMin: Number(lonMin), lonMax: Number(lonMax),
      });
      if (r.data?.ok) setRes(r.data.result as AisResult);
      else setErr(r.data?.error || 'AIS feed unavailable.');
    } catch { setErr('Request failed.'); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-4 gap-2">
        <Field label="Lat min"><input className={inputCls} value={box.latMin} onChange={(e) => setBox({ ...box, latMin: e.target.value })} /></Field>
        <Field label="Lat max"><input className={inputCls} value={box.latMax} onChange={(e) => setBox({ ...box, latMax: e.target.value })} /></Field>
        <Field label="Lon min"><input className={inputCls} value={box.lonMin} onChange={(e) => setBox({ ...box, lonMin: e.target.value })} /></Field>
        <Field label="Lon max"><input className={inputCls} value={box.lonMax} onChange={(e) => setBox({ ...box, lonMax: e.target.value })} /></Field>
      </div>
      <button className={btnCls} onClick={run} disabled={busy}>
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Ship className="h-3.5 w-3.5" />}
        Pull live AIS positions
      </button>
      {err && <ErrLine msg={err} />}
      {res && (
        <div className="space-y-1">
          <p className="text-[11px] text-zinc-400">{res.count} vessels in box · source: AISHub</p>
          <ul className="max-h-72 space-y-1 overflow-y-auto">
            {res.vessels.map((v) => (
              <li key={String(v.mmsi)} className="flex items-center gap-2 rounded border border-zinc-800 bg-zinc-950/40 px-2.5 py-1.5">
                <Ship className="h-3.5 w-3.5 shrink-0 text-cyan-400" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs text-zinc-100">{v.name}</p>
                  <p className="text-[10px] text-zinc-400">
                    {v.type} · {v.speed?.toFixed(1) ?? '—'} kn · {v.lat.toFixed(3)},{v.lon.toFixed(3)}
                    {v.destination ? ` → ${v.destination}` : ''}
                  </p>
                </div>
                <span className="font-mono text-[10px] text-zinc-400">MMSI {v.mmsi}</span>
              </li>
            ))}
            {res.vessels.length === 0 && <li className="py-4 text-center text-[11px] italic text-zinc-400">No vessels reported in this box.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── NDBC buoy ───────────────────────────────────────────────────
function BuoyTab() {
  const [buoyId, setBuoyId] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [res, setRes] = useState<BuoyResult | null>(null);

  async function run() {
    if (!buoyId.trim()) { setErr('Enter an NDBC buoy ID (e.g. 46026).'); return; }
    setBusy(true); setErr(''); setRes(null);
    try {
      const r = await lensRun('ocean', 'ndbc-buoy', { buoyId: buoyId.trim() });
      if (r.data?.ok) setRes(r.data.result as BuoyResult);
      else setErr(r.data?.error || 'Buoy data unavailable.');
    } catch { setErr('Request failed.'); } finally { setBusy(false); }
  }

  const stat = (label: string, value: number | null, unit: string) => (
    <div className="rounded border border-zinc-800 bg-zinc-950/40 px-2 py-1.5">
      <div className="text-[9px] uppercase text-zinc-400">{label}</div>
      <div className="font-mono text-sm text-cyan-200">{value == null ? '—' : `${value}${unit}`}</div>
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input className={inputCls} placeholder="NDBC buoy ID (e.g. 46026)" value={buoyId} onChange={(e) => setBuoyId(e.target.value)} />
        <button className={btnCls} onClick={run} disabled={busy}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Radio className="h-3.5 w-3.5" />}
          Read buoy
        </button>
      </div>
      {err && <ErrLine msg={err} />}
      {res && (
        <div className="space-y-2">
          <p className="text-[11px] text-zinc-400">Buoy {res.buoyId} · observed {res.observedAt} · NOAA NDBC</p>
          <div className="grid grid-cols-3 gap-2">
            {stat('Wave height', res.waveHeightM, ' m')}
            {stat('Dom. period', res.dominantWavePeriodS, ' s')}
            {stat('Wave dir', res.meanWaveDirectionDeg, '°')}
            {stat('Wind speed', res.windSpeedMs, ' m/s')}
            {stat('Wind gust', res.windGustMs, ' m/s')}
            {stat('Water temp', res.waterTempC, ' °C')}
            {stat('Air temp', res.airTempC, ' °C')}
            {stat('Pressure', res.pressureHpa, ' hPa')}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Surf score ──────────────────────────────────────────────────
function SurfTab({ spots }: { spots: Spot[] }) {
  const [mode, setMode] = useState<'spot' | 'coords'>('spot');
  const [spotId, setSpotId] = useState('');
  const [lat, setLat] = useState('');
  const [lon, setLon] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [res, setRes] = useState<SurfResult | null>(null);

  const geoSpots = spots.filter((s) => s.lat != null && s.lon != null);

  async function run() {
    setBusy(true); setErr(''); setRes(null);
    try {
      let params: Record<string, unknown>;
      if (mode === 'spot') {
        if (!spotId) { setErr('Pick a geolocated spot.'); setBusy(false); return; }
        params = { spotId };
      } else {
        if (!lat.trim() || !lon.trim()) { setErr('Enter a latitude and longitude.'); setBusy(false); return; }
        params = { lat: Number(lat), lon: Number(lon) };
      }
      const r = await lensRun('ocean', 'surf-score', params);
      if (r.data?.ok) setRes(r.data.result as SurfResult);
      else setErr(r.data?.error || 'Surf score unavailable.');
    } catch { setErr('Request failed.'); } finally { setBusy(false); }
  }

  const ratingColor = (rating: string) =>
    rating === 'epic' ? 'text-emerald-300' : rating === 'good' ? 'text-cyan-300'
      : rating === 'fair' ? 'text-amber-300' : 'text-rose-300';

  return (
    <div className="space-y-3">
      <div className="flex gap-1 text-[11px]">
        <button onClick={() => setMode('spot')} className={cn('rounded px-2 py-1', mode === 'spot' ? 'bg-cyan-600 text-white' : 'bg-zinc-900 text-zinc-400')}>Saved spot</button>
        <button onClick={() => setMode('coords')} className={cn('rounded px-2 py-1', mode === 'coords' ? 'bg-cyan-600 text-white' : 'bg-zinc-900 text-zinc-400')}>Coordinates</button>
      </div>
      {mode === 'spot' ? (
        <Field label="Geolocated spot">
          <select className={inputCls} value={spotId} onChange={(e) => setSpotId(e.target.value)}>
            <option value="">Select a spot…</option>
            {geoSpots.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.kind})</option>)}
          </select>
        </Field>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <Field label="Latitude"><input className={inputCls} value={lat} onChange={(e) => setLat(e.target.value)} /></Field>
          <Field label="Longitude"><input className={inputCls} value={lon} onChange={(e) => setLon(e.target.value)} /></Field>
        </div>
      )}
      {mode === 'spot' && geoSpots.length === 0 && (
        <p className="text-[10px] italic text-zinc-400">No geolocated spots yet — add lat/lon to a spot, or use coordinates.</p>
      )}
      <button className={btnCls} onClick={run} disabled={busy}>
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Activity className="h-3.5 w-3.5" />}
        Score surf conditions
      </button>
      {err && <ErrLine msg={err} />}
      {res && (
        <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-3">
          <div className="flex items-baseline gap-3">
            <span className="font-mono text-3xl text-cyan-200">{res.score}</span>
            <span className={cn('text-lg font-bold capitalize', ratingColor(res.rating))}>{res.rating}</span>
            {res.spotName && <span className="text-[11px] text-zinc-400">{res.spotName}</span>}
          </div>
          <p className="mt-1 text-[11px] text-zinc-400">{res.summary}</p>
          <div className="mt-2 grid grid-cols-4 gap-2 text-[10px]">
            <div className="rounded border border-zinc-800 bg-zinc-950/40 px-2 py-1"><div className="text-zinc-400">Swell</div><div className="font-mono text-cyan-200">{res.components.swellHeightM} m</div></div>
            <div className="rounded border border-zinc-800 bg-zinc-950/40 px-2 py-1"><div className="text-zinc-400">Period</div><div className="font-mono text-cyan-200">{res.components.swellPeriodS} s</div></div>
            <div className="rounded border border-zinc-800 bg-zinc-950/40 px-2 py-1"><div className="text-zinc-400">Wind wave</div><div className="font-mono text-amber-200">{res.components.windWaveHeightM} m</div></div>
            <div className="rounded border border-zinc-800 bg-zinc-950/40 px-2 py-1"><div className="text-zinc-400">Wind</div><div className="font-mono text-amber-200">{res.components.windSpeedKmh} km/h</div></div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sea surface temperature ─────────────────────────────────────
function SstTab() {
  const [lat, setLat] = useState('');
  const [lon, setLon] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [res, setRes] = useState<SstResult | null>(null);

  async function run() {
    if (!lat.trim() || !lon.trim()) { setErr('Enter a latitude and longitude.'); return; }
    setBusy(true); setErr(''); setRes(null);
    try {
      const r = await lensRun('ocean', 'sea-surface-temp', { lat: Number(lat), lon: Number(lon) });
      if (r.data?.ok) setRes(r.data.result as SstResult);
      else setErr(r.data?.error || 'SST data unavailable.');
    } catch { setErr('Request failed.'); } finally { setBusy(false); }
  }

  const chartData = (res?.series || []).map((p) => ({ time: p.time.slice(11, 16), temp: p.temp ?? 0 }));

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <Field label="Latitude"><input className={inputCls} placeholder="e.g. 24.5" value={lat} onChange={(e) => setLat(e.target.value)} /></Field>
        <Field label="Longitude"><input className={inputCls} placeholder="e.g. -81.8" value={lon} onChange={(e) => setLon(e.target.value)} /></Field>
      </div>
      <button className={btnCls} onClick={run} disabled={busy}>
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Thermometer className="h-3.5 w-3.5" />}
        Get sea surface temperature
      </button>
      {err && <ErrLine msg={err} />}
      {res && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2 text-[11px]">
            <span className="rounded border border-cyan-500/20 bg-cyan-500/5 px-2 py-1 text-cyan-200">Current: <span className="font-mono">{res.current ?? '—'} °C</span></span>
            <span className="rounded border border-zinc-800 bg-zinc-950/40 px-2 py-1 text-zinc-400">24h range: {res.min ?? '—'}–{res.max ?? '—'} °C</span>
          </div>
          <ChartKit kind="line" data={chartData} xKey="time" series={[{ key: 'temp', label: 'SST (°C)', color: '#06b6d4' }]} height={200} />
        </div>
      )}
    </div>
  );
}

// ── Tide alerts ─────────────────────────────────────────────────
function AlertsTab() {
  const [alerts, setAlerts] = useState<TideAlert[]>([]);
  const [checks, setChecks] = useState<AlertCheck[]>([]);
  const [form, setForm] = useState({ stationId: '', stationName: '', tideType: 'both', leadMinutes: '60', label: '' });
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [err, setErr] = useState('');

  const refresh = useCallback(async () => {
    const r = await lensRun('ocean', 'tide-alerts-check', {});
    if (r.data?.ok) {
      setChecks((r.data.result?.alerts as AlertCheck[]) || []);
    }
  }, []);

  // List is derived from the check call's alertIds; we keep our own
  // mirror because add/delete return the full alert object.
  async function loadAlerts() {
    const r = await lensRun('ocean', 'tide-alerts-check', {});
    if (r.data?.ok) {
      const checked = (r.data.result?.alerts as AlertCheck[]) || [];
      setChecks(checked);
    }
  }
  useEffect(() => { void loadAlerts(); }, []);

  async function addAlert() {
    if (!form.stationId.trim()) { setErr('Station ID is required.'); return; }
    setBusy(true); setErr('');
    try {
      const r = await lensRun('ocean', 'tide-alert-add', {
        stationId: form.stationId.trim(),
        stationName: form.stationName.trim() || undefined,
        tideType: form.tideType,
        leadMinutes: Number(form.leadMinutes) || 60,
        label: form.label.trim() || undefined,
      });
      if (r.data?.ok) {
        const a = r.data.result?.alert as TideAlert;
        setAlerts((prev) => [...prev, a]);
        setForm({ stationId: '', stationName: '', tideType: 'both', leadMinutes: '60', label: '' });
        await refresh();
      } else setErr(r.data?.error || 'Could not add alert.');
    } catch { setErr('Request failed.'); } finally { setBusy(false); }
  }

  async function delAlert(id: string) {
    await lensRun('ocean', 'tide-alert-delete', { id });
    setAlerts((prev) => prev.filter((a) => a.id !== id));
    setChecks((prev) => prev.filter((c) => c.alertId !== id));
  }

  async function runCheck() {
    setChecking(true);
    try { await refresh(); } finally { setChecking(false); }
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
        <div className="grid grid-cols-2 gap-2">
          <Field label="NOAA station ID"><input className={inputCls} placeholder="e.g. 9414290" value={form.stationId} onChange={(e) => setForm({ ...form, stationId: e.target.value })} /></Field>
          <Field label="Station name (optional)"><input className={inputCls} placeholder="e.g. San Francisco" value={form.stationName} onChange={(e) => setForm({ ...form, stationName: e.target.value })} /></Field>
          <Field label="Tide type">
            <select className={inputCls} value={form.tideType} onChange={(e) => setForm({ ...form, tideType: e.target.value })}>
              <option value="both">High or low</option>
              <option value="high">High only</option>
              <option value="low">Low only</option>
            </select>
          </Field>
          <Field label="Lead minutes"><input className={inputCls} placeholder="60" value={form.leadMinutes} onChange={(e) => setForm({ ...form, leadMinutes: e.target.value })} /></Field>
          <div className="col-span-2">
            <Field label="Label (optional)"><input className={inputCls} placeholder="e.g. dawn patrol window" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} /></Field>
          </div>
        </div>
        <button className={cn(btnCls, 'mt-2')} onClick={addAlert} disabled={busy}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bell className="h-3.5 w-3.5" />}
          Add tide alert
        </button>
        {err && <div className="mt-2"><ErrLine msg={err} /></div>}
      </div>

      <div className="flex items-center gap-2">
        <button className={cn(btnCls, 'bg-zinc-800 hover:bg-zinc-700')} onClick={runCheck} disabled={checking}>
          {checking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Check next tides
        </button>
        <span className="text-[10px] text-zinc-400">{checks.length} alert{checks.length === 1 ? '' : 's'} tracked</span>
      </div>

      <ul className="space-y-1">
        {checks.map((c) => {
          const a = alerts.find((x) => x.id === c.alertId);
          return (
            <li key={c.alertId} className={cn('rounded border px-2.5 py-1.5', c.due ? 'border-amber-500/40 bg-amber-500/10' : 'border-zinc-800 bg-zinc-950/40')}>
              <div className="flex items-center gap-2">
                <Bell className={cn('h-3.5 w-3.5 shrink-0', c.due ? 'text-amber-300' : 'text-cyan-400')} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs text-zinc-100">{c.stationName}{a?.label ? ` · ${a.label}` : c.label ? ` · ${c.label}` : ''}</p>
                  {c.error ? (
                    <p className="text-[10px] text-rose-300">{c.error}</p>
                  ) : c.nextTide ? (
                    <p className="text-[10px] text-zinc-400">
                      Next {c.nextTide.type} {c.nextTide.height?.toFixed(2)}m @ {c.nextTide.time} ·
                      {c.due ? ' due now' : ` notify in ${c.minutesUntilNotify} min`}
                    </p>
                  ) : null}
                </div>
                <button onClick={() => delAlert(c.alertId)} className="text-rose-400 hover:text-rose-300" aria-label="Delete alert"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            </li>
          );
        })}
        {checks.length === 0 && <li className="py-4 text-center text-[11px] italic text-zinc-400">No tide alerts. Add one above.</li>}
      </ul>
    </div>
  );
}

// ── Logbook export ──────────────────────────────────────────────
function ExportTab({ spots }: { spots: Spot[] }) {
  const [format, setFormat] = useState<'csv' | 'gpx'>('csv');
  const [spotId, setSpotId] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState('');

  async function run() {
    setBusy(true); setErr(''); setDone('');
    try {
      const r = await lensRun('ocean', 'session-export', {
        format,
        spotId: spotId || undefined,
      });
      if (r.data?.ok) {
        const result = r.data.result as { filename: string; mimeType: string; content: string; count: number };
        const blob = new Blob([result.content], { type: result.mimeType });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = result.filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        setDone(`Exported ${result.count} session${result.count === 1 ? '' : 's'} → ${result.filename}`);
      } else setErr(r.data?.error || 'Export failed.');
    } catch { setErr('Request failed.'); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-zinc-400">Download your logged surf/dive/fishing sessions as a GPX track or CSV spreadsheet.</p>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Format">
          <select className={inputCls} value={format} onChange={(e) => setFormat(e.target.value as 'csv' | 'gpx')}>
            <option value="csv">CSV spreadsheet</option>
            <option value="gpx">GPX track (geolocated only)</option>
          </select>
        </Field>
        <Field label="Scope">
          <select className={inputCls} value={spotId} onChange={(e) => setSpotId(e.target.value)}>
            <option value="">All spots</option>
            {spots.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
      </div>
      <button className={btnCls} onClick={run} disabled={busy}>
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
        Export logbook
      </button>
      {err && <ErrLine msg={err} />}
      {done && <div className="rounded border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1.5 text-[11px] text-emerald-200">{done}</div>}
    </div>
  );
}

// ── shell ───────────────────────────────────────────────────────
export function LiveMarinePanel() {
  const [tab, setTab] = useState<SubTab>('Forecast');
  const [spots, setSpots] = useState<Spot[]>([]);

  useEffect(() => {
    void (async () => {
      const r = await lensRun('ocean', 'spot-list', {});
      if (r.data?.ok) setSpots((r.data.result?.spots as Spot[]) || []);
    })();
  }, []);

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
      <div className="mb-3 flex items-center gap-2">
        <MapPin className="h-4 w-4 text-cyan-400" />
        <h3 className="text-sm font-bold text-zinc-100">Live Marine Data</h3>
        <span className="ml-auto text-[10px] text-zinc-400">Open-Meteo · NOAA NDBC · AISHub</span>
      </div>

      <div className="mb-3 flex flex-wrap gap-1 rounded-lg bg-zinc-900 p-1">
        {SUB_TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-medium transition-colors',
              tab === key ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-zinc-300',
            )}
          >
            <Icon className="h-3.5 w-3.5" /> {label}
          </button>
        ))}
      </div>

      {tab === 'Forecast' && <ForecastTab />}
      {tab === 'AIS' && <AisTab />}
      {tab === 'Buoy' && <BuoyTab />}
      {tab === 'Surf' && <SurfTab spots={spots} />}
      {tab === 'SST' && <SstTab />}
      {tab === 'Alerts' && <AlertsTab />}
      {tab === 'Export' && <ExportTab spots={spots} />}
    </div>
  );
}
