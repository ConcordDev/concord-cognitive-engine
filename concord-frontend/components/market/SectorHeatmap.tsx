'use client';

import { useState, useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Grid3x3, Loader2 } from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface Sector { sector: string; etf: string; pct: number | null; price?: number | null; marketCap?: number | null; topSymbols?: string[] }

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }

async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('market', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) {
    return data.result as MacroEnvelope<T>;
  }
  return data as MacroEnvelope<T>;
}

function heatColor(pct: number | null): string {
  if (pct == null) return 'bg-zinc-800 text-zinc-500';
  if (pct >= 2) return 'bg-emerald-700 text-emerald-50';
  if (pct >= 1) return 'bg-emerald-600 text-emerald-50';
  if (pct >= 0.5) return 'bg-emerald-500/70 text-emerald-50';
  if (pct >= -0.5) return 'bg-zinc-700 text-zinc-200';
  if (pct >= -1) return 'bg-rose-500/70 text-rose-50';
  if (pct >= -2) return 'bg-rose-600 text-rose-50';
  return 'bg-rose-700 text-rose-50';
}

export function SectorHeatmapPanel() {
  const [range, setRange] = useState<'1D' | 'YTD'>('1D');
  const [sectors, setSectors] = useState<Sector[]>([]);

  const load = useMutation({
    mutationFn: async () => callMacro<{ sectors: Sector[] }>('sector-performance', { range }),
    onSuccess: (env) => { if (env.ok && env.result) setSectors(env.result.sectors); else setSectors([]); },
  });

  useEffect(() => { load.mutate(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [range]);

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <Grid3x3 className="h-5 w-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">Sector Heatmap</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">spdr · yahoo finance</span>
        </div>
        <div className="flex gap-1 rounded-md border border-zinc-800 bg-zinc-950 p-0.5">
          {(['1D', 'YTD'] as const).map((r) => (
            <button key={r} type="button" onClick={() => setRange(r)} className={`rounded px-2.5 py-1 text-[10px] font-medium ${range === r ? 'bg-cyan-500/15 text-cyan-300' : 'text-zinc-500'}`}>{r}</button>
          ))}
        </div>
      </header>
      {load.isPending && <div className="flex items-center gap-2 text-xs text-zinc-500"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading sectors…</div>}
      {sectors.length > 0 && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {sectors.map((s) => (
              <motion.div key={s.etf} layout initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className={`rounded-md p-3 ${heatColor(s.pct)}`}>
                <div className="flex items-baseline justify-between">
                  <span className="text-xs font-bold">{s.sector}</span>
                  <span className="font-mono text-[9px] opacity-80">{s.etf}</span>
                </div>
                <div className="mt-1 font-mono text-lg font-bold">
                  {s.pct != null ? `${s.pct >= 0 ? '+' : ''}${s.pct.toFixed(2)}%` : '—'}
                </div>
                {s.topSymbols && s.topSymbols.length > 0 && (
                  <div className="mt-1 truncate text-[9px] opacity-80">
                    {s.topSymbols.slice(0, 4).join(' · ')}
                  </div>
                )}
              </motion.div>
            ))}
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-zinc-500">{sectors.length} SPDR sector ETFs · {range}</span>
            <SaveAsDtuButton
              compact
              apiSource="yahoo-finance"
              title={`Sector heatmap snapshot — ${range}`}
              content={sectors.map((s) => `${s.sector} (${s.etf}): ${s.pct?.toFixed(2)}% · top ${s.topSymbols?.slice(0, 3).join(', ')}`).join('\n')}
              extraTags={['market', 'sectors', range.toLowerCase()]}
              rawData={{ range, sectors }}
            />
          </div>
        </>
      )}
    </div>
  );
}
