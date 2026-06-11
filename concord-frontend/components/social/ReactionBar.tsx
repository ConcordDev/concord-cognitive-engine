'use client';

/**
 * ReactionBar — drop-in pan-social reaction strip for any post / DTU /
 * card.
 *
 * Phase 10: surfaces Concord's existing /api/social/react +
 * /api/social/reactions/:postId substrate as a single composable chip
 * row. Drop into chat DTUs, feed cards, council proposals, paper
 * citations — anywhere a thing can be reacted to.
 *
 *   <ReactionBar postId={dtu.id} />
 *
 * UX:
 *   - 6 reactions (like / love / insight / refuse / 🤔 / 👏)
 *   - Click → POST /api/social/react with type
 *   - Live tallies from GET /api/social/reactions/:postId, react-query
 *     poll every 30s + invalidate on own click
 *   - User's current reaction highlighted; click again to remove
 *   - Optimistic UI; rolls back on server failure
 *   - Empty state when no reactions yet — invisible (no "0 likes" noise)
 */

import { useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Heart, Lightbulb, Sparkles, ThumbsUp, HandMetal, Ban } from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';

// Canonical backend reaction types — must match social-layer.js
// VALID_REACTIONS exactly or POST /api/social/react returns
// "Invalid reaction type".
type ReactionType = 'like' | 'fire' | 'heart' | 'mind-blown' | 'useful' | 'disagree';

const REACTIONS: { type: ReactionType; icon: typeof Heart; label: string; tint: string }[] = [
  { type: 'like',        icon: ThumbsUp,  label: 'Like',        tint: 'text-cyan-300 hover:bg-cyan-500/10 border-cyan-500/30' },
  { type: 'heart',       icon: Heart,     label: 'Heart',       tint: 'text-rose-300 hover:bg-rose-500/10 border-rose-500/30' },
  { type: 'mind-blown',  icon: Sparkles,  label: 'Mind blown',  tint: 'text-violet-300 hover:bg-violet-500/10 border-violet-500/30' },
  { type: 'useful',      icon: Lightbulb, label: 'Useful',      tint: 'text-amber-300 hover:bg-amber-500/10 border-amber-500/30' },
  { type: 'fire',        icon: HandMetal, label: 'Fire',        tint: 'text-orange-300 hover:bg-orange-500/10 border-orange-500/30' },
  { type: 'disagree',    icon: Ban,       label: 'Disagree',    tint: 'text-zinc-400 hover:bg-zinc-500/10 border-zinc-600' },
];

interface ReactionsResponse {
  ok: boolean;
  reactions?: Record<string, number>;
  userReaction?: ReactionType | null;
  total?: number;
}

export interface ReactionBarProps {
  /** The post / DTU / artifact id this strip targets. */
  postId: string;
  /** Hide entirely when total is 0 + user hasn't reacted. Default true. */
  hideWhenEmpty?: boolean;
  /** Compact mode: icons only, smaller paddings. Default false. */
  compact?: boolean;
  className?: string;
}

export function ReactionBar({ postId, hideWhenEmpty = true, compact = false, className }: ReactionBarProps) {
  const queryClient = useQueryClient();

  const { data } = useQuery<ReactionsResponse | null>({
    queryKey: ['social-reactions', postId],
    queryFn: async () => {
      try {
        const r = await api.get<ReactionsResponse>(`/api/social/reactions/${encodeURIComponent(postId)}`);
        return r?.data;
      } catch { return null; }
    },
    enabled: !!postId,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  const reactions = useMemo(() => data?.reactions || {}, [data]);
  const userReaction = data?.userReaction || null;
  const total = useMemo(() => Object.values(reactions).reduce((a, b) => a + (b || 0), 0), [reactions]);

  const reactMutation = useMutation({
    mutationFn: async (type: ReactionType) => {
      const r = await api.post('/api/social/react', { postId, type });
      return r?.data;
    },
    onMutate: async (type) => {
      await queryClient.cancelQueries({ queryKey: ['social-reactions', postId] });
      const prev = queryClient.getQueryData<ReactionsResponse | null>(['social-reactions', postId]);
      const wasMine = userReaction === type;
      // Optimistic: increment/decrement based on toggle behavior
      const nextReactions = { ...(prev?.reactions || {}) };
      if (wasMine) {
        nextReactions[type] = Math.max(0, (nextReactions[type] || 0) - 1);
      } else {
        if (userReaction) {
          nextReactions[userReaction] = Math.max(0, (nextReactions[userReaction] || 0) - 1);
        }
        nextReactions[type] = (nextReactions[type] || 0) + 1;
      }
      // Use the updater-FUNCTION form: passing a bare object literal to
      // setQueryData<T> where T is a union (ReactionsResponse | null) trips
      // TanStack v5's Updater type (it checks the literal against the `undefined`
      // arm and mis-reports "true not assignable to undefined"). The function
      // form returns a concrete ReactionsResponse and type-checks cleanly.
      queryClient.setQueryData<ReactionsResponse | null>(['social-reactions', postId], (): ReactionsResponse => ({
        ok: true,
        reactions: nextReactions,
        userReaction: wasMine ? null : type,
        total: Object.values(nextReactions).reduce((a, b) => a + (b || 0), 0),
      }));
      return { prev };
    },
    onError: (_e, _type, ctx) => {
      if (ctx?.prev) {
        queryClient.setQueryData(['social-reactions', postId], ctx.prev);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['social-reactions', postId] });
    },
  });

  const onReact = useCallback((type: ReactionType) => {
    if (!postId) return;
    reactMutation.mutate(type);
  }, [postId, reactMutation]);

  if (hideWhenEmpty && total === 0 && !userReaction) return null;

  return (
    <div
      className={cn(
        'inline-flex flex-wrap items-center gap-1 text-xs',
        className,
      )}
      role="group"
      aria-label="Reactions"
    >
      {REACTIONS.map(r => {
        const count = reactions[r.type] || 0;
        const mine = userReaction === r.type;
        if (hideWhenEmpty && count === 0 && !mine && total > 0) {
          // Skip zero-count chips once at least one reaction exists, to keep the row tight
          return null;
        }
        const Icon = r.icon;
        return (
          <button
            key={r.type}
            type="button"
            onClick={() => onReact(r.type)}
            disabled={reactMutation.isPending}
            title={mine ? `Remove ${r.label}` : r.label}
            aria-pressed={mine}
            className={cn(
              'inline-flex items-center gap-1 rounded border transition-colors',
              compact ? 'px-1.5 py-0.5' : 'px-2 py-1',
              r.tint,
              mine ? 'bg-zinc-800/80 border-zinc-700' : 'bg-zinc-900/40',
              reactMutation.isPending && 'opacity-60',
            )}
          >
            <Icon className={cn(compact ? 'w-3 h-3' : 'w-3.5 h-3.5')} />
            {count > 0 && (
              <span className="tabular-nums font-mono text-[10px] text-zinc-300">{count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export default ReactionBar;
