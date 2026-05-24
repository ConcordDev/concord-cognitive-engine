'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Radio, Loader2, Activity, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { api, apiHelpers } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface Health { ok?: boolean; uptimeSec?: number; heartbeatCount?: number; ticksPerMin?: number; activeUsers?: number; activeSessions?: number; [k: string]: unknown }
interface Perf { eventLoop?: { lagMs: number }; memory?: { rssMb: number; heapUsedMb: number }; [k: string]: unknown }
interface Status { status?: string; [k: string]: unknown }

export function ConcordVitals() {
  const [tick, setTick] = useState(0);
  useEffect(() => { const id = setInterval(() => setTick((t) => t + 1), 5000); return () => clearInterval(id); }, []);
  useEffect(() => { void tick; }, [tick]);

  const health = useQuery({
    queryKey: ['cc-health'],
    queryFn: async () => (await apiHelpers.guidance.health()).data as Health,
    refetchInterval: 5000,
  });
  const perf = useQuery({
    queryKey: ['cc-perf'],
    queryFn: async () => (await apiHelpers.perf.metrics()).data as Perf,
    refetchInterval: 5000,
  });
  const econ = useQuery({
    queryKey: ['cc-econ-status'],
    queryFn: async () => (await api.get('/api/economy/status')).data as Status,
    refetchInterval: 30000,
  });

  const h = health.data || {};
  const p = perf.data || {};
  const e = econ.data || {};
  const lag = p.eventLoop?.lagMs ?? 0;
  const overall = (h.ok !== false) && lag < 200 ? 'green' : lag > 500 ? 'red' : 'amber';
  const ringClass = overall === 'green' ? 'bg-emerald-400' : overall === 'red' ? 'bg-red-400' : 'bg-amber-400';

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <Radio className="h-5 w-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">Concord vitals</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">/api/system + perf + economy · 5s poll</span>
          <span className={`h-2 w-2 rounded-full ${ringClass} animate-pulse`} />
        </div>
        {health.data && (
          <SaveAsDtuButton
            compact
            apiSource="concord-vitals"
            title={`Vitals snapshot — ${new Date().toLocaleString()} (${overall.toUpperCase()})`}
            content={`Overall: ${overall.toUpperCase()}\nUptime sec: ${h.uptimeSec ?? '—'}\nHeartbeats: ${h.heartbeatCount ?? '—'} · ticks/min: ${h.ticksPerMin ?? '—'}\nActive users: ${h.activeUsers ?? '—'}\nActive sessions: ${h.activeSessions ?? '—'}\nEvent loop lag: ${lag.toFixed?.(1) ?? lag} ms\nMemory RSS: ${p.memory?.rssMb?.toFixed(0) ?? '—'} MB\nEconomy: ${e.status || '—'}`}
            extraTags={['command-center', 'vitals', 'concord']}
            rawData={{ health: h, perf: p, econ: e }}
          />
        )}
      </header>
      {(health.isError || perf.isError) && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">Concord runtime unreachable.</div>}
      <div className="grid grid-cols-3 gap-2">
        <div className={`rounded-lg border p-3 ${overall === 'green' ? 'border-emerald-500/30 bg-emerald-500/5' : overall === 'red' ? 'border-red-500/30 bg-red-500/5' : 'border-amber-500/30 bg-amber-500/5'}`}>
          <div className="flex items-center gap-2">
            {overall === 'green' ? <CheckCircle2 className="h-5 w-5 text-emerald-300" /> : overall === 'red' ? <AlertTriangle className="h-5 w-5 text-red-300" /> : <AlertTriangle className="h-5 w-5 text-amber-300" />}
            <div>
              <div className={`text-lg font-semibold ${overall === 'green' ? 'text-emerald-200' : overall === 'red' ? 'text-red-200' : 'text-amber-200'}`}>{overall.toUpperCase()}</div>
              <div className="text-[10px] text-zinc-400">substrate status</div>
            </div>
          </div>
        </div>
        <Cell label="Uptime" value={h.uptimeSec ? `${Math.floor(h.uptimeSec / 3600)}h` : '—'} />
        <Cell label="Loop lag" value={`${(p.eventLoop?.lagMs ?? 0).toFixed(0)}ms`} />
        <Cell label="Heartbeats" value={String(h.heartbeatCount ?? '—')} icon={Activity} />
        <Cell label="Ticks/min" value={String(h.ticksPerMin ?? '—')} />
        <Cell label="RSS" value={p.memory?.rssMb ? `${p.memory.rssMb.toFixed(0)}MB` : '—'} />
        <Cell label="Active users" value={String(h.activeUsers ?? '—')} />
        <Cell label="Sessions" value={String(h.activeSessions ?? '—')} />
        <Cell label="Economy" value={e.status || '—'} />
      </div>
      {(health.isPending || perf.isPending) && <div className="flex items-center gap-2 text-xs text-zinc-400"><Loader2 className="h-4 w-4 animate-spin" /> Polling…</div>}
    </div>
  );
}

function Cell({ label, value, icon: Icon }: { label: string; value: string; icon?: React.ComponentType<{ className?: string }> }) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-400">{Icon && <Icon className="h-3 w-3" />}{label}</div>
      <div className="mt-0.5 font-mono text-lg text-cyan-300">{value}</div>
    </div>
  );
}
