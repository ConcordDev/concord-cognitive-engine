'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Settings, Loader2, Activity, Cpu } from 'lucide-react';
import { api } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface Health { status?: string; uptimeSec?: number; memoryMB?: number; dtuCount?: number; activeUsers?: number; }

export function SettingsHealth() {
  const [tick, setTick] = useState(0);
  useEffect(() => { const id = setInterval(() => setTick((t) => t + 1), 30000); return () => clearInterval(id); }, []);
  useEffect(() => { void tick; }, [tick]);

  const h = useQuery({
    queryKey: ['settings-health'],
    queryFn: async () => {
      const r = await api.get('/api/system/health');
      return (r.data || {}) as Health;
    },
    refetchInterval: 30000,
  });

  const d = h.data || {};
  const uptimeHrs = d.uptimeSec ? (d.uptimeSec / 3600).toFixed(1) : '—';

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2"><Settings className="h-5 w-5 text-zinc-300" /><h2 className="text-sm font-semibold text-white">Concord runtime status</h2><span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">/api/system/health · live</span></div>
        {d.status && <SaveAsDtuButton compact apiSource="concord-settings-health" title={`Concord runtime — ${d.status} · uptime ${uptimeHrs}h`} content={`Status: ${d.status}\nUptime: ${uptimeHrs}h\nMemory: ${d.memoryMB ?? '—'} MB\nDTUs: ${d.dtuCount ?? '—'}\nActive users: ${d.activeUsers ?? '—'}`} extraTags={['settings', 'system-health', 'concord']} rawData={d as unknown as Record<string, unknown>} />}
      </header>
      {h.isError && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">/api/system/health unreachable.</div>}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5"><div className="text-[10px] uppercase tracking-wider text-zinc-400">Status</div><div className={`mt-0.5 font-mono text-lg ${d.status === 'ok' || d.status === 'healthy' ? 'text-emerald-300' : 'text-amber-300'}`}>{d.status || '—'}</div></div>
        <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5"><div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-400"><Activity className="h-2.5 w-2.5" />Uptime</div><div className="mt-0.5 font-mono text-lg text-zinc-200">{uptimeHrs}h</div></div>
        <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5"><div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-400"><Cpu className="h-2.5 w-2.5" />Memory</div><div className="mt-0.5 font-mono text-lg text-zinc-200">{d.memoryMB ?? '—'} MB</div></div>
        <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5"><div className="text-[10px] uppercase tracking-wider text-zinc-400">DTUs</div><div className="mt-0.5 font-mono text-lg text-zinc-200">{d.dtuCount?.toLocaleString() ?? '—'}</div></div>
      </div>
      {h.isPending && <div className="flex items-center gap-2 text-xs text-zinc-400"><Loader2 className="h-4 w-4 animate-spin" /> Polling…</div>}
    </div>
  );
}
