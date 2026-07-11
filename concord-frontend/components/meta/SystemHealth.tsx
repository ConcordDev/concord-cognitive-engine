'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, Loader2, Cpu, HardDrive, Zap, Database, Server, AlertTriangle, TrendingUp } from 'lucide-react';
import { api } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';
import { cn } from '@/lib/utils';

// Real shape of GET /api/system/health (server.js) — health is nested one
// level under the envelope, not flat. A prior version of this widget read
// flat `status`/`uptimeSec`/`memoryMB`/`activeUsers`/`ticksTotal`/`heartbeatsOk`
// keys that never existed at this level, so every tile silently rendered "—"
// (Wave 3 audit, 2026-07-11). Don't flatten the fetch back out.
interface BrainEntry {
  enabled: boolean;
  model?: string;
  role?: string;
  avgResponseMs?: number;
}
interface Health {
  status?: string;
  uptime?: number; // seconds
  dtuCount?: number;
  sessionCount?: number;
  memory?: { rss?: number; heap?: number }; // bytes
  brains?: { mode?: string; onlineCount?: number; brains?: Record<string, BrainEntry> };
  postgres?: { connected?: boolean; status?: string };
  redis?: { connected?: boolean; status?: string };
  saveFailures?: number;
  growth?: { dtusLast24h?: number; dtusLast7d?: number };
}

const bytesToMB = (b?: number) => (typeof b === 'number' ? Math.round(b / (1024 * 1024)) : undefined);

