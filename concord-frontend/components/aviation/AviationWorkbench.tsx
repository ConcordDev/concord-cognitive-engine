'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  X, Loader2, Plane, Cloud, MapPin, Gauge, Plus, Trash2, Save, AlertTriangle, Wind,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

export interface Airport {
  ident: string;
  name: string;
  city: string;
  lat: number;
  lng: number;
  elev_ft: number;
  runways: { id: string; length: number; surface: string }[];
  frequencies: { tower: string; ground: string; atis: string; approach: string; awos: string };
  fuel: string[];
}

export interface MetarReport {
  icaoId: string;
  rawText: string;
  reportTime: string;
  tempC: number;
  dewpC: number;
  windDir: number;
  windSpd: number;
  windGust: number;
  visibilityMi: number;
  altim: number;
  flightCategory: 'VFR' | 'MVFR' | 'IFR' | 'LIFR' | 'UNK';
  clouds: { cover: string; base: number }[];
}

export interface FlightPlan {
  id: string;
  from: string;
  to: string;
  waypoints: string[];
  alternates: string[];
  altitude: number;
  tas: number;
  fuelGallons: number;
  distance_nm: number | null;
  ete_minutes: number | null;
  reserveFuel_gal: number;
  estBurn_gph: number;
  estFuelBurn_gal: number | null;
  createdAt: string;
  updatedAt: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

const FLIGHT_CAT_COLOR: Record<MetarReport['flightCategory'], string> = {
  VFR:  'bg-emerald-500/15 text-emerald-300',
  MVFR: 'bg-sky-500/15 text-sky-300',
  IFR:  'bg-rose-500/15 text-rose-300',
  LIFR: 'bg-violet-500/15 text-violet-300',
  UNK:  'bg-gray-500/15 text-gray-400',
};

type Tab = 'weather' | 'airports' | 'perf' | 'plans';

export function AviationWorkbench({ open, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('weather');

  if (!open) return null;

  return (
    <div className="fixed inset-y-0 right-0 w-[600px] max-w-[100vw] z-40 bg-[#0d1117] border-l border-sky-500/20 shadow-2xl overflow-hidden flex flex-col">
      <header className="px-4 py-3 border-b border-white/10 flex items-center justify-between bg-gradient-to-r from-sky-950/40 to-transparent">
        <div className="flex items-center gap-2">
          <Plane className="w-4 h-4 text-sky-400" />
          <span className="text-sm font-semibold text-gray-200">Aviation Workbench</span>
        </div>
        <button type="button" onClick={onClose}
          className="p-1 rounded-md hover:bg-white/5 text-gray-400"
          aria-label="Close workbench"
        >
          <X className="w-4 h-4" />
        </button>
      </header>

      <nav className="px-3 py-2 border-b border-white/10 flex items-center gap-1 overflow-x-auto">
        {([
          { id: 'weather',  label: 'METAR / TAF', icon: Cloud },
          { id: 'airports', label: 'Airports',    icon: MapPin },
          { id: 'perf',     label: 'Performance', icon: Gauge },
          { id: 'plans',    label: 'Flight plans', icon: Plane },
        ] as const).map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button key={t.id} type="button" onClick={() => setTab(t.id)}
              className={cn(
                'inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded transition flex-shrink-0',
                active
                  ? 'bg-sky-500/15 text-sky-200 border border-sky-500/40'
                  : 'text-gray-400 hover:text-gray-200 border border-transparent',
              )}
            >
              <Icon className="w-3 h-3" />
              {t.label}
            </button>
          );
        })}
      </nav>

      <div className="flex-1 overflow-y-auto">
        {tab === 'weather' && <WeatherTab />}
        {tab === 'airports' && <AirportsTab />}
        {tab === 'perf' && <PerfTab />}
        {tab === 'plans' && <PlansTab />}
      </div>
    </div>
  );
}

// ── Weather tab ───────────────────────────────────────────────

