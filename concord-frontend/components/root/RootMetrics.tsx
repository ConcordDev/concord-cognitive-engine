'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Server, Loader2, Cpu, HardDrive, Activity } from 'lucide-react';
import { api } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

/* The perf.metrics macro's REAL shape (server.js): nested groups, not the
   flat field list this component used to declare — when the two disagreed,
   every tile silently fell back to "—" under a LIVE badge (Root F2). The
   tiles below read only fields the endpoint actually returns; the three
   tiles with no source at this endpoint (ticks · tick ms · active users)
   are gone — values or silence. */
interface PerfMetrics {
  memory?: { heapUsed?: number; heapTotal?: number; rss?: number };
  uptime?: number;
  dtus?: { total?: number; shadow?: number };
  cache?: { hot?: number; queries?: number };
  graph?: { nodes?: number; edges?: number };
  collab?: { sessions?: number; locks?: number };
}

export function RootMetrics() {
  const [tick, setTick] = useState(0);
  useEffect(() => { const id = setInterval(() => setTick((t) => t + 1), 15000); return () => clearInterval(id); }, []);
  useEffect(() => { void tick; }, [tick]);

  const m = useQuery({
    queryKey: ['perf-metrics'],
    queryFn: async () => {
      const r = await api.get('/api/perf/metrics');
      return (r.data || {}) as PerfMetrics;
    },
    refetchInterval: 15000,
  });

  const d = m.data || {};
  const uptimeHrs = d.uptime != null ? (d.uptime / 3600).toFixed(1) : '—';

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2"><Server className="h-5 w-5 text-emerald-400" /><h2 className="text-sm font-semibold text-white">Concord root metrics</h2><span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">/api/perf/metrics · live</span></div>
        {d.dtus?.total != null && <SaveAsDtuButton compact apiSource="concord-perf-metrics" title={`Concord root metrics — uptime ${uptimeHrs}h · ${d.dtus.total.toLocaleString()} DTUs`} content={`Memory (heap): ${d.memory?.heapUsed ?? '—'} MB\nDTU count: ${d.dtus?.total ?? '—'}\nGraph nodes: ${d.graph?.nodes ?? '—'}\nGraph edges: ${d.graph?.edges ?? '—'}\nCache entries: ${d.cache?.hot ?? '—'}\nCollab sessions: ${d.collab?.sessions ?? '—'}\nUptime: ${uptimeHrs}h`} extraTags={['root', 'metrics', 'concord']} rawData={d as unknown as Record<string, unknown>} />}
      </header>
      {m.isError && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">/api/perf/metrics unreachable.</div>}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5"><div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-400"><Cpu className="h-2.5 w-2.5" />Memory</div><div className="mt-0.5 font-mono text-lg text-emerald-300">{d.memory?.heapUsed ?? '—'} MB</div></div>
        <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5"><div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-400"><HardDrive className="h-2.5 w-2.5" />DTUs</div><div className="mt-0.5 font-mono text-lg text-emerald-300">{d.dtus?.total?.toLocaleString() ?? '—'}</div></div>
        <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5"><div className="text-[10px] uppercase tracking-wider text-zinc-400">Graph nodes</div><div className="mt-0.5 font-mono text-lg text-emerald-300">{d.graph?.nodes?.toLocaleString() ?? '—'}</div></div>
        <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5"><div className="text-[10px] uppercase tracking-wider text-zinc-400">Cache entries</div><div className="mt-0.5 font-mono text-lg text-emerald-300">{d.cache?.hot?.toLocaleString() ?? '—'}</div></div>
      </div>
      <div className="grid grid-cols-2 gap-2 text-[11px]">
        <div className="rounded border border-emerald-500/15 bg-emerald-500/5 p-2"><div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-400"><Activity className="h-2.5 w-2.5" />Collab sessions</div><div className="font-mono text-zinc-100">{d.collab?.sessions ?? '—'}</div></div>
        <div className="rounded border border-emerald-500/15 bg-emerald-500/5 p-2"><div className="text-[10px] uppercase tracking-wider text-zinc-400">Uptime</div><div className="font-mono text-zinc-100">{uptimeHrs}h</div></div>
      </div>
      {m.isPending && <div className="flex items-center gap-2 text-xs text-zinc-400"><Loader2 className="h-4 w-4 animate-spin" /> Polling…</div>}
    </div>
  );
}
