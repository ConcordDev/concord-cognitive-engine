'use client';

/**
 * FollowButton — toggle following another user. Drop-in for any
 * surface that shows another user's identity (UserLink hover-card,
 * user profile header, suggested-follows row, etc.).
 *
 * Phase 10h: backend has POST /api/social/follow + /unfollow + GET
 * /api/social/following/:userId; no first-class follow button before
 * now.
 *
 *   <FollowButton targetUserId="u_abc" currentUserId="u_xyz" />
 *
 * Honest: when the user tries to follow themself the button hides.
 * Optimistic UI; rolls back on failure.
 */

import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UserPlus, UserCheck, Loader2 } from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface FollowingResponse {
  ok: boolean;
  following?: Array<{ userId: string }>;
}

export interface FollowButtonProps {
  targetUserId: string;
  currentUserId?: string | null;
  /** Compact icon-only chip. Default false (shows label). */
  compact?: boolean;
  className?: string;
}

export function FollowButton({ targetUserId, currentUserId, compact = false, className }: FollowButtonProps) {
  const queryClient = useQueryClient();
  const [optimistic, setOptimistic] = useState<boolean | null>(null);

  const isSelf = !!currentUserId && currentUserId === targetUserId;

  const { data } = useQuery<FollowingResponse | null>({
    queryKey: ['social-following', currentUserId],
    queryFn: async () => {
      if (!currentUserId) return null;
      try { const r = await api.get<FollowingResponse>(`/api/social/following/${encodeURIComponent(currentUserId)}`); return r?.data; }
      catch { return null; }
    },
    enabled: !!currentUserId && !isSelf,
    staleTime: 60_000,
  });

  const isFollowing = useMemo(() => {
    if (optimistic !== null) return optimistic;
    return !!data?.following?.some(f => f.userId === targetUserId);
  }, [data, optimistic, targetUserId]);

  const mut = useMutation({
    mutationFn: async () => {
      const path = isFollowing ? '/api/social/unfollow' : '/api/social/follow';
      const r = await api.post(path, { followedId: targetUserId });
      return r?.data;
    },
    onMutate: () => { setOptimistic(!isFollowing); },
    onError: () => { setOptimistic(null); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['social-following', currentUserId] });
      queryClient.invalidateQueries({ queryKey: ['social-followers', targetUserId] });
    },
    onSettled: () => { setTimeout(() => setOptimistic(null), 600); },
  });

  const onClick = useCallback(() => {
    if (mut.isPending || isSelf) return;
    mut.mutate();
  }, [mut, isSelf]);

  if (isSelf) return null;
  if (!currentUserId) return null; // hide for anonymous

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={mut.isPending}
      aria-pressed={isFollowing}
      title={isFollowing ? 'Unfollow' : 'Follow'}
      className={cn(
        'inline-flex items-center gap-1 rounded border font-medium transition-colors',
        isFollowing
          ? 'text-zinc-200 bg-zinc-800/60 border-zinc-700 hover:bg-rose-500/10 hover:text-rose-300 hover:border-rose-500/30'
          : 'text-indigo-100 bg-indigo-600/70 border-indigo-500/60 hover:bg-indigo-600/90',
        compact ? 'text-[10px] px-1.5 py-0.5' : 'text-xs px-2.5 py-1',
        mut.isPending && 'opacity-60',
        className,
      )}
    >
      {mut.isPending
        ? <Loader2 className={cn(compact ? 'w-3 h-3' : 'w-3.5 h-3.5', 'animate-spin')} />
        : isFollowing
        ? <UserCheck className={cn(compact ? 'w-3 h-3' : 'w-3.5 h-3.5')} />
        : <UserPlus className={cn(compact ? 'w-3 h-3' : 'w-3.5 h-3.5')} />}
      {!compact && (
        <span>{isFollowing ? 'Following' : 'Follow'}</span>
      )}
    </button>
  );
}

export default FollowButton;
