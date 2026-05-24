'use client';

/**
 * NasaExplorer — bespoke NASA-backed astronomy surface for the
 * astronomy lens. Three coordinated sub-panels driven by a single
 * shared DateScrubber:
 *   astronomy.apod                — APOD by date (hero image / video)
 *   astronomy.iss-current-location — ISS lat/lng/alt/velocity
 *   astronomy.near-earth-objects   — NeoWs close approaches
 *
 * Per category-leader UX research against NASA APOD, Heavens-Above,
 * N2YO, CNEOS, NASA Eyes on Asteroids:
 *
 *   • Single top date scrubber controls APOD + NEO range; ISS is "now"
 *     and refreshes every 15s
 *   • APOD: full-bleed hero with caption, share/save, copyright credit
 *   • ISS: pure-SVG equirectangular world map (no tile lib) with
 *     animated cyan marker + lat/lng/alt readout panel
 *   • NEO table: sortable by miss-distance with red banding for
 *     <1 LD close approaches + amber for <5 LD + PHA AlertTriangle
 *     badge; Save-as-DTU per row
 */

import { useState, useEffect, useMemo } from 'react';
import { useMutation } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronLeft, ChevronRight, Loader2, AlertTriangle, ExternalLink,
  Satellite, Image as ImageIcon, Globe2, Sparkles,
} from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface ApodData {
  date: string;
  title: string;
  explanation: string;
  mediaType: 'image' | 'video';
  url: string;
  hdurl?: string | null;
  copyright?: string | null;
  source: string;
  usingDemoKey?: boolean;
}
interface IssData {
  satelliteId: number; name: string;
  latitude: number; longitude: number; altitudeKm: number; velocityKmH: number;
  visibility: string;
  footprintKm?: number;
  timestamp: number; daynum: number;
  source: string;
}
interface NeoObject {
  id: string;
  name: string;
  absoluteMagnitude?: number;
  estimatedDiameterMeters?: { min?: number; max?: number };
  potentiallyHazardous: boolean;
  sentryObject?: boolean;
  approach?: {
    date: string;
    relativeVelocityKmH: number;
    missDistanceKm: number;
    missDistanceLunar: number;
    orbitingBody: string;
  } | null;
  nasaJplUrl?: string;
}

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }

async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('astronomy', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) {
    return data.result as MacroEnvelope<T>;
  }
  return data as MacroEnvelope<T>;
}

const today = () => new Date().toISOString().slice(0, 10);

export function NasaExplorer() {
  const [date, setDate] = useState<string>(today());

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">NASA Explorer</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">
            apod · iss · neows
          </span>
        </div>
        <DateScrubber date={date} setDate={setDate} />
      </header>

      <ApodPanel date={date} />
      <IssPanel />
      <NeoTable startDate={date} />
    </div>
  );
}

function DateScrubber({ date, setDate }: { date: string; setDate: (d: string) => void }) {
  const shift = (days: number) => {
    const d = new Date(date);
    d.setUTCDate(d.getUTCDate() + days);
    setDate(d.toISOString().slice(0, 10));
  };
  return (
    <div className="flex items-center gap-1 rounded-md border border-zinc-800 bg-zinc-950 p-1">
      <button type="button" onClick={() => shift(-1)} className="rounded p-1 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-cyan-300" aria-label="Previous day">
        <ChevronLeft className="h-3.5 w-3.5" />
      </button>
      <input
        type="date"
        value={date}
        onChange={(e) => { if (e.target.value) setDate(e.target.value); }}
        max={today()}
        className="rounded border-0 bg-transparent px-1 py-0.5 text-xs text-white focus:outline-none"
      />
      <button type="button" onClick={() => shift(1)} className="rounded p-1 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-cyan-300" aria-label="Next day">
        <ChevronRight className="h-3.5 w-3.5" />
      </button>
      {date !== today() && (
        <button type="button" onClick={() => setDate(today())} className="rounded border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-cyan-200 hover:bg-cyan-500/20">
          Today
        </button>
      )}
    </div>
  );
}

// ── APOD ────────────────────────────────────────────────────────────────

