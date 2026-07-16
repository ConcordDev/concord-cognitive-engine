'use client';

/**
 * WildlifeSightingLog — the real wildlife tracking / species catalog that
 * closes desert's first "Genuinely missing, deferred" gap
 * (docs/lens-specs/desert-capability-map.md: "the previous 'Wildlife' tab
 * was 100% fabricated (a stat card mislabeled 'Species Cataloged' actually
 * counted resource nodes) and has been removed"). Backs onto the persisted
 * desert.sighting* macro family (sightingSave / sightingList / sightingDelete
 * / sightingsNearby) — every field here (species, count, observation date,
 * confidence, breakdown) is server-computed or server-persisted, never
 * client-invented.
 */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { PawPrint, Plus, Trash2, Search, Camera } from 'lucide-react';

const CONFIDENCE_OPTIONS = ['certain', 'probable', 'possible'] as const;
type Confidence = (typeof CONFIDENCE_OPTIONS)[number];

interface Sighting {
  id: string;
  species: string;
  commonOrScientific: string;
  count: number;
  lat: number;
  lng: number;
  observedAt: string;
  behavior: string;
  confidence: Confidence;
  notes: string;
  photoUrl: string | null;
  createdAt: string;
  updatedAt: string;
  distanceKm?: number;
}

const CONFIDENCE_BADGE: Record<Confidence, string> = {
  certain: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  probable: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  possible: 'bg-zinc-500/15 text-zinc-300 border-zinc-500/30',
};

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}

