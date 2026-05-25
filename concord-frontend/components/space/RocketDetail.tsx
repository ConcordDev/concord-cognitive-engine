'use client';

/**
 * RocketDetail — vehicle spec sheet. Lists the SpaceX fleet from
 * space.rocket-detail and resolves a full spec sheet on selection.
 * Real r-spacex API, no API key.
 */

import { useState, useEffect, useCallback } from 'react';
import { Rocket, Loader2, AlertTriangle, ExternalLink, CheckCircle2, XCircle } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface FleetEntry {
  id: string;
  name: string;
  active: boolean;
}

interface PayloadWeight {
  id: string;
  name: string;
  kg: number;
}

interface RocketSpec {
  found: boolean;
  fleet?: FleetEntry[];
  id?: string;
  name?: string;
  type?: string;
  active?: boolean;
  stages?: number;
  boosters?: number;
  costPerLaunchUsd?: number;
  successRatePct?: number;
  firstFlight?: string;
  country?: string;
  company?: string;
  heightMeters?: number;
  diameterMeters?: number;
  massKg?: number;
  payloadWeights?: PayloadWeight[];
  description?: string;
  wikipedia?: string;
  flickrImages?: string[];
}

export function RocketDetail() {
  const [fleet, setFleet] = useState<FleetEntry[]>([]);
  const [spec, setSpec] = useState<RocketSpec | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await lensRun<RocketSpec>('space', 'rocket-detail', {});
      if (cancelled) return;
      if (r.data?.ok && r.data.result?.fleet) setFleet(r.data.result.fleet);
      else setError(r.data?.error || 'Fleet unavailable');
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectRocket = useCallback(async (rocketId: string) => {
    setLoading(true);
    setError(null);
    const r = await lensRun<RocketSpec>('space', 'rocket-detail', { rocketId });
    if (r.data?.ok && r.data.result?.found) setSpec(r.data.result);
    else setError(r.data?.error || 'Rocket spec unavailable');
    setLoading(false);
  }, []);

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-white flex items-center gap-2">
        <Rocket className="w-4 h-4 text-indigo-400" /> Vehicle Detail
      </h3>

      {error && (
        <div className="flex items-center gap-2 text-xs text-rose-400 bg-rose-500/10 rounded-lg p-3">
          <AlertTriangle className="w-4 h-4 shrink-0" /> {error}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {fleet.map((f) => (
          <button
            key={f.id}
            onClick={() => selectRocket(f.id)}
            className={cn(
              'px-3 py-1.5 rounded-lg text-xs border',
              spec?.id === f.id
                ? 'bg-indigo-600 text-white border-indigo-500'
                : 'bg-zinc-900 text-zinc-300 border-zinc-800 hover:border-indigo-500/40',
            )}
          >
            {f.name}
            {!f.active && <span className="ml-1.5 text-[10px] text-zinc-400">retired</span>}
          </button>
        ))}
      </div>

      {loading && (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="w-5 h-5 animate-spin text-indigo-400" />
        </div>
      )}

      {spec && spec.found && (
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-base font-semibold text-white">{spec.name}</p>
              <p className="text-[11px] text-zinc-400">
                {[spec.company, spec.country, spec.firstFlight].filter(Boolean).join(' · ')}
              </p>
            </div>
            <span
              className={cn(
                'flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full',
                spec.active ? 'bg-emerald-500/10 text-emerald-400' : 'bg-zinc-700/40 text-zinc-400',
              )}
            >
              {spec.active ? (
                <CheckCircle2 className="w-3 h-3" />
              ) : (
                <XCircle className="w-3 h-3" />
              )}
              {spec.active ? 'Active' : 'Retired'}
            </span>
          </div>

          {spec.description && <p className="text-xs text-zinc-400">{spec.description}</p>}

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              { l: 'Height', v: spec.heightMeters != null ? `${spec.heightMeters} m` : '—' },
              { l: 'Diameter', v: spec.diameterMeters != null ? `${spec.diameterMeters} m` : '—' },
              { l: 'Mass', v: spec.massKg != null ? `${(spec.massKg / 1000).toFixed(0)} t` : '—' },
              { l: 'Stages', v: spec.stages != null ? String(spec.stages) : '—' },
              {
                l: 'Success rate',
                v: spec.successRatePct != null ? `${spec.successRatePct}%` : '—',
              },
              {
                l: 'Cost / launch',
                v:
                  spec.costPerLaunchUsd != null
                    ? `$${(spec.costPerLaunchUsd / 1e6).toFixed(0)}M`
                    : '—',
              },
              { l: 'Boosters', v: spec.boosters != null ? String(spec.boosters) : '—' },
              { l: 'Type', v: spec.type || '—' },
            ].map((s) => (
              <div key={s.l} className="p-2 bg-zinc-950 rounded-lg border border-zinc-800">
                <p className="text-[11px] text-zinc-400">{s.l}</p>
                <p className="text-sm font-mono font-semibold text-white">{s.v}</p>
              </div>
            ))}
          </div>

          {spec.payloadWeights && spec.payloadWeights.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[11px] text-zinc-400 uppercase tracking-wide">Payload capacity</p>
              {spec.payloadWeights.map((p) => (
                <div key={p.id} className="flex items-center justify-between text-xs">
                  <span className="text-zinc-400">{p.name}</span>
                  <span className="font-mono text-zinc-200">{p.kg.toLocaleString()} kg</span>
                </div>
              ))}
            </div>
          )}

          {spec.wikipedia && (
            <a
              href={spec.wikipedia}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-indigo-400 hover:text-indigo-300"
            >
              <ExternalLink className="w-3.5 h-3.5" /> Wikipedia
            </a>
          )}
        </div>
      )}

      {!loading && fleet.length === 0 && !spec && !error && (
        <p className="text-xs text-zinc-400 text-center py-4">No vehicles available.</p>
      )}
    </div>
  );
}
