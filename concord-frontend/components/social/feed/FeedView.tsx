'use client';

/**
 * FeedView — the social-domain engagement feed.
 *
 * Orchestrates all 9 backlog surfaces: composer (media + polls + quotes),
 * post cards (reactions / reposts / replies / share / moderation), the
 * hashtag page, the post-detail permalink view, the DM inbox, and live
 * streaming. Every datum comes from the `social` domain macros.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Sparkles, Hash, TrendingUp } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import type { SocialPost, TrendingHashtag } from './types';
import { FeedComposer } from './FeedComposer';
import { PostCard } from './PostCard';
import { HashtagPage } from './HashtagPage';
import { PostDetail } from './PostDetail';
import { DMInbox } from './DMInbox';
import { LiveStreams } from './LiveStreams';

type View =
  | { kind: 'feed' }
  | { kind: 'hashtag'; tag: string }
  | { kind: 'detail'; postId: string }
  | { kind: 'dms' }
  | { kind: 'live' };

interface FeedViewProps {
  currentUserId: string;
  username: string;
}

export function FeedView({ currentUserId, username }: FeedViewProps) {
  const [view, setView] = useState<View>({ kind: 'feed' });
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [trending, setTrending] = useState<TrendingHashtag[]>([]);
  const [loading, setLoading] = useState(true);
  const [quotePost, setQuotePost] = useState<SocialPost | null>(null);

  const loadFeed = useCallback(async () => {
    setLoading(true);
    const [feedR, trendR] = await Promise.all([
      lensRun<{ posts: SocialPost[] }>('social', 'feed', { limit: 50 }),
      lensRun<{ trending: TrendingHashtag[] }>('social', 'trendingHashtags', { limit: 8 }),
    ]);
    setLoading(false);
    if (feedR.data?.ok && feedR.data.result) setPosts(feedR.data.result.posts || []);
    if (trendR.data?.ok && trendR.data.result) setTrending(trendR.data.result.trending || []);
  }, []);

  useEffect(() => { void loadFeed(); }, [loadFeed]);

  const openHashtag = useCallback((tag: string) => setView({ kind: 'hashtag', tag }), []);
  const openDetail = useCallback((postId: string) => setView({ kind: 'detail', postId }), []);
  const backToFeed = useCallback(() => { setView({ kind: 'feed' }); void loadFeed(); }, [loadFeed]);
  const quote = useCallback((p: SocialPost) => {
    setQuotePost(p);
    setView({ kind: 'feed' });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const navTabs = useMemo(() => ([
    { id: 'feed' as const, label: 'Feed', icon: Sparkles },
    { id: 'dms' as const, label: 'Messages', icon: Hash },
    { id: 'live' as const, label: 'Live', icon: TrendingUp },
  ]), []);

  return (
    <div className="space-y-3">
      {/* sub-navigation */}
      <div className="flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-950/60 p-1">
        {navTabs.map((t) => {
          const Icon = t.icon;
          const active =
            (t.id === 'feed' && (view.kind === 'feed' || view.kind === 'hashtag' || view.kind === 'detail'))
            || view.kind === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setView({ kind: t.id })}
              className={`flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition-colors ${
                active ? 'bg-indigo-600 text-white' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Icon className="w-3.5 h-3.5" /> {t.label}
            </button>
          );
        })}
      </div>

      {view.kind === 'dms' && <DMInbox currentUserId={currentUserId} />}
      {view.kind === 'live' && <LiveStreams username={username} />}

      {view.kind === 'hashtag' && (
        <HashtagPage
          tag={view.tag}
          username={username}
          onBack={backToFeed}
          onOpenHashtag={openHashtag}
          onOpenDetail={openDetail}
          onQuote={quote}
        />
      )}

      {view.kind === 'detail' && (
        <PostDetail
          postId={view.postId}
          username={username}
          onBack={backToFeed}
          onOpenHashtag={openHashtag}
          onOpenDetail={openDetail}
          onQuote={quote}
        />
      )}

      {view.kind === 'feed' && (
        <>
          <FeedComposer
            username={username}
            quotePost={quotePost}
            onClearQuote={() => setQuotePost(null)}
            onPosted={loadFeed}
          />

          {trending.length > 0 && (
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5">
              <div className="mb-1.5 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-zinc-400 font-mono">
                <TrendingUp className="w-3 h-3 text-indigo-300" /> Trending hashtags
              </div>
              <div className="flex flex-wrap gap-1.5">
                {trending.map((t) => (
                  <button
                    key={t.tag}
                    type="button"
                    onClick={() => openHashtag(t.tag)}
                    className="rounded-full border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-[11px] text-indigo-300 hover:border-indigo-500/40"
                  >
                    #{t.tag} <span className="text-zinc-600">{t.posts}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {loading ? (
            <div className="flex items-center gap-2 p-8 text-sm text-zinc-400">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading feed…
            </div>
          ) : posts.length === 0 ? (
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-12 text-center">
              <Sparkles className="mx-auto mb-3 h-8 w-8 text-zinc-700" />
              <h3 className="text-sm font-medium text-zinc-300">No posts yet</h3>
              <p className="mt-1 text-xs text-zinc-400">
                Write the first post — add media, a poll, or quote an existing post.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {posts.map((p) => (
                <PostCard
                  key={p.id}
                  post={p}
                  username={username}
                  onChanged={loadFeed}
                  onQuote={quote}
                  onOpenHashtag={openHashtag}
                  onOpenDetail={openDetail}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
