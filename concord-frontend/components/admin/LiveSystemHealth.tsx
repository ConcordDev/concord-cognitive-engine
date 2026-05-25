'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, Loader2, Cpu, MemoryStick, Network, Heart } from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface HealthDoc { ok?: boolean; uptimeSec?: number; heartbeatCount?: number; ticksPerMin?: number; memoryMb?: number; rssMb?: number; brains?: Record<string, { ok: boolean; latencyMs?: number }>; [k: string]: unknown }
interface PerfDoc { memory?: { heapUsedMb: number; heapTotalMb: number; rssMb: number; externalMb?: number }; cpu?: { userPct: number; sysPct: number }; eventLoop?: { lagMs: number }; uptimeSec?: number; [k: string]: unknown }

export function LiveSystemHealth() {
  const [tick, setTick] = useState(0);

  const health = useQuery({
    queryKey: ['admin-system-health'],
    queryFn: async () => (await apiHelpers.guidance.health()).data as HealthDoc,
    refetchInterval: 5000,
  });
  const perf = useQuery({
    queryKey: ['admin-perf-metrics'],
    queryFn: async () => (await apiHelpers.perf.metrics()).data as PerfDoc,
    refetchInterval: 5000,
  });

  useEffect(() => { const id = setInterval(() => setTick((t) => t + 1), 1000); return () => clearInterval(id); }, []);
  useEffect(() => { void tick; }, [tick]);

  const h = health.data || {};
  const p = perf.data || {};
  const ready = !health.isPending && !perf.isPending;
  const isHealthy = h.ok !== false && (p.eventLoop?.lagMs ?? 0) < 200;

  const fmtMb = (v?: number) => v != null ? `${v.toFixed(0)} MB` : '—';
  const fmtUptime = (s?: number) => {
    if (s == null) return '—';
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    return d > 0 ? `${d}d ${h}h ${m}m` : `${h}h ${m}m`;
  };

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">Live system health</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">/api/system/health · /api/perf/metrics · 5s poll</span>
          <span className={`h-2 w-2 rounded-full ${isHealthy ? 'bg-emerald-400' : 'bg-amber-400'} animate-pulse`} />
        </div>
        {ready && (
          <SaveAsDtuButton
            compact
            apiSource="concord-system-health"
            title={`Concord system health — ${new Date().toLocaleString()}`}
            content={`uptime: ${fmtUptime(h.uptimeSec ?? p.uptimeSec)}\nheartbeats: ${h.heartbeatCount ?? '—'} (${h.ticksPerMin ?? '—'} ticks/min)\nrss: ${fmtMb(p.memory?.rssMb)}\nheap used: ${fmtMb(p.memory?.heapUsedMb)} / ${fmtMb(p.memory?.heapTotalMb)}\nevent-loop lag: ${p.eventLoop?.lagMs?.toFixed(1) ?? '—'} ms\ncpu user/sys: ${p.cpu?.userPct?.toFixed(1) ?? '—'}% / ${p.cpu?.sysPct?.toFixed(1) ?? '—'}%\n\nBrains:\n${Object.entries(h.brains || {}).map(([k, v]) => `  ${k}: ${v.ok ? 'ok' : 'down'}${v.latencyMs != null ? ` (${v.latencyMs}ms)` : ''}`).join('\n') || '  (none reported)'}`}
            extraTags={['admin', 'system-health', 'concord']}
            rawData={{ health: h, perf: p }}
          />
        )}
      </header>

      {(health.isError || perf.isError) && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">Failed to reach Concord runtime — server may be down.</div>}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Cell label="Uptime" value={fmtUptime(h.uptimeSec ?? p.uptimeSec)} icon={Heart} />
        <Cell label="Heartbeats" value={`${h.heartbeatCount ?? '—'}${h.ticksPerMin != null ? ` · ${h.ticksPerMin}/min` : ''}`} icon={Activity} />
        <Cell label="RSS" value={fmtMb(p.memory?.rssMb)} icon={MemoryStick} />
        <Cell label="Heap used" value={`${fmtMb(p.memory?.heapUsedMb)} / ${fmtMb(p.memory?.heapTotalMb)}`} icon={MemoryStick} />
        <Cell label="Event loop lag" value={p.eventLoop?.lagMs != null ? `${p.eventLoop.lagMs.toFixed(1)} ms` : '—'} icon={Network} />
        <Cell label="CPU user" value={p.cpu?.userPct != null ? `${p.cpu.userPct.toFixed(1)}%` : '—'} icon={Cpu} />
        <Cell label="CPU sys" value={p.cpu?.sysPct != null ? `${p.cpu.sysPct.toFixed(1)}%` : '—'} icon={Cpu} />
        <Cell label="Brains up" value={`${Object.values(h.brains || {}).filter((b) => b.ok).length} / ${Object.keys(h.brains || {}).length}`} icon={Activity} />
      </div>

      {h.brains && Object.keys(h.brains).length > 0 && (
        <div className="rounded-md border border-zinc-800 bg-zinc-950/40 p-3">
          <div className="mb-2 text-xs font-semibold text-zinc-200">Brain pool</div>
          <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
            {Object.entries(h.brains).map(([k, v]) => (
              <div key={k} className="flex items-center justify-between rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-[11px]">
                <span className="font-mono text-zinc-300">{k}</span>
                <span className={`font-mono ${v.ok ? 'text-emerald-300' : 'text-red-300'}`}>{v.ok ? 'ok' : 'down'}{v.latencyMs != null ? ` · ${v.latencyMs}ms` : ''}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {!ready && <div className="flex items-center gap-2 text-xs text-zinc-400"><Loader2 className="h-4 w-4 animate-spin" /> Polling runtime…</div>}
    </div>
  );
}

function Cell({ label, value, icon: Icon }: { label: string; value: string; icon?: React.ComponentType<{ className?: string }> }) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-400">{Icon && <Icon className="h-3 w-3" />}{label}</div>
      <div className="mt-0.5 font-mono text-sm text-cyan-300">{value}</div>
    </div>
  );
}