export function WildlifeSightingLog() {
  const [sightings, setSightings] = useState<Sighting[]>([]);
  const [bySpecies, setBySpecies] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [species, setSpecies] = useState('');
  const [commonOrScientific, setCommonOrScientific] = useState('');
  const [count, setCount] = useState('1');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [observedAt, setObservedAt] = useState('');
  const [behavior, setBehavior] = useState('');
  const [confidence, setConfidence] = useState<Confidence>('probable');
  const [notes, setNotes] = useState('');
  const [photoUrl, setPhotoUrl] = useState('');

  const [nearLat, setNearLat] = useState('');
  const [nearLng, setNearLng] = useState('');
  const [near, setNear] = useState<{ sightings: Sighting[]; count: number } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await lensRun<{ sightings: Sighting[]; count: number; bySpecies: Record<string, number> }>(
      'desert',
      'sightingList',
      {},
    );
    if (r.data?.ok && r.data.result) {
      setSightings(r.data.result.sightings);
      setBySpecies(r.data.result.bySpecies);
    } else {
      setErr(r.data?.error || 'Could not load sightings');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(async () => {
    setErr(null);
    if (!species.trim()) {
      setErr('Species is required');
      return;
    }
    const la = Number(lat);
    const ln = Number(lng);
    if (!Number.isFinite(la) || !Number.isFinite(ln)) {
      setErr('Valid lat/lng required');
      return;
    }
    setBusy(true);
    const r = await lensRun('desert', 'sightingSave', {
      species: species.trim(),
      commonOrScientific: commonOrScientific || undefined,
      count: Number(count) || 1,
      lat: la,
      lng: ln,
      observedAt: observedAt || undefined,
      behavior: behavior || undefined,
      confidence,
      notes: notes || undefined,
      photoUrl: photoUrl || undefined,
    });
    setBusy(false);
    if (r.data?.ok) {
      setSpecies('');
      setCommonOrScientific('');
      setCount('1');
      setLat('');
      setLng('');
      setObservedAt('');
      setBehavior('');
      setConfidence('probable');
      setNotes('');
      setPhotoUrl('');
      await load();
    } else {
      setErr(r.data?.error || 'Save failed');
    }
  }, [species, commonOrScientific, count, lat, lng, observedAt, behavior, confidence, notes, photoUrl, load]);

  const remove = useCallback(
    async (id: string) => {
      await lensRun('desert', 'sightingDelete', { id });
      await load();
    },
    [load],
  );

  const findNearby = useCallback(async () => {
    setErr(null);
    const la = Number(nearLat);
    const ln = Number(nearLng);
    if (!Number.isFinite(la) || !Number.isFinite(ln)) {
      setErr('Valid lat/lng for proximity search required');
      return;
    }
    setBusy(true);
    const r = await lensRun<{ sightings: Sighting[]; count: number }>('desert', 'sightingsNearby', {
      lat: la,
      lng: ln,
      radiusKm: 100,
    });
    setBusy(false);
    if (r.data?.ok && r.data.result) setNear(r.data.result);
    else setErr(r.data?.error || 'Proximity search failed');
  }, [nearLat, nearLng]);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <PawPrint className="h-4 w-4 text-amber-400" />
          <h3 className="text-sm font-semibold text-white">Wildlife sighting log</h3>
          <span className="ml-auto text-[10px] text-zinc-500">{sightings.length} logged</span>
        </div>

        <div className="flex flex-wrap gap-2">
          <input
            value={species}
            onChange={(e) => setSpecies(e.target.value)}
            placeholder="Species (e.g. Desert bighorn sheep)"
            className="flex-1 min-w-[180px] rounded bg-zinc-950 border border-zinc-800 px-2 py-1.5 text-sm text-white"
          />
          <input
            value={commonOrScientific}
            onChange={(e) => setCommonOrScientific(e.target.value)}
            placeholder="Common / scientific name"
            className="flex-1 min-w-[140px] rounded bg-zinc-950 border border-zinc-800 px-2 py-1.5 text-sm text-white"
          />
          <input
            value={count}
            onChange={(e) => setCount(e.target.value)}
            type="number"
            min={1}
            placeholder="Count"
            className="w-20 rounded bg-zinc-950 border border-zinc-800 px-2 py-1.5 text-sm text-white"
          />
        </div>

        <div className="flex flex-wrap gap-2">
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
          <input
            value={observedAt}
            onChange={(e) => setObservedAt(e.target.value)}
            type="date"
            aria-label="Observed date"
            className="rounded bg-zinc-950 border border-zinc-800 px-2 py-1.5 text-sm text-white"
          />
          <select
            value={confidence}
            onChange={(e) => setConfidence(e.target.value as Confidence)}
            aria-label="Confidence"
            className="rounded bg-zinc-950 border border-zinc-800 px-2 py-1.5 text-sm text-white"
          >
            {CONFIDENCE_OPTIONS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap gap-2">
          <input
            value={behavior}
            onChange={(e) => setBehavior(e.target.value)}
            placeholder="Behavior observed (e.g. grazing, denning)"
            className="flex-1 min-w-[160px] rounded bg-zinc-950 border border-zinc-800 px-2 py-1.5 text-sm text-white"
          />
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notes"
            className="flex-1 min-w-[160px] rounded bg-zinc-950 border border-zinc-800 px-2 py-1.5 text-sm text-white"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Camera className="h-3.5 w-3.5 text-zinc-500" />
          <input
            value={photoUrl}
            onChange={(e) => setPhotoUrl(e.target.value)}
            placeholder="Photo URL (optional reference)"
            className="flex-1 min-w-[160px] rounded bg-zinc-950 border border-zinc-800 px-2 py-1.5 text-sm text-white"
          />
          <button
            onClick={save}
            disabled={busy}
            className="flex items-center gap-1 rounded bg-amber-600 hover:bg-amber-500 disabled:opacity-50 px-2.5 py-1.5 text-xs text-white"
          >
            <Plus className="h-3.5 w-3.5" /> Log sighting
          </button>
        </div>

        {err && <p className="text-xs text-red-400" role="alert">{err}</p>}

        {Object.keys(bySpecies).length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {Object.entries(bySpecies).map(([sp, n]) => (
              <span key={sp} className="rounded bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-300">
                {sp} <span className="text-amber-300 font-mono">{n}</span>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Search className="h-4 w-4 text-amber-400" />
          <span className="text-sm font-medium text-white">Sightings within 100 km</span>
          <input
            value={nearLat}
            onChange={(e) => setNearLat(e.target.value)}
            placeholder="search lat"
            className="w-24 rounded bg-zinc-950 border border-zinc-800 px-2 py-1 text-sm text-white"
          />
          <input
            value={nearLng}
            onChange={(e) => setNearLng(e.target.value)}
            placeholder="search lng"
            className="w-24 rounded bg-zinc-950 border border-zinc-800 px-2 py-1 text-sm text-white"
          />
          <button
            onClick={findNearby}
            disabled={busy}
            className="rounded bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 px-2.5 py-1 text-xs text-white"
          >
            Find
          </button>
        </div>
        {near && (
          <div className="space-y-1.5 pt-1">
            {near.sightings.length === 0 && <p className="text-xs text-zinc-500">No sightings in range.</p>}
            {near.sightings.map((s) => (
              <div key={s.id} className="flex items-center justify-between rounded bg-zinc-950 border border-zinc-800 px-3 py-1.5 text-xs">
                <span className="text-white">{s.species}</span>
                <span className="font-mono text-amber-300">{s.distanceKm} km</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {loading ? (
        <p className="text-center text-sm text-zinc-400 py-6">Loading…</p>
      ) : (
        <div className="space-y-1.5">
          {sightings.map((s) => (
            <div key={s.id} data-testid={`sighting-row-${s.id}`} className="flex items-center justify-between rounded bg-zinc-900 border border-zinc-800 px-3 py-2">
              <div className="flex items-center gap-2 flex-wrap">
                <PawPrint className="h-4 w-4 text-amber-400" />
                <span className="text-sm text-white">{s.species}</span>
                {s.count > 1 && <span className="text-xs text-zinc-400">×{s.count}</span>}
                <span className={`text-[10px] uppercase px-1.5 py-0.5 rounded border ${CONFIDENCE_BADGE[s.confidence]}`}>
                  {s.confidence}
                </span>
                <span className="text-xs text-zinc-500">{fmtDate(s.observedAt)}</span>
                {s.behavior && <span className="text-xs text-zinc-500 italic">{s.behavior}</span>}
              </div>
              <button onClick={() => remove(s.id)} className="p-1 text-zinc-400 hover:text-red-400" aria-label={`Delete ${s.species} sighting`}>
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          {sightings.length === 0 && <p className="text-center text-sm text-zinc-400 py-6">No wildlife sightings logged yet.</p>}
        </div>
      )}
    </div>
  );
}

export default WildlifeSightingLog;
