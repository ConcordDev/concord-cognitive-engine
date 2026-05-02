'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { UserPlus, X, Users, Sparkles, Loader2, Star } from 'lucide-react';
import Image from 'next/image';
import { cn, formatNumber } from '@/lib/utils';
import { api } from '@/lib/api/client';

// ── Types ────────────────────────────────────────────────────────────────────

interface SuggestedCreator {
  userId: string;
  displayName: string;
  avatarUrl?: string;
  bio?: string;
  followerCount: number;
  sharedInterests: string[];
  matchScore: number;
}

interface SuggestedFollowsProps {
  currentUserId: string;
  onNavigateToUser?: (userId: string) => void;
  className?: string;
}

// ── Gradient helper ──────────────────────────────────────────────────────────

const gradients = [
  'from-neon-cyan to-blue-600',
  'from-neon-purple to-pink-600',
  'from-neon-pink to-rose-600',
  'from-amber-400 to-orange-600',
  'from-violet-500 to-indigo-600',
  'from-teal-400 to-cyan-600',
];

function pickGradient(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return gradients[Math.abs(hash) % gradients.length];
}

// ── Main Component ───────────────────────────────────────────────────────────

function SuggestedFollows({ currentUserId, onNavigateToUser, className }: SuggestedFollowsProps) {
  const queryClient = useQueryClient();
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [followed, setFollowed] = useState<Set<string>>(new Set());

  const { data: suggestions, isLoading } = useQuery({
    queryKey: ['suggested-follows', currentUserId],
    queryFn: async () => {
      const res = await api.get(`/api/social/discover/${currentUserId}`);
      const raw: Record<string, unknown>[] = res.data?.suggestions || [];
      return raw.map(
        (s): SuggestedCreator => ({
          userId: (s.userId as string) || '',
          displayName: (s.displayName as string) || 'User',
          avatarUrl: s.avatarUrl as string | undefined,
          bio: (s.bio as string) || undefined,
          followerCount: (s.followerCount as number) || 0,
          sharedInterests: Array.isArray(s.sharedInterests) ? (s.sharedInterests as string[]) : [],
          matchScore: (s.matchScore as number) || 0,
        })
      );
    },
    enabled: !!currentUserId,
  });

  const followMutation = useMutation({
    mutationFn: async (userId: string) => {
      await api.post('/api/social/follow', { followedId: userId });
      return userId;
    },
    onSuccess: (userId) => {
      setFollowed((prev) => new Set(prev).add(userId));
      queryClient.invalidateQueries({ queryKey: ['following'] });
    },
  });

  const unfollowMutation = useMutation({
    mutationFn: async (userId: string) => {
      await api.post('/api/social/unfollow', { followedId: userId });
      return userId;
    },
    onSuccess: (userId) => {
      setFollowed((prev) => {
        const next = new Set(prev);
        next.delete(userId);
        return next;
      });
    },
  });

  const handleDismiss = (userId: string) => {
    setDismissed((prev) => new Set(prev).add(userId));
  };

  const handleToggleFollow = (userId: string) => {
    if (followed.has(userId)) {
      unfollowMutation.mutate(userId);
    } else {
      followMutation.mutate(userId);
    }
  };

  const visible = (suggestions || []).filter((s) => !dismissed.has(s.userId)).slice(0, 5);

  if (isLoading) {
    return (
      <div className={cn('p-4', className)}>
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-5 h-5 text-neon-cyan animate-spin" />
        </div>
      </div>
    );
  }

  if (visible.length === 0) return null;

  return (
    <div className={cn('space-y-3', className)}>
      {/* Header */}
      <div className="flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-neon-purple" />
        <h3 className="text-sm font-semibold text-white">Creators you might like</h3>
      </div>

      {/* Suggestion cards */}
      <div className="space-y-2">
        <AnimatePresence mode="popLayout">
          {visible.map((creator) => {
            const isFollowed = followed.has(creator.userId);
            const gradient = pickGradient(creator.userId);

            return (
              <motion.div
                key={creator.userId}
                layout
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20, height: 0, marginBottom: 0 }}
                transition={{ duration: 0.25 }}
                className="p-3 rounded-xl bg-lattice-deep border border-lattice-border hover:border-neon-cyan/20 transition-all"
              >
                <div className="flex items-start gap-3">
                  {/* Avatar */}
                  <button
                    onClick={() => onNavigateToUser?.(creator.userId)}
                    className={cn(
                      'w-10 h-10 rounded-full flex-shrink-0 flex items-center justify-center text-white font-bold text-sm bg-gradient-to-br',
                      gradient
                    )}
                  >
                    {creator.avatarUrl ? (
                      <Image
                        src={creator.avatarUrl}
                        alt={creator.displayName}
                        width={40}
                        height={40}
                        className="w-full h-full rounded-full object-cover"
                      />
                    ) : (
                      creator.displayName.charAt(0).toUpperCase()
                    )}
                  </button>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <button
                        onClick={() => onNavigateToUser?.(creator.userId)}
                        className="text-sm text-white font-medium hover:text-neon-cyan transition-colors truncate"
                      >
                        {creator.displayName}
                      </button>

                      <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                        {/* Follow/Following button */}
                        <button
                          onClick={() => handleToggleFollow(creator.userId)}
                          disabled={followMutation.isPending || unfollowMutation.isPending}
                          className={cn(
                            'flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-all',
                            isFollowed
                              ? 'bg-lattice-surface text-gray-400 border border-lattice-border hover:border-red-500/30 hover:text-red-400'
                              : 'bg-neon-cyan/15 text-neon-cyan border border-neon-cyan/30 hover:bg-neon-cyan/25'
                          )}
                        >
                          {isFollowed ? (
                            'Following'
                          ) : (
                            <>
                              <UserPlus className="w-3 h-3" />
                              Follow
                            </>
                          )}
                        </button>

                        {/* Dismiss */}
                        <button
                          onClick={() => handleDismiss(creator.userId)}
                          className="p-1 text-gray-600 hover:text-gray-400 transition-colors"
                          aria-label="Dismiss suggestion"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Follower count */}
                    <div className="flex items-center gap-2 mt-0.5 text-xs text-gray-500">
                      <span className="flex items-center gap-1">
                        <Users className="w-3 h-3" />
                        {formatNumber(creator.followerCount)} followers
                      </span>
                      {creator.matchScore > 0 && (
                        <span className="flex items-center gap-1 text-neon-cyan/70">
                          <Star className="w-3 h-3" />
                          {Math.round(creator.matchScore * 100)}% match
                        </span>
                      )}
                    </div>

                    {/* Shared interests */}
                    {creator.sharedInterests.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {creator.sharedInterests.slice(0, 4).map((interest) => (
                          <span
                            key={interest}
                            className="text-[10px] text-neon-purple/70 bg-neon-purple/5 px-1.5 py-0.5 rounded-full"
                          >
                            {interest}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}

import { withErrorBoundary } from '@/components/common/ErrorBoundary';
const _WrappedSuggestedFollows = withErrorBoundary(SuggestedFollows);
export { _WrappedSuggestedFollows as SuggestedFollows };
export default _WrappedSuggestedFollows;
