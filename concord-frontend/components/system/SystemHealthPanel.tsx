'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Server, Loader2, Activity, Cpu, HardDrive, Zap } from 'lucide-react';
import { api } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

// The real handler (`server.js` `app.get("/api/system/health", ...)`) nests
// everything under a `health` key and does NOT return `uptimeSec` /
// `memoryMB` / `activeUsers` / `heartbeatsOk` at all — it returns `uptime`
// (seconds), `memory: { rss, heap }` (bytes), and `sessionCount`. The
// original interface here read flat top-level fields that never existed on
// the wire, so every stat silently rendered "—" forever. (This is the same
// `/api/system/health` envelope-shape bug independently found in the
// `resonance` and `meta` lenses this wave — verified against the actual
// route handler, not assumed.)
interface Health {
  status?: string;
  uptime?: number; // seconds
  dtuCount?: number;
  sessionCount?: number;
  memory?: { rss?: number; heap?: number }; // bytes
  saveFailures?: number;
  postgres?: { connected?: boolean; status?: string };
  redis?: { connected?: boolean; status?: string };
}

export function SystemHealthPanel() {
  const [tick, setTick] = useState(0);
  useEffect(() => { const id = setInterval(() => setTick((t) => t + 1), 15000); return () => clearInterval(id); }, []);
  useEffect(() => { void tick; }, [tick]);

  const h = useQuery({
    queryKey: ['system-status'],
    queryFn: async () => {
      const r = await api.get('/api/system/health');
      return (r.data?.health || {}) as Health;
    },
    refetchInterval: 15000,
  });

  const d = h.data || {};
  const uptimeHrs = d.uptime ? (d.uptime / 3600).toFixed(1) : '—';
  const memoryMB = d.memory?.rss ? Math.round(d.memory.rss / 1048576) : undefined;
  const storageOk = d.postgres?.connected !== false && d.redis?.connected !== false;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2"><Server className="h-5 w-5 text-emerald-400" /><h2 className="text-sm font-semibold text-white">Concord system status</h2><span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">/api/system/health · live</span></div>
        {d.status && <SaveAsDtuButton compact apiSource="concord-system" title={`System status — ${d.status} · uptime ${uptimeHrs}h`} content={`Status: ${d.status}\nUptime: ${uptimeHrs}h\nMemory (RSS): ${memoryMB ?? '—'} MB\nDTUs: ${d.dtuCount ?? '—'}\nSessions: ${d.sessionCount ?? '—'}\nSave failures: ${d.saveFailures ?? 0}`} extraTags={['system', 'concord', 'health']} rawData={d as unknown as Record<string, unknown>} />}
      </header>
      {h.isError && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">/api/system/health unreachable.</div>}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5"><div className="text-[10px] uppercase tracking-wider text-zinc-400">Status</div><div className={`mt-0.5 font-mono text-lg ${d.status === 'ok' || d.status === 'healthy' || d.status === 'operational' ? 'text-emerald-300' : 'text-amber-300'}`}>{d.status || '—'}</div></div>
        <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5"><div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-400"><Zap className="h-2.5 w-2.5" />Uptime</div><div className="mt-0.5 font-mono text-lg text-emerald-300">{uptimeHrs}h</div></div>
        <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5"><div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-400"><Cpu className="h-2.5 w-2.5" />Memory (RSS)</div><div className="mt-0.5 font-mono text-lg text-emerald-300">{memoryMB ?? '—'} MB</div></div>
        <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5"><div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-400"><HardDrive className="h-2.5 w-2.5" />DTUs</div><div className="mt-0.5 font-mono text-lg text-emerald-300">{d.dtuCount?.toLocaleString() ?? '—'}</div></div>
      </div>
      <div className="grid grid-cols-2 gap-2 text-[11px]">
        <div className="rounded border border-emerald-500/15 bg-emerald-500/5 p-2"><div className="text-[10px] uppercase tracking-wider text-zinc-400">Sessions</div><div className="font-mono text-zinc-100">{d.sessionCount ?? '—'}</div></div>
        <div className="rounded border border-emerald-500/15 bg-emerald-500/5 p-2"><div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-400"><Activity className="h-2.5 w-2.5" />Storage</div><div className="font-mono text-zinc-100">{h.data ? (storageOk ? '✓ OK' : '⚠ fallback') : '—'}</div></div>
      </div>
      {h.isPending && <div className="flex items-center gap-2 text-xs text-zinc-400"><Loader2 className="h-4 w-4 animate-spin" /> Polling…</div>}
    </div>
  );
}
