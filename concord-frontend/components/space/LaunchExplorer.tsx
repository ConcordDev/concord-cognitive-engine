'use client';

/**
 * LaunchExplorer — upcoming launches with provider / orbit / country
 * filtering. Calls space.launches-filtered (Launch Library 2) which
 * returns both the filtered set and the facet lists for the dropdowns.
 */

import { useState, useEffect, useCallback } from 'react';
import { Filter, RefreshCw, Loader2, AlertTriangle, Rocket, MapPin } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface FilteredLaunch {
  id: string;
  name: string;
  net: string | null;
  status: string | null;
  provider: string;
  rocket: string | null;
  orbit: string;
  pad: string | null;
  location: string | null;
  countryCode: string;
}

interface FilteredResult {
  launches: FilteredLaunch[];
  count: number;
  totalBeforeFilter: number;
  facets: {
    providers: string[];
    orbits: string[];
    countries: string[];
  };
}

function fmtDate(iso: string | null): string {
  if (!iso) return 'TBD';
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

export function LaunchExplorer() {
  const [data, setData] = useState<FilteredResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [provider, setProvider] = useState('');
  const [orbit, setOrbit] = useState('');
  const [countryCode, setCountryCode] = useState('');

  const fetchLaunches = useCallback(async () => {
    setLoading(true);
    setError(null);
    const input: Record<string, unknown> = { limit: 40 };
    if (provider) input.provider = provider;
    if (orbit) input.orbit = orbit;
    if (countryCode) input.countryCode = countryCode;
    const r = await lensRun<FilteredResult>('space', 'launches-filtered', input);
    if (r.data?.ok && r.data.result) setData(r.data.result);
    else setError(r.data?.error || 'Launch list unavailable');
    setLoading(false);
  }, [provider, orbit, countryCode]);

  useEffect(() => {
    fetchLaunches();
  }, [fetchLaunches]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2">
          <Filter className="w-4 h-4 text-emerald-400" /> Launch Explorer
        </h3>
        <button
          onClick={fetchLaunches}
          className="p-1.5 rounded hover:bg-zinc-800 text-zinc-400 hover:text-white"
          aria-label="Refresh launches"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {[
          { v: provider, set: setProvider, opts: data?.facets.providers || [], label: 'All providers' },
          { v: orbit, set: setOrbit, opts: data?.facets.orbits || [], label: 'All orbits' },
          {
            v: countryCode,
            set: setCountryCode,
            opts: data?.facets.countries || [],
            label: 'All countries',
          },
        ].map((f, i) => (
          <select
            key={i}
            value={f.v}
            onChange={(e) => f.set(e.target.value)}
            className="bg-zinc-900 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs text-zinc-200"
          >
            <option value="">{f.label}</option>
            {f.opts.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        ))}
        {(provider || orbit || countryCode) && (
          <button
            onClick={() => {
              setProvider('');
              setOrbit('');
              setCountryCode('');
            }}
            className="px-2.5 py-1.5 text-xs text-zinc-400 hover:text-white"
          >
            Clear
          </button>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 text-xs text-rose-400 bg-rose-500/10 rounded-lg p-3">
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
          <p className="text-[11px] text-zinc-500">
            Showing {data.count} of {data.totalBeforeFilter} upcoming launches
          </p>
          {data.count === 0 ? (
            <p className="text-xs text-zinc-500 text-center py-4">
              No launches match the selected filters.
            </p>
          ) : (
            <ul className="space-y-2">
              {data.launches.map((l) => (
                <li
                  key={l.id}
                  className="p-3 bg-zinc-900 rounded-lg border border-zinc-800 hover:border-emerald-500/30"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs font-semibold text-white">{l.name}</p>
                    {l.status && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 shrink-0">
                        {l.status}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 mt-1.5">
                    <span className="inline-flex items-center gap-1 text-[11px] text-indigo-300">
                      <Rocket className="w-3 h-3" /> {l.provider}
                    </span>
                    <span className="text-[11px] text-cyan-300">{l.orbit}</span>
                    {l.location && (
                      <span className="inline-flex items-center gap-1 text-[11px] text-zinc-400">
                        <MapPin className="w-3 h-3" /> {l.location}
                      </span>
                    )}
                    <span className="text-[11px] text-zinc-500 ml-auto">{fmtDate(l.net)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
