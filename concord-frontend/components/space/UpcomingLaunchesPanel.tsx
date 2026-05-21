'use client';

/**
 * UpcomingLaunchesPanel — real Launch Library 2 upcoming launches,
 * drop-in for astronomy + space lenses. No API key.
 *
 * Phase 4 (fifth wave) of the UX completeness sprint.
 */

import { useState, useEffect } from 'react';
import { Calendar, RefreshCw, AlertTriangle, Radio } from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Launch {
  id: string;
  name: string;
  statusName: string | null;
  statusAbbrev: string | null;
  net: string | null;
  launchProvider: string | null;
  rocket: string | null;
  missionDescription: string | null;
  padName: string | null;
  padLocation: string | null;
  imageUrl: string | null;
  webcastLive: boolean;
}

async function runMacro<T>(domain: string, name: string, input: Record<string, unknown>): Promise<T | null> {
  try {
    const r = await api.post('/api/lens/run', { domain, name, input });
    return r?.data as T;
  } catch {
    return null;
  }
}

function formatLaunchDate(iso: string | null): string {
  if (!iso) return 'TBD';
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  } catch { return iso; }
}

const STATUS_COLOR: Record<string, string> = {
  Go: 'text-emerald-400',
  TBD: 'text-zinc-500',
  TBC: 'text-amber-400',
  Hold: 'text-rose-400',
  Success: 'text-emerald-400',
  Failure: 'text-rose-400',
};

export interface UpcomingLaunchesPanelProps {
  domain: 'astronomy' | 'space';
  className?: string;
}

export function UpcomingLaunchesPanel({ domain, className }: UpcomingLaunchesPanelProps) {
  const [launches, setLaunches] = useState<Launch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    const r = await runMacro<{ ok: boolean; launches?: Launch[]; reason?: string }>(
      domain, 'live_launches_upcoming', { limit: 8 },
    );
    if (r?.ok) setLaunches(r.launches || []);
    else setError(r?.reason || 'fetch_failed');
    setLoading(false);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await runMacro<{ ok: boolean; launches?: Launch[]; reason?: string }>(
        domain, 'live_launches_upcoming', { limit: 8 },
      );
      if (cancelled) return;
      if (r?.ok) setLaunches(r.launches || []);
      else setError(r?.reason || 'fetch_failed');
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [domain]);

  return (
    <section className={cn('rounded-lg border border-zinc-800 bg-zinc-950/80 overflow-hidden', className)}>
      <header className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800/80 bg-zinc-900/40">
        <Calendar className="w-4 h-4 text-blue-300" aria-hidden="true" />
        <h3 className="text-sm font-medium text-zinc-100 flex-1">Upcoming launches</h3>
        <span className="text-[10px] text-emerald-400 font-mono">REAL data</span>
        <button
          type="button"
          onClick={() => void fetchData()}
          disabled={loading}
          className="p-1 text-zinc-500 hover:text-zinc-200 transition-colors"
          aria-label="Refresh"
        >
          <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
        </button>
      </header>

      {error && (
        <div className="px-3 py-3 text-xs text-rose-300/80">
          <AlertTriangle className="inline w-3.5 h-3.5 mr-1" /> Launch Library unreachable ({error})
        </div>
      )}

      {!error && !loading && launches.length === 0 && (
        <div className="px-3 py-6 text-xs text-zinc-500 italic text-center">No upcoming launches.</div>
      )}

      {launches.length > 0 && (
        <ul className="divide-y divide-zinc-800/40 max-h-[500px] overflow-y-auto">
          {launches.map((l) => (
            <li key={l.id} className="px-3 py-2.5 text-xs">
              <div className="flex items-start gap-3">
                {l.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={l.imageUrl} alt="" className="w-12 h-12 rounded object-cover shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="text-zinc-200 font-medium truncate">{l.name}</span>
                    {l.statusAbbrev && (
                      <span className={cn('text-[10px] font-mono', STATUS_COLOR[l.statusAbbrev] || 'text-zinc-500')}>
                        {l.statusAbbrev}
                      </span>
                    )}
                    {l.webcastLive && (
                      <span className="text-[10px] text-rose-400 font-mono flex items-center gap-0.5">
                        <Radio className="w-2.5 h-2.5" /> LIVE
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-zinc-400 mt-0.5 font-mono">
                    {formatLaunchDate(l.net)}
                  </div>
                  <div className="text-[10px] text-zinc-500 truncate">
                    {l.launchProvider && `${l.launchProvider} · `}
                    {l.rocket}
                  </div>
                  {(l.padName || l.padLocation) && (
                    <div className="text-[10px] text-zinc-500 truncate">
                      📍 {l.padName}{l.padLocation && `, ${l.padLocation}`}
                    </div>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <footer className="px-3 py-1.5 text-[10px] text-zinc-500 border-t border-zinc-800/40">
        Source: Launch Library 2 (theSpaceDevs)
      </footer>
    </section>
  );
}

export default UpcomingLaunchesPanel;
