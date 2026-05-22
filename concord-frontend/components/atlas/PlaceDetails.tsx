'use client';

/**
 * PlaceDetails — full place-details page. Calls the `place-details`
 * atlas macro, which pulls the complete OSM tag set for a feature and
 * enriches it with a Wikipedia summary + photo when the feature links
 * to a Wikipedia article.
 *
 * Backend: atlas.place-details — Overpass OSM + Wikipedia, no key.
 */

import { useState } from 'react';
import Image from 'next/image';
import {
  Loader2, Info, Clock, Phone, Globe, Mail, MapPin, Accessibility, BookOpen,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';

type OsmType = 'node' | 'way' | 'relation';

interface PlaceDetailsData {
  osmType: OsmType;
  osmId: number;
  name: string | null;
  lat: number | null;
  lng: number | null;
  category: string | null;
  cuisine: string | null;
  openingHours: string | null;
  phone: string | null;
  website: string | null;
  email: string | null;
  address: string | null;
  wheelchair: string | null;
  operator: string | null;
  wikipedia: string | null;
  wikidata: string | null;
  summary: string | null;
  image: string | null;
}

interface PlaceDetailsResult {
  details: PlaceDetailsData;
  source: string;
}

export function PlaceDetails() {
  const [osmType, setOsmType] = useState<OsmType>('node');
  const [osmId, setOsmId] = useState('');
  const [result, setResult] = useState<PlaceDetailsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready = osmId.trim() !== '' && Number.isFinite(Number(osmId));

  async function compute() {
    if (!ready) return;
    setLoading(true);
    setError(null);
    try {
      const r = await lensRun<PlaceDetailsResult>('atlas', 'place-details', {
        osmType,
        osmId: Number(osmId),
      });
      if (r.data?.ok && r.data.result) {
        setResult(r.data.result);
      } else {
        setResult(null);
        setError(r.data?.error || 'Place lookup failed.');
      }
    } catch {
      setResult(null);
      setError('Place details service unreachable.');
    }
    setLoading(false);
  }

  const d = result?.details;

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950">
      <div className="border-b border-zinc-800 bg-zinc-900/60 p-3">
        <div className="flex items-center gap-2">
          <Info className="h-4 w-4 text-cyan-400" />
          <span className="text-sm font-semibold text-white">Place details</span>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <select
            value={osmType}
            onChange={(e) => setOsmType(e.target.value as OsmType)}
            className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white focus:border-cyan-500/40 focus:outline-none"
          >
            <option value="node">node</option>
            <option value="way">way</option>
            <option value="relation">relation</option>
          </select>
          <input
            type="number"
            placeholder="OSM ID"
            value={osmId}
            onChange={(e) => setOsmId(e.target.value)}
            className="w-40 rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white placeholder:text-zinc-600 focus:border-cyan-500/40 focus:outline-none"
          />
          <button
            type="button"
            onClick={compute}
            disabled={loading || !ready}
            className="inline-flex items-center gap-1.5 rounded-md bg-cyan-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-cyan-400 disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Info className="h-3.5 w-3.5" />}
            Look up
          </button>
        </div>
        <p className="mt-2 text-[10px] text-zinc-600">
          Find OSM IDs from the place search panel above — each result carries an osmType + osmId.
        </p>
      </div>

      <div className="p-3">
        {error && (
          <div className="rounded border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">{error}</div>
        )}
        {!result && !error && !loading && (
          <div className="rounded border border-dashed border-zinc-800 p-6 text-center text-[11px] text-zinc-500">
            No data yet. Enter an OSM feature type and ID to load its full details.
          </div>
        )}
        {d && (
          <div className="space-y-3">
            <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/5 p-3">
              <h3 className="text-base font-semibold text-white">{d.name || `Unnamed ${d.osmType}`}</h3>
              {d.category && (
                <span className="mt-1 inline-block rounded bg-cyan-500/15 px-1.5 py-0.5 text-[10px] capitalize text-cyan-300">
                  {d.category}{d.cuisine ? ` · ${d.cuisine}` : ''}
                </span>
              )}
            </div>

            {d.image && (
              <div className="relative aspect-video w-full overflow-hidden rounded-lg border border-zinc-800">
                <Image src={d.image} alt={d.name || 'Place photo'} fill unoptimized sizes="600px" className="object-cover" />
              </div>
            )}

            {d.summary && (
              <div className="rounded border border-zinc-800 bg-zinc-900/40 p-3">
                <p className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-500">
                  <BookOpen className="h-3 w-3" /> Summary
                </p>
                <p className="mt-1 text-[12px] leading-relaxed text-zinc-200">{d.summary}</p>
              </div>
            )}

            <dl className="grid grid-cols-1 gap-1.5">
              {d.address && (
                <DetailRow icon={MapPin} label="Address" value={d.address} />
              )}
              {d.openingHours && (
                <DetailRow icon={Clock} label="Hours" value={d.openingHours} />
              )}
              {d.phone && (
                <DetailRow icon={Phone} label="Phone" value={d.phone} />
              )}
              {d.email && (
                <DetailRow icon={Mail} label="Email" value={d.email} />
              )}
              {d.wheelchair && (
                <DetailRow icon={Accessibility} label="Wheelchair" value={d.wheelchair} />
              )}
              {d.operator && (
                <DetailRow icon={Info} label="Operator" value={d.operator} />
              )}
              {d.website && (
                <div className="flex items-center gap-2 rounded border border-zinc-800 bg-zinc-900/40 px-2.5 py-1.5">
                  <Globe className="h-3.5 w-3.5 shrink-0 text-cyan-400" />
                  <a href={d.website} target="_blank" rel="noopener noreferrer" className="truncate text-[11px] text-cyan-300 hover:underline">
                    {d.website}
                  </a>
                </div>
              )}
              {d.wikipedia && (
                <div className="flex items-center gap-2 rounded border border-zinc-800 bg-zinc-900/40 px-2.5 py-1.5">
                  <BookOpen className="h-3.5 w-3.5 shrink-0 text-cyan-400" />
                  <a href={d.wikipedia} target="_blank" rel="noopener noreferrer" className="truncate text-[11px] text-cyan-300 hover:underline">
                    Wikipedia article
                  </a>
                </div>
              )}
            </dl>

            {d.lat != null && d.lng != null && (
              <p className="font-mono text-[10px] text-zinc-500">{d.lat.toFixed(5)}, {d.lng.toFixed(5)}</p>
            )}
            <p className="text-[10px] text-zinc-600">Source: {result.source}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function DetailRow({ icon: Icon, label, value }: { icon: typeof Info; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2 rounded border border-zinc-800 bg-zinc-900/40 px-2.5 py-1.5">
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-400" />
      <div className="flex-1">
        <p className="text-[9px] uppercase tracking-wider text-zinc-500">{label}</p>
        <p className="text-[11px] text-zinc-200">{value}</p>
      </div>
    </div>
  );
}
