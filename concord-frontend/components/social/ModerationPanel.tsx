'use client';

/**
 * ModerationPanel — the missing "muted & blocked accounts + my reports"
 * self-service surface. `social.mute` / `social.block` / `social.report`
 * were only reachable one-way from PostCard's post-menu (mute this
 * person, block this person, report this post) — there was nowhere to
 * see or undo any of it afterward, and `social.moderationStatus`
 * (returns the viewer's own muted/blocked ids + filed reports) had zero
 * callers anywhere in the frontend. Every real messaging/social product
 * (X, Instagram, Discord) ships a "Blocked accounts" settings surface;
 * this is that surface for Concord's social lens.
 *
 * No fake data — empty columns say so plainly. Unmute/unblock reuse the
 * existing toggle macros (`mute`/`block` accept an explicit
 * `muted`/`blocked` override) so this is a real two-way management UI,
 * not a read-only list.
 */

import { useCallback, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Shield, VolumeX, Ban, Flag, Loader2, X } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { UserLink } from './UserLink';

interface ModerationReport {
  id: string;
  targetKind: 'post' | 'user';
  targetId: string;
  reason: string;
  detail: string;
  status: string;
  createdAt: string;
}
interface ModerationStatusResult {
  muted: string[];
  blocked: string[];
  reports: ModerationReport[];
  reportCount: number;
}

export function ModerationPanel({ className }: { className?: string }) {
  const [pending, setPending] = useState<string | null>(null);

  const { data, isLoading, error, refetch } = useQuery<ModerationStatusResult | null>({
    queryKey: ['social-moderation-status'],
    queryFn: async () => {
      const r = await lensRun<ModerationStatusResult>('social', 'moderationStatus', {});
      return r.data?.ok ? r.data.result ?? null : null;
    },
    staleTime: 15_000,
  });

  const unmute = useCallback(async (userId: string) => {
    setPending(`mute:${userId}`);
    const r = await lensRun('social', 'mute', { userId, muted: false });
    setPending(null);
    if (r.data?.ok) refetch();
  }, [refetch]);

  const unblock = useCallback(async (userId: string) => {
    setPending(`block:${userId}`);
    const r = await lensRun('social', 'block', { userId, blocked: false });
    setPending(null);
    if (r.data?.ok) refetch();
  }, [refetch]);

  if (isLoading) {
    return (
      <div className={cn('flex items-center gap-2 px-4 py-8 text-sm text-zinc-400', className)}>
        <Loader2 className="w-4 h-4 animate-spin" /> Loading moderation status…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className={cn('rounded-lg border border-zinc-800 bg-zinc-950/60 p-8 text-center', className)}>
        <Shield className="w-8 h-8 text-zinc-700 mx-auto mb-2" />
        <p className="text-sm text-zinc-300">Couldn’t load your moderation status right now.</p>
      </div>
    );
  }

  const { muted, blocked, reports } = data;

  return (
    <div className={cn('space-y-4', className)}>
      <div className="flex items-center gap-2 text-xs text-zinc-400">
        <Shield className="w-3.5 h-3.5 text-indigo-300" />
        <span>Muted and blocked accounts stay private to you — nobody is notified.</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <section className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
          <header className="flex items-center gap-1.5 mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
            <VolumeX className="w-3.5 h-3.5" /> Muted ({muted.length})
          </header>
          {muted.length === 0 ? (
            <p className="text-xs text-zinc-500 italic py-2">You haven’t muted anyone.</p>
          ) : (
            <ul className="space-y-1.5">
              {muted.map((userId) => (
                <li key={userId} className="flex items-center justify-between gap-2 text-xs">
                  <UserLink userId={userId} tone="muted" />
                  <button
                    type="button"
                    onClick={() => void unmute(userId)}
                    disabled={pending === `mute:${userId}`}
                    className="flex items-center gap-1 rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-400 hover:border-indigo-500/40 hover:text-indigo-300 disabled:opacity-40"
                  >
                    {pending === `mute:${userId}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <X className="w-3 h-3" />}
                    Unmute
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
          <header className="flex items-center gap-1.5 mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
            <Ban className="w-3.5 h-3.5" /> Blocked ({blocked.length})
          </header>
          {blocked.length === 0 ? (
            <p className="text-xs text-zinc-500 italic py-2">You haven’t blocked anyone.</p>
          ) : (
            <ul className="space-y-1.5">
              {blocked.map((userId) => (
                <li key={userId} className="flex items-center justify-between gap-2 text-xs">
                  <UserLink userId={userId} tone="muted" />
                  <button
                    type="button"
                    onClick={() => void unblock(userId)}
                    disabled={pending === `block:${userId}`}
                    className="flex items-center gap-1 rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-400 hover:border-rose-500/40 hover:text-rose-300 disabled:opacity-40"
                  >
                    {pending === `block:${userId}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <X className="w-3 h-3" />}
                    Unblock
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
        <header className="flex items-center gap-1.5 mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
          <Flag className="w-3.5 h-3.5" /> Reports you’ve filed ({reports.length})
        </header>
        {reports.length === 0 ? (
          <p className="text-xs text-zinc-500 italic py-2">You haven’t reported anything.</p>
        ) : (
          <ul className="space-y-1.5">
            {reports.map((r) => (
              <li key={r.id} className="flex items-center gap-2 rounded border border-zinc-800 bg-zinc-900/40 px-2 py-1.5 text-[11px]">
                <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase text-zinc-400">{r.targetKind}</span>
                <span className="font-mono text-zinc-300">{r.targetId.slice(0, 16)}</span>
                <span className="capitalize text-rose-300">{r.reason}</span>
                <span className="ml-auto text-[10px] text-zinc-500">{r.status}</span>
                <span className="text-[10px] text-zinc-500">
                  {new Date(r.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export default ModerationPanel;
