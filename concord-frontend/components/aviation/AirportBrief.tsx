'use client';

/**
 * AirportBrief — bespoke FAA airport detail + METAR/TAF for the
 * aviation lens. Backed by:
 *   aviation.airport-lookup  — FAA NASR (runways, frequencies, fuel)
 *   aviation.weather-metar   — aviationweather.gov real METAR
 *   aviation.weather-taf     — aviationweather.gov real TAF
 *
 * Per category-leader UX research (ForeFlight, Garmin Pilot, SkyVector,
 * AviationWeather.gov, FlightAware): decoded first with raw collapsed,
 * flight-category chip (VFR/MVFR/IFR/LIFR), runway strip with surface,
 * frequencies as copy-to-clipboard list, Save-as-DTU.
 */

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  Plane, Loader2, Search, Radio, Wind, Layers,
  ChevronDown, ChevronRight,
} from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface Airport {
  ident: string; name: string; city: string;
  lat: number; lng: number; elev_ft: number;
  runways: Array<{ id: string; length: number; surface: string }>;
  frequencies: { tower: string; ground: string; atis: string; approach: string; awos: string };
  fuel: string[];
}
interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }

async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('aviation', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) {
    return data.result as MacroEnvelope<T>;
  }
  return data as MacroEnvelope<T>;
}

