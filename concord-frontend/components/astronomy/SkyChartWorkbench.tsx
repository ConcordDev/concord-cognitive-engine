'use client';

/**
 * SkyChartWorkbench — SkySafari / Stellarium parity surface.
 *
 * Seven feature-parity panels, all driven by REAL ephemeris math
 * (server domain `astronomy`) and free keyless public APIs:
 *   - Interactive real-time sky chart (azimuthal projection) — `sky-chart`
 *   - Tonight's-best / what's-up-now visibility list      — `whats-up`
 *   - Constellation lines + deep-sky overlay              — `constellations`
 *   - Point-phone-at-sky AR mode (DeviceOrientation)      — `ar-resolve`
 *   - Telescope GoTo (INDI/ASCOM bridge)                  — `goto-*`
 *   - Moon-phase + rise/set ephemeris calendar            — `ephemeris-calendar`
 *   - Light-pollution / observing-conditions forecast     — `observing-forecast`
 *
 * No mock data. Observer location is real user input (manual or geolocation).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Compass, Sparkles, ListChecks, Grid3x3, Smartphone, Orbit as Telescope,
  CalendarDays, CloudMoon, Loader2, MapPin, Crosshair,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

// ─── Shared observer-location shape ───────────────────────────────────
interface Observer { latitude: number; longitude: number }

// ─── Macro result shapes ──────────────────────────────────────────────
interface SkyStar {
  name: string; constellation: string; magnitude: number;
  ra: number; dec: number; altitude: number; azimuth: number; visible: boolean;
}
interface SkyChartResult {
  observer: Observer; when: string; siderealTimeDeg: number;
  sun: { altitude: number; azimuth: number; isDaytime: boolean };
  moon: { altitude: number; azimuth: number; illumination: number; phase: string; visible: boolean };
  stars: SkyStar[];
  constellationLines: { name: string; segments: [string, string][] }[];
  visibleCount: number;
}
interface WhatsUpObject {
  name: string; kind: string; magnitude: number; constellation: string | null;
  altitude: number; azimuth: number; phase?: string;
}
interface WhatsUpResult {
  when: string; darkSky: boolean; twilight: boolean; sunAltitude: number;
  objects: WhatsUpObject[]; count: number; best: WhatsUpObject | null;
}
interface ConstSegment {
  from: string; to: string;
  fromAltAz?: { altitude: number; azimuth: number };
  toAltAz?: { altitude: number; azimuth: number };
}
interface ConstellationsResult {
  constellations: { name: string; segments: ConstSegment[] }[];
  deepSky: { id: string; name: string; type: string; constellation: string; magnitude: number }[];
  count: number; deepSkyCount: number;
}
interface ArMatch {
  name: string; constellation: string; magnitude: number;
  altitude: number; azimuth: number; separationDeg: number;
}
interface ArResult {
  pointing: { altitude: number; azimuth: number }; fov: number;
  matches: ArMatch[]; count: number; nearest: ArMatch | null;
}
interface GotoMount { name: string; protocol: string; host: string; port: number }
interface GotoCommand {
  id: string; targetName: string; ra: number; dec: number;
  altAz: { altitude: number; azimuth: number } | null;
  protocol: string | null; status: string; belowHorizon: boolean | null; createdAt: string;
}
interface CalendarDay {
  date: string; moonPhase: string; moonIllumination: number; moonAgeDays: number;
  sunrise: string | null; sunset: string | null; moonrise: string | null; moonset: string | null;
}
interface EphemerisResult { days: number; calendar: CalendarDay[] }
interface ForecastHour {
  time: string; cloudCover: number; visibilityM: number; humidity: number;
  temperatureC: number; observingScore: number; rating: string;
}
interface ForecastResult {
  hours: ForecastHour[]; nightHours: ForecastHour[]; bestWindow: ForecastHour | null;
}

type PanelId = 'chart' | 'whatsup' | 'constellations' | 'ar' | 'goto' | 'calendar' | 'forecast';
const PANELS: { id: PanelId; label: string; icon: typeof Compass }[] = [
  { id: 'chart', label: 'Sky Chart', icon: Compass },
  { id: 'whatsup', label: "What's Up", icon: ListChecks },
  { id: 'constellations', label: 'Constellations', icon: Grid3x3 },
  { id: 'ar', label: 'AR Mode', icon: Smartphone },
  { id: 'goto', label: 'GoTo Mount', icon: Telescope },
  { id: 'calendar', label: 'Ephemeris', icon: CalendarDays },
  { id: 'forecast', label: 'Conditions', icon: CloudMoon },
];

const STORE_KEY = 'astronomy:observer';

function fmtTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ─── Top-level workbench ──────────────────────────────────────────────
export function SkyChartWorkbench() {
  const [panel, setPanel] = useState<PanelId>('chart');
  const [observer, setObserver] = useState<Observer | null>(null);
  const [latInput, setLatInput] = useState('');
  const [lonInput, setLonInput] = useState('');
  const [geoBusy, setGeoBusy] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);

  // Restore last observer location.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const p = JSON.parse(raw) as Observer;
        if (Number.isFinite(p.latitude) && Number.isFinite(p.longitude)) {
          setObserver(p);
          setLatInput(String(p.latitude));
          setLonInput(String(p.longitude));
        }
      }
    } catch { /* no stored location */ }
  }, []);

  const commitObserver = useCallback((lat: number, lon: number) => {
    const o = { latitude: lat, longitude: lon };
    setObserver(o);
    try { localStorage.setItem(STORE_KEY, JSON.stringify(o)); } catch { /* storage off */ }
  }, []);

  const applyManual = useCallback(() => {
    const lat = parseFloat(latInput);
    const lon = parseFloat(lonInput);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) { setGeoError('Latitude must be between -90 and 90.'); return; }
    if (!Number.isFinite(lon) || lon < -180 || lon > 180) { setGeoError('Longitude must be between -180 and 180.'); return; }
    setGeoError(null);
    commitObserver(lat, lon);
  }, [latInput, lonInput, commitObserver]);

  const useGeolocation = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGeoError('Geolocation is not available on this device.');
      return;
    }
    setGeoBusy(true);
    setGeoError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = Math.round(pos.coords.latitude * 10000) / 10000;
        const lon = Math.round(pos.coords.longitude * 10000) / 10000;
        setLatInput(String(lat));
        setLonInput(String(lon));
        commitObserver(lat, lon);
        setGeoBusy(false);
      },
      (err) => { setGeoError(`Location denied: ${err.message}`); setGeoBusy(false); },
      { enableHighAccuracy: false, timeout: 10000 },
    );
  }, [commitObserver]);

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 overflow-hidden">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800 bg-gradient-to-r from-violet-600/15 to-transparent">
        <Sparkles className="w-5 h-5 text-violet-400" />
        <h2 className="text-sm font-bold text-zinc-100">Sky Chart Workbench</h2>
        <span className="text-[11px] text-zinc-400">real-time ephemeris · SkySafari / Stellarium parity</span>
      </header>

      {/* Observer location bar */}
      <div className="px-4 py-3 border-b border-zinc-800 bg-zinc-900/40">
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wide text-zinc-400">Latitude</span>
            <input
              value={latInput} onChange={(e) => setLatInput(e.target.value)}
              placeholder="40.7128" inputMode="decimal"
              className="w-28 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wide text-zinc-400">Longitude</span>
            <input
              value={lonInput} onChange={(e) => setLonInput(e.target.value)}
              placeholder="-74.0060" inputMode="decimal"
              className="w-28 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100"
            />
          </label>
          <button
            type="button" onClick={applyManual}
            className="flex items-center gap-1.5 bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium rounded-lg px-3 py-1.5"
          >
            <Crosshair className="w-3.5 h-3.5" /> Set location
          </button>
          <button
            type="button" onClick={useGeolocation} disabled={geoBusy}
            className="flex items-center gap-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium rounded-lg px-3 py-1.5 disabled:opacity-50"
          >
            {geoBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MapPin className="w-3.5 h-3.5" />}
            Use my location
          </button>
          {observer && (
            <span className="text-[11px] text-emerald-400">
              Observing from {observer.latitude.toFixed(4)}°, {observer.longitude.toFixed(4)}°
            </span>
          )}
        </div>
        {geoError && <p className="mt-1.5 text-[11px] text-rose-400">{geoError}</p>}
      </div>

      {/* Panel tabs */}
      <nav className="flex gap-1 px-2 pt-2 border-b border-zinc-800 overflow-x-auto">
        {PANELS.map((p) => {
          const Icon = p.icon;
          const active = panel === p.id;
          return (
            <button
              key={p.id} type="button" onClick={() => setPanel(p.id)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-t-lg whitespace-nowrap focus:outline-none focus:ring-2 focus:ring-violet-500',
                active ? 'bg-zinc-900 text-violet-300 border-x border-t border-zinc-800' : 'text-zinc-400 hover:text-zinc-200',
              )}
            >
              <Icon className="w-3.5 h-3.5" /> {p.label}
            </button>
          );
        })}
      </nav>

      <div className="p-4">
        {!observer ? (
          <p className="text-xs text-zinc-400 italic py-8 text-center">
            Set your observer location above to compute the live sky.
          </p>
        ) : (
          <>
            {panel === 'chart' && <SkyChartPanel observer={observer} />}
            {panel === 'whatsup' && <WhatsUpPanel observer={observer} />}
            {panel === 'constellations' && <ConstellationsPanel observer={observer} />}
            {panel === 'ar' && <ArPanel observer={observer} />}
            {panel === 'goto' && <GotoPanel observer={observer} />}
            {panel === 'calendar' && <EphemerisPanel observer={observer} />}
            {panel === 'forecast' && <ForecastPanel observer={observer} />}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Panel 1: interactive real-time sky chart ─────────────────────────
function SkyChartPanel({ observer }: { observer: Observer }) {
  const [data, setData] = useState<SkyChartResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showLines, setShowLines] = useState(true);
  const [whenIso, setWhenIso] = useState(''); // empty = now

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const input: Record<string, unknown> = { latitude: observer.latitude, longitude: observer.longitude };
    if (whenIso) input.when = new Date(whenIso).toISOString();
    const r = await lensRun<SkyChartResult>('astronomy', 'sky-chart', input);
    if (r.data?.ok && r.data.result) setData(r.data.result);
    else setError(r.data?.error || 'Sky chart unavailable.');
    setLoading(false);
  }, [observer, whenIso]);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <PanelLoading />;
  if (error || !data) return <PanelError msg={error} />;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-xs text-zinc-400">
          Time
          <input
            type="datetime-local" value={whenIso} onChange={(e) => setWhenIso(e.target.value)}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-xs text-zinc-100"
          />
          {whenIso && (
            <button type="button" onClick={() => setWhenIso('')} className="text-violet-400 hover:text-violet-300">
              now
            </button>
          )}
        </label>
        <label className="flex items-center gap-1.5 text-xs text-zinc-400">
          <input type="checkbox" checked={showLines} onChange={(e) => setShowLines(e.target.checked)} />
          Constellation lines
        </label>
        <span className="text-[11px] text-zinc-400">
          {data.sun.isDaytime ? 'Daytime' : 'Night'} · {data.visibleCount} stars up · sidereal {data.siderealTimeDeg.toFixed(1)}°
        </span>
      </div>

      <SkyDome data={data} showLines={showLines} />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        <Tile label="Sun alt" value={`${data.sun.altitude.toFixed(1)}°`} />
        <Tile label="Moon phase" value={data.moon.phase} />
        <Tile label="Moon illum" value={`${Math.round(data.moon.illumination * 100)}%`} />
        <Tile label="Moon alt" value={`${data.moon.altitude.toFixed(1)}°`} />
      </div>
    </div>
  );
}

