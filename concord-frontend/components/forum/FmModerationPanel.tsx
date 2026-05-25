'use client';

/**
 * FmModerationPanel — the flag queue for reported content.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, ShieldAlert, Check } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Flag {
  id: string; targetType: string; targetId: string; reason: string; note: string | null; createdAt: string;
}
interface Queue { pending: Flag[]; pendingCount: number; resolvedCount: number; byReason: Record<string, number> }

const ACTIONS = [
  { id: 'dismissed', label: 'Dismiss' },
  { id: 'content_removed', label: 'Remove content' },
  { id: 'warned', label: 'Warn author' },
];

export function FmModerationPanel({ onChange }: { onChange: () => void }) {
  const [queue, setQueue] = useState<Queue | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('forum', 'flag-queue', {});
    setQueue((r.data?.result as Queue | null) || null);
    setLoading(false);
    onChange();
  }, [onChange]);

  useEffect(() => { void refresh(); }, [refresh]);

  const resolve = async (id: string, action: string) => {
    await lensRun('forum', 'flag-resolve', { id, action });
    await refresh();
  };

  if (loading || !queue) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 text-center">
          <p className="text-2xl font-bold text-orange-300">{queue.pendingCount}</p>
          <p className="text-[10px] text-zinc-400 uppercase">Pending</p>
        </div>
        <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 text-center">
          <p className="text-2xl font-bold text-zinc-100">{queue.resolvedCount}</p>
          <p className="text-[10px] text-zinc-400 uppercase">Resolved</p>
        </div>
      </div>

      <section>
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
          <ShieldAlert className="w-3.5 h-3.5 text-orange-400" /> Flag queue
        </h3>
        {queue.pending.length === 0 ? (
          <p className="text-[11px] text-zinc-400 italic py-6 text-center">No pending flags — the community is clear.</p>
        ) : (
          <ul className="space-y-2">
            {queue.pending.map((f) => (
              <li key={f.id} className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className={cn('text-[10px] uppercase px-1.5 py-0.5 rounded',
                    f.reason === 'spam' ? 'bg-rose-950 text-rose-300'
                      : f.reason === 'harassment' ? 'bg-red-950 text-red-300'
                        : 'bg-zinc-800 text-zinc-400')}>
                    {f.reason.replace(/_/g, ' ')}
                  </span>
                  <span className="text-[11px] text-zinc-400">{f.targetType}</span>
                  <span className="text-[10px] text-zinc-400 font-mono truncate flex-1">{f.targetId}</span>
                </div>
                {f.note && <p className="text-[11px] text-zinc-400 mb-2">{f.note}</p>}
                <div className="flex flex-wrap gap-1.5">
                  {ACTIONS.map((a) => (
                    <button key={a.id} type="button" onClick={() => resolve(f.id, a.id)}
                      className="flex items-center gap-1 text-[10px] px-2 py-0.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded">
                      <Check className="w-3 h-3" /> {a.label}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
