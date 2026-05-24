'use client';

/**
 * ParksPanel — US National Parks Service parks by state. REAL_FREE;
 * requires NPS_API_KEY env var.
 *
 * Phase 11 (Item 9). Empty/missing-key/error states are honest.
 */

import { useState, useEffect, useCallback } from 'react';
import { Trees, RefreshCw, AlertTriangle, KeyRound, ExternalLink } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Park {
  parkCode?: string;
  name?: string;
  description?: string;
  designation?: string;
  states?: string;
  url?: string;
  imageUrl?: string | null;
}
interface ParksResponse {
  ok: boolean;
  source?: string;
  stateCode?: string;
  total?: number;
  parks?: Park[];
  reason?: string;
  envVar?: string;
  signupUrl?: string;
}

const STATES = ['AK','AL','AR','AZ','CA','CO','CT','DC','DE','FL','GA','HI','IA','ID','IL','IN','KS','KY','LA','MA','MD','ME','MI','MN','MO','MS','MT','NC','ND','NE','NH','NJ','NM','NV','NY','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VA','VT','WA','WI','WV','WY'];

async function runMacro(input: Record<string, unknown>) {
  try { const r = await lensRun({ domain: 'travel', name: 'live_nps_parks', input }); return r?.data as ParksResponse | null; }
  catch { return null; }
}

export interface ParksPanelProps { className?: string; }

export function ParksPanel({ className }: ParksPanelProps) {
  const [state, setState] = useState('CA');
  const [data, setData] = useState<ParksResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async (s: string) => {
    setLoading(true);
    const r = await runMacro({ stateCode: s, limit: 10 });
    setData(r);
    setLoading(false);
  }, []);

  useEffect(() => { void fetchData(state); }, [fetchData, state]);

  return (
    <section className={cn('rounded-lg border border-zinc-800 bg-zinc-950/80 overflow-hidden', className)}>
      <header className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800/80 bg-zinc-900/40">
        <Trees className="w-4 h-4 text-emerald-300" aria-hidden="true" />
        <h3 className="text-sm font-medium text-zinc-100 flex-1">National Parks · {state}{data?.total ? ` (${data.total})` : ''}</h3>
        <span className="text-[10px] text-emerald-400 font-mono">REAL data</span>
        <button type="button" onClick={() => void fetchData(state)} disabled={loading} className="p-1 text-zinc-400 hover:text-zinc-200" aria-label="Refresh">
          <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
        </button>
      </header>

      <div className="px-3 py-2 border-b border-zinc-800/40">
        <select value={state} onChange={(e) => setState(e.target.value)} className="text-xs bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-zinc-100 w-full">
          {STATES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {data && !data.ok && data.reason === 'missing_api_key' && (
        <div className="px-3 py-4 text-xs space-y-2 bg-amber-500/5 border-y border-amber-500/20">
          <div className="flex items-center gap-1.5 text-amber-300"><KeyRound className="w-3.5 h-3.5" /> <span className="font-medium">API key required</span></div>
          <p className="text-zinc-300">Set <code className="text-amber-300 bg-zinc-900 px-1 rounded">{data.envVar}</code> in <code className="text-zinc-300 bg-zinc-900 px-1 rounded">.env</code> to enable real NPS data.</p>
          {data.signupUrl && <a href={data.signupUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-emerald-300 hover:text-emerald-200"><ExternalLink className="w-3 h-3" /> Free signup</a>}
        </div>
      )}

      {data && !data.ok && data.reason !== 'missing_api_key' && (
        <div className="px-3 py-3 text-xs text-rose-300/80"><AlertTriangle className="inline w-3.5 h-3.5 mr-1" /> NPS unreachable ({data.reason || 'unknown'})</div>
      )}

      {data?.ok && (data.parks?.length ?? 0) === 0 && !loading && (
        <div className="px-3 py-6 text-xs text-zinc-400 italic text-center">No parks listed for that state.</div>
      )}

      {data?.ok && data.parks && data.parks.length > 0 && (
        <ul className="px-3 py-2 space-y-2 max-h-80 overflow-y-auto">
          {data.parks.map(p => (
            <li key={p.parkCode} className="flex gap-2">
              {p.imageUrl && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={p.imageUrl} alt="" className="w-14 h-14 object-cover rounded border border-zinc-800 flex-shrink-0" loading="lazy" />
              )}
              <div className="min-w-0 flex-1">
                <a href={p.url} target="_blank" rel="noreferrer" className="text-xs font-medium text-zinc-100 hover:text-emerald-300 line-clamp-1">{p.name}</a>
                <div className="text-[10px] text-zinc-400">{p.designation}</div>
                <p className="text-[11px] text-zinc-400 line-clamp-2">{p.description}</p>
              </div>
            </li>
          ))}
        </ul>
      )}

      <footer className="px-3 py-1.5 text-[10px] text-zinc-400 border-t border-zinc-800/40">
        Source: National Park Service · developer.nps.gov
      </footer>
    </section>
  );
}

export default ParksPanel;