/** Azimuthal-projection sky dome SVG. Zenith centre, horizon at edge. */
function SkyDome({ data, showLines }: { data: SkyChartResult; showLines: boolean }) {
  const SIZE = 360;
  const R = SIZE / 2 - 8;
  const cx = SIZE / 2;
  const cy = SIZE / 2;

  // alt/az → x,y. altitude 90° → centre, 0° → edge.
  const project = useCallback((alt: number, az: number): { x: number; y: number } => {
    const r = R * (1 - Math.max(0, alt) / 90);
    const a = (az - 90) * (Math.PI / 180); // 0°=N at top
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  }, [R, cx, cy]);

  const starByName = useMemo(() => {
    const m = new Map<string, SkyStar>();
    data.stars.forEach((s) => m.set(s.name, s));
    return m;
  }, [data.stars]);

  return (
    <div className="flex justify-center">
      <svg width={SIZE} height={SIZE} role="img" aria-label="Real-time sky chart" className="select-none">
        <circle cx={cx} cy={cy} r={R} fill="#0a0a18" stroke="#3f3f5f" strokeWidth={1.5} />
        <circle cx={cx} cy={cy} r={R * 2 / 3} fill="none" stroke="#27273f" strokeWidth={0.7} />
        <circle cx={cx} cy={cy} r={R / 3} fill="none" stroke="#27273f" strokeWidth={0.7} />
        {/* Cardinal labels */}
        {([['N', 0], ['E', 90], ['S', 180], ['W', 270]] as [string, number][]).map(([lbl, az]) => {
          const p = project(0, az);
          return (
            <text key={lbl} x={p.x} y={p.y} fill="#71717a" fontSize={10} textAnchor="middle" dominantBaseline="middle">
              {lbl}
            </text>
          );
        })}
        {/* Constellation lines */}
        {showLines && data.constellationLines.flatMap((c) =>
          c.segments.map(([a, b], i) => {
            const sa = starByName.get(a);
            const sb = starByName.get(b);
            if (!sa || !sb || sa.altitude <= 0 || sb.altitude <= 0) return null;
            const pa = project(sa.altitude, sa.azimuth);
            const pb = project(sb.altitude, sb.azimuth);
            return (
              <line key={`${c.name}-${i}`} x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y}
                stroke="#4f46e5" strokeWidth={0.8} strokeOpacity={0.55} />
            );
          }),
        )}
        {/* Stars */}
        {data.stars.filter((s) => s.visible).map((s) => {
          const p = project(s.altitude, s.azimuth);
          const radius = Math.max(1, 3.4 - s.magnitude * 0.7);
          return (
            <g key={s.name}>
              <circle cx={p.x} cy={p.y} r={radius} fill="#fef9c3" />
              {s.magnitude < 1 && (
                <text x={p.x + 5} y={p.y + 3} fill="#a1a1aa" fontSize={8}>{s.name}</text>
              )}
            </g>
          );
        })}
        {/* Sun */}
        {data.sun.altitude > 0 && (() => {
          const p = project(data.sun.altitude, data.sun.azimuth);
          return <circle cx={p.x} cy={p.y} r={6} fill="#facc15" stroke="#fde68a" strokeWidth={1} />;
        })()}
        {/* Moon */}
        {data.moon.visible && (() => {
          const p = project(data.moon.altitude, data.moon.azimuth);
          return <circle cx={p.x} cy={p.y} r={5} fill="#e4e4e7" stroke="#a1a1aa" strokeWidth={1} />;
        })()}
      </svg>
    </div>
  );
}

