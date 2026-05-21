'use client';

/**
 * MeshQueue — store-and-forward queue management. Lists frames from
 * `mesh.queueList`, lets the operator retry (`mesh.queueRetry`),
 * re-prioritize (`mesh.queuePrioritize`) or drop (`mesh.queueDrop`)
 * each frame. Frames land here when a message is sent to an offline
 * node — they are delivered automatically once the node reappears.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import { Loader2, RotateCw, Trash2, Inbox } from 'lucide-react';

interface Frame {
  id: string;
  messageId: string;
  to: string;
  toName: string;
  sizeBytes: number;
  priority: 'threat' | 'economic' | 'consciousness' | 'knowledge' | 'general';
  attempts: number;
  state: string;
  queuedAt: string;
}

const PRIORITIES: Frame['priority'][] = ['threat', 'economic', 'consciousness', 'knowledge', 'general'];
const PRIORITY_TONE: Record<string, string> = {
  threat: 'bg-rose-900/50 text-rose-200',
  economic: 'bg-amber-900/50 text-amber-200',
  consciousness: 'bg-violet-900/50 text-violet-200',
  knowledge: 'bg-sky-900/50 text-sky-200',
  general: 'bg-teal-900/50 text-teal-300',
};

export function MeshQueue() {
  const qc = useQueryClient();

  const queue = useQuery({
    queryKey: ['mesh-queue'],
    queryFn: async () => {
      const r = await apiHelpers.lens.runDomain('mesh', 'queueList', {});
      return (r.data?.result ?? r.data) as { frames: Frame[]; total: number; pending: number; totalBytes: number };
    },
    refetchInterval: 15_000,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['mesh-queue'] });
    qc.invalidateQueries({ queryKey: ['mesh-overview'] });
  };

  const retry = useMutation({
    mutationFn: async (frameId: string) => (await apiHelpers.lens.runDomain('mesh', 'queueRetry', { frameId })).data?.result,
    onSuccess: invalidate,
  });
  const prioritize = useMutation({
    mutationFn: async (v: { frameId: string; priority: string }) =>
      (await apiHelpers.lens.runDomain('mesh', 'queuePrioritize', v)).data?.result,
    onSuccess: invalidate,
  });
  const drop = useMutation({
    mutationFn: async (frameId: string) => (await apiHelpers.lens.runDomain('mesh', 'queueDrop', { frameId })).data?.result,
    onSuccess: invalidate,
  });

  const frames = queue.data?.frames ?? [];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Frames" value={queue.data?.total ?? 0} />
        <Stat label="Pending" value={queue.data?.pending ?? 0} />
        <Stat label="Queued bytes" value={`${queue.data?.totalBytes ?? 0} B`} />
      </div>

      {queue.isLoading ? (
        <Loader2 className="h-4 w-4 animate-spin text-teal-500" />
      ) : frames.length === 0 ? (
        <p className="flex items-center justify-center gap-2 rounded border border-teal-900/30 bg-teal-950/10 px-4 py-8 text-xs text-teal-600">
          <Inbox className="h-4 w-4" /> Store-and-forward queue is empty.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {frames.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center gap-2 rounded border border-teal-900/30 bg-teal-950/10 px-3 py-2 text-xs">
              <span className={`rounded px-1.5 py-0.5 text-[10px] ${PRIORITY_TONE[f.priority]}`}>{f.priority}</span>
              <span className="font-mono text-teal-200">→ {f.toName}</span>
              <span className="text-[10px] text-teal-700">{f.sizeBytes} B · {f.attempts} attempt{f.attempts !== 1 ? 's' : ''}</span>
              <span className="rounded bg-teal-900/40 px-1.5 py-0.5 text-[10px] text-teal-400">{f.state}</span>
              <span className="ml-auto flex items-center gap-1.5">
                <select
                  value={f.priority}
                  onChange={(e) => prioritize.mutate({ frameId: f.id, priority: e.target.value })}
                  aria-label={`Priority for frame to ${f.toName}`}
                  className="rounded border border-teal-900/50 bg-black px-1.5 py-1 text-[10px] text-teal-200 focus:outline-none focus:ring-2 focus:ring-teal-400"
                >
                  {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
                <button
                  onClick={() => retry.mutate(f.id)}
                  disabled={retry.isPending}
                  className="rounded p-1 text-teal-300 hover:bg-teal-900/40 disabled:opacity-40"
                  aria-label={`Retry frame to ${f.toName}`}
                >
                  <RotateCw className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => drop.mutate(f.id)}
                  disabled={drop.isPending}
                  className="rounded p-1 text-rose-400 hover:bg-rose-950/40 disabled:opacity-40"
                  aria-label={`Drop frame to ${f.toName}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border border-teal-900/40 bg-teal-950/10 p-2.5 text-teal-200">
      <div className="mb-0.5 text-[10px] uppercase tracking-wider text-teal-700">{label}</div>
      <div className="font-mono text-lg font-semibold">{value}</div>
    </div>
  );
}
