'use client';

/**
 * ModerationQueue — community moderation surface. Lists pending flags
 * and close-vote-pending questions, lets a moderator (1000+ rep) action
 * or decline each flag. Wires answers.mod-queue + answers.mod-resolve.
 */

import { useCallback, useEffect, useState } from 'react';
import { ShieldAlert, Loader2, Check, X, Flag } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface QueueItem {
  id: string;
  kind?: string;
  reason: string;
  note?: string;
  questionId: string;
  questionTitle: string;
  answerId: string | null;
  status: string;
  excerpt?: string;
  flaggedBy?: string;
  closeVotes?: number;
  threshold?: number;
  createdAt: string;
}

export function ModerationQueue({ onResolved }: { onResolved?: () => void }) {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [gateError, setGateError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('answers', 'mod-queue', {});
    if (r.data?.ok) {
      setItems((r.data.result?.queue as QueueItem[]) || []);
      setGateError('');
    } else {
      setGateError(r.data?.error || 'Moderation queue unavailable.');
      setItems([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function resolve(item: QueueItem, decision: 'actioned' | 'declined') {
    if (item.kind === 'close-vote-pending') return;
    setBusy(item.id);
    const r = await lensRun('answers', 'mod-resolve', {
      questionId: item.questionId,
      answerId: item.answerId || undefined,
      flagId: item.id,
      decision,
    });
    setBusy(null);
    if (r.data?.ok) {
      await load();
      onResolved?.();
    } else {
      setGateError(r.data?.error || 'Could not resolve flag.');
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <ShieldAlert className="w-4 h-4 text-orange-400" />
        <h4 className="text-sm font-semibold text-zinc-200">Moderation queue</h4>
        <span className="text-[11px] text-zinc-500">{items.length} pending</span>
      </div>

      {gateError && (
        <p className="text-[12px] text-amber-400 border border-amber-900/40 bg-amber-950/20 rounded px-3 py-2">
          {gateError}
        </p>
      )}

      {loading ? (
        <div className="flex justify-center py-6"><Loader2 className="w-4 h-4 animate-spin text-zinc-500" /></div>
      ) : !gateError && items.length === 0 ? (
        <p className="text-xs text-zinc-500 italic py-4 text-center">No data yet — queue is clear.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.id} className="rounded border border-zinc-800 bg-zinc-900/50 p-2.5">
              <div className="flex items-center gap-1.5 text-[11px]">
                <Flag className="w-3 h-3 text-rose-400" />
                <span className="px-1.5 py-0.5 rounded bg-rose-900/40 text-rose-300">{item.reason}</span>
                {item.kind === 'close-vote-pending' && (
                  <span className="px-1.5 py-0.5 rounded bg-amber-900/40 text-amber-300">
                    close-vote {item.closeVotes}/{item.threshold}
                  </span>
                )}
                <span className="ml-auto text-zinc-600">{new Date(item.createdAt).toLocaleDateString()}</span>
              </div>
              <p className="text-[12px] text-zinc-300 mt-1 font-medium">{item.questionTitle}</p>
              {item.excerpt && <p className="text-[11px] text-zinc-500 mt-0.5 line-clamp-2">{item.excerpt}</p>}
              {item.note && <p className="text-[11px] text-zinc-400 mt-0.5 italic">&ldquo;{item.note}&rdquo;</p>}
              {item.kind !== 'close-vote-pending' && (
                <div className="flex gap-1.5 mt-2">
                  <button
                    onClick={() => resolve(item, 'actioned')}
                    disabled={busy === item.id}
                    className="px-2 py-1 text-[11px] rounded bg-emerald-700 hover:bg-emerald-600 text-white inline-flex items-center gap-1 disabled:opacity-40"
                  >
                    <Check className="w-3 h-3" />Action
                  </button>
                  <button
                    onClick={() => resolve(item, 'declined')}
                    disabled={busy === item.id}
                    className="px-2 py-1 text-[11px] rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-100 inline-flex items-center gap-1 disabled:opacity-40"
                  >
                    <X className="w-3 h-3" />Decline
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
