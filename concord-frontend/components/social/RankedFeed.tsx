'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { OwnPostDelete } from './OwnPostDelete';
import { invalidatePostSurfaces } from './invalidate-post-surfaces';
import { PostMediaCard, type PostListingAttachment } from './PostMediaCard';
import { socialPostViewTransitionName } from './PostDetailInPlace';

interface RankedPost {
  id: string;
  userId: string;
  content?: string;
  createdAt?: string;
  why?: string[];
  mediaType?: string;
  mediaUrl?: string | null;
  sensitiveHidden?: boolean;
  listing?: PostListingAttachment | null;
}

export function RankedFeed({ currentUserId, onOpenPost }: { currentUserId: string; onOpenPost?: (postId: string) => void }) {
  const queryClient = useQueryClient();
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const query = useQuery({
    queryKey: ['social-for-you', currentUserId],
    queryFn: async () => {
      const res = await api.get<{ ok?: boolean; posts?: RankedPost[]; error?: string }>('/api/social/feed/for-you');
      if (res.data?.ok === false) throw new Error(res.data.error || 'Couldn’t load For You');
      return res.data?.posts || [];
    },
    refetchInterval: 30_000,
  });

  async function feedback(postId: string, action: 'less' | 'not-interested') {
    const res = await api.post('/api/social/feed/feedback', { postId, action });
    if (res.data?.ok === false) return;
    await queryClient.invalidateQueries({ queryKey: ['social-for-you', currentUserId] });
  }

  if (query.isLoading) return <p className="text-sm text-zinc-400">Loading For You…</p>;
  if (query.isError) return <p className="text-sm text-rose-300">Couldn’t load For You.</p>;
  const posts = (query.data || []).filter((post) => !removed.has(post.id));
  if (posts.length === 0) return <p className="text-sm text-zinc-400">No ranked posts yet.</p>;

  return (
    <ul className="social-reveal-items space-y-2">
      {posts.map((post) => (
        <li
          key={post.id}
          className="relative rounded-lg border border-zinc-800 bg-zinc-950/60 p-3"
          style={{ viewTransitionName: socialPostViewTransitionName(post.id) }}
        >
          {onOpenPost && (
            <button
              type="button"
              className="absolute inset-0 rounded-lg"
              aria-label={`Open post${post.content ? ` — ${post.content.slice(0, 80)}` : ''}`}
              onClick={() => onOpenPost(post.id)}
            />
          )}
          <div className="relative">
            <p className="text-sm text-zinc-200">{post.content}</p>
            {post.sensitiveHidden && <p className="mt-1 text-xs text-zinc-500">Sensitive media hidden</p>}
            {/* Attached Studio track or Marketplace item → real media card
                (play button, never autoplay). `relative` keeps its controls
                above the open-post overlay. */}
            <PostMediaCard className="relative" mediaType={post.mediaType} mediaUrl={post.mediaUrl} listing={post.listing} />
            {post.why && post.why.length > 0 && (
              <p className="mt-1 text-[11px] text-zinc-500">Why this is here: {post.why.join(' · ')}</p>
            )}
          </div>
          <div className="relative mt-2 flex gap-2">
            <button type="button" className="text-[11px] text-zinc-300 underline" onClick={() => void feedback(post.id, 'less')}>Show less like this</button>
            <button type="button" className="text-[11px] text-zinc-300 underline" onClick={() => void feedback(post.id, 'not-interested')}>Not interested</button>
            {post.userId === currentUserId && (
              <OwnPostDelete
                postId={post.id}
                onDeleted={() => {
                  setRemoved((prev) => new Set(prev).add(post.id));
                  // Row already dropped here; reconcile the Following
                  // timeline, You > Posts and the post count too.
                  void invalidatePostSurfaces(queryClient);
                }}
              />
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}