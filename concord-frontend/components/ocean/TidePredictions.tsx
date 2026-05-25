'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Waves, Loader2, ArrowUp, ArrowDown } from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface Prediction { time: string; height: number; type: 'high' | 'low' }

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }

async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('ocean', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) {
    return data.result as MacroEnvelope<T>;
  }
  return data as MacroEnvelope<T>;
}

const COMMON_STATIONS = [
  { id: '9414290', name: 'San Francisco, CA' },
  { id: '8518750', name: 'The Battery, NY' },
  { id: '8443970', name: 'Boston, MA' },
  { id: '8723214', name: 'Virginia Key, FL' },
  { id: '9447130', name: 'Seattle, WA' },
];

export function TidePredictions() {
  const [stationId, setStationId] = useState('9414290');
  const [preds, setPreds] = useState<Prediction[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useMutation({
    mutationFn: async () => callMacro<{ predictions: Prediction[] }>('noaa-tide-prediction', { stationId }),
    onSuccess: (env) => {
      if (env.ok && env.result) { setPreds(env.result.predictions); setError(null); }
      else { setPreds([]); setError(env.error || 'tide fetch failed'); }
    },
  });

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <Waves className="h-5 w-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">Tide Predictions</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">noaa co-ops</span>
        </div>
      </header>

      <div className="flex items-center gap-2 flex-wrap">
        <select value={stationId} onChange={(e) => setStationId(e.target.value)} className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white">
          {COMMON_STATIONS.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <input type="text" value={stationId} onChange={(e) => setStationId(e.target.value.replace(/\D/g, ''))} placeholder="or station #" className="w-28 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 font-mono text-xs text-white" />
        <button type="button" onClick={() => load.mutate()} disabled={!stationId || load.isPending} className="inline-flex items-center gap-1.5 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 text-xs text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50">
          {load.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Waves className="h-3 w-3" />}
          Load tides
        </button>
        {preds.length > 0 && (
          <SaveAsDtuButton
            compact
            apiSource="noaa-tides"
            title={`Tide predictions — station ${stationId} (${preds.length} entries)`}
            content={preds.map((p) => `${p.time}  ${p.type.toUpperCase()} ${p.height}m MLLW`).join('\n')}
            extraTags={['ocean', 'tides', 'noaa', stationId]}
            rawData={{ stationId, predictions: preds }}
          />
        )}
      </div>
      {error && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">{error}</div>}
      {preds.length > 0 && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-1">
          {preds.map((p, i) => (
            <div key={i} className={`flex items-center gap-3 rounded border ${p.type === 'high' ? 'border-cyan-500/30 bg-cyan-500/5' : 'border-amber-500/30 bg-amber-500/5'} p-2`}>
              {p.type === 'high' ? <ArrowUp className="h-3.5 w-3.5 text-cyan-300" /> : <ArrowDown className="h-3.5 w-3.5 text-amber-300" />}
              <span className="font-mono text-xs text-zinc-200">{p.time}</span>
              <span className={`ml-auto font-mono text-sm ${p.type === 'high' ? 'text-cyan-200' : 'text-amber-200'}`}>{p.height.toFixed(2)}m</span>
              <span className="text-[10px] uppercase tracking-wider text-zinc-400">{p.type}</span>
            </div>
          ))}
        </motion.div>
      )}
    </div>
  );
}
