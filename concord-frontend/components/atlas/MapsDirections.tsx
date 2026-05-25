'use client';

/**
 * MapsDirections — Google-Maps-style turn-by-turn directions panel for
 * the atlas lens. Patterned on Google Maps' left-rail directions UI:
 * vertically stacked origin/destination inputs with a swap button,
 * mode tabs (drive/transit/walk/bike), route summary card with
 * distance + duration, and a step-by-step waypoint list with chevrons.
 *
 * Backend: uses already-wired atlas macros
 *   • nominatim-geocode — typeahead address resolution
 *   • routeOptimize — nearest-neighbor route ordering
 *
 * No new backend. No shared calc shell. Bespoke per atlas's leader
 * paid app (Google Maps).
 */

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  Car, TrainFront, PersonStanding, Bike,
  ArrowDownUp, MapPin, Loader2, Navigation,
  ChevronRight, Plus, X,
} from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

type Mode = 'drive' | 'transit' | 'walk' | 'bike';

interface Place {
  query: string;
  displayName?: string;
  latitude?: number;
  longitude?: number;
}

interface RouteLeg { from: string; to: string; km: number }
interface RouteData { route?: string[]; totalDistanceKm?: number; legs?: RouteLeg[] }

const MODE_TABS: Array<{ id: Mode; label: string; icon: typeof Car; speedKph: number }> = [
  { id: 'drive',   label: 'Drive',   icon: Car,            speedKph: 65 },
  { id: 'transit', label: 'Transit', icon: TrainFront,     speedKph: 30 },
  { id: 'walk',    label: 'Walk',    icon: PersonStanding, speedKph: 5 },
  { id: 'bike',    label: 'Bike',    icon: Bike,           speedKph: 18 },
];

type NominatimEnvelope = {
  ok?: boolean;
  result?: { places?: Array<{ displayName: string; latitude: number; longitude: number }> };
  places?: Array<{ displayName: string; latitude: number; longitude: number }>;
};

async function geocodeOne(query: string): Promise<{ displayName: string; latitude: number; longitude: number } | null> {
  if (!query.trim()) return null;
  try {
    const r = await apiHelpers.lens.runDomain('atlas', 'nominatim-geocode', { input: { query: query.trim(), limit: 1 } });
    const env = (r as { data?: { ok: boolean; result?: NominatimEnvelope | { places?: Array<{ displayName: string; latitude: number; longitude: number }> } } }).data;
    if (!env?.ok) return null;
    const raw = env.result as NominatimEnvelope | undefined;
    const places = raw?.places || raw?.result?.places || [];
    const top = places[0];
    if (!top) return null;
    return { displayName: top.displayName, latitude: top.latitude, longitude: top.longitude };
  } catch { return null; }
}

type RouteEnvelope = {
  ok?: boolean;
  result?: RouteData;
} & RouteData;

async function optimize(waypoints: Array<{ name: string; lat: number; lon: number }>): Promise<RouteData | null> {
  try {
    const r = await apiHelpers.lens.runDomain('atlas', 'routeOptimize', { input: { artifact: { data: { waypoints } } } });
    const env = (r as { data?: { ok: boolean; result?: RouteEnvelope } }).data;
    if (!env?.ok) return null;
    const raw = env.result;
    if (!raw) return null;
    if (raw.result && typeof raw.result === 'object' && 'route' in raw.result) return raw.result;
    return raw as RouteData;
  } catch { return null; }
}

function formatDuration(km: number, speedKph: number): string {
  const hours = km / speedKph;
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return m > 0 ? `${h} hr ${m} min` : `${h} hr`;
}

