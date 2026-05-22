'use client';

/**
 * StreetImagery — street-level / panoramic imagery viewer. Calls the
 * `street-imagery` atlas macro (Mapillary open imagery). With a token
 * it returns nearby crowd-sourced photos; without one it returns the
 * keyless public coverage tile reference.
 *
 * Backend: atlas.street-imagery — Mapillary Graph API.
 */

import { useState } from 'react';
import Image from 'next/image';
import { Loader2, Camera, Compass, Maximize2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface StreetImage {
  id: string;
  thumbUrl: string | null;
  smallThumbUrl: string | null;
  capturedAt: string | null;
  compassAngle: number | null;
  isPanoramic: boolean;
  lat: number | null;
  lng: number | null;
  distanceM: number | null;
}

interface StreetResult {
  lat: number;
  lng: number;
  images: StreetImage[];
  count?: number;
  coverageTileUrl?: string;
  hasToken: boolean;
  note?: string;
  source: string;
}

export function StreetImagery() {
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [result, setResult] = useState<StreetResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focused, setFocused] = useState<StreetImage | null>(null);

  const ready = [lat, lng].every((v) => v.trim() !== '' && Number.isFinite(Number(v)));

  async function compute() {
    if (!ready) return;
    setLoading(true);
    setError(null);
    setFocused(null);
    try {
      const r = await lensRun<StreetResult>('atlas', 'street-imagery', {
        lat: Number(lat),
        lng: Number(lng),
      });
      if (r.data?.ok && r.data.result) {
        setResult(r.data.result);
      } else {
        setResult(null);
        setError(r.data?.error || 'Imagery lookup failed.');
      }
    } catch {
      setResult(null);
      setError('Imagery service unreachable.');
    }
    setLoading(false);
  }

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950">
      <div className="border-b border-zinc-800 bg-zinc-900/60 p-3">
        <div className="flex items-center gap-2">
          <Camera className="h-4 w-4 text-fuchsia-400" />
          <span className="text-sm font-semibold text-white">Street-level imagery</span>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <input type="number" step="any" placeholder="Latitude" value={lat} onChange={(e) => setLat(e.target.value)} className="w-32 rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white placeholder:text-zinc-600 focus:border-fuchsia-500/40 focus:outline-none" />
          <input type="number" step="any" placeholder="Longitude" value={lng} onChange={(e) => setLng(e.target.value)} className="w-32 rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white placeholder:text-zinc-600 focus:border-fuchsia-500/40 focus:outline-none" />
          <button
            type="button"
            onClick={compute}
            disabled={loading || !ready}
            className="inline-flex items-center gap-1.5 rounded-md bg-fuchsia-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-fuchsia-400 disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
            View imagery
          </button>
        </div>
      </div>

      <div className="p-3">
        {error && (
          <div className="rounded border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">{error}</div>
        )}
        {!result && !error && !loading && (
          <div className="rounded border border-dashed border-zinc-800 p-6 text-center text-[11px] text-zinc-500">
            No data yet. Enter coordinates to load nearby street-level photos.
          </div>
        )}
        {result && !result.hasToken && (
          <div className="space-y-2">
            <div className="rounded border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-[11px] text-sky-200">
              {result.note || 'Mapillary coverage tile layer available; per-image lookups need a token.'}
            </div>
            {result.coverageTileUrl && (
              <div className="rounded border border-zinc-800 bg-zinc-900/40 p-2">
                <p className="text-[10px] uppercase tracking-wider text-zinc-500">Keyless coverage tile layer</p>
                <p className="mt-1 break-all font-mono text-[10px] text-zinc-400">{result.coverageTileUrl}</p>
              </div>
            )}
          </div>
        )}
        {result && result.hasToken && result.images.length === 0 && (
          <div className="rounded border border-dashed border-zinc-800 p-6 text-center text-[11px] text-zinc-500">
            No street imagery found within ~280 m of this point.
          </div>
        )}
        {result && result.hasToken && result.images.length > 0 && (
          <div className="space-y-3">
            <div className="text-[10px] uppercase tracking-wider text-zinc-500">{result.images.length} photo{result.images.length === 1 ? '' : 's'} nearby</div>
            <div className="grid grid-cols-3 gap-2">
              {result.images.map((im) => (
                <button
                  key={im.id}
                  type="button"
                  onClick={() => setFocused(im)}
                  className="group relative aspect-square overflow-hidden rounded border border-zinc-800 bg-zinc-900"
                >
                  {im.smallThumbUrl && (
                    <Image
                      src={im.smallThumbUrl}
                      alt={`Street view ${im.id}`}
                      fill
                      unoptimized
                      sizes="120px"
                      className="object-cover transition group-hover:scale-105"
                    />
                  )}
                  <span className="absolute bottom-1 left-1 flex items-center gap-1 rounded bg-black/70 px-1 text-[8px] text-white">
                    {im.isPanoramic && <Maximize2 className="h-2.5 w-2.5" />}
                    {im.distanceM != null && <span>{im.distanceM} m</span>}
                  </span>
                </button>
              ))}
            </div>
            {focused && focused.thumbUrl && (
              <div className="rounded-lg border border-fuchsia-500/30 bg-zinc-900/60 p-2">
                <div className="relative aspect-video w-full overflow-hidden rounded">
                  <Image src={focused.thumbUrl} alt={`Street view ${focused.id}`} fill unoptimized sizes="600px" className="object-cover" />
                </div>
                <div className="mt-2 flex items-center justify-between text-[10px] text-zinc-400">
                  <span>{focused.capturedAt ? new Date(focused.capturedAt).toLocaleDateString() : 'undated'}</span>
                  {focused.compassAngle != null && (
                    <span className="flex items-center gap-1"><Compass className="h-3 w-3" />{Math.round(focused.compassAngle)}°</span>
                  )}
                  {focused.isPanoramic && <span className="text-fuchsia-300">panoramic</span>}
                </div>
              </div>
            )}
            <p className="text-[10px] text-zinc-600">Source: {result.source}</p>
          </div>
        )}
      </div>
    </div>
  );
}