export function SystemHealth() {
  const [tick, setTick] = useState(0);
  useEffect(() => { const id = setInterval(() => setTick((t) => t + 1), 15000); return () => clearInterval(id); }, []);
  useEffect(() => { void tick; }, [tick]);

  const h = useQuery({
    queryKey: ['system-health'],
    queryFn: async () => {
      const r = await api.get('/api/system/health');
      return (r.data?.health || {}) as Health;
    },
    refetchInterval: 15000,
  });

  const d = h.data || {};
  const uptimeHrs = typeof d.uptime === 'number' ? (d.uptime / 3600).toFixed(1) : '—';
  const memMB = bytesToMB(d.memory?.heap);
  const brainList = Object.entries(d.brains?.brains || {});

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2"><Activity className="h-5 w-5 text-emerald-400" /><h2 className="text-sm font-semibold text-white">Concord system vitals</h2><span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">/api/system/health · live</span></div>
        {d.status && <SaveAsDtuButton compact apiSource="concord-system-health" title={`System vitals — ${d.status} · uptime ${uptimeHrs}h`} content={`Status: ${d.status}\nUptime: ${uptimeHrs}h\nHeap: ${memMB ?? '—'} MB\nDTU count: ${d.dtuCount ?? '—'}\nActive sessions: ${d.sessionCount ?? '—'}\nBrains online: ${d.brains?.onlineCount ?? '—'}/5 (${d.brains?.mode ?? '—'})\nPostgres: ${d.postgres?.status ?? '—'}\nRedis: ${d.redis?.status ?? '—'}\nSave failures: ${d.saveFailures ?? 0}\nDTUs last 24h: ${d.growth?.dtusLast24h ?? '—'}\nDTUs last 7d: ${d.growth?.dtusLast7d ?? '—'}`} extraTags={['meta', 'system-health', 'concord']} rawData={d as unknown as Record<string, unknown>} />}
      </header>
      {h.isError && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">/api/system/health unreachable.</div>}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5"><div className="text-[10px] uppercase tracking-wider text-zinc-400">Status</div><div className={`mt-0.5 font-mono text-lg ${d.status === 'operational' || d.status === 'ok' || d.status === 'healthy' ? 'text-emerald-300' : 'text-amber-300'}`}>{d.status || '—'}</div></div>
        <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5"><div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-400"><Zap className="h-2.5 w-2.5" />Uptime</div><div className="mt-0.5 font-mono text-lg text-emerald-300">{uptimeHrs}h</div></div>
        <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5"><div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-400"><Cpu className="h-2.5 w-2.5" />Heap</div><div className="mt-0.5 font-mono text-lg text-emerald-300">{memMB ?? '—'} MB</div></div>
        <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5"><div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-400"><HardDrive className="h-2.5 w-2.5" />DTUs</div><div className="mt-0.5 font-mono text-lg text-emerald-300">{d.dtuCount?.toLocaleString() ?? '—'}</div></div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-4">
        <div className="rounded border border-emerald-500/15 bg-emerald-500/5 p-2"><div className="text-[10px] uppercase tracking-wider text-zinc-400">Active sessions</div><div className="font-mono text-zinc-100">{d.sessionCount ?? '—'}</div></div>
        <div className="rounded border border-emerald-500/15 bg-emerald-500/5 p-2 flex items-center gap-1.5"><Database className="h-3 w-3 text-zinc-500" /><div><div className="text-[10px] uppercase tracking-wider text-zinc-400">Postgres</div><div className={cn('font-mono', d.postgres?.connected ? 'text-emerald-300' : 'text-zinc-400')}>{d.postgres?.status ?? '—'}</div></div></div>
        <div className="rounded border border-emerald-500/15 bg-emerald-500/5 p-2 flex items-center gap-1.5"><Server className="h-3 w-3 text-zinc-500" /><div><div className="text-[10px] uppercase tracking-wider text-zinc-400">Redis</div><div className={cn('font-mono', d.redis?.connected ? 'text-emerald-300' : 'text-zinc-400')}>{d.redis?.status ?? '—'}</div></div></div>
        <div className={cn('rounded border p-2 flex items-center gap-1.5', (d.saveFailures ?? 0) > 0 ? 'border-rose-500/30 bg-rose-500/10' : 'border-emerald-500/15 bg-emerald-500/5')}>
          <AlertTriangle className={cn('h-3 w-3', (d.saveFailures ?? 0) > 0 ? 'text-rose-400' : 'text-zinc-500')} />
          <div><div className="text-[10px] uppercase tracking-wider text-zinc-400">Save failures</div><div className={cn('font-mono', (d.saveFailures ?? 0) > 0 ? 'text-rose-300' : 'text-zinc-100')}>{d.saveFailures ?? 0}</div></div>
        </div>
      </div>

      {(d.growth?.dtusLast24h !== undefined || d.growth?.dtusLast7d !== undefined) && (
        <div className="flex items-center gap-4 rounded border border-zinc-800 bg-zinc-950 px-3 py-2 text-[11px] text-zinc-300">
          <TrendingUp className="h-3.5 w-3.5 text-neon-cyan" />
          <span>DTU growth: <span className="font-mono text-emerald-300">+{d.growth?.dtusLast24h ?? 0}</span> last 24h &middot; <span className="font-mono text-emerald-300">+{d.growth?.dtusLast7d ?? 0}</span> last 7d</span>
        </div>
      )}

      {brainList.length > 0 && (
        <div>
          <p className="mb-1.5 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-zinc-400">
            Five-brain fleet &middot; {d.brains?.onlineCount ?? 0}/5 online &middot; {d.brains?.mode ?? 'unknown'}
          </p>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-5">
            {brainList.map(([name, b]) => (
              <div
                key={name}
                className={cn(
                  'rounded border px-2 py-1.5 text-[11px]',
                  b.enabled ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-zinc-800 bg-zinc-950',
                )}
                title={b.model ? `${b.model} · ${b.role ?? ''}` : undefined}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="font-mono capitalize text-zinc-200">{name}</span>
                  <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', b.enabled ? 'bg-emerald-400' : 'bg-zinc-600')} />
                </div>
                <div className="mt-0.5 truncate text-zinc-500">{b.enabled ? `${b.avgResponseMs ?? 0}ms avg` : 'offline'}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {h.isPending && <div className="flex items-center gap-2 text-xs text-zinc-400"><Loader2 className="h-4 w-4 animate-spin" /> Polling…</div>}
    </div>
  );
}
