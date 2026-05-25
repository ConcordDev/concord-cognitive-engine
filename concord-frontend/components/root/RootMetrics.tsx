'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Server, Loader2, Cpu, HardDrive, Activity } from 'lucide-react';
import { api } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface PerfMetrics { ticks?: number; tickDurationMs?: number; memoryMB?: number; cpuPct?: number; dtuCount?: number; activeUsers?: number; uptimeSec?: number; }

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
  const uptimeHrs = d.uptimeSec ? (d.uptimeSec / 3600).toFixed(1) : '—';

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2"><Server className="h-5 w-5 text-emerald-400" /><h2 className="text-sm font-semibold text-white">Concord root metrics</h2><span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">/api/perf/metrics · live</span></div>
        {d.ticks != null && <SaveAsDtuButton compact apiSource="concord-perf-metrics" title={`Concord root metrics — uptime ${uptimeHrs}h · ${d.dtuCount?.toLocaleString() ?? '—'} DTUs`} content={`Ticks: ${d.ticks ?? '—'}\nTick duration: ${d.tickDurationMs ?? '—'} ms\nMemory: ${d.memoryMB ?? '—'} MB\nCPU: ${d.cpuPct ?? '—'}%\nDTU count: ${d.dtuCount ?? '—'}\nActive users: ${d.activeUsers ?? '—'}\nUptime: ${uptimeHrs}h`} extraTags={['root', 'metrics', 'concord']} rawData={d as unknown as Record<string, unknown>} />}
      </header>
      {m.isError && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">/api/perf/metrics unreachable.</div>}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5"><div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-400"><Activity className="h-2.5 w-2.5" />Ticks</div><div className="mt-0.5 font-mono text-lg text-emerald-300">{d.ticks?.toLocaleString() ?? '—'}</div></div>
        <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5"><div className="text-[10px] uppercase tracking-wider text-zinc-400">Tick (ms)</div><div className="mt-0.5 font-mono text-lg text-emerald-300">{d.tickDurationMs ?? '—'}</div></div>
        <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5"><div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-400"><Cpu className="h-2.5 w-2.5" />Memory</div><div className="mt-0.5 font-mono text-lg text-emerald-300">{d.memoryMB ?? '—'} MB</div></div>
        <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5"><div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-400"><HardDrive className="h-2.5 w-2.5" />DTUs</div><div className="mt-0.5 font-mono text-lg text-emerald-300">{d.dtuCount?.toLocaleString() ?? '—'}</div></div>
      </div>
      <div className="grid grid-cols-2 gap-2 text-[11px]">
        <div className="rounded border border-emerald-500/15 bg-emerald-500/5 p-2"><div className="text-[10px] uppercase tracking-wider text-zinc-400">Active users</div><div className="font-mono text-zinc-100">{d.activeUsers ?? '—'}</div></div>
        <div className="rounded border border-emerald-500/15 bg-emerald-500/5 p-2"><div className="text-[10px] uppercase tracking-wider text-zinc-400">Uptime</div><div className="font-mono text-zinc-100">{uptimeHrs}h</div></div>
      </div>
      {m.isPending && <div className="flex items-center gap-2 text-xs text-zinc-400"><Loader2 className="h-4 w-4 animate-spin" /> Polling…</div>}
    </div>
  );
}
