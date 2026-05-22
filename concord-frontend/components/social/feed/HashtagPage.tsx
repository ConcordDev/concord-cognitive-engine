'use client';

/**
 * HashtagPage — dedicated hashtag / topic feed.
 *
 * Backlog item 4: calls social.hashtagFeed for a single tag. Renders the
 * filtered post stream plus contributor count. No fake data.
 */

import { useCallback, useEffect, useState } from 'react';
import { Hash, Loader2, ArrowLeft, Users } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import type { SocialPost } from './types';
import { PostCard } from './PostCard';

interface HashtagPageProps {
  tag: string;
  username: string;
  onBack: () => void;
  onOpenHashtag: (tag: string) => void;
  onOpenDetail: (postId: string) => void;
  onQuote: (post: SocialPost) => void;
}

export function HashtagPage({ tag, username, onBack, onOpenHashtag, onOpenDetail, onQuote }: HashtagPageProps) {
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [contributors, setContributors] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await lensRun<{ posts: SocialPost[]; contributors: number }>('social', 'hashtagFeed', { tag });
    setLoading(false);
    if (r.data?.ok && r.data.result) {
      setPosts(r.data.result.posts || []);
      setContributors(r.data.result.contributors || 0);
    }
  }, [tag]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
        <button
          type="button"
          onClick={onBack}
          className="rounded p-1 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
          aria-label="Back to feed"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <Hash className="w-5 h-5 text-indigo-300" />
        <div>
          <h2 className="text-base font-semibold text-zinc-100">#{tag}</h2>
          <p className="flex items-center gap-1 text-[11px] text-zinc-500">
            <Users className="w-3 h-3" /> {contributors} contributor{contributors === 1 ? '' : 's'} ·
            {' '}{posts.length} post{posts.length === 1 ? '' : 's'}
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 p-6 text-sm text-zinc-500">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading #{tag}…
        </div>
      ) : posts.length === 0 ? (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-10 text-center">
          <Hash className="mx-auto mb-3 h-8 w-8 text-zinc-700" />
          <p className="text-sm text-zinc-400">No posts tagged #{tag} yet.</p>
          <p className="mt-1 text-xs text-zinc-600">Post with #{tag} to start this topic.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {posts.map((p) => (
            <PostCard
              key={p.id}
              post={p}
              username={username}
              onChanged={load}
              onQuote={onQuote}
              onOpenHashtag={onOpenHashtag}
              onOpenDetail={onOpenDetail}
            />
          ))}
        </div>
      )}
    </div>
  );
}
