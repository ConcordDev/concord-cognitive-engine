'use client';

/**
 * PostCard — a single feed post for the social-domain feed.
 *
 * Backlog items 2 (reactions / repost), 5 (post detail + share),
 * 7 (mute / block / report), 9 (polls + quote-posts). Each engagement
 * action calls a social-domain macro — no fake data.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Heart, Repeat2, MessageSquare, Share2, MoreHorizontal, Quote,
  Link2, Flag, VolumeX, Ban, Check, BarChart3,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import type { SocialPost, PollOption } from './types';
import { ReplyTree } from './ReplyTree';

// Emoji presentation per reaction id — purely cosmetic, kept local. The
// authoritative *set* of ids comes from the `social.reactionKinds` macro
// (fetched below) so this component never drifts from what the backend
// actually accepts; this hardcoded list below is only the last-resort
// fallback if that fetch fails, and mirrors REACTION_KINDS in
// server/domains/social.js at the time of writing.
const REACTION_EMOJI: Record<string, string> = {
  like: '👍', love: '❤️', celebrate: '🎉', insightful: '💡', laugh: '😂', sad: '😢',
};
const FALLBACK_REACTION_IDS = ['like', 'love', 'celebrate', 'insightful', 'laugh', 'sad'];
const REPORT_REASONS = ['spam', 'harassment', 'misinformation', 'hate', 'violence', 'other'];

// Module-level cache — reactionKinds is a static catalog, no need to
// re-fetch per PostCard instance in a long feed.
let reactionKindsCache: string[] | null = null;

function relTime(iso: string): string {
  const d = Date.now() - new Date(iso).getTime();
  if (d < 60_000) return 'now';
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

interface PostCardProps {
  post: SocialPost;
  username: string;
  onChanged: () => void;
  onQuote: (post: SocialPost) => void;
  onOpenHashtag: (tag: string) => void;
  onOpenDetail: (postId: string) => void;
}

export function PostCard({ post, username, onChanged, onQuote, onOpenHashtag, onOpenDetail }: PostCardProps) {
  const [showReactions, setShowReactions] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [showReports, setShowReports] = useState(false);
  const [showReplies, setShowReplies] = useState(false);
  const [copied, setCopied] = useState(false);
  const [poll, setPoll] = useState(post.poll);
  const [pollChoice, setPollChoice] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reactionIds, setReactionIds] = useState<string[]>(reactionKindsCache || FALLBACK_REACTION_IDS);

  const permalink = `/lenses/social/post/${post.id}`;

  // Fetch the authoritative reaction catalog once (cached module-wide) so
  // the picker never drifts from what `social.react` actually accepts.
  useEffect(() => {
    if (reactionKindsCache) return;
    let cancelled = false;
    (async () => {
      const r = await lensRun<{ kinds: string[] }>('social', 'reactionKinds', {});
      if (!cancelled && r.data?.ok && Array.isArray(r.data.result?.kinds) && r.data.result.kinds.length) {
        reactionKindsCache = r.data.result.kinds;
        setReactionIds(reactionKindsCache);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // A post fetched from `feed`/`hashtagFeed` doesn't carry the viewer's own
  // poll vote (the wire shape only exposes aggregate option counts, not a
  // per-viewer field) — without this the checkmark on a poll you already
  // voted on in a prior session never rendered. `pollResults` is the
  // purpose-built read for exactly this: authoritative viewerChoice + a
  // fresh tally in case other viewers have voted since the feed loaded.
  useEffect(() => {
    if (!post.poll) return;
    let cancelled = false;
    (async () => {
      const r = await lensRun<{ viewerChoice: string | null; options: PollOption[]; totalVotes: number; closed: boolean; closesAt: string | null; question: string }>(
        'social', 'pollResults', { postId: post.id },
      );
      if (cancelled || !r.data?.ok || !r.data.result) return;
      setPollChoice(r.data.result.viewerChoice);
      setPoll((p) => (p ? { ...p, options: r.data!.result!.options, closesAt: r.data!.result!.closesAt } : p));
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [post.id]);

  const react = useCallback(async (kind: string) => {
    setShowReactions(false);
    const r = await lensRun('social', 'react', { postId: post.id, reaction: kind });
    if (r.data?.ok) onChanged();
  }, [post.id, onChanged]);

  const repost = useCallback(async () => {
    const r = await lensRun('social', 'repost', { postId: post.id });
    if (r.data?.ok) onChanged();
  }, [post.id, onChanged]);

  const vote = useCallback(async (optionId: string) => {
    const r = await lensRun<{ options: PollOption[]; totalVotes: number; viewerChoice: string }>(
      'social', 'votePoll', { postId: post.id, optionId },
    );
    if (r.data?.ok && r.data.result) {
      setPollChoice(r.data.result.viewerChoice);
      setPoll((p) => (p ? { ...p, options: r.data!.result!.options } : p));
    }
  }, [post.id]);

  const copyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${permalink}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable */ }
  }, [permalink]);

  const moderate = useCallback(async (macro: 'mute' | 'block') => {
    setShowMenu(false);
    const r = await lensRun<{ muted?: boolean; blocked?: boolean }>('social', macro, { userId: post.userId });
    if (r.data?.ok) {
      setNotice(macro === 'mute'
        ? (r.data.result?.muted ? 'User muted.' : 'User unmuted.')
        : (r.data.result?.blocked ? 'User blocked.' : 'User unblocked.'));
      onChanged();
    }
  }, [post.userId, onChanged]);

  const submitReport = useCallback(async (reason: string) => {
    setShowReports(false);
    setShowMenu(false);
    const r = await lensRun('social', 'report', { postId: post.id, reason });
    if (r.data?.ok) setNotice('Report submitted to moderators.');
  }, [post.id]);

  const totalVotes = poll ? poll.options.reduce((n, o) => n + o.votes, 0) : 0;

  return (
    <article className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 hover:border-indigo-500/20 transition-colors">
      <div className="flex items-baseline gap-2">
        <span className="text-sm font-medium text-zinc-100">@{post.username}</span>
        <span className="text-[10px] text-zinc-400">{relTime(post.createdAt)}</span>
        <div className="relative ml-auto">
          <button
            type="button"
            onClick={() => setShowMenu((m) => !m)}
            className="rounded p-1 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-300"
            aria-label="Post menu"
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>
          {showMenu && (
            <div className="absolute right-0 top-7 z-20 w-44 rounded-lg border border-zinc-800 bg-zinc-950 py-1 text-xs shadow-xl">
              <button type="button" onClick={() => void moderate('mute')} className="flex w-full items-center gap-2 px-3 py-1.5 text-zinc-300 hover:bg-zinc-900">
                <VolumeX className="w-3.5 h-3.5" /> Mute @{post.username}
              </button>
              <button type="button" onClick={() => void moderate('block')} className="flex w-full items-center gap-2 px-3 py-1.5 text-zinc-300 hover:bg-zinc-900">
                <Ban className="w-3.5 h-3.5" /> Block @{post.username}
              </button>
              <button type="button" onClick={() => { setShowReports((v) => !v); }} className="flex w-full items-center gap-2 px-3 py-1.5 text-rose-400 hover:bg-zinc-900">
                <Flag className="w-3.5 h-3.5" /> Report post
              </button>
              {showReports && (
                <div className="border-t border-zinc-800 px-2 py-1">
                  {REPORT_REASONS.map((reason) => (
                    <button
                      key={reason}
                      type="button"
                      onClick={() => void submitReport(reason)}
                      className="block w-full rounded px-2 py-1 text-left capitalize text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
                    >
                      {reason}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {post.body && (
        <p className="mt-1 text-sm text-zinc-200 leading-snug whitespace-pre-wrap">{post.body}</p>
      )}

      {post.hashtags.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1.5">
          {post.hashtags.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => onOpenHashtag(tag)}
              className="text-[11px] font-medium text-indigo-300 hover:text-indigo-200"
            >
              #{tag}
            </button>
          ))}
        </div>
      )}

      {post.media.length > 0 && (
        <div className={cn('mt-2 grid gap-1.5', post.media.length === 1 ? 'grid-cols-1' : 'grid-cols-2')}>
          {post.media.map((m, i) => (
            <div key={`${m.url.slice(0, 24)}-${i}`} className="overflow-hidden rounded border border-zinc-800">
              {m.kind === 'image' ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={m.url} alt={m.alt || 'attachment'} className="w-full max-h-72 object-cover" />
              ) : (
                <video src={m.url} controls className="w-full max-h-72" />
              )}
            </div>
          ))}
        </div>
      )}

      {poll && (
        <div className="mt-2 space-y-1.5 rounded border border-zinc-800 bg-zinc-900/40 p-2">
          {poll.question && <p className="text-xs font-medium text-zinc-300">{poll.question}</p>}
          {poll.options.map((o) => {
            const pct = totalVotes > 0 ? Math.round((o.votes / totalVotes) * 100) : 0;
            const chosen = pollChoice === o.id;
            return (
              <button
                key={o.id}
                type="button"
                onClick={() => void vote(o.id)}
                className="relative w-full overflow-hidden rounded border border-zinc-800 px-2 py-1 text-left text-xs hover:border-indigo-500/40"
              >
                <div
                  className={cn('absolute inset-y-0 left-0', chosen ? 'bg-indigo-500/30' : 'bg-zinc-800/60')}
                  style={{ width: `${pct}%` }}
                />
                <span className="relative flex items-center justify-between">
                  <span className={cn('text-zinc-200', chosen && 'font-semibold')}>
                    {chosen && <Check className="mr-1 inline w-3 h-3" />}{o.label}
                  </span>
                  <span className="text-zinc-400">{pct}%</span>
                </span>
              </button>
            );
          })}
          <p className="flex items-center gap-1 text-[10px] text-zinc-400">
            <BarChart3 className="w-3 h-3" /> {totalVotes} vote{totalVotes === 1 ? '' : 's'}
          </p>
        </div>
      )}

      {post.quoteOf && (
        <div className="mt-2 rounded border border-zinc-800 bg-zinc-900/40 p-2 text-[11px] text-zinc-400">
          <Quote className="mr-1 inline w-3 h-3" />
          Quoting another post —
          <button type="button" onClick={() => onOpenDetail(post.quoteOf!)} className="ml-1 text-indigo-300 hover:underline">
            view original
          </button>
        </div>
      )}

      <div className="mt-2 flex items-center gap-3 text-zinc-400">
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowReactions((v) => !v)}
            className={cn('flex items-center gap-1 text-xs hover:text-rose-400', post.viewerReaction && 'text-rose-400')}
          >
            <Heart className={cn('w-4 h-4', post.viewerReaction && 'fill-rose-400')} />
            {post.reactionTotal > 0 && post.reactionTotal}
          </button>
          {showReactions && (
            <div className="absolute bottom-7 left-0 z-20 flex gap-0.5 rounded-full border border-zinc-800 bg-zinc-950 px-1.5 py-1 shadow-xl">
              {reactionIds.map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => void react(id)}
                  className={cn(
                    'rounded-full px-1 text-base hover:scale-125 transition-transform',
                    post.viewerReaction === id && 'bg-indigo-500/20',
                  )}
                  title={id}
                >
                  {REACTION_EMOJI[id] || '➕'}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => setShowReplies((v) => !v)}
          className="flex items-center gap-1 text-xs hover:text-indigo-300"
        >
          <MessageSquare className="w-4 h-4" />
          {post.replyCount > 0 && post.replyCount}
        </button>
        <button
          type="button"
          onClick={() => void repost()}
          className={cn('flex items-center gap-1 text-xs hover:text-emerald-400', post.viewerReposted && 'text-emerald-400')}
        >
          <Repeat2 className="w-4 h-4" />
          {post.repostCount > 0 && post.repostCount}
        </button>
        <button
          type="button"
          aria-label="Quote post"
          onClick={() => onQuote(post)}
          className="flex items-center gap-1 text-xs hover:text-indigo-300"
        >
          <Quote className="w-4 h-4" />
        </button>
        <div className="relative ml-auto">
          <button
            type="button"
            onClick={() => setShowShare((v) => !v)}
            className="flex items-center gap-1 text-xs hover:text-indigo-300"
            aria-label="Share post"
          >
            <Share2 className="w-4 h-4" />
          </button>
          {showShare && (
            <div className="absolute bottom-7 right-0 z-20 w-44 rounded-lg border border-zinc-800 bg-zinc-950 py-1 text-xs shadow-xl">
              <button type="button" onClick={() => void copyLink()} className="flex w-full items-center gap-2 px-3 py-1.5 text-zinc-300 hover:bg-zinc-900">
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Link2 className="w-3.5 h-3.5" />}
                {copied ? 'Link copied' : 'Copy permalink'}
              </button>
              <button type="button" onClick={() => { setShowShare(false); onOpenDetail(post.id); }} className="flex w-full items-center gap-2 px-3 py-1.5 text-zinc-300 hover:bg-zinc-900">
                <MessageSquare className="w-3.5 h-3.5" /> Open detail view
              </button>
              <button type="button" onClick={() => { setShowShare(false); onQuote(post); }} className="flex w-full items-center gap-2 px-3 py-1.5 text-zinc-300 hover:bg-zinc-900">
                <Quote className="w-3.5 h-3.5" /> Quote this post
              </button>
            </div>
          )}
        </div>
      </div>

      {notice && <p className="mt-1.5 text-[11px] text-emerald-400">{notice}</p>}

      {showReplies && (
        <div className="mt-2 border-t border-zinc-800 pt-2">
          <ReplyTree postId={post.id} username={username} />
        </div>
      )}
    </article>
  );
}
