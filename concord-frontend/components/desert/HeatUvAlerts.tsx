'use client';

/**
 * HeatUvAlerts — track named locations and surface live heat-index / UV
 * alerts via desert.trackedAdd / trackedDelete / trackedAlerts and the
 * ad-hoc desert.heatUvAlert lookup. Data is live Open-Meteo.
 */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz';
import { Plus, Trash2, Thermometer, Sun, Wind, AlertTriangle, RefreshCw } from 'lucide-react';

interface DayUv {
  date: string;
  uvMax: number;
  tempMax: number;
  tempMin: number;
  sunrise: string;
  sunset: string;
}

interface AlertItem {
  kind: string;
  severity: string;
  message: string;
}

interface WeatherAlert {
  location: { name: string; lat: number; lng: number };
  observedAt: string;
  temperatureC: number;
  apparentC: number | null;
  humidityPercent: number;
  windKmh: number;
  heatIndexC: number;
  heatRisk: string;
  uvIndex: number;
  uvLevel: string;
  uvAdvice: string;
  uvMax3day: DayUv[];
  alerts: AlertItem[];
  alertLevel: string;
}

interface Tracked {
  id: string;
  name: string;
  lat: number;
  lng: number;
  alert: WeatherAlert | null;
  alertError?: string;
}

const LEVEL_COLOR: Record<string, string> = {
  extreme: 'text-red-400 bg-red-400/10 border-red-400/30',
  elevated: 'text-orange-400 bg-orange-400/10 border-orange-400/30',
  nominal: 'text-green-400 bg-green-400/10 border-green-400/30',
};

