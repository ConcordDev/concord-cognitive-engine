'use client';

/**
 * CommentThread — drop-in threaded comments for any post/DTU/artifact.
 *
 * Phase 10c: surfaces /api/social/comment{,s} as a single composable
 * component. Drop into any DTU detail view, chat citation, council
 * proposal, paper claim, etc.
 *
 *   <CommentThread postId={dtu.id} />
 *
 * Substrate:
 *   - GET  /api/social/comments/:postId → { ok, comments: [...] }
 *   - POST /api/social/comment           → { postId, content, parentCommentId? }
 *   - DELETE /api/social/comment/:postId/:commentId
 *
 * Backend supports threading via parentCommentId; the UI renders a
 * single-level reply tree (collapse-deep replies after depth 2 so the
 * thread stays readable).  Honest empty + error states; no fake stubs.
 */

import { useCallback, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { MessageSquare, Loader2, AlertTriangle, Send, Trash2, CornerDownRight } from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { UserLink } from './UserLink';

interface Comment {
  id: string;
  userId: string;
  username?: string;
  displayName?: string;
  avatarUrl?: string | null;
  content: string;
  createdAt: string;
  parentCommentId?: string | null;
}

interface CommentsResponse {
  ok: boolean;
  comments?: Comment[];
}

export interface CommentThreadProps {
  postId: string;
  /** Max replies-of-reply depth to show inline. Default 2. */
  maxDepth?: number;
  /** Show the input box for new top-level comments. Default true. */
  showComposer?: boolean;
  /** Current user id for delete-permission check. Optional. */
  currentUserId?: string | null;
  /** Collapse the thread by default, show "Show comments (N)" button. Default false. */
  collapsed?: boolean;
  className?: string;
}

function timeAgo(iso: string): string {
  const delta = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (delta < 60) return `${delta}s`;
  if (delta < 3600) return `${Math.floor(delta / 60)}m`;
  if (delta < 86400) return `${Math.floor(delta / 3600)}h`;
  return `${Math.floor(delta / 86400)}d`;
}

export function CommentThread({
  postId,
  maxDepth = 2,
  showComposer = true,
  currentUserId,
  collapsed: collapsedDefault = false,
  className,
}: CommentThreadProps) {
  const [collapsed, setCollapsed] = useState(collapsedDefault);
  const [draftText, setDraftText] = useState('');
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery<CommentsResponse | null>({
    queryKey: ['social-comments', postId],
    queryFn: async () => {
      try {
        const r = await api.get<CommentsResponse>(`/api/social/comments/${encodeURIComponent(postId)}?limit=100`);
        return r?.data;
      } catch { return null; }
    },
    enabled: !!postId && !collapsed,
    staleTime: 30_000,
  });

  const comments = useMemo(() => data?.comments || [], [data]);
  const total = comments.length;

  // Group by parentCommentId for the tree.
  const tree = useMemo(() => {
    const byParent = new Map<string | null, Comment[]>();
    for (const c of comments) {
      const pid = c.parentCommentId || null;
      if (!byParent.has(pid)) byParent.set(pid, []);
      byParent.get(pid)!.push(c);
    }
    return byParent;
  }, [comments]);

  const postMutation = useMutation({
    mutationFn: async (input: { content: string; parentCommentId?: string | null }) => {
      const r = await api.post('/api/social/comment', { postId, ...input });
      return r?.data;
    },
    onSuccess: () => {
      setDraftText('');
      setReplyText('');
      setReplyTo(null);
      queryClient.invalidateQueries({ queryKey: ['social-comments', postId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (commentId: string) => {
      const r = await api.delete(`/api/social/comment/${encodeURIComponent(postId)}/${encodeURIComponent(commentId)}`);
      return r?.data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['social-comments', postId] }),
  });

  const renderComment = useCallback((c: Comment, depth: number): React.ReactNode => {
    const children = tree.get(c.id) || [];
    const canDelete = currentUserId && c.userId === currentUserId;
    return (
      <li key={c.id} className={cn('py-2', depth > 0 && 'pl-4 border-l border-zinc-800 ml-2')}>
        <div className="flex items-baseline gap-2 mb-0.5">
          <UserLink
            username={c.username}
            userId={c.userId}
            displayName={c.displayName}
            className="text-xs"
          />
          <span className="text-[10px] text-zinc-500 font-mono">{timeAgo(c.createdAt)}</span>
          {canDelete && (
            <button
              type="button"
              onClick={() => deleteMutation.mutate(c.id)}
              disabled={deleteMutation.isPending}
              className="ml-auto text-[10px] text-zinc-500 hover:text-rose-300 disabled:opacity-40"
              title="Delete comment"
            >
              <Trash2 className="w-2.5 h-2.5" />
            </button>
          )}
        </div>
        <p className="text-xs text-zinc-300 whitespace-pre-wrap leading-snug">{c.content}</p>
        <button
          type="button"
          onClick={() => { setReplyTo(replyTo === c.id ? null : c.id); setReplyText(''); }}
          className="mt-1 inline-flex items-center gap-0.5 text-[10px] text-zinc-500 hover:text-indigo-300"
        >
          <CornerDownRight className="w-2.5 h-2.5" /> Reply
        </button>
        {replyTo === c.id && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!replyText.trim()) return;
              postMutation.mutate({ content: replyText.trim(), parentCommentId: c.id });
            }}
            className="mt-1 flex items-center gap-1"
          >
            <input
              type="text"
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              placeholder="Reply…"
              autoFocus
              className="flex-1 text-xs bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-indigo-500/40"
            />
            <button
              type="submit"
              disabled={postMutation.isPending || !replyText.trim()}
              className="text-xs px-2 py-1 rounded bg-indigo-700/40 hover:bg-indigo-700/60 text-indigo-100 border border-indigo-600/60 disabled:opacity-40"
            >
              {postMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
            </button>
          </form>
        )}
        {depth < maxDepth && children.length > 0 && (
          <ul className="mt-1">
            {children.map(child => renderComment(child, depth + 1))}
          </ul>
        )}
        {depth >= maxDepth && children.length > 0 && (
          <div className="mt-1 text-[10px] text-zinc-500 italic ml-4">
            +{children.length} deeper repl{children.length === 1 ? 'y' : 'ies'} (open in detail view)
          </div>
        )}
      </li>
    );
  }, [tree, currentUserId, deleteMutation, replyTo, replyText, postMutation, maxDepth]);

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        className={cn(
          'inline-flex items-center gap-1 text-[11px] text-zinc-500 hover:text-zinc-200',
          className,
        )}
      >
        <MessageSquare className="w-3 h-3" />
        Show comments
      </button>
    );
  }

  const topLevel = tree.get(null) || [];

  return (
    <section className={cn('rounded border border-zinc-800/60 bg-zinc-950/40', className)}>
      <header className="flex items-center gap-2 px-3 py-1.5 border-b border-zinc-800/40">
        <MessageSquare className="w-3.5 h-3.5 text-zinc-400" />
        <h4 className="text-[11px] font-medium text-zinc-300 flex-1">
          Comments {total > 0 && <span className="text-zinc-500 font-mono">({total})</span>}
        </h4>
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          className="text-[10px] text-zinc-500 hover:text-zinc-200"
        >
          hide
        </button>
      </header>

      {isLoading && (
        <div className="px-3 py-2 text-[11px] text-zinc-500 flex items-center gap-1">
          <Loader2 className="w-3 h-3 animate-spin" /> Loading…
        </div>
      )}

      {error && (
        <div className="px-3 py-2 text-[11px] text-rose-300/80">
          <AlertTriangle className="inline w-3 h-3 mr-1" /> Comments unreachable
        </div>
      )}

      {!isLoading && !error && topLevel.length === 0 && (
        <div className="px-3 py-3 text-[11px] text-zinc-500 italic">
          No comments yet. Be the first.
        </div>
      )}

      {topLevel.length > 0 && (
        <ul className="px-3 divide-y divide-zinc-800/40">
          {topLevel.map(c => renderComment(c, 0))}
        </ul>
      )}

      {showComposer && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!draftText.trim()) return;
            postMutation.mutate({ content: draftText.trim() });
          }}
          className="border-t border-zinc-800/40 px-3 py-2 flex items-center gap-1.5"
        >
          <input
            type="text"
            value={draftText}
            onChange={(e) => setDraftText(e.target.value)}
            placeholder="Write a comment…"
            className="flex-1 text-xs bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-indigo-500/40"
          />
          <button
            type="submit"
            disabled={postMutation.isPending || !draftText.trim()}
            className="text-xs px-2 py-1 rounded bg-indigo-700/40 hover:bg-indigo-700/60 text-indigo-100 border border-indigo-600/60 disabled:opacity-40"
          >
            {postMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Post'}
          </button>
        </form>
      )}
    </section>
  );
}

export default CommentThread;
