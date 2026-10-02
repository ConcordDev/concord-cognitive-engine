'use client';

/**
 * Eco north star — one air reading.
 * A number appears only after eco.aqi-current returns for a saved place or a
 * browser location. There is no default city.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { LensShell } from '@/components/lens/LensShell';
import { NorthGreeting, QuietMore, northCtaClass } from '@/components/code/CodeFamilyChrome';
import { GraphFamilyPill, SERIES_LINKS } from '@/components/graph/GraphFamilyChrome';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { lensRun } from '@/lib/api/client';

type Place = { label?: string; lat?: number; lng?: number };
type Aqi = { aqi?: number; category?: string; recommendation?: string; source?: string };

const AQI_LABEL: Record<string, string> = {
  good: 'Good',
  moderate: 'Moderate',
  sensitive: 'Sensitive',
  unhealthy: 'Unhealthy',
  'very-unhealthy': 'Very unhealthy',
  hazardous: 'Hazardous',
};

function askBrowser(): Promise<{ lat: number; lng: number } | null> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { maximumAge: 5 * 60 * 1000, timeout: 5000 },
    );
  });
}

export function EcoNorthStar({ onOpenDesk }: { onOpenDesk: () => void }) {
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [composing, setComposing] = useState(false);
  const [commonName, setCommonName] = useState('');
  const [scientific, setScientific] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [ask, setAsk] = useState(0);

  const places = useQuery({
    queryKey: ['eco-north', 'places'],
    queryFn: async () => {
      const r = await lensRun<{ locations?: Place[] }>('eco', 'locations-list', {});
      if (!r.data?.ok) throw new Error(r.data?.error || 'Places failed');
      return r.data.result?.locations ?? [];
    },
  });

  const saved = (places.data ?? []).find((p) => Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng)));

  const geo = useQuery({
    queryKey: ['eco-north', 'geo', ask],
    enabled: places.isSuccess && !saved,
    queryFn: askBrowser,
  });

  const coord = saved
    ? { lat: Number(saved.lat), lng: Number(saved.lng), where: saved.label || 'your saved place' }
    : geo.data
      ? { lat: geo.data.lat, lng: geo.data.lng, where: 'this machine' }
      : null;

  const air = useQuery({
    queryKey: ['eco-north', 'aqi', coord?.lat, coord?.lng],
    enabled: !!coord,
    queryFn: async () => {
      const r = await lensRun<Aqi>('eco', 'aqi-current', { lat: coord!.lat, lng: coord!.lng });
      if (!r.data?.ok || r.data.result == null || !Number.isFinite(Number(r.data.result.aqi))) {
        throw new Error(r.data?.error || 'Air reading failed');
      }
      return r.data.result;
    },
  });

  const logSighting = async () => {
    const title = commonName.trim();
    if (!title) {
      setError('Name what you saw.');
      return;
    }
    setSaving(true);
    setError('');
    const r = await lensRun('eco', 'biodiversity-log', {
      commonName: title,
      scientificName: scientific.trim(),
      observedAt: new Date().toISOString(),
      ...(coord ? { lat: coord.lat, lng: coord.lng } : {}),
    });
    setSaving(false);
    if (!r.data?.ok) {
      setError(r.data?.error || 'Sighting was not logged.');
      return;
    }
    setComposing(false);
    setCommonName('');
    setScientific('');
  };

  const waiting = places.isLoading || (places.isSuccess && !saved && geo.isLoading);
  const noCoord = places.isSuccess && !saved && geo.isSuccess && !geo.data;

  return (
    <LensShell lensId="eco" asMain={false} disableAgentFab>
      <div data-lens-theme="eco" className="relative min-h-[calc(100vh-3rem)] px-8 pb-28 pt-8">
        <div className="absolute right-8 top-8">
          <QuietMore items={[{ id: 'desk', label: 'Eco desk' }]} onPick={() => onOpenDesk()} />
        </div>
        <NorthGreeting kicker="Ecosystem" title={`The air around you${who ? `, ${who}` : ''}`} />
        <GraphFamilyPill active="eco" links={SERIES_LINKS} />

        {places.isError && <p role="alert" className="mt-8 text-[14px] text-rose-300">Saved places didn’t load.</p>}
        {waiting && <p className="mt-10 text-[15px] text-zinc-500">Looking for a coordinate.</p>}
        {noCoord && (
          <div className="mt-10 max-w-md">
            <p className="text-[15px] text-zinc-400">No coordinate on this machine. The air reading needs one.</p>
            <button type="button" onClick={() => setAsk((n) => n + 1)} className="mt-3 text-[13px] text-zinc-400 hover:text-zinc-100">
              Ask again
            </button>
          </div>
        )}
        {air.data && coord && (
          <div className="mt-8 max-w-md rounded-2xl border border-white/10 bg-white/[0.03] p-6">
            <div className="flex items-baseline gap-3">
              <span className="font-vault text-[3.5rem] leading-none text-zinc-100">{Math.round(Number(air.data.aqi))}</span>
              <span className="text-[15px] text-zinc-400">AQI · {AQI_LABEL[air.data.category || ''] || air.data.category || 'Reading'}</span>
            </div>
            <p className="mt-4 text-[14px] text-zinc-400">{air.data.source || 'Open-Meteo'} at {coord.where}.</p>
            {air.data.recommendation && <p className="mt-2 text-[14px] text-zinc-300">{air.data.recommendation}</p>}
          </div>
        )}
        {air.isError && <p role="alert" className="mt-6 text-[14px] text-rose-300">The air reading didn’t load.</p>}

        {composing && (
          <form className="mt-6 flex max-w-md gap-2" onSubmit={(e) => { e.preventDefault(); void logSighting(); }}>
            <input
              aria-label="Common name"
              value={commonName}
              onChange={(e) => setCommonName(e.target.value)}
              placeholder="What you saw"
              className="flex-1 rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-[14px] text-zinc-100"
            />
            <input
              aria-label="Scientific name"
              value={scientific}
              onChange={(e) => setScientific(e.target.value)}
              placeholder="Scientific name"
              className="w-40 rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-[14px] text-zinc-100"
            />
          </form>
        )}
        {error && <p role="alert" className="mt-3 text-[14px] text-rose-300">{error}</p>}
        <button type="button" className={northCtaClass} disabled={saving} onClick={() => { if (composing) void logSighting(); else setComposing(true); }}>
          {composing ? (saving ? 'Logging…' : 'Save sighting') : '+ Log a sighting'}
        </button>
      </div>
    </LensShell>
  );
}
