'use client';

/**
 * PeopleToFollow — a real "People to follow" row for Social Home.
 *
 * Candidates come from GET /api/social/people-to-follow: creators with
 * recent public posts and/or finished Studio projects, excluding the
 * viewer, accounts already followed, blocked users (either direction) and
 * muted users. The follow button hits the real POST /api/social/follow;
 * on success the row refetches, so the person is gone after a reload too.
 * An empty row renders nothing — it is never padded with hard-coded users.
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, UserPlus, Users } from 'lucide-react';
import { cn, formatNumber } from '@/lib/utils';
import { api } from '@/lib/api/client';

export interface PersonToFollow {
  userId: string;
  displayName: string;
  username?: string | null;
  avatar?: string | null;
  bio?: string | null;
  followerCount: number;
  recentPostCount: number;
  lastActiveAt?: string | null;
}

interface PeopleToFollowProps {
  currentUserId: string;
  onOpenProfile?: (userId: string) => void;
  className?: string;
}

export function PeopleToFollow({ currentUserId, onOpenProfile, className }: PeopleToFollowProps) {
  const queryClient = useQueryClient();
  const [failed, setFailed] = useState<Set<string>>(new Set());

  const { data, isLoading } = useQuery<{ people?: PersonToFollow[] }>({
    queryKey: ['people-to-follow', currentUserId],
    queryFn: async () => {
      const res = await api.get<{ ok?: boolean; people?: PersonToFollow[] }>('/api/social/people-to-follow', { params: { limit: 8 } });
      if (res.data?.ok === false) throw new Error('Couldn’t load people to follow');
      return { people: res.data?.people || [] };
    },
    staleTime: 30 * 1000,
    enabled: Boolean(currentUserId),
  });

  const follow = useMutation({
    mutationFn: async (userId: string) => {
      const res = await api.post<{ ok?: boolean; error?: string }>('/api/social/follow', { followedId: userId });
      if (res.data?.ok === false) throw new Error(res.data.error || 'Follow failed');
      return userId;
    },
    onSuccess: (userId) => {
      setFailed((prev) => {
        if (!prev.has(userId)) return prev;
        const next = new Set(prev);
        next.delete(userId);
        return next;
      });
      // The row updates from the server's own answer: refetch and the
      // followed account is no longer suggested. Also refresh every
      // surface that reads follow state, so a reload keeps the same truth.
      void queryClient.invalidateQueries({ queryKey: ['people-to-follow'] });
      void queryClient.invalidateQueries({ queryKey: ['suggested-follows'] });
      void queryClient.invalidateQueries({ queryKey: ['discover-users'] });
      void queryClient.invalidateQueries({ queryKey: ['social-following-activity'] });
    },
    onError: (_err, userId) => {
      setFailed((prev) => new Set(prev).add(userId));
    },
  });

  const people = (data?.people || []).filter((p) => p.userId !== currentUserId);

  if (!currentUserId || isLoading || people.length === 0) return null;

  return (
    <section className={cn('rounded-2xl border border-white/10 bg-[#111] p-3', className)} aria-label="People to follow">
      <h2 className="mb-2 text-sm font-medium text-zinc-200">People to follow</h2>
      <ul className="flex gap-3 overflow-x-auto pb-1">
        {people.map((person) => (
          <li
            key={person.userId}
            className="flex w-44 shrink-0 flex-col gap-2 rounded-xl border border-white/10 bg-zinc-950/60 p-3"
          >
            <button
              type="button"
              onClick={() => onOpenProfile?.(person.userId)}
              className="flex items-center gap-2 text-left"
              aria-label={`Open ${person.displayName}`}
            >
              {person.avatar ? (
                // eslint-disable-next-line @next/next/no-img-element -- avatars are arbitrary remote artifact URLs
                <img src={person.avatar} alt="" className="h-10 w-10 rounded-full object-cover" />
              ) : (
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-sm font-bold text-zinc-200">
                  {person.displayName.charAt(0).toUpperCase()}
                </span>
              )}
              <span className="min-w-0">
                <span className="block truncate text-sm text-zinc-100">{person.displayName}</span>
                <span className="flex items-center gap-1 text-[11px] text-zinc-500">
                  <Users className="h-3 w-3" aria-hidden="true" />
                  {formatNumber(person.followerCount)} followers
                </span>
              </span>
            </button>
            <p className="flex items-center gap-1 text-[11px] text-zinc-400">
              {person.recentPostCount > 0 && `${person.recentPostCount} recent ${person.recentPostCount === 1 ? 'post' : 'posts'}`}
            </p>
            <button
              type="button"
              onClick={() => follow.mutate(person.userId)}
              disabled={follow.isPending && follow.variables === person.userId}
              className={cn(
                'inline-flex min-h-[44px] items-center justify-center gap-1 rounded-full px-3 text-xs font-medium transition-colors',
                'border border-teal-400/40 bg-teal-400/10 text-teal-200 hover:bg-teal-400/20',
                follow.isPending && follow.variables === person.userId && 'opacity-60',
              )}
              aria-label={`Follow ${person.displayName}`}
            >
              {follow.isPending && follow.variables === person.userId ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <UserPlus className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              Follow
            </button>
            {failed.has(person.userId) && <p className="text-[11px] text-rose-300">Couldn’t follow just now.</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}

export default PeopleToFollow;