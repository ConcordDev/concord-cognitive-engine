'use client';

/* eslint-disable @next/next/no-img-element */
// PostCard — a single feed post with reactions (timeline.react), the
// "who reacted" breakdown, nested comments, and share. Every action is a
// real macro call; nothing here is a placeholder.

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ThumbsUp, Heart, Laugh, Frown, Angry, MessageCircle, Share2,
  Globe, Users, Lock, Film, Trash2, Repeat2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { lensRun } from '@/lib/api/client';
import { useUIStore } from '@/store/ui';
import type { FeedPost, ReactionKind } from './types';
import { CommentThread } from './CommentThread';
import { ReactionBreakdown } from './ReactionBreakdown';
import { ShareModal } from './ShareModal';

const REACTIONS: { id: ReactionKind; icon: typeof ThumbsUp; color: string; label: string }[] = [
  { id: 'like', icon: ThumbsUp, color: 'text-blue-500', label: 'Like' },
  { id: 'love', icon: Heart, color: 'text-red-500', label: 'Love' },
  { id: 'haha', icon: Laugh, color: 'text-yellow-500', label: 'Haha' },
  { id: 'sad', icon: Frown, color: 'text-yellow-500', label: 'Sad' },
  { id: 'angry', icon: Angry, color: 'text-orange-500', label: 'Angry' },
];

const PRIVACY_ICON = { public: Globe, friends: Users, private: Lock } as const;

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3600000);
  if (h < 1) return 'Just now';
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(iso).toLocaleDateString();
}

