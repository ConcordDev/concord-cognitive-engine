'use client';

import { useCallback, useEffect, useState } from 'react';
import { Bell, Loader2, MapPin, Plus, Trash2, Crosshair, ShieldCheck, AlertTriangle } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface SavedLocation {
  id: string;
  label: string;
  lat: number;
  lng: number;
  savedAt: string;
}

interface EnvAlert {
  kind: string;
  severity: 'low' | 'moderate' | 'high';
  value: number;
  unit: string;
  category: string;
  message: string;
  pollenType?: string | null;
}

interface AlertResult {
  location: { lat: number; lng: number; label: string | null };
  readings: {
    aqi: number;
    pm25: number;
    pm10: number;
    ozone: number;
    uvIndexMax: number;
    peakPollen: number;
    peakPollenType: string | null;
  };
  alerts: EnvAlert[];
  alertCount: number;
  allClear: boolean;
  source: string;
  checkedAt: string;
}

const SEVERITY_TONE: Record<string, string> = {
  low: 'text-cyan-400 border-cyan-500/30 bg-cyan-500/10',
  moderate: 'text-amber-400 border-amber-500/30 bg-amber-500/10',
  high: 'text-red-400 border-red-500/30 bg-red-500/10',
};

export function EnvAlerts() {
  const [locations, setLocations] = useState<SavedLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, AlertResult>>({});

  const loadLocations = useCallback(async () => {
    setLoading(true);
    const r = await lensRun<{ locations: SavedLocation[] }>('eco', 'locations-list', {});
    if (r.data?.ok && r.data.result) setLocations(r.data.result.locations);
    else setError(r.data?.error || 'Could not load saved locations.');
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadLocations();
  }, [loadLocations]);

  const useMyLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setError('Geolocation not available in this browser.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(pos.coords.latitude.toFixed(4));
        setLng(pos.coords.longitude.toFixed(4));
      },
      () => setError('Could not read your location.'),
    );
  }, []);

  const save = useCallback(async () => {
    const latN = Number(lat);
    const lngN = Number(lng);
    if (!label.trim() || !isFinite(latN) || !isFinite(lngN)) {
      setError('Enter a label and valid coordinates.');
      return;
    }
    setBusy('save');
    setError(null);
    const r = await lensRun('eco', 'locations-save', { label: label.trim(), lat: latN, lng: lngN });
    if (r.data?.ok) {
      setLabel('');
      setLat('');
      setLng('');
      await loadLocations();
    } else {
      setError(r.data?.error || 'Could not save location.');
    }
    setBusy(null);
  }, [label, lat, lng, loadLocations]);

  const remove = useCallback(
    async (id: string) => {
      setBusy(id);
      await lensRun('eco', 'locations-delete', { id });
      setResults((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      await loadLocations();
      setBusy(null);
    },
    [loadLocations],
  );

  const check = useCallback(async (loc: SavedLocation) => {
    setBusy(loc.id);
    setError(null);
    const r = await lensRun<AlertResult>('eco', 'environmental-alerts', {
      lat: loc.lat,
      lng: loc.lng,
      label: loc.label,
    });
    if (r.data?.ok && r.data.result) {
      setResults((prev) => ({ ...prev, [loc.id]: r.data!.result! }));
    } else {
      setError(r.data?.error || 'Could not fetch environmental alerts.');
    }
    setBusy(null);
  }, []);

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Bell className="w-4 h-4 text-amber-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">
          Local environmental alerts
        </span>
      </header>

      <div className="p-4 space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] text-gray-500 uppercase">Label</span>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Home"
              className="px-2 py-1.5 bg-white/[0.03] border border-white/10 rounded text-sm focus:outline-none focus:border-green-500/50"
            />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] text-gray-500 uppercase">Latitude</span>
            <input
              value={lat}
              onChange={(e) => setLat(e.target.value)}
              inputMode="decimal"
              className="px-2 py-1.5 bg-white/[0.03] border border-white/10 rounded text-sm focus:outline-none focus:border-green-500/50"
            />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] text-gray-500 uppercase">Longitude</span>
            <input
              value={lng}
              onChange={(e) => setLng(e.target.value)}
              inputMode="decimal"
              className="px-2 py-1.5 bg-white/[0.03] border border-white/10 rounded text-sm focus:outline-none focus:border-green-500/50"
            />
          </label>
          <div className="flex items-end">
            <button
              onClick={useMyLocation}
              className="inline-flex items-center gap-1.5 px-2 py-1.5 w-full justify-center rounded bg-white/[0.04] border border-white/10 text-gray-300 text-sm hover:bg-white/[0.08]"
            >
              <Crosshair className="w-4 h-4" /> My location
            </button>
          </div>
        </div>

        <button
          onClick={save}
          disabled={busy === 'save'}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-green-500 text-black text-sm font-bold hover:bg-green-400 disabled:opacity-50"
        >
          {busy === 'save' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          Save location
        </button>

        {error && <div className="text-xs text-red-400">{error}</div>}

        {loading && (
          <div className="flex items-center gap-2 text-xs text-gray-500 py-6 justify-center">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading saved locations…
          </div>
        )}

        {!loading && locations.length === 0 && (
          <p className="py-8 text-center text-xs text-gray-500">
            No data yet. Save a location to get air-quality, pollen, and UV alerts for it.
          </p>
        )}

        {!loading && locations.length > 0 && (
          <div className="space-y-2">
            {locations.map((loc) => {
              const res = results[loc.id];
              return (
                <div
                  key={loc.id}
                  className="rounded border border-white/10 bg-white/[0.02] p-3 space-y-2"
                >
                  <div className="flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-green-400 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-white truncate">{loc.label}</div>
                      <div className="text-[10px] text-gray-500">
                        {loc.lat.toFixed(3)}, {loc.lng.toFixed(3)}
                      </div>
                    </div>
                    <button
                      onClick={() => check(loc)}
                      disabled={busy === loc.id}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-white/[0.04] border border-amber-500/30 text-amber-400 text-xs hover:bg-amber-500/10 disabled:opacity-50"
                    >
                      {busy === loc.id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Bell className="w-3.5 h-3.5" />
                      )}
                      Check alerts
                    </button>
                    <button
                      onClick={() => remove(loc.id)}
                      disabled={busy === loc.id}
                      className="p-1 rounded hover:bg-red-500/10 text-gray-500 hover:text-red-400 disabled:opacity-50"
                      aria-label="Delete location"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {res && (
                    <div className="space-y-2 pt-1 border-t border-white/5">
                      <div className="grid grid-cols-3 gap-2 text-center">
                        <div className="p-1.5 bg-white/[0.03] rounded">
                          <p className="text-sm font-bold text-cyan-400">{res.readings.aqi}</p>
                          <p className="text-[9px] text-gray-500">US AQI</p>
                        </div>
                        <div className="p-1.5 bg-white/[0.03] rounded">
                          <p className="text-sm font-bold text-amber-400">
                            {res.readings.uvIndexMax}
                          </p>
                          <p className="text-[9px] text-gray-500">UV index max</p>
                        </div>
                        <div className="p-1.5 bg-white/[0.03] rounded">
                          <p className="text-sm font-bold text-green-400">
                            {res.readings.peakPollen}
                          </p>
                          <p className="text-[9px] text-gray-500">
                            peak pollen{res.readings.peakPollenType ? ` (${res.readings.peakPollenType})` : ''}
                          </p>
                        </div>
                      </div>
                      {res.allClear ? (
                        <div className="flex items-center gap-1.5 text-xs text-green-400">
                          <ShieldCheck className="w-4 h-4" /> All clear — no thresholds exceeded.
                        </div>
                      ) : (
                        <div className="space-y-1.5">
                          {res.alerts.map((a, i) => (
                            <div
                              key={i}
                              className={`flex items-start gap-2 rounded border p-2 text-xs ${
                                SEVERITY_TONE[a.severity]
                              }`}
                            >
                              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                              <div>
                                <span className="font-semibold uppercase">
                                  {a.kind.replace('_', ' ')} · {a.severity}
                                </span>
                                <span className="text-gray-300">
                                  {' '}
                                  ({a.value} {a.unit})
                                </span>
                                <p className="text-gray-400">{a.message}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      <p className="text-[10px] text-gray-600">
                        Source: {res.source} · checked {new Date(res.checkedAt).toLocaleTimeString()}
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default EnvAlerts;