function flightCategoryFromMetar(raw: string): { label: 'VFR' | 'MVFR' | 'IFR' | 'LIFR' | '?'; color: string } {
  // Parse ceiling + visibility from raw METAR for a quick category chip
  // VFR: ceiling > 3000 AND vis > 5sm
  // MVFR: 1000-3000 ceiling OR 3-5sm vis
  // IFR: 500-1000 ceiling OR 1-3sm vis
  // LIFR: <500 ceiling OR <1sm vis
  if (!raw) return { label: '?', color: 'text-zinc-400 border-zinc-700' };
  const visMatch = raw.match(/\s(\d{1,3})SM(?:\s|$)/);
  const ceilMatch = raw.match(/(BKN|OVC)(\d{3})/);
  const visSm = visMatch ? Number(visMatch[1]) : 99;
  const ceilFt = ceilMatch ? Number(ceilMatch[2]) * 100 : 99999;
  if (ceilFt < 500 || visSm < 1) return { label: 'LIFR', color: 'text-fuchsia-300 border-fuchsia-500/40 bg-fuchsia-500/10' };
  if (ceilFt < 1000 || visSm < 3) return { label: 'IFR', color: 'text-red-300 border-red-500/40 bg-red-500/10' };
  if (ceilFt < 3000 || visSm < 5) return { label: 'MVFR', color: 'text-amber-300 border-amber-500/40 bg-amber-500/10' };
  return { label: 'VFR', color: 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10' };
}

export function AirportBrief() {
  const [identInput, setIdentInput] = useState('');
  const [airport, setAirport] = useState<Airport | null>(null);
  const [metar, setMetar] = useState<string | null>(null);
  const [taf, setTaf] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lookupMutation = useMutation({
    mutationFn: async (ident: string) => {
      const apt = await callMacro<{ airport: Airport }>('airport-lookup', { ident });
      if (apt.ok && apt.result) setAirport(apt.result.airport);
      else { setAirport(null); setError(apt.error || 'lookup failed'); return; }
      // Parallel METAR + TAF
      const [met, ta] = await Promise.all([
        callMacro<{ raw: string; decoded?: unknown }>('weather-metar', { ids: ident }),
        callMacro<{ raw: string; decoded?: unknown }>('weather-taf', { ids: ident }),
      ]);
      if (met.ok && met.result) setMetar((met.result as { raw?: string; metars?: Array<{ rawOb?: string }> }).raw || (met.result as { metars?: Array<{ rawOb?: string }> }).metars?.[0]?.rawOb || JSON.stringify(met.result));
      if (ta.ok && ta.result) setTaf((ta.result as { raw?: string; tafs?: Array<{ rawTAF?: string }> }).raw || (ta.result as { tafs?: Array<{ rawTAF?: string }> }).tafs?.[0]?.rawTAF || JSON.stringify(ta.result));
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = identInput.trim().toUpperCase();
    if (q.length < 3) return;
    setError(null); setAirport(null); setMetar(null); setTaf(null);
    lookupMutation.mutate(q);
  };

  const cat = flightCategoryFromMetar(metar || '');

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <Plane className="h-5 w-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">Airport Brief</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">
            faa nasr · metar · taf
          </span>
        </div>
      </header>

      <form onSubmit={submit} className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
          <input
            type="text"
            value={identInput}
            onChange={(e) => setIdentInput(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4))}
            placeholder="ICAO — KSFO, KJFK, KORD…"
            maxLength={4}
            className="w-full rounded-md border border-zinc-800 bg-zinc-950 py-1.5 pl-8 pr-3 font-mono text-sm uppercase tracking-[0.2em] text-white placeholder-zinc-600 focus:border-cyan-500/40 focus:outline-none"
          />
        </div>
        <button
          type="submit"
          disabled={identInput.length < 3 || lookupMutation.isPending}
          className="inline-flex items-center gap-1.5 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs font-medium text-cyan-200 transition-colors hover:bg-cyan-500/20 disabled:opacity-50"
        >
          {lookupMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plane className="h-3.5 w-3.5" />}
          Brief
        </button>
      </form>

      {error && !airport && (
        <div className="rounded-md border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">{error}</div>
      )}

      {!airport && !lookupMutation.isPending && !error && (
        <div className="rounded-md border border-dashed border-zinc-800 bg-zinc-950/40 px-3 py-6 text-center text-xs text-zinc-400">
          Enter a 3-4 char ICAO ident — gets you the FAA airport record + current METAR + TAF.
        </div>
      )}

      {airport && (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }} className="space-y-3">
          {/* Hero */}
          <div className="rounded-lg border border-cyan-500/20 bg-gradient-to-br from-cyan-500/10 via-zinc-950/60 to-zinc-950/80 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <h3 className="font-mono text-2xl font-bold text-white">{airport.ident}</h3>
                  <span className={`rounded-full border px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider ${cat.color}`}>
                    {cat.label}
                  </span>
                </div>
                <p className="text-sm text-zinc-300">{airport.name}</p>
                <p className="text-[11px] text-zinc-400">
                  {airport.city} · {airport.lat.toFixed(4)}, {airport.lng.toFixed(4)} · elev {airport.elev_ft} ft
                </p>
              </div>
              <SaveAsDtuButton
                apiSource="faa-nasr"
                apiUrl={`https://api.aviationapi.com/v1/airports?apt=${airport.ident}`}
                title={`${airport.ident} — ${airport.name}`}
                content={[
                  `ICAO: ${airport.ident}`,
                  `Name: ${airport.name}`,
                  `Location: ${airport.city} (${airport.lat}, ${airport.lng})`,
                  `Elevation: ${airport.elev_ft} ft`,
                  `Runways: ${airport.runways.map((r) => r.id).join(', ')}`,
                  `Tower: ${airport.frequencies.tower || '—'}`,
                  `Ground: ${airport.frequencies.ground || '—'}`,
                  `ATIS: ${airport.frequencies.atis || '—'}`,
                  `Fuel: ${airport.fuel.join(', ') || '—'}`,
                  '',
                  metar ? `METAR: ${metar}` : '',
                  taf ? `TAF: ${taf}` : '',
                ].filter(Boolean).join('\n')}
                extraTags={['aviation', 'airport', airport.ident.toLowerCase()]}
                rawData={{ airport, metar, taf }}
              />
            </div>
          </div>

          {/* Runways */}
          {airport.runways.length > 0 && (
            <div className="rounded-md border border-zinc-800 bg-zinc-950/40 p-3">
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-zinc-200">
                <Layers className="h-3.5 w-3.5 text-cyan-400" /> Runways
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {airport.runways.map((r) => (
                  <div key={r.id} className="rounded border border-zinc-800 bg-zinc-950 p-2 text-xs">
                    <div className="font-mono font-bold text-cyan-300">{r.id}</div>
                    <div className="text-[10px] text-zinc-400">{r.length.toLocaleString()} ft · {r.surface || '—'}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Frequencies */}
          <div className="rounded-md border border-zinc-800 bg-zinc-950/40 p-3">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-zinc-200">
              <Radio className="h-3.5 w-3.5 text-cyan-400" /> Frequencies
            </div>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-5">
              {Object.entries(airport.frequencies).map(([k, v]) => (
                <FreqCell key={k} label={k} freq={v as string} />
              ))}
            </div>
          </div>

          {/* Weather */}
          <div className="rounded-md border border-zinc-800 bg-zinc-950/40 p-3">
            <button type="button" onClick={() => setShowRaw((v) => !v)} className="flex w-full items-center justify-between text-xs font-semibold text-zinc-200 hover:text-zinc-100">
              <span className="flex items-center gap-2"><Wind className="h-3.5 w-3.5 text-cyan-400" /> Weather</span>
              <span className="text-[10px] text-zinc-400">{showRaw ? 'hide raw' : 'show raw'}</span>
              {showRaw ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            </button>
            {!metar && lookupMutation.isPending && (
              <div className="mt-2 flex items-center gap-2 text-[11px] text-zinc-400"><Loader2 className="h-3 w-3 animate-spin" /> Loading METAR/TAF…</div>
            )}
            {(metar || taf) && (
              <div className="mt-2 space-y-2 text-xs">
                {metar && (
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-zinc-400">METAR</div>
                    <pre className="mt-0.5 whitespace-pre-wrap font-mono text-[11px] text-emerald-300">{showRaw ? metar : metar.replace(/^\S+ /, '').slice(0, 200)}</pre>
                  </div>
                )}
                {taf && (
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-zinc-400">TAF</div>
                    <pre className="mt-0.5 max-h-32 overflow-y-auto whitespace-pre-wrap font-mono text-[11px] text-cyan-300">{showRaw ? taf : taf.slice(0, 400)}</pre>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* External link */}
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <a href={`https://skyvector.com/airport/${airport.ident}`} target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:underline">SkyVector</a>
            <span className="text-zinc-700">·</span>
            <a href={`https://aviationweather.gov/data/cache/metars.cache.csv.zip`} target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:underline">AviationWeather.gov</a>
          </div>
        </motion.div>
      )}
    </div>
  );
}

function FreqCell({ label, freq }: { label: string; freq: string }) {
  if (!freq) {
    return (
      <div className="rounded border border-zinc-800 bg-zinc-950 p-2 text-xs opacity-50">
        <div className="text-[10px] uppercase tracking-wider text-zinc-400">{label}</div>
        <div className="font-mono text-zinc-600">—</div>
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() => { if (typeof navigator !== 'undefined') navigator.clipboard?.writeText(freq); }}
      title="Click to copy"
      className="rounded border border-zinc-800 bg-zinc-950 p-2 text-left text-xs transition-colors hover:border-cyan-500/30"
    >
      <div className="text-[10px] uppercase tracking-wider text-zinc-400">{label}</div>
      <div className="font-mono text-cyan-300">{freq}</div>
    </button>
  );
}
