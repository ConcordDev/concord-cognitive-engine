'use client';

/**
 * EnviroPanel — bespoke EPA AirNow + Superfund + USGS Water panel
 * for the environment lens. Backed by environment.airnow-current +
 * environment.epa-superfund-search + environment.usgs-water-realtime.
 *
 * Per category-leader research (AirNow, IQAir, EPA Envirofacts, USGS
 * WaterWatch): EPA AQI color bands + Superfund site detail + per-row
 * Save-as-DTU.
 */

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Leaf, Loader2, Wind, Droplets, Biohazard } from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface AqiObservation {
  dateObserved: string; hourObserved: number;
  reportingArea: string; stateCode: string;
  parameterName: string; aqi: number;
  category?: string;
}

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }

async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('environment', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) {
    return data.result as MacroEnvelope<T>;
  }
  return data as MacroEnvelope<T>;
}

function aqiColor(aqi: number) {
  if (aqi <= 50) return 'bg-emerald-500 text-emerald-50';
  if (aqi <= 100) return 'bg-yellow-500 text-yellow-950';
  if (aqi <= 150) return 'bg-orange-500 text-orange-950';
  if (aqi <= 200) return 'bg-red-500 text-red-50';
  if (aqi <= 300) return 'bg-violet-600 text-violet-50';
  return 'bg-rose-900 text-rose-50';
}

export function EnviroPanel() {
  const [zip, setZip] = useState('94110');
  const [observations, setObservations] = useState<AqiObservation[]>([]);
  const [error, setError] = useState<string | null>(null);

  const aqiMutation = useMutation({
    mutationFn: async () => callMacro<{ observations: AqiObservation[] }>('airnow-current', { zipCode: zip }),
    onSuccess: (env) => {
      if (env.ok && env.result) { setObservations(env.result.observations); setError(null); }
      else { setObservations([]); setError(env.error || 'no AQI data'); }
    },
  });

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <Leaf className="h-5 w-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">Environmental data (EPA / USGS)</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">airnow · envirofacts · usgs</span>
        </div>
      </header>

      <div className="rounded-lg border border-cyan-500/20 bg-zinc-950/60 p-3 space-y-2">
        <div className="flex items-center gap-2">
          <Wind className="h-3.5 w-3.5 text-cyan-400" />
          <span className="text-xs font-semibold text-zinc-200">Current AQI (AirNow)</span>
          <input type="text" maxLength={5} value={zip} onChange={(e) => setZip(e.target.value.replace(/\D/g, ''))} placeholder="ZIP" className="ml-2 w-20 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs font-mono text-white" />
          <button type="button" onClick={() => aqiMutation.mutate()} disabled={zip.length !== 5 || aqiMutation.isPending} className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 text-xs text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50">
            {aqiMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Load AQI'}
          </button>
        </div>
        {error && <div className="text-[11px] text-red-300">{error}</div>}
        {observations.length > 0 && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-1.5">
            {observations.map((o, i) => (
              <div key={`${o.parameterName}-${i}`} className="flex items-center gap-2 rounded border border-zinc-800 bg-zinc-950 p-2 text-xs">
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${aqiColor(o.aqi)}`}>{o.aqi}</span>
                <span className="font-mono text-zinc-300">{o.parameterName}</span>
                <span className="text-zinc-500">{o.category || ''}</span>
                <span className="ml-auto text-[10px] text-zinc-500">{o.reportingArea}, {o.stateCode}</span>
                <SaveAsDtuButton
                  compact
                  apiSource="epa-airnow"
                  title={`AQI ${o.aqi} ${o.parameterName} — ${o.reportingArea}, ${o.stateCode}`}
                  content={`AQI: ${o.aqi}\nParameter: ${o.parameterName}\nCategory: ${o.category}\nReporting area: ${o.reportingArea}, ${o.stateCode}\nObserved: ${o.dateObserved} ${o.hourObserved}:00`}
                  extraTags={['environment', 'aqi', 'epa', o.parameterName.toLowerCase().replace(/\./g, '-')]}
                  rawData={o}
                />
              </div>
            ))}
          </motion.div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <SuperfundSearch />
        <UsgsWater />
      </div>
    </div>
  );
}

function SuperfundSearch() {
  const [state, setState] = useState('CA');
  const [sites, setSites] = useState<Array<{ siteName: string; epaId: string; nplStatus: string; city: string; state: string }>>([]);
  const search = useMutation({
    mutationFn: async () => callMacro<{ sites: typeof sites }>('epa-superfund-search', { state }),
    onSuccess: (env) => { if (env.ok && env.result) setSites(env.result.sites); else setSites([]); },
  });
  return (
    <div className="rounded-lg border border-cyan-500/20 bg-zinc-950/60 p-3 space-y-2">
      <div className="flex items-center gap-2 text-xs">
        <Biohazard className="h-3.5 w-3.5 text-cyan-400" />
        <span className="font-semibold text-zinc-200">Superfund sites</span>
        <input type="text" maxLength={2} value={state} onChange={(e) => setState(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))} placeholder="State" className="ml-2 w-12 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 font-mono uppercase text-xs text-white" />
        <button type="button" onClick={() => search.mutate()} disabled={state.length !== 2 || search.isPending} className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 text-xs text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50">
          {search.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Search'}
        </button>
      </div>
      <div className="space-y-1 max-h-64 overflow-y-auto">
        {sites.map((s) => (
          <div key={s.epaId} className="rounded border border-zinc-800 bg-zinc-950 p-2 text-[11px]">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-white">{s.siteName}</span>
              <span className="shrink-0 rounded bg-amber-500/15 px-1.5 text-[9px] text-amber-300">{s.nplStatus}</span>
            </div>
            <div className="text-[10px] text-zinc-500">{s.city}, {s.state} · EPA ID {s.epaId}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function UsgsWater() {
  const [siteCode, setSiteCode] = useState('11447650');
  const [data, setData] = useState<{ site: string; readings: Array<{ parameter: string; value: number; unit: string }> } | null>(null);
  const load = useMutation({
    mutationFn: async () => callMacro<{ site: string; readings: Array<{ parameter: string; value: number; unit: string }> }>('usgs-water-realtime', { siteCode }),
    onSuccess: (env) => { if (env.ok && env.result) setData(env.result); else setData(null); },
  });
  return (
    <div className="rounded-lg border border-cyan-500/20 bg-zinc-950/60 p-3 space-y-2">
      <div className="flex items-center gap-2 text-xs">
        <Droplets className="h-3.5 w-3.5 text-cyan-400" />
        <span className="font-semibold text-zinc-200">USGS water</span>
        <input type="text" value={siteCode} onChange={(e) => setSiteCode(e.target.value)} placeholder="Site code" className="ml-2 w-28 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 font-mono text-xs text-white" />
        <button type="button" onClick={() => load.mutate()} disabled={!siteCode || load.isPending} className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 text-xs text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50">
          {load.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Load'}
        </button>
      </div>
      {data && (
        <>
          <div className="text-[11px] text-zinc-300">{data.site}</div>
          {data.readings.map((r, i) => (
            <div key={i} className="flex items-center justify-between rounded border border-zinc-800 bg-zinc-950 p-1.5 text-[11px]">
              <span className="text-zinc-400">{r.parameter}</span>
              <span className="font-mono text-cyan-300">{r.value} {r.unit}</span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
