'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Rocket, Loader2, Tv, ExternalLink, MapPin } from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface LL2Launch { id: string; name: string; net: string; status?: string; provider?: string; rocket?: string; mission?: string; missionDescription?: string; orbit?: string; pad?: string; location?: string; countryCode?: string; webcastLive?: boolean; image?: string }
interface SpacexLaunch { id: string; name: string; flightNumber?: number; dateUtc: string; details?: string; webcast?: string; article?: string; wikipedia?: string; patch?: string }

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }

async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('space', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) {
    return data.result as MacroEnvelope<T>;
  }
  return data as MacroEnvelope<T>;
}

function tCountdown(ts: string): { sign: '-' | '+'; days: number; hh: string; mm: string } {
  const target = new Date(ts).getTime();
  const now = Date.now();
  const ms = target - now;
  const abs = Math.abs(ms);
  const days = Math.floor(abs / 86_400_000);
  const hh = Math.floor((abs % 86_400_000) / 3_600_000).toString().padStart(2, '0');
  const mm = Math.floor((abs % 3_600_000) / 60_000).toString().padStart(2, '0');
  return { sign: ms >= 0 ? '-' : '+', days, hh, mm };
}

export function UpcomingLaunches() {
  const [provider, setProvider] = useState<'all' | 'spacex'>('all');
  const [ll2, setLL2] = useState<LL2Launch[]>([]);
  const [sx, setSx] = useState<SpacexLaunch[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => { const id = setInterval(() => setTick((t) => t + 1), 30_000); return () => clearInterval(id); }, []);
  useEffect(() => { void tick; }, [tick]);

  const load = useMutation({
    mutationFn: async () => {
      setError(null);
      if (provider === 'spacex') {
        const env = await callMacro<{ launches: SpacexLaunch[] }>('spacex-upcoming', { limit: 12 });
        if (env.ok && env.result) { setSx(env.result.launches); setLL2([]); }
        else setError(env.error || 'spacex failed');
      } else {
        const env = await callMacro<{ launches: LL2Launch[] }>('launch-library-upcoming', { limit: 15 });
        if (env.ok && env.result) { setLL2(env.result.launches); setSx([]); }
        else setError(env.error || 'launch library failed');
      }
    },
  });

  useEffect(() => {
    load.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider]);

  const all = useMemo(() => {
    if (provider === 'spacex') {
      return sx.map((l) => ({
        id: l.id, name: l.name, net: l.dateUtc, status: 'TBC', provider: 'SpaceX',
        rocket: l.flightNumber ? `Flight #${l.flightNumber}` : 'Falcon family',
        mission: l.name, missionDescription: l.details || '', orbit: '', pad: '', location: '',
        countryCode: 'USA', webcastLive: !!l.webcast, image: l.patch,
        webcast: l.webcast, article: l.article, wikipedia: l.wikipedia,
      })) as (LL2Launch & Partial<SpacexLaunch>)[];
    }
    return ll2 as (LL2Launch & Partial<SpacexLaunch>)[];
  }, [provider, sx, ll2]);

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <Rocket className="h-5 w-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">Upcoming launches</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">{provider === 'spacex' ? 'spacexdata · r-spacex' : 'thespacedevs · launch library 2'}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border border-zinc-800 bg-zinc-950 p-0.5 text-[10px]">
            {(['all', 'spacex'] as const).map((p) => (
              <button key={p} onClick={() => setProvider(p)} className={`rounded px-2 py-0.5 font-mono uppercase ${provider === p ? 'bg-cyan-500/20 text-cyan-200' : 'text-zinc-500 hover:text-zinc-300'}`}>{p === 'all' ? 'All providers' : 'SpaceX'}</button>
            ))}
          </div>
          {all.length > 0 && (
            <SaveAsDtuButton
              compact
              apiSource={provider === 'spacex' ? 'spacex' : 'launch-library-2'}
              apiUrl={provider === 'spacex' ? 'https://api.spacexdata.com/v4/launches/upcoming' : 'https://ll.thespacedevs.com/2.2.0/launch/upcoming/'}
              title={`${all.length} upcoming launches — ${provider === 'spacex' ? 'SpaceX' : 'All providers'}`}
              content={all.slice(0, 10).map((l, i) => `${i + 1}. ${l.name} — ${l.provider || 'unknown'} · ${l.net} · ${l.pad || ''}`).join('\n')}
              extraTags={['space', 'launches', provider]}
              rawData={{ provider, launches: all.slice(0, 30) }}
            />
          )}
        </div>
      </header>

      {error && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">{error}</div>}

      {load.isPending && <div className="flex items-center gap-2 text-xs text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Fetching launch manifest…</div>}

      <div className="space-y-2">
        {all.map((l) => {
          const t = tCountdown(l.net);
          const isToday = t.sign === '-' && t.days === 0;
          return (
            <article key={l.id} className={`rounded-lg border ${l.webcastLive ? 'border-red-500/30 bg-red-500/5' : 'border-zinc-800 bg-zinc-950/40'} p-3`}>
              <div className="flex items-start gap-3">
                {l.image && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={l.image} alt="" className="h-12 w-12 rounded border border-zinc-800 object-cover" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="line-clamp-1 text-sm font-semibold text-white">{l.name}</h3>
                    <span className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] uppercase ${isToday ? 'bg-amber-500/20 text-amber-200' : 'bg-zinc-800 text-zinc-400'}`}>
                      T{t.sign}{t.days}d {t.hh}:{t.mm}
                    </span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-zinc-400">
                    {l.provider && <span>{l.provider}</span>}
                    {l.rocket && <span className="font-mono">{l.rocket}</span>}
                    {l.pad && <span className="flex items-center gap-0.5"><MapPin className="h-3 w-3" /> {l.pad}{l.location ? `, ${l.location}` : ''}</span>}
                    {l.orbit && <span className="rounded bg-zinc-800 px-1 font-mono text-[10px] text-zinc-300">{l.orbit}</span>}
                    {l.status && <span className="text-cyan-300/80">{l.status}</span>}
                  </div>
                  {l.missionDescription && <p className="mt-1 line-clamp-2 text-[11px] text-zinc-500">{l.missionDescription}</p>}
                  <div className="mt-1 flex gap-2 text-[11px]">
                    {l.webcast && <a href={l.webcast} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-red-300 hover:underline"><Tv className="h-3 w-3" /> webcast</a>}
                    {l.article && <a href={l.article} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-cyan-300 hover:underline"><ExternalLink className="h-3 w-3" /> article</a>}
                    {l.wikipedia && <a href={l.wikipedia} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-cyan-300 hover:underline"><ExternalLink className="h-3 w-3" /> wiki</a>}
                  </div>
                </div>
              </div>
            </article>
          );
        })}
        {all.length === 0 && !load.isPending && !error && (
          <div className="rounded border border-dashed border-zinc-800 p-6 text-center text-xs text-zinc-500">No launches in window.</div>
        )}
      </div>
    </div>
  );
}
