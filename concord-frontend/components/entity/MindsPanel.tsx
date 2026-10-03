'use client';

/**
 * MindsPanel — the emergent entities (ids `em_…`) the qualia engine tracks.
 * These are a different population from the world-model graph, so qualia
 * overlays bind here rather than to registry entities.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { ErrorState } from '@/components/common/EmptyState';
import { QualiaEntityPanel } from '@/components/entity/QualiaEntityPanel';

interface Mind {
  entityId: string;
  dominantOS: string | null;
  osSummaries?: Record<string, unknown> | unknown[];
  policyAlerts?: unknown[];
  activeOSCount: number;
  totalChannels: number;
  lastUpdated: string | number | null;
}

export function MindsPanel() {
  const [openId, setOpenId] = useState<string | null>(null);
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['qualia-all'],
    queryFn: () => apiHelpers.qualia.all().then((r) => r.data as { ok: boolean; entities: Mind[]; count: number }),
    refetchInterval: 10000,
  });

  if (isError) return <div className="flex justify-center p-8"><ErrorState error={(error as Error)?.message} onRetry={refetch} /></div>;
  if (isLoading) return <div className="flex items-center gap-2 text-[14px] text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading minds…</div>;

  const minds = data?.entities ?? [];
  if (minds.length === 0) {
    return (
      <div className="max-w-xl rounded-2xl border border-dashed border-white/15 p-8 text-center">
        <p className="text-[15px] text-zinc-300">No emergent minds are registered yet.</p>
        <p className="mt-1 text-[13px] text-zinc-500">They appear here as soon as the substrate spawns one.</p>
      </div>
    );
  }

  return (
    <div className="pb-24">
      <p className="mb-4 max-w-2xl text-[13px] leading-relaxed text-zinc-500">
        Emergent entities that perceive and feel through the qualia engine. Open one to see its senses, body map, presence and planetary channel.
      </p>
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {minds.map((m) => {
          const on = openId === m.entityId;
          const alerts = m.policyAlerts?.length ?? 0;
          return (
            <li key={m.entityId}>
              <button type="button" onClick={() => setOpenId(on ? null : m.entityId)} aria-pressed={on}
                className={cn('w-full rounded-2xl border bg-[#111] p-4 text-left transition-colors', on ? 'border-teal-400/50' : 'border-white/10 hover:border-white/25')}>
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-teal-400" />
                  <span className="truncate font-mono text-[13px] text-zinc-200">{m.entityId}</span>
                </div>
                <dl className="mt-3 grid grid-cols-3 gap-2 text-[12px]">
                  <div><dt className="text-zinc-500">Dominant</dt><dd className="mt-0.5 truncate text-zinc-100">{m.dominantOS || '—'}</dd></div>
                  <div><dt className="text-zinc-500">Active OS</dt><dd className="mt-0.5 tabular-nums text-zinc-100">{m.activeOSCount}</dd></div>
                  <div><dt className="text-zinc-500">Channels</dt><dd className="mt-0.5 tabular-nums text-zinc-100">{m.totalChannels}</dd></div>
                </dl>
                {alerts > 0 && <p className="mt-2.5 text-[12px] text-amber-300">{alerts} policy alert{alerts !== 1 ? 's' : ''}</p>}
                {m.lastUpdated && <p className="mt-2 text-[11px] text-zinc-600">updated {new Date(m.lastUpdated).toLocaleTimeString()}</p>}
              </button>
            </li>
          );
        })}
      </ul>

      {openId && <QualiaEntityPanel entityId={openId} entityName={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}
