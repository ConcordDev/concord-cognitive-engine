'use client';

/**
 * SatelliteCatalog — the real, currently-tracked catalog of satellites
 * (beyond just the ISS), from CelesTrak's free/keyless GP data feed
 * (space.satellite-catalog macro, `server/domains/space.js`). CelesTrak
 * is the standard source the amateur + professional satellite-tracking
 * community has used for decades — no API key, no per-user auth.
 *
 * Honest by construction: an unreachable/non-JSON response from CelesTrak
 * surfaces as an explicit error banner (never a stale or fabricated
 * catalog); an unrecognized/empty group legitimately renders zero rows
 * with an explanatory empty state (never invented satellites).
 */

import { useCallback, useEffect, useState } from 'react';
import { Radar, RefreshCw, Loader2, AlertTriangle, ExternalLink } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface CatalogSatellite {
  name: string | null;
  objectId: string | null;
  noradId: number | null;
  epoch: string | null;
  meanMotion: number | null;
  eccentricity: number | null;
  inclinationDeg: number | null;
  raanDeg: number | null;
  argOfPericenterDeg: number | null;
  meanAnomalyDeg: number | null;
  revAtEpoch: number | null;
  bstar: number | null;
  meanMotionDot: number | null;
  classification: string | null;
}

interface CatalogResult {
  satellites: CatalogSatellite[];
  count: number;
  totalAvailable: number;
  group: string;
  source: string;
  attribution: string;
}

// A curated shortlist of well-known CelesTrak groups for the dropdown —
// the backend itself accepts ANY safe-shaped group token and passes it
// straight through, so a user can also type a different one below.
const GROUP_PRESETS: { value: string; label: string }[] = [
  { value: 'active', label: 'Active satellites' },
  { value: 'stations', label: 'Space stations' },
  { value: 'starlink', label: 'Starlink' },
  { value: 'gps-ops', label: 'GPS operational' },
  { value: 'weather', label: 'Weather' },
  { value: 'science', label: 'Science' },
  { value: 'geo', label: 'Geostationary' },
  { value: 'visual', label: 'Brightest (visual)' },
];

