'use client';

/**
 * PostDetail — permalink detail view for a single post.
 *
 * Backlog item 5: calls social.postDetail (post + quoted + replyTree +
 * permalink) and social.shareTargets for the share sheet. No fake data.
 */

import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Loader2, Link2, Check } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import type { SocialPost, SocialReply } from './types';
import { normalizePost } from './normalizePost';
import { PostCard } from './PostCard';
import { ReplyTree } from './ReplyTree';

interface PostDetailProps {
  postId: string;
  username: string;
  currentUserId?: string;
  onBack: () => void;
  /** Accessible label for the back/close control ("Close post" in the
   *  in-place panel, "Back to feed" on the permalink page). */
  backLabel?: string;
  onOpenHashtag: (tag: string) => void;
  onOpenDetail: (postId: string) => void;
  onQuote: (post: SocialPost) => void;
}

export function PostDetail({ postId, username, currentUserId, onBack, backLabel = 'Back to feed', onOpenHashtag, onOpenDetail, onQuote }: PostDetailProps) {
  const [post, setPost] = useState<SocialPost | null>(null);
  const [quoted, setQuoted] = useState<SocialPost | null>(null);
  const [permalink, setPermalink] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [loadedId, setLoadedId] = useState(postId);
  const [reloadKey, setReloadKey] = useState(0);
  if (loadedId !== postId) {
    setLoadedId(postId);
    setLoading(true);
    setError(null);
  }
  const reload = useCallback(() => {
    setLoading(true);
    setReloadKey((n) => n + 1);
  }, []);

  const copyLink = useCallback(async () => {
    const r = await lensRun<{ permalink: string }>('social', 'shareTargets', { postId });
    const link = r.data?.result?.permalink || permalink;
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${link}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable */ }
  }, [postId, permalink]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await lensRun<{ post: SocialPost; quoted: SocialPost | null; replyTree: SocialReply[]; permalink: string }>(
        'social', 'postDetail', { postId },
      );
      if (cancelled) return;
      if (r.data?.ok && r.data.result) {
        setPost(normalizePost(r.data.result.post));
        setQuoted(r.data.result.quoted ? normalizePost(r.data.result.quoted) : null);
        setPermalink(r.data.result.permalink);
        setError(null);
      } else {
        setPost(null);
        setQuoted(null);
        setError(r.data?.error || 'Post not found.');
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [postId, reloadKey]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5">
        {/* ≥44px tap target (a11y) — the icon stays visually identical. */}
        <button
          type="button"
          onClick={onBack}
          className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
          aria-label={backLabel}
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <span className="text-sm font-medium text-zinc-200">Post</span>
        <button
          type="button"
          onClick={() => void copyLink()}
          className="ml-auto flex items-center gap-1.5 rounded bg-zinc-900 px-2 py-1 text-[11px] text-zinc-300 hover:bg-zinc-800"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Link2 className="w-3.5 h-3.5" />}
          {copied ? 'Copied' : 'Copy permalink'}
        </button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 p-6 text-sm text-zinc-400">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading post…
        </div>
      ) : error || !post ? (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-10 text-center text-sm text-zinc-400">
          {error || 'Post not found.'}
        </div>
      ) : (
        <>
          {quoted && (
            <div className="ml-4 border-l-2 border-indigo-500/30 pl-2">
              <p className="mb-1 text-[10px] uppercase tracking-wider text-zinc-400">Quoted</p>
              <PostCard
                post={quoted}
                username={username}
                currentUserId={currentUserId}
                onChanged={reload}
                onQuote={onQuote}
                onOpenHashtag={onOpenHashtag}
                onOpenDetail={onOpenDetail}
              />
            </div>
          )}
          <PostCard
            post={post}
            username={username}
            currentUserId={currentUserId}
            onChanged={reload}
            onQuote={onQuote}
            onOpenHashtag={onOpenHashtag}
            onOpenDetail={onOpenDetail}
          />
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
            <h3 className="mb-2 text-xs font-medium text-zinc-400">Replies</h3>
            <ReplyTree postId={post.id} username={username} />
          </div>
        </>
      )}
    </div>
  );
}