export function PostCard({ post, viewerId }: { post: FeedPost; viewerId: string }) {
  const qc = useQueryClient();
  const [showReactionPicker, setShowReactionPicker] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [showShare, setShowShare] = useState(false);

  const reactMutation = useMutation({
    mutationFn: (kind: ReactionKind) => lensRun('timeline', 'react', { postId: post.id, kind }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['timeline-feed'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: () => lensRun('timeline', 'post-delete', { postId: post.id }),
    onSuccess: (r) => {
      if (r.data.ok) {
        qc.invalidateQueries({ queryKey: ['timeline-feed'] });
        useUIStore.getState().addToast({ type: 'success', message: 'Post deleted' });
      } else {
        useUIStore.getState().addToast({ type: 'error', message: r.data.error || 'Delete failed' });
      }
    },
  });

  const total = post.reactionTotal;
  const topKinds = REACTIONS.filter((r) => (post.reactionCounts?.[r.id] ?? 0) > 0)
    .sort((a, b) => (post.reactionCounts[b.id] ?? 0) - (post.reactionCounts[a.id] ?? 0))
    .slice(0, 3);
  const currentReaction = post.userReaction ? REACTIONS.find((r) => r.id === post.userReaction) : null;
  const PrivacyIcon = PRIVACY_ICON[post.privacy] ?? Globe;
  const isOwner = post.authorId === viewerId;

  return (
    <article className="bg-[#242526] rounded-lg">
      {/* Header */}
      <div className="p-4 pb-2 flex items-start justify-between">
        <div className="flex gap-3">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex-shrink-0" />
          <div>
            <h3 className="font-semibold text-white text-sm">{post.authorId}</h3>
            <div className="flex items-center gap-1.5 text-xs text-gray-400">
              <span>{timeAgo(post.createdAt)}</span>
              <span>·</span>
              <PrivacyIcon className="w-3 h-3" />
              {post.sharedFrom && (
                <>
                  <span>·</span>
                  <Repeat2 className="w-3 h-3 text-green-400" />
                  <span className="text-green-400">shared</span>
                </>
              )}
            </div>
          </div>
        </div>
        {isOwner && (
          <button
            onClick={() => deleteMutation.mutate()}
            disabled={deleteMutation.isPending}
            className="p-2 rounded-full hover:bg-[#3a3b3c] text-gray-400 hover:text-red-400"
            aria-label="Delete post"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Content */}
      {post.content && (
        <div className="px-4 py-2">
          <p className="text-white text-sm whitespace-pre-wrap">{post.content}</p>
        </div>
      )}

      {/* Tagged users */}
      {post.taggedUserIds?.length > 0 && (
        <div className="px-4 pb-1 text-xs text-gray-400">
          with {post.taggedUserIds.join(', ')}
        </div>
      )}

      {/* Media */}
      {post.media?.length > 0 && (
        <div className={cn('grid gap-0.5', post.media.length === 1 ? 'grid-cols-1' : 'grid-cols-2')}>
          {post.media.map((m, i) => (
            <div key={m.id ?? `${m.url}-${i}`} className="bg-[#18191a] aspect-video overflow-hidden relative">
              {m.kind === 'video' ? (
                <div className="w-full h-full flex items-center justify-center">
                  <Film className="w-10 h-10 text-gray-600" />
                </div>
              ) : (
                <img src={m.url} alt={m.caption || 'post media'} className="w-full h-full object-cover" />
              )}
            </div>
          ))}
        </div>
      )}

      {/* Shared-from quote */}
      {post.sharedFrom && (
        <div className="mx-4 my-2 border border-gray-700 rounded-lg p-3 bg-[#18191a]">
          <p className="text-xs font-semibold text-gray-300 mb-1">{post.sharedFrom.authorId}</p>
          <p className="text-sm text-gray-400">{post.sharedFrom.content || '(media post)'}</p>
        </div>
      )}

      {/* Reaction summary bar */}
      <div className="px-4 py-2 flex items-center justify-between text-gray-400 text-xs border-b border-gray-700">
        {total > 0 ? (
          <button onClick={() => setShowBreakdown(true)} className="flex items-center gap-1 hover:underline">
            <div className="flex -space-x-1">
              {topKinds.map((r) => {
                const Icon = r.icon;
                return (
                  <div key={r.id} className={cn('w-4 h-4 rounded-full bg-[#3a3b3c] flex items-center justify-center', r.color)}>
                    <Icon className="w-2.5 h-2.5" />
                  </div>
                );
              })}
            </div>
            <span className="ml-1">{total}</span>
          </button>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-3">
          <button onClick={() => setShowComments((c) => !c)} className="hover:underline">
            {post.commentCount} comments
          </button>
        </div>
      </div>

      {/* Action buttons */}
      <div className="px-2 py-1 flex items-center">
        <div
          className="relative flex-1"
          onMouseEnter={() => setShowReactionPicker(true)}
          onMouseLeave={() => setShowReactionPicker(false)}
        >
          <button
            onClick={() => reactMutation.mutate(post.userReaction || 'like')}
            className={cn(
              'w-full flex items-center justify-center gap-2 py-2 rounded-lg hover:bg-[#3a3b3c] transition-colors',
              currentReaction ? currentReaction.color : 'text-gray-400',
            )}
          >
            {currentReaction ? <currentReaction.icon className="w-5 h-5" /> : <ThumbsUp className="w-5 h-5" />}
            <span className="font-medium text-sm">{currentReaction?.label ?? 'Like'}</span>
          </button>
          <AnimatePresence>
            {showReactionPicker && (
              <motion.div
                initial={{ opacity: 0, y: 8, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.9 }}
                className="absolute bottom-full left-0 mb-1 flex gap-1 p-2 bg-[#242526] rounded-full shadow-xl border border-gray-700 z-10"
              >
                {REACTIONS.map((r) => {
                  const Icon = r.icon;
                  return (
                    <button
                      key={r.id}
                      onClick={() => {
                        reactMutation.mutate(r.id);
                        setShowReactionPicker(false);
                      }}
                      title={r.label}
                      className="p-1.5 rounded-full hover:bg-[#3a3b3c] hover:scale-125 transition-all"
                    >
                      <Icon className={cn('w-6 h-6', r.color)} />
                    </button>
                  );
                })}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <button
          onClick={() => setShowComments((c) => !c)}
          className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg hover:bg-[#3a3b3c] text-gray-400 transition-colors"
        >
          <MessageCircle className="w-5 h-5" />
          <span className="font-medium text-sm">Comment</span>
        </button>

        <button
          onClick={() => setShowShare(true)}
          className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg hover:bg-[#3a3b3c] text-gray-400 transition-colors"
        >
          <Share2 className="w-5 h-5" />
          <span className="font-medium text-sm">Share</span>
        </button>
      </div>

      {/* Comments */}
      {showComments && <CommentThread postId={post.id} viewerId={viewerId} />}

      {/* Modals */}
      <AnimatePresence>
        {showBreakdown && <ReactionBreakdown postId={post.id} onClose={() => setShowBreakdown(false)} />}
        {showShare && <ShareModal post={post} onClose={() => setShowShare(false)} />}
      </AnimatePresence>
    </article>
  );
}