function fmtEpoch(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

function orbitalZone(meanMotion: number | null): string {
  // Mean motion is orbits/day — a coarse LEO/MEO/GEO split from period,
  // consistent with the altitude-based split used elsewhere in this lens
  // (period = 1440 / meanMotion minutes; LEO < 2000km ≈ period < ~127min).
  if (meanMotion == null || !Number.isFinite(meanMotion) || meanMotion <= 0) return '—';
  const periodMin = 1440 / meanMotion;
  if (periodMin < 128) return 'LEO';
  if (periodMin < 1000) return 'MEO';
  return 'GEO';
}

const ZONE_TONE: Record<string, string> = {
  LEO: 'text-cyan-400 bg-cyan-500/10',
  MEO: 'text-indigo-400 bg-indigo-500/10',
  GEO: 'text-purple-400 bg-purple-500/10',
};

export function SatelliteCatalog() {
  const [group, setGroup] = useState('active');
  const [customGroup, setCustomGroup] = useState('');
  const [limit, setLimit] = useState('100');
  const [data, setData] = useState<CatalogResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const effectiveGroup = customGroup.trim() || group;

  const fetchCatalog = useCallback(async () => {
    setLoading(true);
    setError(null);
    const lim = Math.max(1, Math.min(500, Math.round(Number(limit) || 100)));
    const r = await lensRun<CatalogResult>('space', 'satellite-catalog', {
      group: effectiveGroup,
      limit: lim,
    });
    if (r.data?.ok && r.data.result) {
      setData(r.data.result);
    } else {
      setError(r.data?.error || 'Satellite catalog unavailable');
      setData(null);
    }
    setLoading(false);
  }, [effectiveGroup, limit]);

  useEffect(() => { void fetchCatalog(); }, [fetchCatalog]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2">
          <Radar className="w-4 h-4 text-emerald-400" /> Satellite Catalog
        </h3>
        <button
          onClick={fetchCatalog}
          disabled={loading}
          className="p-1.5 rounded hover:bg-zinc-800 text-zinc-400 hover:text-white disabled:opacity-40"
          aria-label="Refresh catalog"
          data-testid="sat-catalog-refresh"
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <select
          data-testid="sat-catalog-group"
          value={group}
          onChange={(e) => { setGroup(e.target.value); setCustomGroup(''); }}
          className="bg-zinc-900 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs text-zinc-200"
        >
          {GROUP_PRESETS.map((g) => (
            <option key={g.value} value={g.value}>{g.label}</option>
          ))}
        </select>
        <input
          data-testid="sat-catalog-custom-group"
          value={customGroup}
          onChange={(e) => setCustomGroup(e.target.value)}
          placeholder="or type any CelesTrak group…"
          className="flex-1 min-w-[160px] bg-zinc-900 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs text-zinc-200 placeholder-zinc-500"
        />
        <input
          data-testid="sat-catalog-limit"
          value={limit}
          onChange={(e) => setLimit(e.target.value)}
          type="number"
          min={1}
          max={500}
          className="w-20 bg-zinc-900 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs text-zinc-200"
          aria-label="Result limit"
        />
      </div>

      {error && (
        <div data-testid="sat-catalog-error" className="flex items-center gap-2 text-xs text-rose-400 bg-rose-500/10 rounded-lg p-3">
          <AlertTriangle className="w-4 h-4 shrink-0" /> {error}
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="w-5 h-5 animate-spin text-emerald-400" />
        </div>
      )}

      {data && !loading && (
        <>
          <p className="text-[11px] text-zinc-400">
            Showing {data.count} of {data.totalAvailable} tracked objects in group &ldquo;{data.group}&rdquo;
          </p>

          {data.count === 0 ? (
            <p data-testid="sat-catalog-empty" className="text-xs text-zinc-400 text-center py-6 border border-dashed border-zinc-800 rounded-lg">
              No objects returned for this group — either the group name isn&apos;t a recognized CelesTrak catalog, or it&apos;s genuinely empty right now.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-zinc-800">
              <table className="w-full text-xs" data-testid="sat-catalog-table">
                <thead>
                  <tr className="bg-zinc-900 text-zinc-400 text-left">
                    <th className="px-2.5 py-2 font-medium">Name</th>
                    <th className="px-2.5 py-2 font-medium">NORAD ID</th>
                    <th className="px-2.5 py-2 font-medium">Zone</th>
                    <th className="px-2.5 py-2 font-medium">Inclination</th>
                    <th className="px-2.5 py-2 font-medium">Mean motion</th>
                    <th className="px-2.5 py-2 font-medium">Eccentricity</th>
                    <th className="px-2.5 py-2 font-medium">Epoch</th>
                  </tr>
                </thead>
                <tbody>
                  {data.satellites.map((s) => {
                    const zone = orbitalZone(s.meanMotion);
                    return (
                      <tr
                        key={`${s.noradId ?? s.objectId ?? s.name}`}
                        data-testid={`sat-catalog-row-${s.noradId ?? s.objectId ?? s.name}`}
                        className="border-t border-zinc-800 hover:bg-zinc-900/60"
                      >
                        <td className="px-2.5 py-2 text-zinc-100 font-medium whitespace-nowrap">{s.name || '—'}</td>
                        <td className="px-2.5 py-2 text-zinc-300 font-mono tabular-nums">{s.noradId ?? '—'}</td>
                        <td className="px-2.5 py-2">
                          <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full', ZONE_TONE[zone] || 'text-zinc-400 bg-zinc-800')}>
                            {zone}
                          </span>
                        </td>
                        <td className="px-2.5 py-2 text-zinc-300 font-mono tabular-nums">
                          {s.inclinationDeg != null ? `${s.inclinationDeg.toFixed(2)}°` : '—'}
                        </td>
                        <td className="px-2.5 py-2 text-zinc-300 font-mono tabular-nums">
                          {s.meanMotion != null ? `${s.meanMotion.toFixed(4)}/day` : '—'}
                        </td>
                        <td className="px-2.5 py-2 text-zinc-300 font-mono tabular-nums">
                          {s.eccentricity != null ? s.eccentricity.toFixed(4) : '—'}
                        </td>
                        <td className="px-2.5 py-2 text-zinc-400 whitespace-nowrap">{fmtEpoch(s.epoch)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <p className="flex items-center gap-1.5 text-[10px] text-zinc-500">
            <ExternalLink className="w-3 h-3" />
            {data.attribution} — live GP/TLE catalog, cached up to 6h
          </p>
        </>
      )}
    </div>
  );
}