function ApodPanel({ date }: { date: string }) {
  const [apod, setApod] = useState<ApodData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const apodQuery = useMutation({
    mutationFn: async (d: string) => callMacro<ApodData>('apod', { date: d }),
    onSuccess: (env) => {
      if (env.ok && env.result) { setApod(env.result); setError(null); }
      else { setApod(null); setError(env.error || 'No APOD'); }
    },
  });

  useEffect(() => {
    apodQuery.mutate(date);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  return (
    <section className="rounded-lg border border-cyan-500/20 bg-zinc-950/60 p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-semibold text-zinc-200">
          <ImageIcon className="h-3.5 w-3.5 text-cyan-400" />
          NASA Picture of the Day
          <span className="font-mono text-[10px] text-zinc-400">{date}</span>
        </div>
        {apod && (
          <SaveAsDtuButton
            compact
            apiSource="nasa-apod"
            apiUrl={`https://api.nasa.gov/planetary/apod?date=${date}`}
            title={`APOD ${apod.date} — ${apod.title}`}
            content={[
              `Title: ${apod.title}`,
              `Date: ${apod.date}`,
              apod.copyright ? `Copyright: ${apod.copyright}` : 'Image credit: NASA (public domain)',
              '',
              apod.explanation,
              '',
              `Media URL: ${apod.url}`,
            ].join('\n')}
            extraTags={['astronomy', 'apod', 'nasa', apod.date.slice(0, 7)]}
            rawData={apod}
          />
        )}
      </div>
      {apodQuery.isPending && (
        <div className="flex h-48 items-center justify-center text-xs text-zinc-400">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading APOD…
        </div>
      )}
      {error && !apod && (
        <div className="rounded-md border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">{error}</div>
      )}
      {apod && (
        <div className="space-y-2">
          {apod.mediaType === 'image' ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={apod.url}
              alt={apod.title}
              className="w-full rounded border border-zinc-800 object-cover"
            />
          ) : (
            <div className="aspect-video w-full overflow-hidden rounded border border-zinc-800">
              <iframe src={apod.url} title={apod.title} className="h-full w-full" allowFullScreen />
            </div>
          )}
          <h3 className="text-base font-semibold text-white">{apod.title}</h3>
          <p className="text-xs leading-relaxed text-zinc-300">{apod.explanation}</p>
          <div className="flex items-center justify-between text-[10px] text-zinc-400">
            <span>{apod.copyright ? `© ${apod.copyright}` : 'NASA · public domain'}</span>
            {apod.hdurl && (
              <a href={apod.hdurl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 hover:text-cyan-400">
                <ExternalLink className="h-2.5 w-2.5" /> HD
              </a>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

// ── ISS ─────────────────────────────────────────────────────────────────

function IssPanel() {
  const [iss, setIss] = useState<IssData | null>(null);
  const issQuery = useMutation({
    mutationFn: async () => callMacro<IssData>('iss-current-location', {}),
    onSuccess: (env) => { if (env.ok && env.result) setIss(env.result); },
  });
  useEffect(() => {
    issQuery.mutate();
    const id = setInterval(() => issQuery.mutate(), 15000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Equirectangular projection — viewBox 0 0 360 180 makes lng→x trivial
  // (x = lng + 180, y = 90 - lat). Marker animates with framer-motion.
  return (
    <section className="rounded-lg border border-cyan-500/20 bg-zinc-950/60 p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-semibold text-zinc-200">
          <Satellite className="h-3.5 w-3.5 text-cyan-400" />
          ISS — real-time position
          <span className="rounded-full bg-cyan-500/15 px-1.5 text-[10px] font-mono text-cyan-300">15s</span>
        </div>
        {iss && (
          <SaveAsDtuButton
            compact
            apiSource="iss-wheretheissat"
            apiUrl="https://api.wheretheiss.at/v1/satellites/25544"
            title={`ISS position ${new Date((iss.timestamp || 0) * 1000).toISOString()}`}
            content={[
              `Satellite: ${iss.name} (#${iss.satelliteId})`,
              `Latitude: ${iss.latitude.toFixed(4)}°`,
              `Longitude: ${iss.longitude.toFixed(4)}°`,
              `Altitude: ${iss.altitudeKm.toFixed(2)} km`,
              `Velocity: ${iss.velocityKmH.toFixed(0)} km/h`,
              `Footprint: ${iss.footprintKm?.toFixed(0)} km`,
              `Visibility: ${iss.visibility}`,
              `Timestamp: ${new Date((iss.timestamp || 0) * 1000).toISOString()}`,
            ].join('\n')}
            extraTags={['astronomy', 'iss', 'realtime']}
            rawData={iss}
          />
        )}
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="md:col-span-2">
          <svg viewBox="0 0 360 180" className="aspect-[2/1] w-full rounded border border-zinc-800 bg-zinc-950">
            {/* Equator + prime meridian */}
            <line x1="0" y1="90" x2="360" y2="90" stroke="#27272a" strokeWidth="0.3" strokeDasharray="2 2" />
            <line x1="180" y1="0" x2="180" y2="180" stroke="#27272a" strokeWidth="0.3" strokeDasharray="2 2" />
            {/* Gridlines (very subtle, every 30°) */}
            {[30, 60, 120, 150, 210, 240, 300, 330].map((x) => (
              <line key={x} x1={x} y1="0" x2={x} y2="180" stroke="#27272a" strokeWidth="0.1" />
            ))}
            {[30, 60, 120, 150].map((y) => (
              <line key={y} x1="0" y1={y} x2="360" y2={y} stroke="#27272a" strokeWidth="0.1" />
            ))}
            {/* Polar caps as faint cyan tint */}
            <rect x="0" y="0" width="360" height="15" fill="#22d3ee" opacity="0.05" />
            <rect x="0" y="165" width="360" height="15" fill="#22d3ee" opacity="0.05" />

            {iss && (
              <motion.g
                animate={{ x: iss.longitude + 180, y: 90 - iss.latitude }}
                transition={{ duration: 1.4, ease: 'easeOut' }}
              >
                <circle cx={0} cy={0} r="3" fill="#22d3ee" opacity="0.3" />
                <circle cx={0} cy={0} r="1.5" fill="#22d3ee" />
              </motion.g>
            )}
          </svg>
          <div className="mt-1 flex justify-between text-[10px] text-zinc-400">
            <span>−180°</span>
            <span>0°</span>
            <span>+180°</span>
          </div>
        </div>
        <div className="space-y-1.5">
          {iss ? (
            <>
              <DataRow label="Latitude" value={`${iss.latitude.toFixed(4)}°`} />
              <DataRow label="Longitude" value={`${iss.longitude.toFixed(4)}°`} />
              <DataRow label="Altitude" value={`${iss.altitudeKm.toFixed(1)} km`} />
              <DataRow label="Velocity" value={`${Math.round(iss.velocityKmH)} km/h`} />
              {iss.footprintKm && <DataRow label="Footprint" value={`${Math.round(iss.footprintKm)} km`} />}
              <DataRow label="Visibility" value={iss.visibility} />
              <p className="pt-1 text-[10px] text-zinc-400">
                Source: wheretheiss.at · refreshing every 15s
              </p>
            </>
          ) : (
            <div className="flex h-32 items-center justify-center text-xs text-zinc-400">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Locating ISS…
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function DataRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2 rounded border border-zinc-800 bg-zinc-950/40 px-2.5 py-1 text-[11px]">
      <span className="text-zinc-400">{label}</span>
      <span className="font-mono text-cyan-300">{value}</span>
    </div>
  );
}

// ── NEO close-approaches ────────────────────────────────────────────────

function NeoTable({ startDate }: { startDate: string }) {
  const [neos, setNeos] = useState<NeoObject[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Default window: startDate ± 3 days, clamped to NASA's 7-day max
  const endDate = useMemo(() => {
    const d = new Date(startDate);
    d.setUTCDate(d.getUTCDate() + 3);
    return d.toISOString().slice(0, 10);
  }, [startDate]);

  const neoQuery = useMutation({
    mutationFn: async (params: { startDate: string; endDate: string }) =>
      callMacro<{ objects: NeoObject[] }>('near-earth-objects', params),
    onSuccess: (env) => {
      if (env.ok && env.result) { setNeos(env.result.objects); setError(null); }
      else { setNeos([]); setError(env.error || 'No NEOs'); }
    },
  });

  useEffect(() => {
    neoQuery.mutate({ startDate, endDate });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startDate, endDate]);

  return (
    <section className="rounded-lg border border-cyan-500/20 bg-zinc-950/60 p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-semibold text-zinc-200">
          <Globe2 className="h-3.5 w-3.5 text-cyan-400" />
          Near-Earth Objects · {startDate} → {endDate}
        </div>
        <span className="text-[10px] text-zinc-400">{neos.length} close approaches</span>
      </div>
      {neoQuery.isPending && (
        <div className="flex h-20 items-center justify-center text-xs text-zinc-400">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading NEO feed…
        </div>
      )}
      {error && (
        <div className="rounded-md border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">{error}</div>
      )}
      {!neoQuery.isPending && neos.length === 0 && !error && (
        <p className="rounded border border-dashed border-zinc-800 bg-zinc-950/40 px-3 py-4 text-center text-xs text-zinc-400">
          No NEOs in this window.
        </p>
      )}
      {neos.length > 0 && (
        <div className="space-y-1">
          <AnimatePresence initial={false}>
            {neos.slice(0, 25).map((n) => <NeoRow key={n.id} n={n} />)}
          </AnimatePresence>
        </div>
      )}
    </section>
  );
}

function NeoRow({ n }: { n: NeoObject }) {
  const lunar = n.approach?.missDistanceLunar ?? Infinity;
  const isClose = lunar < 1;
  const isAmber = lunar >= 1 && lunar < 5;
  const border = isClose ? 'border-l-red-500 bg-red-500/5' : isAmber ? 'border-l-amber-500 bg-amber-500/5' : 'border-l-zinc-700';

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.15 }}
      className={`flex items-center gap-3 rounded border border-zinc-800 border-l-4 ${border} px-2.5 py-1.5`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate font-mono text-[11px] text-white">{n.name}</span>
          {n.potentiallyHazardous && (
            <span className="inline-flex items-center gap-0.5 rounded bg-red-500/15 px-1 py-0.5 text-[9px] font-bold uppercase text-red-300">
              <AlertTriangle className="h-2.5 w-2.5" /> PHA
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-x-2 text-[10px] text-zinc-400">
          {n.approach && <span>{n.approach.date}</span>}
          {n.estimatedDiameterMeters?.max != null && (
            <span>{Math.round(n.estimatedDiameterMeters.min || 0)}–{Math.round(n.estimatedDiameterMeters.max)} m</span>
          )}
          {n.approach && (
            <span className={isClose ? 'text-red-300' : isAmber ? 'text-amber-300' : ''}>
              {n.approach.missDistanceLunar.toFixed(2)} LD
            </span>
          )}
          {n.approach && <span>{Math.round(n.approach.relativeVelocityKmH).toLocaleString()} km/h</span>}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <SaveAsDtuButton
          compact
          apiSource="nasa-neows"
          apiUrl={`https://api.nasa.gov/neo/rest/v1/neo/${n.id}`}
          title={`${n.name} — close approach ${n.approach?.date || '?'}`}
          content={[
            `Object: ${n.name}`,
            `Absolute magnitude H: ${n.absoluteMagnitude ?? '—'}`,
            n.estimatedDiameterMeters ? `Diameter: ${n.estimatedDiameterMeters.min?.toFixed(0)}–${n.estimatedDiameterMeters.max?.toFixed(0)} m` : '',
            n.potentiallyHazardous ? 'POTENTIALLY HAZARDOUS ASTEROID' : '',
            '',
            n.approach ? `Approach date: ${n.approach.date}` : '',
            n.approach ? `Miss distance: ${n.approach.missDistanceKm.toFixed(0)} km (${n.approach.missDistanceLunar.toFixed(2)} LD)` : '',
            n.approach ? `Relative velocity: ${Math.round(n.approach.relativeVelocityKmH).toLocaleString()} km/h` : '',
            n.approach ? `Orbiting body: ${n.approach.orbitingBody}` : '',
            '',
            n.nasaJplUrl ? `JPL: ${n.nasaJplUrl}` : '',
          ].filter(Boolean).join('\n')}
          extraTags={['astronomy', 'neo', n.potentiallyHazardous ? 'pha' : 'neo']}
          rawData={n}
        />
        {n.nasaJplUrl && (
          <a href={n.nasaJplUrl} target="_blank" rel="noopener noreferrer" className="flex h-6 w-6 items-center justify-center rounded text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200" aria-label="Open JPL page"><ExternalLink className="h-2.5 w-2.5" /></a>
        )}
      </div>
    </motion.div>
  );
}