export function MapsDirections() {
  const [origin, setOrigin] = useState<Place>({ query: '' });
  const [destination, setDestination] = useState<Place>({ query: '' });
  const [stops, setStops] = useState<Place[]>([]);
  const [mode, setMode] = useState<Mode>('drive');
  const [route, setRoute] = useState<RouteData | null>(null);
  const [resolvedNames, setResolvedNames] = useState<string[]>([]);

  const compute = useMutation({
    mutationFn: async () => {
      const all = [origin, ...stops, destination];
      const resolved = await Promise.all(all.map(async (p) => {
        if (p.latitude != null && p.longitude != null) return { name: p.displayName || p.query, lat: p.latitude, lon: p.longitude };
        const g = await geocodeOne(p.query);
        if (!g) return null;
        return { name: g.displayName, lat: g.latitude, lon: g.longitude };
      }));
      const valid = resolved.filter((r): r is { name: string; lat: number; lon: number } => r !== null);
      if (valid.length < 2) {
        setRoute(null);
        return null;
      }
      setResolvedNames(valid.map((v) => v.name));
      const r = await optimize(valid);
      setRoute(r);
      return r;
    },
  });

  const swap = () => {
    const o = origin;
    setOrigin(destination);
    setDestination(o);
    setRoute(null);
  };

  const addStop = () => setStops((ss) => [...ss, { query: '' }]);
  const updateStop = (i: number, value: string) => setStops((ss) => ss.map((s, idx) => (idx === i ? { query: value } : s)));
  const removeStop = (i: number) => setStops((ss) => ss.filter((_, idx) => idx !== i));

  const modeSpeed = MODE_TABS.find((m) => m.id === mode)?.speedKph ?? 65;
  const totalDuration = route?.totalDistanceKm ? formatDuration(route.totalDistanceKm, modeSpeed) : null;

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950">
      {/* Maps-style header: white-ish search rail */}
      <div className="border-b border-zinc-800 bg-zinc-900/60 p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Navigation className="h-4 w-4 text-blue-400" />
            <span className="text-sm font-semibold text-white">Directions</span>
          </div>
          {route && route.totalDistanceKm != null && (
            <SaveAsDtuButton
              compact
              apiSource="concord-atlas-maps-directions"
              title={`Directions: ${origin.query} → ${destination.query} (${mode}, ${route.totalDistanceKm} km)`}
              content={`Mode: ${mode}\nTotal: ${route.totalDistanceKm} km, ~${totalDuration}\n\nRoute:\n${(route.route || []).map((r, i) => `  ${i + 1}. ${r}`).join('\n')}\n\nLegs:\n${(route.legs || []).map((l) => `  ${l.from} → ${l.to}: ${l.km} km`).join('\n')}`}
              extraTags={['atlas', 'directions', mode]}
              rawData={{ origin: origin.query, destination: destination.query, stops: stops.map((s) => s.query), mode, route }}
            />
          )}
        </div>

        {/* Mode tabs — Maps-style icon row */}
        <div className="mt-3 flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-950 p-1">
          {MODE_TABS.map((m) => {
            const Icon = m.icon;
            const active = mode === m.id;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => setMode(m.id)}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded px-2 py-1.5 text-[11px] transition ${active ? 'bg-blue-500/20 text-blue-200' : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200'}`}
              >
                <Icon className="h-3.5 w-3.5" />
                {m.label}
              </button>
            );
          })}
        </div>

        {/* Origin / stops / destination — Maps-style vertical stack with bullet rail */}
        <div className="relative mt-3 space-y-1.5">
          {/* Connector rail */}
          <div className="pointer-events-none absolute left-[10px] top-3 h-[calc(100%-24px)] w-[1px] border-l border-dashed border-zinc-700" aria-hidden="true" />

          <div className="relative flex items-center gap-2">
            <span className="z-10 h-2.5 w-2.5 shrink-0 rounded-full border-2 border-blue-400 bg-zinc-950" />
            <input
              className="flex-1 rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white placeholder:text-zinc-400 focus:border-blue-500/40 focus:outline-none"
              placeholder="Choose starting point"
              value={origin.query}
              onChange={(e) => setOrigin({ query: e.target.value })}
            />
            <button type="button" onClick={swap} className="shrink-0 rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200" aria-label="Swap"><ArrowDownUp className="h-3.5 w-3.5" /></button>
          </div>

          {stops.map((s, i) => (
            <div key={i} className="relative flex items-center gap-2">
              <span className="z-10 h-2 w-2 shrink-0 rounded-full bg-zinc-600" />
              <input
                className="flex-1 rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white placeholder:text-zinc-400 focus:border-blue-500/40 focus:outline-none"
                placeholder={`Stop ${i + 1}`}
                value={s.query}
                onChange={(e) => updateStop(i, e.target.value)}
              />
              <button type="button" onClick={() => removeStop(i)} className="shrink-0 rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-rose-300" aria-label="Remove stop"><X className="h-3.5 w-3.5" /></button>
            </div>
          ))}

          <div className="relative flex items-center gap-2">
            <MapPin className="z-10 h-3 w-3 shrink-0 text-rose-400" />
            <input
              className="flex-1 rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white placeholder:text-zinc-400 focus:border-blue-500/40 focus:outline-none"
              placeholder="Choose destination"
              value={destination.query}
              onChange={(e) => setDestination({ query: e.target.value })}
            />
            <span className="w-[26px]" />
          </div>

          <button type="button" onClick={addStop} className="ml-[18px] inline-flex items-center gap-1 text-[10px] text-zinc-400 hover:text-blue-300"><Plus className="h-3 w-3" />Add stop</button>
        </div>

        <button
          type="button"
          onClick={() => compute.mutate()}
          disabled={compute.isPending || !origin.query.trim() || !destination.query.trim()}
          className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-blue-500 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-400 disabled:opacity-50"
        >
          {compute.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Navigation className="h-3.5 w-3.5" />}
          Get directions
        </button>
      </div>

      {/* Route summary + step list — Maps-style result rail */}
      <div className="p-3">
        {!route && !compute.isPending && (
          <div className="rounded border border-dashed border-zinc-800 p-6 text-center text-[11px] text-zinc-400">Enter origin and destination above, then tap "Get directions".</div>
        )}
        {compute.isPending && (
          <div className="flex items-center gap-2 text-xs text-zinc-400"><Loader2 className="h-4 w-4 animate-spin" />Resolving addresses + computing route…</div>
        )}
        {route && route.totalDistanceKm != null && (
          <div className="space-y-3">
            {/* Hero route card */}
            <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-3">
              <div className="flex items-baseline justify-between">
                <span className="font-mono text-2xl text-blue-200">{totalDuration}</span>
                <span className="font-mono text-sm text-zinc-400">{route.totalDistanceKm.toLocaleString()} km</span>
              </div>
              <div className="mt-1 flex items-center gap-1 text-[10px] text-zinc-400">
                <span>via {mode}</span>
                {route.legs && <span>· {route.legs.length} leg{route.legs.length === 1 ? '' : 's'}</span>}
              </div>
            </div>

            {/* Resolved address chain */}
            {resolvedNames.length > 0 && (
              <ol className="space-y-1">
                {resolvedNames.map((name, i) => (
                  <li key={i} className="flex items-start gap-2 rounded border border-zinc-800 bg-zinc-900/40 px-2.5 py-1.5">
                    <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-blue-500/20 text-[10px] font-mono text-blue-200">{i + 1}</span>
                    <span className="flex-1 text-[11px] text-zinc-100">{name}</span>
                  </li>
                ))}
              </ol>
            )}

            {/* Legs — step-by-step */}
            {route.legs && route.legs.length > 0 && (
              <div className="space-y-1">
                <div className="text-[10px] uppercase tracking-wider text-zinc-400">Steps</div>
                {route.legs.map((leg, i) => {
                  const legDuration = formatDuration(leg.km, modeSpeed);
                  return (
                    <div key={i} className="flex items-center gap-2 rounded border border-zinc-800 bg-zinc-900/40 px-2.5 py-1.5">
                      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-blue-400" />
                      <div className="flex-1 text-[11px]">
                        <div className="text-zinc-100">{leg.from} → {leg.to}</div>
                        <div className="text-[10px] text-zinc-400">{leg.km} km · {legDuration}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
        {compute.isError && (
          <div className="rounded border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">Route lookup failed.</div>
        )}
        {!compute.isPending && route === null && compute.data === null && (
          <div className="rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">Couldn't resolve one or more addresses. Try a more specific location.</div>
        )}
      </div>
    </div>
  );
}
