'use client';

/**
 * FireIncidents — bespoke InciWeb + NIFC wildfire panel for the
 * forestry lens. Per category-leader research (InciWeb, CalFire,
 * Watch Duty, NIFC EGP): row-led incident list with severity left-
 * stripe + Save-as-DTU per fire.
 */

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Flame, Loader2, ExternalLink } from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface Fire {
  id: number; name: string; type?: string;
  location?: string; state?: string; county?: string;
  sizeAcres?: number; containmentPct?: number; status?: string;
  startDate?: string; lastUpdated?: string;
  latitude?: number | null; longitude?: number | null;
  incidentUrl?: string;
}

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }

async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('forestry', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) {
    return data.result as MacroEnvelope<T>;
  }
  return data as MacroEnvelope<T>;
}

export function FireIncidents() {
  const [state, setState] = useState('');
  const [fires, setFires] = useState<Fire[]>([]);

  const load = useMutation({
    mutationFn: async () => callMacro<{ fires: Fire[] }>('inciweb-active-fires', state ? { state, limit: 60 } : { limit: 60 }),
    onSuccess: (env) => { if (env.ok && env.result) setFires(env.result.fires); else setFires([]); },
  });

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <Flame className="h-5 w-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">Active Wildfires</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">inciweb · nifc</span>
        </div>
      </header>

      <div className="flex items-center gap-2">
        <input type="text" maxLength={2} value={state} onChange={(e) => setState(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))} placeholder="State (optional)" className="w-32 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 font-mono uppercase text-xs text-white" />
        <button type="button" onClick={() => load.mutate()} disabled={load.isPending} className="inline-flex items-center gap-1.5 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50">
          {load.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Flame className="h-3.5 w-3.5" />}
          Load active fires
        </button>
        {fires.length > 0 && <span className="text-[10px] text-zinc-400">{fires.length} incidents</span>}
      </div>

      <div className="space-y-1.5">
        {fires.map((f) => {
          const contained = f.containmentPct || 0;
          const border = contained < 30 ? 'border-l-red-500 bg-red-500/5' : contained < 80 ? 'border-l-amber-500 bg-amber-500/5' : 'border-l-emerald-500 bg-emerald-500/5';
          return (
            <motion.div key={f.id} layout initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className={`flex items-start gap-3 rounded border border-zinc-800 border-l-4 ${border} p-3`}>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="font-semibold text-white">{f.name}</span>
                  <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-300">{contained.toFixed(0)}% contained</span>
                  {f.sizeAcres != null && <span className="font-mono text-[11px] text-amber-300">{Math.round(f.sizeAcres).toLocaleString()} acres</span>}
                </div>
                <div className="mt-0.5 flex flex-wrap gap-x-2 text-[10px] text-zinc-400">
                  {f.location && <span>{f.location}</span>}
                  {f.county && <span>{f.county} Co.</span>}
                  {f.state && <span>{f.state}</span>}
                  {f.startDate && <span>Started {f.startDate}</span>}
                  {f.lastUpdated && <span>· Updated {f.lastUpdated}</span>}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <SaveAsDtuButton
                  compact
                  apiSource="inciweb"
                  apiUrl={f.incidentUrl}
                  title={`${f.name} fire — ${f.state || ''} · ${Math.round(f.sizeAcres || 0).toLocaleString()} acres`}
                  content={`Fire: ${f.name}\nLocation: ${f.location || ''} ${f.county || ''} ${f.state || ''}\nSize: ${f.sizeAcres} acres\nContainment: ${contained}%\nStatus: ${f.status}\nStarted: ${f.startDate}\nLast updated: ${f.lastUpdated}\n${f.incidentUrl ? `URL: ${f.incidentUrl}` : ''}`}
                  extraTags={['forestry', 'wildfire', 'inciweb', f.state?.toLowerCase() || 'us']}
                  rawData={f}
                />
                {f.incidentUrl && <a href={f.incidentUrl} target="_blank" rel="noopener noreferrer" className="flex h-6 w-6 items-center justify-center rounded text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200" aria-label="open"><ExternalLink className="h-3 w-3" /></a>}
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
