'use client';

import { useEffect, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Brain, Loader2, Activity, Layers, Pause } from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface AttStatus { activeThreads?: number; queueDepth?: number; backgroundJobs?: number; totalCompleted?: number; throughputPerMin?: number; [k: string]: unknown }
interface Thread { id?: string; threadId?: string; type?: string; priority?: number; description?: string; domain?: string; status?: string; createdAt?: string; startedAt?: string; durationMs?: number }

export function AttentionThreads() {
  const [tick, setTick] = useState(0);
  useEffect(() => { const id = setInterval(() => setTick((t) => t + 1), 4000); return () => clearInterval(id); }, []);
  useEffect(() => { void tick; }, [tick]);

  const status = useQuery({
    queryKey: ['attention-status'],
    queryFn: async () => (await apiHelpers.attention.status()).data as AttStatus,
    refetchInterval: 4000,
  });
  const threads = useQuery({
    queryKey: ['attention-threads'],
    queryFn: async () => {
      const r = await apiHelpers.attention.threads();
      const data = r.data as { threads?: Thread[] } | Thread[];
      return (Array.isArray(data) ? data : data.threads || []) as Thread[];
    },
    refetchInterval: 4000,
  });
  const queue = useQuery({
    queryKey: ['attention-queue'],
    queryFn: async () => {
      const r = await apiHelpers.attention.queue();
      const data = r.data as { queue?: Thread[] } | Thread[];
      return (Array.isArray(data) ? data : data.queue || []) as Thread[];
    },
    refetchInterval: 4000,
  });

  const complete = useMutation({
    mutationFn: async (threadId: string) => apiHelpers.attention.completeThread({ threadId }),
    onSuccess: () => { threads.refetch(); status.refetch(); },
  });

  const s = status.data || {};
  const tlist = threads.data || [];
  const qlist = queue.data || [];

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <Brain className="h-5 w-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">Attention allocation</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">/api/attention/* · 4s poll</span>
        </div>
        {status.data && (
          <SaveAsDtuButton
            compact
            apiSource="concord-attention"
            title={`Attention snapshot — ${new Date().toLocaleString()}`}
            content={`Active threads: ${s.activeThreads ?? '—'}\nQueue depth: ${s.queueDepth ?? '—'}\nBackground jobs: ${s.backgroundJobs ?? '—'}\nThroughput: ${s.throughputPerMin ?? '—'} /min\n\nActive (${tlist.length}):\n${tlist.slice(0, 10).map((t) => `  ${t.id || t.threadId} · ${t.type || '?'} · pri=${t.priority ?? '-'}`).join('\n')}\n\nQueued (${qlist.length}):\n${qlist.slice(0, 10).map((t) => `  ${t.id || t.threadId} · ${t.type || '?'} · pri=${t.priority ?? '-'}`).join('\n')}`}
            extraTags={['attention', 'concord']}
            rawData={{ status: s, threads: tlist, queue: qlist }}
          />
        )}
      </header>
      {status.isError && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">Attention runtime unreachable.</div>}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Cell label="Active" value={String(s.activeThreads ?? '—')} icon={Activity} />
        <Cell label="Queue" value={String(s.queueDepth ?? '—')} icon={Layers} />
        <Cell label="Background" value={String(s.backgroundJobs ?? '—')} icon={Pause} />
        <Cell label="Tput/min" value={String(s.throughputPerMin ?? '—')} />
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="rounded-md border border-zinc-800 bg-zinc-950/40 p-3">
          <div className="mb-2 flex items-center gap-1 text-xs font-semibold text-zinc-200">Active threads ({tlist.length})</div>
          <div className="space-y-1 max-h-72 overflow-y-auto">
            {tlist.map((t, i) => (
              <div key={t.id || t.threadId || i} className="flex items-center justify-between gap-2 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-[11px]">
                <div className="min-w-0">
                  <span className="font-mono text-cyan-300">{(t.id || t.threadId || '?').slice(0, 10)}</span>
                  <span className="ml-2 text-zinc-400">{t.type || '?'}</span>
                  {t.priority != null && <span className="ml-2 text-[10px] text-amber-300">p{t.priority}</span>}
                </div>
                {(t.id || t.threadId) && (
                  <button onClick={() => complete.mutate((t.id || t.threadId) as string)} className="rounded border border-cyan-500/30 bg-cyan-500/10 px-1.5 py-0.5 text-[10px] text-cyan-200">complete</button>
                )}
              </div>
            ))}
            {tlist.length === 0 && <div className="rounded border border-dashed border-zinc-800 p-3 text-center text-[10px] text-zinc-500">No active threads.</div>}
          </div>
        </div>
        <div className="rounded-md border border-zinc-800 bg-zinc-950/40 p-3">
          <div className="mb-2 flex items-center gap-1 text-xs font-semibold text-zinc-200">Queue ({qlist.length})</div>
          <div className="space-y-1 max-h-72 overflow-y-auto">
            {qlist.map((t, i) => (
              <div key={t.id || t.threadId || i} className="flex items-center justify-between rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-[11px]">
                <span className="font-mono text-zinc-300">{(t.id || t.threadId || '?').slice(0, 10)} · {t.type || '?'}</span>
                {t.priority != null && <span className="text-[10px] text-amber-300">p{t.priority}</span>}
              </div>
            ))}
            {qlist.length === 0 && <div className="rounded border border-dashed border-zinc-800 p-3 text-center text-[10px] text-zinc-500">Queue empty.</div>}
          </div>
        </div>
      </div>
      {(status.isPending || threads.isPending) && <div className="flex items-center gap-2 text-xs text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Polling…</div>}
    </div>
  );
}

function Cell({ label, value, icon: Icon }: { label: string; value: string; icon?: React.ComponentType<{ className?: string }> }) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-500">{Icon && <Icon className="h-3 w-3" />}{label}</div>
      <div className="mt-0.5 font-mono text-lg text-cyan-300">{value}</div>
    </div>
  );
}