// ─── Panel 2: what's up now ───────────────────────────────────────────
function WhatsUpPanel({ observer }: { observer: Observer }) {
  const [data, setData] = useState<WhatsUpResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [minAlt, setMinAlt] = useState(15);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const r = await lensRun<WhatsUpResult>('astronomy', 'whats-up', {
      latitude: observer.latitude, longitude: observer.longitude, minAltitude: minAlt,
    });
    if (r.data?.ok && r.data.result) setData(r.data.result);
    else setError(r.data?.error || "What's-up list unavailable.");
    setLoading(false);
  }, [observer, minAlt]);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <PanelLoading />;
  if (error || !data) return <PanelError msg={error} />;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-400">
        <label className="flex items-center gap-2">
          Min altitude
          <input
            type="range" min={0} max={60} value={minAlt}
            onChange={(e) => setMinAlt(Number(e.target.value))} className="accent-violet-500"
          />
          <span className="text-zinc-200 w-10">{minAlt}°</span>
        </label>
        <span className={cn('px-2 py-0.5 rounded-full text-[10px] uppercase',
          data.darkSky ? 'bg-emerald-900/50 text-emerald-300'
            : data.twilight ? 'bg-amber-900/50 text-amber-300' : 'bg-sky-900/50 text-sky-300')}>
          {data.darkSky ? 'dark sky' : data.twilight ? 'twilight' : 'daylight'}
        </span>
        <span>Sun {data.sunAltitude.toFixed(1)}°</span>
      </div>

      {data.objects.length === 0 ? (
        <p className="text-xs text-zinc-400 italic py-6 text-center">
          Nothing above {minAlt}° right now — lower the altitude or check back later.
        </p>
      ) : (
        <ul className="space-y-1">
          {data.objects.map((o) => (
            <li key={`${o.kind}-${o.name}`}
              className="flex items-center justify-between bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-2">
              <div>
                <p className="text-xs text-zinc-100">
                  {o.name}
                  <span className="text-zinc-600 capitalize"> · {o.kind}</span>
                  {o.phase && <span className="text-zinc-400"> · {o.phase}</span>}
                </p>
                <p className="text-[10px] text-zinc-400">
                  {o.constellation ? `${o.constellation} · ` : ''}mag {o.magnitude}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs text-violet-300">{o.altitude.toFixed(1)}° alt</p>
                <p className="text-[10px] text-zinc-400">{o.azimuth.toFixed(0)}° az</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── Panel 3: constellations + deep-sky ───────────────────────────────
function ConstellationsPanel({ observer }: { observer: Observer }) {
  const [data, setData] = useState<ConstellationsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState<string | null>(null);
  const [importMsg, setImportMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const r = await lensRun<ConstellationsResult>('astronomy', 'constellations', {
      latitude: observer.latitude, longitude: observer.longitude,
    });
    if (r.data?.ok && r.data.result) setData(r.data.result);
    else setError(r.data?.error || 'Constellation data unavailable.');
    setLoading(false);
  }, [observer]);

  useEffect(() => { void load(); }, [load]);

  const importDso = useCallback(async (catalogId: string, name: string) => {
    setImporting(catalogId);
    const r = await lensRun('astronomy', 'catalog-import', { catalogId });
    setImportMsg(r.data?.ok ? `Added ${name} to your targets.` : (r.data?.error || 'Import failed.'));
    setImporting(null);
  }, []);

  if (loading) return <PanelLoading />;
  if (error || !data) return <PanelError msg={error} />;

  return (
    <div className="space-y-4">
      {importMsg && (
        <div className="text-[11px] text-emerald-300 bg-emerald-950/40 border border-emerald-900/50 rounded-lg px-3 py-1.5">
          {importMsg}
        </div>
      )}
      <section>
        <h3 className="text-xs font-semibold text-zinc-300 mb-2">Constellation lines ({data.count})</h3>
        <ul className="space-y-1">
          {data.constellations.map((c) => {
            const up = c.segments.filter((s) => (s.fromAltAz?.altitude ?? -1) > 0 && (s.toAltAz?.altitude ?? -1) > 0).length;
            return (
              <li key={c.name}
                className="flex items-center justify-between bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-2">
                <span className="text-xs text-zinc-100">{c.name}</span>
                <span className={cn('text-[10px]', up > 0 ? 'text-emerald-400' : 'text-zinc-600')}>
                  {up}/{c.segments.length} segments above horizon
                </span>
              </li>
            );
          })}
        </ul>
      </section>
      <section>
        <h3 className="text-xs font-semibold text-zinc-300 mb-2">Deep-sky overlay ({data.deepSkyCount})</h3>
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          {data.deepSky.map((d) => (
            <li key={d.id}
              className="flex items-center justify-between bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-1.5">
              <div className="min-w-0">
                <p className="text-xs text-zinc-100 truncate">{d.id} — {d.name}</p>
                <p className="text-[10px] text-zinc-400 capitalize">{d.type} · {d.constellation} · mag {d.magnitude}</p>
              </div>
              <button
                type="button" disabled={importing === d.id}
                onClick={() => importDso(d.id, d.name)}
                className="ml-2 text-[10px] text-violet-300 hover:text-violet-200 disabled:opacity-50 shrink-0"
              >
                {importing === d.id ? '…' : '+ target'}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

// ─── Panel 4: AR point-at-sky mode ────────────────────────────────────
function ArPanel({ observer }: { observer: Observer }) {
  const [data, setData] = useState<ArResult | null>(null);
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manualAlt, setManualAlt] = useState('45');
  const [manualAz, setManualAz] = useState('180');
  const orientRef = useRef<{ alt: number; az: number } | null>(null);

  const resolve = useCallback(async (alt: number, az: number) => {
    const r = await lensRun<ArResult>('astronomy', 'ar-resolve', {
      latitude: observer.latitude, longitude: observer.longitude,
      altitude: alt, azimuth: az, fov: 25,
    });
    if (r.data?.ok && r.data.result) setData(r.data.result);
    else setError(r.data?.error || 'AR resolve failed.');
  }, [observer]);

  // DeviceOrientation → alt/az.
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    const handler = (e: DeviceOrientationEvent) => {
      // beta = front/back tilt (pitch), alpha = compass heading.
      const beta = e.beta ?? 0;
      const alpha = e.alpha ?? 0;
      const alt = Math.max(0, Math.min(90, 90 - Math.abs(beta)));
      const az = ((360 - alpha) % 360 + 360) % 360;
      orientRef.current = { alt, az };
    };
    window.addEventListener('deviceorientation', handler, true);
    const tick = () => {
      if (orientRef.current) {
        const { alt, az } = orientRef.current;
        void resolve(alt, az);
      }
      raf = window.setTimeout(tick, 1500) as unknown as number;
    };
    tick();
    return () => {
      window.removeEventListener('deviceorientation', handler, true);
      window.clearTimeout(raf);
    };
  }, [active, resolve]);

  const startAr = useCallback(async () => {
    setError(null);
    // iOS 13+ requires explicit permission.
    interface DOEC { requestPermission?: () => Promise<'granted' | 'denied'> }
    const DOE = (window as unknown as { DeviceOrientationEvent?: DOEC }).DeviceOrientationEvent;
    if (DOE && typeof DOE.requestPermission === 'function') {
      try {
        const perm = await DOE.requestPermission();
        if (perm !== 'granted') { setError('Motion sensor permission denied.'); return; }
      } catch { setError('Could not request motion sensor permission.'); return; }
    }
    setActive(true);
  }, []);

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-zinc-400">
        Point your phone at the sky — device-orientation sensors resolve which stars you are facing.
        On desktop, enter a direction manually.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        {!active ? (
          <button
            type="button" onClick={startAr}
            className="flex items-center gap-1.5 bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium rounded-lg px-3 py-1.5"
          >
            <Smartphone className="w-3.5 h-3.5" /> Start AR mode
          </button>
        ) : (
          <button
            type="button" onClick={() => setActive(false)}
            className="flex items-center gap-1.5 bg-rose-700 hover:bg-rose-600 text-white text-xs font-medium rounded-lg px-3 py-1.5"
          >
            Stop AR
          </button>
        )}
        {!active && (
          <>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase text-zinc-400">Altitude</span>
              <input value={manualAlt} onChange={(e) => setManualAlt(e.target.value)}
                className="w-20 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-xs text-zinc-100" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase text-zinc-400">Azimuth</span>
              <input value={manualAz} onChange={(e) => setManualAz(e.target.value)}
                className="w-20 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-xs text-zinc-100" />
            </label>
            <button
              type="button"
              onClick={() => resolve(parseFloat(manualAlt) || 0, parseFloat(manualAz) || 0)}
              className="bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs rounded-lg px-3 py-1.5"
            >
              Resolve
            </button>
          </>
        )}
      </div>

      {error && <p className="text-[11px] text-rose-400">{error}</p>}

      {data && (
        <div className="space-y-2">
          <p className="text-[11px] text-zinc-400">
            Pointing {data.pointing.altitude.toFixed(0)}° alt / {data.pointing.azimuth.toFixed(0)}° az · FOV {data.fov}°
          </p>
          {data.matches.length === 0 ? (
            <p className="text-xs text-zinc-400 italic">No catalogued bright stars in that direction.</p>
          ) : (
            <ul className="space-y-1">
              {data.matches.map((m) => (
                <li key={m.name}
                  className="flex items-center justify-between bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-2">
                  <div>
                    <p className="text-xs text-zinc-100">{m.name}</p>
                    <p className="text-[10px] text-zinc-400">{m.constellation} · mag {m.magnitude}</p>
                  </div>
                  <span className="text-xs text-violet-300">{m.separationDeg}° off-centre</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Panel 5: telescope GoTo bridge ───────────────────────────────────
function GotoPanel({ observer }: { observer: Observer }) {
  const [mount, setMount] = useState<GotoMount | null>(null);
  const [queue, setQueue] = useState<GotoCommand[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mountForm, setMountForm] = useState({ name: '', protocol: 'indi', host: '', port: '' });
  const [cmdForm, setCmdForm] = useState({ targetName: '', ra: '', dec: '' });

  const refresh = useCallback(async () => {
    setLoading(true);
    const [m, q] = await Promise.all([
      lensRun<{ mount: GotoMount | null }>('astronomy', 'goto-mount-get', {}),
      lensRun<{ queue: GotoCommand[] }>('astronomy', 'goto-queue', {}),
    ]);
    const mt = m.data?.result?.mount || null;
    setMount(mt);
    if (mt) setMountForm({ name: mt.name, protocol: mt.protocol, host: mt.host, port: String(mt.port) });
    setQueue(q.data?.result?.queue || []);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const saveMount = useCallback(async () => {
    const r = await lensRun('astronomy', 'goto-mount-set', {
      name: mountForm.name, protocol: mountForm.protocol,
      host: mountForm.host, port: mountForm.port ? Number(mountForm.port) : undefined,
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed to save mount.'); return; }
    setError(null);
    await refresh();
  }, [mountForm, refresh]);

  const sendGoto = useCallback(async () => {
    if (!cmdForm.targetName.trim()) { setError('Target name is required.'); return; }
    const ra = parseFloat(cmdForm.ra);
    const dec = parseFloat(cmdForm.dec);
    if (!Number.isFinite(ra) || !Number.isFinite(dec)) { setError('RA and Dec (degrees) are required.'); return; }
    const r = await lensRun('astronomy', 'goto-command', {
      targetName: cmdForm.targetName.trim(), ra, dec,
      latitude: observer.latitude, longitude: observer.longitude,
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'GoTo failed.'); return; }
    setError(null);
    setCmdForm({ targetName: '', ra: '', dec: '' });
    await refresh();
  }, [cmdForm, observer, refresh]);

  const setStatus = useCallback(async (id: string, status: string) => {
    await lensRun('astronomy', 'goto-command-update', { id, status });
    await refresh();
  }, [refresh]);

  const clearDone = useCallback(async () => {
    await lensRun('astronomy', 'goto-clear', {});
    await refresh();
  }, [refresh]);

  if (loading) return <PanelLoading />;

  return (
    <div className="space-y-4">
      {error && <p className="text-[11px] text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-1.5">{error}</p>}

      <section>
        <h3 className="text-xs font-semibold text-zinc-300 mb-2">
          Mount profile {mount && <span className="text-emerald-400 font-normal">· connected</span>}
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <input placeholder="Mount name" value={mountForm.name}
            onChange={(e) => setMountForm({ ...mountForm, name: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <select value={mountForm.protocol}
            onChange={(e) => setMountForm({ ...mountForm, protocol: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
            {['indi', 'ascom', 'lx200', 'stellarium'].map((p) => <option key={p} value={p}>{p.toUpperCase()}</option>)}
          </select>
          <input placeholder="Host" value={mountForm.host}
            onChange={(e) => setMountForm({ ...mountForm, host: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="Port" inputMode="numeric" value={mountForm.port}
            onChange={(e) => setMountForm({ ...mountForm, port: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
        </div>
        <button type="button" onClick={saveMount}
          className="mt-2 bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium rounded-lg px-3 py-1.5">
          Save mount
        </button>
      </section>

      <section>
        <h3 className="text-xs font-semibold text-zinc-300 mb-2">Send GoTo slew</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <input placeholder="Target name" value={cmdForm.targetName}
            onChange={(e) => setCmdForm({ ...cmdForm, targetName: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="RA °" inputMode="decimal" value={cmdForm.ra}
            onChange={(e) => setCmdForm({ ...cmdForm, ra: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="Dec °" inputMode="decimal" value={cmdForm.dec}
            onChange={(e) => setCmdForm({ ...cmdForm, dec: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <button type="button" onClick={sendGoto}
            className="flex items-center justify-center gap-1 bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium rounded-lg">
            <Telescope className="w-3.5 h-3.5" /> Slew
          </button>
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-semibold text-zinc-300">Command queue ({queue.length})</h3>
          {queue.some((c) => c.status === 'completed' || c.status === 'cancelled') && (
            <button type="button" onClick={clearDone} className="text-[10px] text-violet-300 hover:text-violet-200">
              Clear finished
            </button>
          )}
        </div>
        {queue.length === 0 ? (
          <p className="text-[11px] text-zinc-400 italic">No GoTo commands queued.</p>
        ) : (
          <ul className="space-y-1">
            {queue.map((c) => (
              <li key={c.id}
                className="flex items-center justify-between bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-2">
                <div>
                  <p className="text-xs text-zinc-100">{c.targetName}</p>
                  <p className="text-[10px] text-zinc-400">
                    RA {c.ra}° / Dec {c.dec}°
                    {c.altAz && ` · ${c.altAz.altitude.toFixed(0)}° alt`}
                    {c.belowHorizon && <span className="text-rose-400"> · below horizon</span>}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={cn('text-[10px] uppercase px-1.5 py-0.5 rounded-full',
                    c.status === 'completed' ? 'bg-emerald-900/50 text-emerald-300'
                      : c.status === 'failed' ? 'bg-rose-900/50 text-rose-300'
                        : c.status === 'slewing' ? 'bg-amber-900/50 text-amber-300'
                          : c.status === 'no-mount' ? 'bg-zinc-800 text-zinc-400'
                            : 'bg-violet-900/50 text-violet-300')}>
                    {c.status}
                  </span>
                  {c.status === 'queued' && (
                    <button type="button" onClick={() => setStatus(c.id, 'slewing')}
                      className="text-[10px] text-violet-300 hover:text-violet-200">slew</button>
                  )}
                  {c.status === 'slewing' && (
                    <button type="button" onClick={() => setStatus(c.id, 'completed')}
                      className="text-[10px] text-emerald-300 hover:text-emerald-200">done</button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// ─── Panel 6: ephemeris calendar ──────────────────────────────────────
function EphemerisPanel({ observer }: { observer: Observer }) {
  const [data, setData] = useState<EphemerisResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(14);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const r = await lensRun<EphemerisResult>('astronomy', 'ephemeris-calendar', {
      latitude: observer.latitude, longitude: observer.longitude, days,
    });
    if (r.data?.ok && r.data.result) setData(r.data.result);
    else setError(r.data?.error || 'Ephemeris calendar unavailable.');
    setLoading(false);
  }, [observer, days]);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <PanelLoading />;
  if (error || !data) return <PanelError msg={error} />;

  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-xs text-zinc-400">
        Span
        <select value={days} onChange={(e) => setDays(Number(e.target.value))}
          className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-xs text-zinc-100">
          {[7, 14, 30, 60].map((d) => <option key={d} value={d}>{d} days</option>)}
        </select>
      </label>
      <ul className="space-y-1">
        {data.calendar.map((d) => (
          <li key={d.date}
            className="grid grid-cols-2 sm:grid-cols-5 gap-2 items-center bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-2">
            <span className="text-xs text-zinc-100">{d.date}</span>
            <span className="flex items-center gap-1.5 text-xs text-zinc-300">
              <MoonGlyph illumination={d.moonIllumination} />
              {d.moonPhase}
            </span>
            <span className="text-[10px] text-zinc-400">illum {Math.round(d.moonIllumination * 100)}%</span>
            <span className="text-[10px] text-amber-300/80">
              ☀ {fmtTime(d.sunrise)} – {fmtTime(d.sunset)}
            </span>
            <span className="text-[10px] text-sky-300/80">
              ☾ {fmtTime(d.moonrise)} – {fmtTime(d.moonset)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function MoonGlyph({ illumination }: { illumination: number }) {
  // Simple lit-fraction disc.
  const lit = Math.round(illumination * 100);
  return (
    <svg width={14} height={14} viewBox="0 0 14 14" aria-hidden="true">
      <circle cx={7} cy={7} r={6} fill="#27272a" stroke="#52525b" strokeWidth={0.6} />
      <circle cx={7} cy={7} r={6} fill="#fef3c7"
        style={{ clipPath: `inset(0 ${100 - lit}% 0 0)` }} />
    </svg>
  );
}

// ─── Panel 7: observing-conditions forecast ───────────────────────────
function ForecastPanel({ observer }: { observer: Observer }) {
  const [data, setData] = useState<ForecastResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const r = await lensRun<ForecastResult>('astronomy', 'observing-forecast', {
      latitude: observer.latitude, longitude: observer.longitude,
    });
    if (r.data?.ok && r.data.result) setData(r.data.result);
    else setError(r.data?.error || 'Conditions forecast unavailable.');
    setLoading(false);
  }, [observer]);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <PanelLoading />;
  if (error || !data) return <PanelError msg={error} />;

  const ratingColor = (r: string) =>
    r === 'excellent' ? 'bg-emerald-500' : r === 'good' ? 'bg-lime-500'
      : r === 'fair' ? 'bg-amber-500' : 'bg-rose-500';

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-zinc-400">
        Cloud cover, visibility &amp; humidity from Open-Meteo (free, keyless). Higher score = better seeing.
      </p>
      {data.bestWindow && (
        <div className="bg-emerald-950/40 border border-emerald-900/50 rounded-lg px-3 py-2">
          <p className="text-xs text-emerald-300">
            Best dark-hours window: {fmtTime(data.bestWindow.time)} ·
            score {data.bestWindow.observingScore} ({data.bestWindow.rating}) ·
            {' '}{data.bestWindow.cloudCover}% cloud
          </p>
        </div>
      )}
      <section>
        <h3 className="text-xs font-semibold text-zinc-300 mb-2">Night hours (21:00–04:00 UTC)</h3>
        {data.nightHours.length === 0 ? (
          <p className="text-[11px] text-zinc-400 italic">No night-hour data in the forecast window.</p>
        ) : (
          <ul className="space-y-1">
            {data.nightHours.map((h) => (
              <li key={h.time} className="flex items-center gap-3 bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-1.5">
                <span className="text-[11px] text-zinc-400 w-28 shrink-0">
                  {new Date(h.time).toUTCString().slice(5, 17)}
                </span>
                <div className="flex-1 h-2 bg-zinc-800 rounded-full overflow-hidden">
                  <div className={cn('h-full', ratingColor(h.rating))} style={{ width: `${h.observingScore}%` }} />
                </div>
                <span className="text-[10px] text-zinc-300 w-8 text-right">{h.observingScore}</span>
                <span className="text-[10px] text-zinc-400 w-24 text-right">
                  {h.cloudCover}% cloud · {h.temperatureC}°C
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// ─── Small shared primitives ──────────────────────────────────────────
function PanelLoading() {
  return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
}
function PanelError({ msg }: { msg: string | null }) {
  return <p className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{msg || 'Unavailable.'}</p>;
}
function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-zinc-400">{label}</p>
      <p className="text-sm text-zinc-100">{value}</p>
    </div>
  );
}
