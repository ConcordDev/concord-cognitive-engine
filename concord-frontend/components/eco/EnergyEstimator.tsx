'use client';

import { useEffect, useState } from 'react';
import { Sun, Zap, Loader2 } from 'lucide-react';
import { api } from '@/lib/api/client';

interface EstimateResult {
  systemKwp: number | null;
  annualKwh: number | null;
  monthlyKwh: number[] | null;
  co2AvoidedKgPerYear: number | null;
  capacityFactor: number | null;
  source: string | null;
  reason?: string | null;
  unavailable?: string[];
  message?: string;
  tiltAssumed?: boolean;
  azimuthAssumed?: boolean;
}

export function EnergyEstimator() {
  const [lat, setLat] = useState<number | ''>('');
  const [lng, setLng] = useState<number | ''>('');
  const [systemKw, setSystemKw] = useState<number | ''>('');
  const [tilt, setTilt] = useState<number | ''>('');
  const [azimuth, setAzimuth] = useState<number | ''>('');
  const [result, setResult] = useState<EstimateResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        pos => {
          setLat((prev) => (prev === '' ? pos.coords.latitude : prev));
          setLng((prev) => (prev === '' ? pos.coords.longitude : prev));
        },
        () => { /* a denied fix stays blank */ },
        { maximumAge: 5 * 60 * 1000, timeout: 5000 }
      );
    }
  }, []);

  async function estimate() {
    setLoading(true);
    setError(null);
    try {
      const input: Record<string, number> = {};
      if (typeof lat === 'number' && Number.isFinite(lat)) input.lat = lat;
      if (typeof lng === 'number' && Number.isFinite(lng)) input.lng = lng;
      if (typeof systemKw === 'number' && Number.isFinite(systemKw)) input.systemKw = systemKw;
      if (typeof tilt === 'number' && Number.isFinite(tilt)) input.tilt = tilt;
      if (typeof azimuth === 'number' && Number.isFinite(azimuth)) input.azimuth = azimuth;
      const res = await api.post('/api/lens/run', {
        domain: 'eco', action: 'energy-estimate',
        input,
      });
      // /api/lens/run single-unwraps: a handler rejection arrives as
      // res.data.result = { ok:false, error }. Surface it rather than crashing
      // on result.monthlyKwh.map / Math.max(...result.monthlyKwh).
      const node = res.data?.result as (EstimateResult & { ok?: boolean; error?: string }) | null;
      if (node && node.ok === false) {
        setError(node.error || 'Could not estimate production.');
        setResult(null);
      } else {
        setResult((node as EstimateResult) || null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not estimate production.');
      setResult(null);
    } finally { setLoading(false); }
  }

  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const monthly = result?.monthlyKwh ?? [];
  const maxMonthly = monthly.length ? Math.max(...monthly) : 1;
  const quoted = result != null && result.annualKwh != null && result.capacityFactor != null;

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Sun className="w-4 h-4 text-yellow-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Renewable estimator</span>
      </header>
      <div className="p-4 space-y-3">
        <div className="grid grid-cols-2 gap-3 text-xs">
          <Field label="Latitude">
            <input type="number" step={0.01} value={lat} onChange={e => setLat(e.target.value === '' ? '' : Number(e.target.value))} className="w-full px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-white" />
          </Field>
          <Field label="Longitude">
            <input type="number" step={0.01} value={lng} onChange={e => setLng(e.target.value === '' ? '' : Number(e.target.value))} className="w-full px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-white" />
          </Field>
          <Field label="System size (kW)">
            <input type="number" step={0.5} value={systemKw} onChange={e => setSystemKw(e.target.value === '' ? '' : Number(e.target.value))} className="w-full px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-white" />
          </Field>
          <Field label="Tilt (°)">
            <input type="number" step={1} value={tilt} onChange={e => setTilt(e.target.value === '' ? '' : Number(e.target.value))} className="w-full px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-white" />
          </Field>
          <Field label="Azimuth (° from N)">
            <input type="number" step={1} value={azimuth} onChange={e => setAzimuth(e.target.value === '' ? '' : Number(e.target.value))} className="w-full px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-white" />
          </Field>
        </div>
        <button
          onClick={estimate}
          disabled={loading}
          className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-yellow-500 text-black font-bold hover:bg-yellow-400 disabled:opacity-50"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
          Estimate production
        </button>
        {error && <div role="alert" className="text-xs text-red-400">{error}</div>}
        {result && !quoted && (
          <p className="text-xs text-gray-400">{result.message || 'Not recorded'}</p>
        )}
        {result && quoted && (
          <div className="space-y-2 pt-2 border-t border-white/10">
            <div className="grid grid-cols-3 gap-2 text-center">
              <Stat label="Annual" value={`${result.annualKwh!.toLocaleString(undefined, { maximumFractionDigits: 0 })} kWh`} accent="text-yellow-300" />
              <Stat label="CO₂ avoided/yr" value={result.co2AvoidedKgPerYear == null ? '—' : `${result.co2AvoidedKgPerYear.toLocaleString(undefined, { maximumFractionDigits: 0 })} kg`} accent="text-green-300" />
              <Stat label="Capacity factor" value={`${(result.capacityFactor! * 100).toFixed(0)}%`} accent="text-cyan-300" />
            </div>
            <div>
              <p className="text-[10px] uppercase text-gray-400 tracking-wider mb-1">Monthly production (kWh)</p>
              <div className="flex items-end gap-1 h-20">
                {monthly.map((v, i) => (
                  <div key={i} className="flex-1 flex flex-col items-center">
                    <div className="bg-gradient-to-t from-yellow-500/60 to-yellow-300/40 w-full rounded-t" style={{ height: `${Math.max(4, (v / maxMonthly) * 100)}%` }} />
                    <span className="text-[9px] text-gray-400 mt-0.5">{months[i]}</span>
                  </div>
                ))}
              </div>
            </div>
            {(result.tiltAssumed || result.azimuthAssumed) && (
              <p className="text-[10px] text-gray-400">Tilt and azimuth were not sent, so this quote uses 30° and 180°.</p>
            )}
            <p className="text-[10px] text-gray-400">Source: {result.source} · grid emission factor 0.4 kgCO₂/kWh (US avg).</p>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-wider text-gray-400 block mb-0.5">{label}</span>
      {children}
    </label>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="bg-white/[0.03] rounded px-2 py-2">
      <div className="text-[10px] text-gray-400">{label}</div>
      <div className={`text-sm font-bold tabular-nums ${accent}`}>{value}</div>
    </div>
  );
}

export default EnergyEstimator;