function WeatherTab() {
  const [ids, setIds] = useState('KSFO,KLAX,KJFK');
  const [reports, setReports] = useState<MetarReport[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetch = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await lensRun({
        domain: 'aviation', action: 'weather-metar',
        input: { ids: ids.split(',').map((s) => s.trim()).filter(Boolean) },
      });
      const data = res.data as { ok?: boolean; error?: string; result?: { reports?: MetarReport[] } };
      if (data.ok) setReports(data.result?.reports || []);
      else setError(data.error || 'Failed');
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  };

  return (
    <div className="p-3 space-y-3">
      <div className="flex gap-2">
        <input
          type="text" value={ids}
          onChange={(e) => setIds(e.target.value)}
          placeholder="KSFO,KLAX,..."
          className="flex-1 px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100 font-mono"
        />
        <button type="button" onClick={fetch} disabled={loading}
          className="px-3 py-1 rounded-md border border-sky-500/40 bg-sky-500/15 text-xs text-sky-100 disabled:opacity-40">
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Fetch'}
        </button>
      </div>
      <p className="text-[10px] text-gray-400">Live data from aviationweather.gov (free, no key).</p>

      {error && <p className="text-xs text-rose-300">{error}</p>}

      {reports.map((r) => (
        <div key={r.icaoId} className="rounded border border-white/10 bg-black/20 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-200 font-mono">{r.icaoId}</span>
            <span className={cn('text-[10px] px-2 py-0.5 rounded uppercase font-mono', FLIGHT_CAT_COLOR[r.flightCategory])}>
              {r.flightCategory}
            </span>
          </div>
          <p className="text-[10px] text-gray-400 font-mono break-all">{r.rawText}</p>
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div>
              <span className="text-gray-400">Wind</span>
              <p className="text-gray-200">
                <Wind className="w-3 h-3 inline mr-1 text-cyan-400" />
                {r.windDir}° @ {r.windSpd}kt{r.windGust ? `G${r.windGust}` : ''}
              </p>
            </div>
            <div>
              <span className="text-gray-400">Vis</span>
              <p className="text-gray-200">{r.visibilityMi}mi</p>
            </div>
            <div>
              <span className="text-gray-400">Temp / Dew</span>
              <p className="text-gray-200">{r.tempC}° / {r.dewpC}°C</p>
            </div>
          </div>
          {r.clouds.length > 0 && (
            <p className="text-[11px] text-gray-400">
              Clouds: {r.clouds.map((c) => `${c.cover} ${c.base ? `@${c.base}ft` : ''}`).join(', ')}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Airports tab ──────────────────────────────────────────────

function AirportsTab() {
  const [ident, setIdent] = useState('KSFO');
  const [airport, setAirport] = useState<Airport | null>(null);
  const [available, setAvailable] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lookup = useCallback(async (id?: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await lensRun({
        domain: 'aviation', action: 'airport-lookup',
        input: { ident: id || ident },
      });
      const data = res.data as { ok?: boolean; error?: string; result?: { airport?: Airport; availableIdents?: string[] } };
      if (data.ok) {
        setAirport(data.result?.airport || null);
        setAvailable(data.result?.availableIdents || []);
      } else {
        setError(data.error || 'Failed');
        setAirport(null);
      }
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, [ident]);

  useEffect(() => { lookup(); }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="p-3 space-y-3">
      <div className="flex gap-2">
        <input
          type="text" value={ident}
          onChange={(e) => setIdent(e.target.value.toUpperCase())}
          onKeyDown={(e) => { if (e.key === 'Enter') lookup(); }}
          placeholder="KSFO" maxLength={4}
          className="flex-1 px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100 font-mono uppercase"
        />
        <button type="button" onClick={() => lookup()} disabled={loading}
          className="px-3 py-1 rounded-md border border-sky-500/40 bg-sky-500/15 text-xs text-sky-100 disabled:opacity-40">
          Lookup
        </button>
      </div>

      <p className="text-[10px] text-gray-400">Live FAA NASR data via aviationapi.com — covers all ~20,000 US public-use airports.</p>

      {available.length > 0 && !airport && (
        <div className="text-[11px] text-gray-400">
          Suggested: {available.map((i) => (
            <button key={i} type="button" onClick={() => { setIdent(i); lookup(i); }}
              className="inline-block mr-1 mb-1 px-1.5 py-0.5 rounded border border-white/10 hover:border-sky-500/30 text-gray-300 font-mono">
              {i}
            </button>
          ))}
        </div>
      )}

      {error && <p className="text-xs text-rose-300">{error}</p>}

      {airport && (
        <div className="rounded border border-white/10 bg-black/20 p-4 space-y-3">
          <div>
            <p className="text-sm font-semibold text-gray-100">{airport.name}</p>
            <p className="text-[11px] text-gray-400">{airport.ident} · {airport.city} · {airport.elev_ft}ft elev</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">Runways</p>
            {airport.runways.map((rw) => (
              <p key={rw.id} className="text-xs text-gray-300 font-mono">
                {rw.id} · {rw.length.toLocaleString()}ft · {rw.surface}
              </p>
            ))}
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">Frequencies</p>
            <div className="grid grid-cols-2 gap-1 text-xs font-mono text-gray-300">
              {airport.frequencies.tower && <p>TWR <span className="text-cyan-300">{airport.frequencies.tower}</span></p>}
              {airport.frequencies.ground && <p>GND <span className="text-cyan-300">{airport.frequencies.ground}</span></p>}
              {airport.frequencies.atis && <p>ATIS <span className="text-cyan-300">{airport.frequencies.atis}</span></p>}
              {airport.frequencies.approach && <p>APP <span className="text-cyan-300">{airport.frequencies.approach}</span></p>}
              {airport.frequencies.awos && <p>AWOS <span className="text-cyan-300">{airport.frequencies.awos}</span></p>}
            </div>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">Fuel</p>
            <p className="text-xs text-gray-300">{airport.fuel.join(' · ') || 'None listed'}</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Performance tab ────────────────────────────────────────────

function PerfTab() {
  const [inputs, setInputs] = useState({
    pressureAlt: 0,
    oat: 15,
    weight: 2400,
    headwind: 0,
    slope: 0,
  });
  const [takeoff, setTakeoff] = useState<{ groundRoll_ft: number; over50ft_ft: number } | null>(null);
  const [landing, setLanding] = useState<{ groundRoll_ft: number; over50ft_ft: number } | null>(null);
  const [loading, setLoading] = useState(false);

  const calc = async () => {
    setLoading(true);
    try {
      const [t, l] = await Promise.all([
        lensRun({ domain: 'aviation', action: 'perf-takeoff', input: inputs }),
        lensRun({ domain: 'aviation', action: 'perf-landing', input: inputs }),
      ]);
      setTakeoff((t.data as { result?: typeof takeoff }).result || null);
      setLanding((l.data as { result?: typeof landing }).result || null);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  useEffect(() => { calc(); }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="p-3 space-y-3">
      <p className="text-[10px] text-gray-400">Simplified Cessna 172 performance model. Always consult POH for actual operations.</p>

      <div className="grid grid-cols-2 gap-2">
        {([
          ['pressureAlt', 'Pressure alt (ft)', '0-14000'],
          ['oat',         'OAT (°C)',          '-40..50'],
          ['weight',      'Weight (lb)',       '1500-2550'],
          ['headwind',    'Headwind (kt)',     'neg = tailwind'],
          ['slope',       'Slope (%)',         '+ = uphill'],
        ] as const).map(([key, label, hint]) => (
          <label key={key} className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wider text-gray-400">{label}</span>
            <input type="number"
              value={inputs[key]}
              onChange={(e) => setInputs({ ...inputs, [key]: Number(e.target.value) })}
              className="px-2 py-1.5 text-sm bg-black/40 border border-white/10 rounded text-gray-100 font-mono"
            />
            <span className="text-[9px] text-gray-400">{hint}</span>
          </label>
        ))}
      </div>

      <button type="button" onClick={calc} disabled={loading}
        className="w-full py-2 rounded-md border border-sky-500/40 bg-sky-500/15 text-xs text-sky-100 disabled:opacity-40">
        {loading ? <Loader2 className="w-3 h-3 animate-spin inline" /> : 'Calculate'}
      </button>

      {takeoff && (
        <div className="rounded border border-emerald-500/20 bg-emerald-500/5 p-3">
          <p className="text-[10px] uppercase tracking-wider text-emerald-400 mb-1">Takeoff</p>
          <p className="text-sm text-gray-100 font-mono">
            Ground roll: <span className="text-emerald-300">{takeoff.groundRoll_ft.toLocaleString()} ft</span>
          </p>
          <p className="text-sm text-gray-100 font-mono">
            Over 50ft obstacle: <span className="text-emerald-300">{takeoff.over50ft_ft.toLocaleString()} ft</span>
          </p>
        </div>
      )}

      {landing && (
        <div className="rounded border border-amber-500/20 bg-amber-500/5 p-3">
          <p className="text-[10px] uppercase tracking-wider text-amber-400 mb-1">Landing</p>
          <p className="text-sm text-gray-100 font-mono">
            Ground roll: <span className="text-amber-300">{landing.groundRoll_ft.toLocaleString()} ft</span>
          </p>
          <p className="text-sm text-gray-100 font-mono">
            Over 50ft obstacle: <span className="text-amber-300">{landing.over50ft_ft.toLocaleString()} ft</span>
          </p>
        </div>
      )}
    </div>
  );
}

// ── Flight Plans tab ───────────────────────────────────────────

function PlansTab() {
  const [plans, setPlans] = useState<FlightPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ from: 'KSFO', to: 'KLAX', altitude: 7500, tas: 110, fuelGallons: 53 });

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await lensRun({ domain: 'aviation', action: 'plan-list', input: {} });
      setPlans(((res.data as { result?: { plans?: FlightPlan[] } }).result?.plans) || []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const save = async () => {
    try {
      await lensRun({ domain: 'aviation', action: 'plan-create', input: draft });
      setCreating(false);
      await refresh();
    } catch (e) { console.error(e); }
  };

  const remove = async (id: string) => {
    try {
      await lensRun({ domain: 'aviation', action: 'plan-delete', input: { id } });
      await refresh();
    } catch (e) { console.error(e); }
  };

  return (
    <div className="p-3 space-y-2">
      <button type="button" onClick={() => setCreating((v) => !v)}
        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-sky-500/30 bg-sky-500/10 text-xs text-sky-200">
        <Plus className="w-3 h-3" /> New plan
      </button>

      {creating && (
        <div className="rounded border border-sky-500/30 bg-sky-500/5 p-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <input type="text" value={draft.from}
              onChange={(e) => setDraft({ ...draft, from: e.target.value.toUpperCase() })}
              placeholder="From (KSFO)" maxLength={4}
              className="px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100 font-mono uppercase" />
            <input type="text" value={draft.to}
              onChange={(e) => setDraft({ ...draft, to: e.target.value.toUpperCase() })}
              placeholder="To (KLAX)" maxLength={4}
              className="px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100 font-mono uppercase" />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <input type="number" value={draft.altitude}
              onChange={(e) => setDraft({ ...draft, altitude: Number(e.target.value) })}
              placeholder="Altitude ft"
              className="px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100 font-mono" />
            <input type="number" value={draft.tas}
              onChange={(e) => setDraft({ ...draft, tas: Number(e.target.value) })}
              placeholder="TAS kt"
              className="px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100 font-mono" />
            <input type="number" value={draft.fuelGallons}
              onChange={(e) => setDraft({ ...draft, fuelGallons: Number(e.target.value) })}
              placeholder="Fuel gal"
              className="px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100 font-mono" />
          </div>
          <button type="button" onClick={save}
            className="inline-flex items-center gap-1 px-3 py-1 rounded-md border border-sky-500/40 bg-sky-500/15 text-xs text-sky-100">
            <Save className="w-3 h-3" /> Compose
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-8 text-xs text-gray-400">
          <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…
        </div>
      ) : plans.length === 0 ? (
        <p className="text-center text-xs text-gray-400 py-8">No flight plans yet.</p>
      ) : (
        plans.map((p) => (
          <div key={p.id} className="rounded border border-white/10 bg-black/20 p-3 group">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1">
                <p className="text-sm font-mono text-gray-100">
                  {p.from} → {p.to}
                  {p.distance_nm != null && <span className="text-cyan-300 ml-2">{p.distance_nm}nm</span>}
                </p>
                <p className="text-[11px] text-gray-400">
                  FL{(p.altitude / 100).toFixed(0)} · {p.tas}kt TAS · {p.fuelGallons}gal
                </p>
                {p.ete_minutes && (
                  <p className="text-[11px] text-amber-300 mt-0.5">
                    ETE {Math.floor(p.ete_minutes / 60)}h {p.ete_minutes % 60}m · burn ~{p.estFuelBurn_gal}gal
                    {p.estFuelBurn_gal && p.estFuelBurn_gal > p.fuelGallons - p.reserveFuel_gal && (
                      <span className="ml-1 inline-flex items-center text-rose-300">
                        <AlertTriangle className="w-3 h-3" /> insufficient fuel
                      </span>
                    )}
                  </p>
                )}
              </div>
              <button aria-label="Delete" type="button" onClick={() => remove(p.id)}
                className="p-1 text-gray-600 hover:text-rose-300 opacity-0 group-hover:opacity-100">
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

export default AviationWorkbench;
