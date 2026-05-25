'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Brain, Loader2, Cpu, Activity } from 'lucide-react';
import { api } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface BrainSlot {
  slot: string;
  model?: string;
  host?: string;
  url?: string;
  reachable?: boolean;
  lastCheckedAt?: number;
  inflight?: number;
  totalRequests?: number;
  totalErrors?: number;
}

interface BrainStatus {
  brains?: BrainSlot[];
  policy?: string;
  ready?: boolean;
  initializedAt?: number;
}

export function BrainPoolStatus() {
  const [tick, setTick] = useState(0);
  useEffect(() => { const id = setInterval(() => setTick((t) => t + 1), 15000); return () => clearInterval(id); }, []);
  useEffect(() => { void tick; }, [tick]);

  const status = useQuery({
    queryKey: ['brain-status'],
    queryFn: async () => {
      const r = await api.get('/api/brain/status');
      return (r.data || {}) as BrainStatus;
    },
    refetchInterval: 15000,
  });

  const brains = status.data?.brains || [];
  const reachable = brains.filter((b) => b.reachable).length;
  const totalInflight = brains.reduce((a, b) => a + (b.inflight || 0), 0);
  const totalReq = brains.reduce((a, b) => a + (b.totalRequests || 0), 0);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <Brain className="h-5 w-5 text-fuchsia-400" />
          <h2 className="text-sm font-semibold text-white">Brain pool status</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">/api/brain/status · live</span>
        </div>
        {brains.length > 0 && (
          <SaveAsDtuButton
            compact
            apiSource="concord-brain-status"
            title={`Brain pool snapshot — ${reachable}/${brains.length} reachable · ${totalInflight} inflight`}
            content={brains.map((b) => `${b.slot}: ${b.model || '—'} @ ${b.host || b.url || '—'} · ${b.reachable ? 'UP' : 'DOWN'} · inflight ${b.inflight ?? 0} · req ${b.totalRequests ?? 0} · err ${b.totalErrors ?? 0}`).join('\n')}
            extraTags={['expert-mode', 'concord', 'brain-pool']}
            rawData={status.data as unknown as Record<string, unknown>}
          />
        )}
      </header>
      {status.isError && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">/api/brain/status unreachable.</div>}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5">
          <div className="text-[10px] uppercase tracking-wider text-zinc-400">Reachable</div>
          <div className="mt-0.5 font-mono text-lg text-fuchsia-300">{reachable} <span className="text-[10px] text-zinc-400">/ {brains.length}</span></div>
        </div>
        <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5">
          <div className="text-[10px] uppercase tracking-wider text-zinc-400">Inflight now</div>
          <div className="mt-0.5 font-mono text-lg text-fuchsia-300">{totalInflight}</div>
        </div>
        <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5">
          <div className="text-[10px] uppercase tracking-wider text-zinc-400">Total requests</div>
          <div className="mt-0.5 font-mono text-lg text-fuchsia-300">{totalReq.toLocaleString()}</div>
        </div>
      </div>
      <div className="space-y-1.5">
        {brains.map((b) => (
          <div key={b.slot} className={`rounded-lg border p-2.5 ${b.reachable ? 'border-fuchsia-500/20 bg-fuchsia-500/5' : 'border-rose-500/30 bg-rose-500/5'}`}>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Cpu className={`h-3.5 w-3.5 ${b.reachable ? 'text-fuchsia-400' : 'text-rose-400'}`} />
                <span className="font-mono text-sm text-zinc-100">{b.slot}</span>
                <span className="rounded bg-zinc-800 px-1 font-mono text-[9px] text-zinc-300">{b.model || '—'}</span>
              </div>
              <span className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${b.reachable ? 'bg-emerald-500/20 text-emerald-200' : 'bg-rose-500/30 text-rose-200'}`}>{b.reachable ? 'UP' : 'DOWN'}</span>
            </div>
            <div className="mt-1 grid grid-cols-3 gap-1.5 text-[10px] text-zinc-400">
              <span className="flex items-center gap-0.5"><Activity className="h-3 w-3" />inflight {b.inflight ?? 0}</span>
              <span>req {b.totalRequests ?? 0}</span>
              <span>err {b.totalErrors ?? 0}</span>
            </div>
            {(b.host || b.url) && <p className="mt-0.5 line-clamp-1 font-mono text-[9px] text-zinc-400">{b.host || b.url}</p>}
          </div>
        ))}
        {brains.length === 0 && !status.isPending && !status.isError && (
          <div className="rounded border border-dashed border-zinc-800 p-4 text-center text-[11px] text-zinc-400">No brains reported. Backend may be initializing.</div>
        )}
      </div>
      {status.isPending && <div className="flex items-center gap-2 text-xs text-zinc-400"><Loader2 className="h-4 w-4 animate-spin" /> Polling brain pool…</div>}
    </div>
  );
}
