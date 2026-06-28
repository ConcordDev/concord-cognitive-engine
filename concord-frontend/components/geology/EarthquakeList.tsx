'use client';

import { useState, useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Activity, Loader2, ExternalLink, AlertTriangle } from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface Quake {
  id: string; magnitude: number; magnitudeType?: string;
  place: string; time: string | null; url?: string;
  status?: string; tsunami?: boolean; felt?: number;
  alert?: string | null; sig?: number;
  longitude: number; latitude: number; depthKm: number;
}

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }

async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('geology', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) {
    return data.result as MacroEnvelope<T>;
  }
  return data as MacroEnvelope<T>;
}

function magClass(mag: number) {
  if (mag >= 7) return 'border-l-red-500 bg-red-500/10 text-red-200';
  if (mag >= 5.5) return 'border-l-orange-500 bg-orange-500/5 text-orange-200';
  if (mag >= 4) return 'border-l-amber-500 bg-amber-500/5 text-amber-200';
  if (mag >= 2.5) return 'border-l-emerald-500/40 text-emerald-200';
  return 'border-l-zinc-700 text-zinc-300';
}

export function EarthquakeList() {
  const [minMag, setMinMag] = useState(2.5);
  const [sinceHours, setSinceHours] = useState(24);
  const [events, setEvents] = useState<Quake[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ran, setRan] = useState(false);

  const load = useMutation({
    mutationFn: async () => callMacro<{ events: Quake[] }>('recent-earthquakes', { minMagnitude: minMag, sinceHours, limit: 100 }),
    // EMPTY ≠ ERROR: a rejected macro (USGS unreachable) surfaces a distinct
    // error banner; a successful-but-empty window renders the empty notice.
    onSuccess: (env) => {
      setRan(true);
      if (env.ok && env.result) { setEvents(env.result.events || []); setError(null); }
      else { setEvents([]); setError(env.error || 'USGS earthquake catalog unreachable'); }
    },
    onError: (e) => { setRan(true); setEvents([]); setError(e instanceof Error ? e.message : 'USGS earthquake catalog unreachable'); },
  });

  useEffect(() => {
    load.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mutate stable
  }, []);

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">Recent Earthquakes</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">usgs feed</span>
        </div>
      </header>
      <div className="flex items-center gap-2 text-xs">
        <label className="text-zinc-400">Min mag:</label>
        <input type="number" step="0.5" min="0" max="9" value={minMag} onChange={(e) => setMinMag(Number(e.target.value))} className="w-16 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 font-mono text-white" />
        <label className="text-zinc-400">Since (hrs):</label>
        <select value={sinceHours} onChange={(e) => setSinceHours(Number(e.target.value))} className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-white">
          {[1, 6, 12, 24, 72, 168, 720].map((h) => <option key={h} value={h}>{h}h</option>)}
        </select>
        <button type="button" onClick={() => load.mutate()} disabled={load.isPending} className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 text-xs text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50">
          {load.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Reload'}
        </button>
      </div>
      {error && (
        <div className="flex items-center gap-2 rounded border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => load.mutate()} disabled={load.isPending}
            className="rounded border border-rose-400/40 px-2 py-0.5 text-rose-200 hover:bg-rose-500/20 disabled:opacity-50">
            Retry
          </button>
        </div>
      )}
      {!error && ran && !load.isPending && events.length === 0 && (
        <p className="py-4 text-center text-xs italic text-zinc-400">
          No earthquakes ≥M{minMag.toFixed(1)} in the past {sinceHours}h.
        </p>
      )}
      <div className="space-y-1 max-h-[28rem] overflow-y-auto">
        {events.map((q) => (
          <motion.div key={q.id} layout initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className={`flex items-center gap-3 rounded border border-zinc-800 border-l-4 ${magClass(q.magnitude)} p-2`}>
            <div className="font-mono text-lg font-bold w-12 text-center">{q.magnitude?.toFixed(1)}</div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs text-white">{q.place}</div>
              <div className="flex flex-wrap gap-x-2 text-[10px] text-zinc-400">
                <span>{q.time ? new Date(q.time).toLocaleString() : ''}</span>
                <span>depth {q.depthKm?.toFixed(0)} km</span>
                {q.tsunami && <span className="font-bold text-rose-400">⚠ tsunami flag</span>}
                {q.alert && <span className="uppercase">{q.alert}</span>}
              </div>
            </div>
            <SaveAsDtuButton
              compact
              apiSource="usgs-earthquake"
              apiUrl={q.url}
              title={`M${q.magnitude} — ${q.place}`}
              content={`M${q.magnitude} ${q.magnitudeType || ''}\nPlace: ${q.place}\nTime: ${q.time}\nDepth: ${q.depthKm} km\nCoordinates: ${q.latitude}, ${q.longitude}\nTsunami flag: ${q.tsunami}\nPAGER alert: ${q.alert || 'none'}\nFelt: ${q.felt || 0} reports\nSignificance: ${q.sig}\n${q.url}`}
              extraTags={['geology', 'earthquake', `m${Math.floor(q.magnitude || 0)}`, q.alert || 'none']}
              rawData={q}
            />
            {q.url && (
              <a href={q.url} target="_blank" rel="noopener noreferrer" className="flex h-6 w-6 items-center justify-center rounded text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200" aria-label="open"><ExternalLink className="h-3 w-3" /></a>
            )}
            {(q.alert === 'orange' || q.alert === 'red') && <AlertTriangle className="h-3.5 w-3.5 text-red-400" />}
          </motion.div>
        ))}
      </div>
    </div>
  );
}
