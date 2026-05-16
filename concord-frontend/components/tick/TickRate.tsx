'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, Loader2, Zap, Clock } from 'lucide-react';
import { api } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface Metrics { ticks?: number; tickDurationMs?: number; uptimeSec?: number; heartbeatsOk?: boolean; }

export function TickRate() {
  const [tick, setTick] = useState(0);
  useEffect(() => { const id = setInterval(() => setTick((t) => t + 1), 15000); return () => clearInterval(id); }, []);
  useEffect(() => { void tick; }, [tick]);

  const m = useQuery({
    queryKey: ['tick-metrics'],
    queryFn: async () => {
      const r = await api.get('/api/perf/metrics');
      return (r.data || {}) as Metrics;
    },
    refetchInterval: 15000,
  });

  const d = m.data || {};
  const uptimeHrs = d.uptimeSec ? (d.uptimeSec / 3600).toFixed(1) : '—';
  const tickRate = d.uptimeSec && d.ticks ? (d.ticks / d.uptimeSec).toFixed(3) : '—';

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2"><Activity className="h-5 w-5 text-emerald-400" /><h2 className="text-sm font-semibold text-white">Heartbeat tick rate</h2><span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">/api/perf/metrics · live</span></div>
        {d.ticks != null && <SaveAsDtuButton compact apiSource="concord-tick" title={`Tick rate — ${tickRate} ticks/sec · ${d.ticks?.toLocaleString()} total`} content={`Ticks: ${d.ticks ?? '—'}\nTick duration: ${d.tickDurationMs ?? '—'} ms\nUptime: ${uptimeHrs}h\nTicks/sec: ${tickRate}\nHeartbeats: ${d.heartbeatsOk ? 'OK' : '—'}`} extraTags={['tick', 'heartbeat', 'concord']} rawData={d as unknown as Record<string, unknown>} />}
      </header>
      {m.isError && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">/api/perf/metrics unreachable.</div>}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5"><div className="text-[10px] uppercase tracking-wider text-zinc-500">Total ticks</div><div className="mt-0.5 font-mono text-lg text-emerald-300">{d.ticks?.toLocaleString() ?? '—'}</div></div>
        <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5"><div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-500"><Clock className="h-2.5 w-2.5" />Tick ms</div><div className="mt-0.5 font-mono text-lg text-emerald-300">{d.tickDurationMs ?? '—'}</div></div>
        <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5"><div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-500"><Zap className="h-2.5 w-2.5" />Rate (Hz)</div><div className="mt-0.5 font-mono text-lg text-emerald-300">{tickRate}</div></div>
        <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5"><div className="text-[10px] uppercase tracking-wider text-zinc-500">Heartbeats</div><div className="mt-0.5 font-mono text-lg text-emerald-300">{d.heartbeatsOk ? '✓' : '—'}</div></div>
      </div>
      {m.isPending && <div className="flex items-center gap-2 text-xs text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Polling…</div>}
    </div>
  );
}
