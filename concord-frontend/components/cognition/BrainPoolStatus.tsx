'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Brain, Loader2, Cpu, Zap } from 'lucide-react';
import { api } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface BrainStatus { brains?: Record<string, { ok: boolean; model?: string; latencyMs?: number; queueDepth?: number; tokens24h?: number; url?: string }>; [k: string]: unknown }

export function BrainPoolStatus() {
  const [tick, setTick] = useState(0);
  useEffect(() => { const id = setInterval(() => setTick((t) => t + 1), 8000); return () => clearInterval(id); }, []);
  useEffect(() => { void tick; }, [tick]);

  const status = useQuery({
    queryKey: ['brain-status'],
    queryFn: async () => (await api.get('/api/brain/status')).data as BrainStatus,
    refetchInterval: 8000,
  });

  const brains = status.data?.brains || {};
  const entries = Object.entries(brains);
  const upCount = entries.filter(([, v]) => v.ok).length;

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <Brain className="h-5 w-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">Brain pool — cognitive substrate</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">/api/brain/status · 8s poll</span>
          <span className={`h-2 w-2 rounded-full ${upCount === entries.length && entries.length > 0 ? 'bg-emerald-400' : upCount === 0 ? 'bg-red-400' : 'bg-amber-400'} animate-pulse`} />
        </div>
        {entries.length > 0 && (
          <SaveAsDtuButton
            compact
            apiSource="concord-brains"
            title={`Brain pool snapshot — ${upCount}/${entries.length} up`}
            content={entries.map(([k, v]) => `${k} (${v.model || '?'}): ${v.ok ? 'up' : 'down'}${v.latencyMs != null ? ` · ${v.latencyMs}ms` : ''}${v.queueDepth != null ? ` · queue ${v.queueDepth}` : ''}${v.tokens24h != null ? ` · ${v.tokens24h.toLocaleString()} tok/24h` : ''}`).join('\n')}
            extraTags={['cognition', 'brains', 'concord']}
            rawData={status.data}
          />
        )}
      </header>
      {status.isError && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">Brain pool unreachable.</div>}
      {status.isPending && <div className="flex items-center gap-2 text-xs text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Polling brains…</div>}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {entries.map(([name, b]) => (
          <div key={name} className={`rounded-lg border p-3 ${b.ok ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-red-500/20 bg-red-500/5'}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Cpu className={`h-4 w-4 ${b.ok ? 'text-emerald-300' : 'text-red-300'}`} />
                <span className="font-mono text-sm text-white">{name}</span>
              </div>
              <span className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${b.ok ? 'bg-emerald-500/20 text-emerald-200' : 'bg-red-500/20 text-red-200'}`}>{b.ok ? 'UP' : 'DOWN'}</span>
            </div>
            {b.model && <div className="mt-1 font-mono text-[11px] text-cyan-300">{b.model}</div>}
            <div className="mt-2 grid grid-cols-3 gap-1 font-mono text-[10px] text-zinc-400">
              <div><Zap className="mr-0.5 inline h-2.5 w-2.5" />{b.latencyMs != null ? `${b.latencyMs}ms` : '—'}</div>
              <div>queue {b.queueDepth ?? '—'}</div>
              <div>{b.tokens24h ? `${(b.tokens24h / 1000).toFixed(0)}k tok` : '—'}</div>
            </div>
            {b.url && <div className="mt-0.5 truncate font-mono text-[9px] text-zinc-500">{b.url}</div>}
          </div>
        ))}
        {entries.length === 0 && !status.isPending && (
          <div className="col-span-full rounded border border-dashed border-zinc-800 p-6 text-center text-[11px] text-zinc-500">No brains reporting.</div>
        )}
      </div>
    </div>
  );
}