export function HeatUvAlerts() {
  const [name, setName] = useState('');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [tracked, setTracked] = useState<Tracked[]>([]);
  const [counts, setCounts] = useState({ extreme: 0, elevated: 0, nominal: 0 });
  const [adhoc, setAdhoc] = useState<WeatherAlert | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setBusy(true);
    const r = await lensRun<{ tracked: Tracked[]; counts: typeof counts }>('desert', 'trackedAlerts', {});
    setBusy(false);
    if (r.data?.ok && r.data.result) {
      setTracked(r.data.result.tracked);
      setCounts(r.data.result.counts);
    }
  }, []);

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const add = useCallback(async () => {
    setErr(null);
    const la = Number(lat);
    const ln = Number(lng);
    if (!Number.isFinite(la) || !Number.isFinite(ln)) {
      setErr('Valid lat/lng required');
      return;
    }
    setBusy(true);
    const r = await lensRun('desert', 'trackedAdd', { name: name || 'Tracked location', lat: la, lng: ln });
    setBusy(false);
    if (r.data?.ok) {
      setName('');
      setLat('');
      setLng('');
      refresh();
    } else {
      setErr(r.data?.error || 'Add failed');
    }
  }, [name, lat, lng, refresh]);

  const lookup = useCallback(async () => {
    setErr(null);
    const la = Number(lat);
    const ln = Number(lng);
    if (!Number.isFinite(la) || !Number.isFinite(ln)) {
      setErr('Valid lat/lng required');
      return;
    }
    setBusy(true);
    const r = await lensRun<WeatherAlert>('desert', 'heatUvAlert', { name: name || 'Location', lat: la, lng: ln });
    setBusy(false);
    if (r.data?.ok && r.data.result) setAdhoc(r.data.result);
    else setErr(r.data?.error || 'Lookup failed');
  }, [name, lat, lng]);

  const remove = useCallback(
    async (id: string) => {
      await lensRun('desert', 'trackedDelete', { id });
      refresh();
    },
    [refresh],
  );

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-400" />
          <h3 className="text-sm font-semibold text-white">Live heat-index / UV alerts</h3>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Location name"
            className="flex-1 min-w-[140px] rounded bg-zinc-950 border border-zinc-800 px-2 py-1.5 text-sm text-white"
          />
          <input
            value={lat}
            onChange={(e) => setLat(e.target.value)}
            placeholder="lat"
            className="w-24 rounded bg-zinc-950 border border-zinc-800 px-2 py-1.5 text-sm text-white"
          />
          <input
            value={lng}
            onChange={(e) => setLng(e.target.value)}
            placeholder="lng"
            className="w-24 rounded bg-zinc-950 border border-zinc-800 px-2 py-1.5 text-sm text-white"
          />
          <button
            onClick={add}
            disabled={busy}
            className="flex items-center gap-1 rounded bg-amber-600 hover:bg-amber-500 disabled:opacity-50 px-2.5 py-1.5 text-xs text-white"
          >
            <Plus className="h-3.5 w-3.5" /> Track
          </button>
          <button
            onClick={lookup}
            disabled={busy}
            className="flex items-center gap-1 rounded bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 px-2.5 py-1.5 text-xs text-white"
          >
            <Sun className="h-3.5 w-3.5" /> Quick check
          </button>
        </div>
        {err && <p className="text-xs text-red-400">{err}</p>}
        <div className="flex items-center gap-3 text-xs">
          <span className="text-red-400">{counts.extreme} extreme</span>
          <span className="text-orange-400">{counts.elevated} elevated</span>
          <span className="text-green-400">{counts.nominal} nominal</span>
          <button onClick={refresh} disabled={busy} className="ml-auto flex items-center gap-1 text-zinc-400 hover:text-white">
            <RefreshCw className={`h-3 w-3 ${busy ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>
      </div>

      {adhoc && <AlertCard alert={adhoc} />}

      {tracked.map((t) => (
        <div key={t.id} className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-white">{t.name}</span>
            <button onClick={() => remove(t.id)} className="p-1 text-zinc-500 hover:text-red-400" aria-label="Stop tracking">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
          {t.alert ? (
            <AlertCard alert={t.alert} />
          ) : (
            <p className="text-xs text-red-400">{t.alertError || 'No data'}</p>
          )}
        </div>
      ))}
      {tracked.length === 0 && !adhoc && (
        <p className="text-center text-sm text-zinc-500 py-6">No tracked locations yet.</p>
      )}
    </div>
  );
}

function AlertCard({ alert }: { alert: WeatherAlert }) {
  return (
    <div className={`rounded-lg border p-4 space-y-3 ${LEVEL_COLOR[alert.alertLevel] || 'border-zinc-800'}`}>
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-white">{alert.location.name}</span>
        <span className="text-xs uppercase tracking-wider">{alert.alertLevel}</span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
        <Stat icon={<Thermometer className="h-3.5 w-3.5 text-rose-400" />} label="Heat index" value={`${alert.heatIndexC}°C`} />
        <Stat icon={<Thermometer className="h-3.5 w-3.5 text-amber-400" />} label="Air temp" value={`${alert.temperatureC}°C`} />
        <Stat icon={<Sun className="h-3.5 w-3.5 text-yellow-400" />} label="UV index" value={`${alert.uvIndex}`} />
        <Stat icon={<Wind className="h-3.5 w-3.5 text-zinc-400" />} label="Wind" value={`${alert.windKmh} km/h`} />
      </div>
      <p className="text-xs text-zinc-300">
        Heat risk: <span className="font-semibold">{alert.heatRisk}</span> · UV: {alert.uvLevel} — {alert.uvAdvice}
      </p>
      {alert.alerts.length > 0 && (
        <ul className="space-y-1">
          {alert.alerts.map((a, i) => (
            <li key={i} className="flex items-center gap-1.5 text-xs text-orange-300">
              <AlertTriangle className="h-3 w-3" /> {a.message}
            </li>
          ))}
        </ul>
      )}
      {alert.uvMax3day.length > 0 && (
        <ChartKit
          kind="bar"
          height={160}
          data={alert.uvMax3day.map((d) => ({
            date: (d.date || '').slice(5),
            uvMax: d.uvMax,
            tempMax: d.tempMax,
          }))}
          xKey="date"
          series={[
            { key: 'uvMax', label: 'UV max', color: '#f59e0b' },
            { key: 'tempMax', label: 'Temp max °C', color: '#ef4444' },
          ]}
        />
      )}
    </div>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded bg-zinc-950/60 border border-zinc-800 px-2 py-1.5">
      <div className="flex items-center gap-1">
        {icon}
        <span className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</span>
      </div>
      <div className="mt-0.5 font-mono text-sm text-white">{value}</div>
    </div>
  );
}
