'use client';

// CommentThread — nested comment view for a single post. Wires the
// timeline.comment-list / comment-add / comment-delete macros. Renders a
// real recursive reply tree (no placeholder input).

import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { lensRun } from '@/lib/api/client';
import { MessageCircle, CornerDownRight, Trash2, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Comment } from './types';

interface CommentThreadProps {
  postId: string;
  /** Current viewer's id — used to gate the delete control. */
  viewerId: string;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3600000);
  if (h < 1) return 'just now';
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(iso).toLocaleDateString();
}

function CommentNode({
  comment,
  depth,
  postId,
  viewerId,
  onReply,
  onDelete,
  busyId,
}: {
  comment: Comment;
  depth: number;
  postId: string;
  viewerId: string;
  onReply: (parentId: string, text: string) => void;
  onDelete: (commentId: string) => void;
  busyId: string | null;
}) {
  const [replying, setReplying] = useState(false);
  const [draft, setDraft] = useState('');

  const submit = () => {
    if (!draft.trim()) return;
    onReply(comment.id, draft.trim());
    setDraft('');
    setReplying(false);
  };

  return (
    <div className={cn(depth > 0 && 'ml-5 border-l border-gray-700 pl-3')}>
      <div className="flex gap-2 py-1.5">
        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="bg-[#3a3b3c] rounded-2xl px-3 py-1.5 inline-block max-w-full">
            <p className="text-xs font-semibold text-white">{comment.authorId}</p>
            <p className="text-sm text-gray-200 whitespace-pre-wrap break-words">{comment.text}</p>
          </div>
          <div className="flex items-center gap-3 mt-0.5 ml-2 text-[11px] text-gray-400">
            <span>{timeAgo(comment.createdAt)}</span>
            <button onClick={() => setReplying((r) => !r)} className="hover:text-white font-medium">
              Reply
            </button>
            {comment.authorId === viewerId && (
              <button
                onClick={() => onDelete(comment.id)}
                disabled={busyId === comment.id}
                className="hover:text-red-400 inline-flex items-center gap-1"
              >
                {busyId === comment.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                Delete
              </button>
            )}
          </div>
          {replying && (
            <div className="flex gap-2 mt-1.5 ml-2">
              <CornerDownRight className="w-4 h-4 text-gray-400 mt-1.5 flex-shrink-0" />
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submit()}
                placeholder={`Reply to ${comment.authorId}…`}
                autoFocus
                className="flex-1 bg-[#3a3b3c] rounded-full px-3 py-1.5 text-sm text-white placeholder-gray-500 outline-none focus:ring-1 focus:ring-blue-500"
              />
              <button
                onClick={submit}
                disabled={!draft.trim()}
                className="px-3 py-1 rounded-full bg-blue-600 text-white text-xs disabled:opacity-40"
              >
                Send
              </button>
            </div>
          )}
        </div>
      </div>
      {comment.replies?.map((child) => (
        <CommentNode
          key={child.id}
          comment={child}
          depth={depth + 1}
          postId={postId}
          viewerId={viewerId}
          onReply={onReply}
          onDelete={onDelete}
          busyId={busyId}
        />
      ))}
    </div>
  );
}

export function CommentThread({ postId, viewerId }: CommentThreadProps) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['timeline-comments', postId],
    queryFn: async () => {
      const r = await lensRun<{ thread: Comment[]; total: number }>('timeline', 'comment-list', { postId });
      return r.data.result ?? { thread: [], total: 0 };
    },
  });

  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['timeline-comments', postId] });
    qc.invalidateQueries({ queryKey: ['timeline-feed'] });
  }, [qc, postId]);

  const addMutation = useMutation({
    mutationFn: (vars: { text: string; parentId?: string }) =>
      lensRun('timeline', 'comment-add', { postId, text: vars.text, parentId: vars.parentId }),
    onSuccess: invalidate,
  });

  const deleteMutation = useMutation({
    mutationFn: (commentId: string) => lensRun('timeline', 'comment-delete', { postId, commentId }),
    onSuccess: invalidate,
    onSettled: () => setBusyId(null),
  });

  const submitRoot = () => {
    if (!draft.trim()) return;
    addMutation.mutate({ text: draft.trim() });
    setDraft('');
  };

  return (
    <div className="px-4 pb-3 pt-1 space-y-1">
      <div className="flex items-center gap-1.5 text-xs text-gray-400 font-medium mb-1">
        <MessageCircle className="w-3.5 h-3.5" />
        {data?.total ?? 0} comment{(data?.total ?? 0) === 1 ? '' : 's'}
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-xs text-gray-400 py-2">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading comments…
        </div>
      ) : (
        (data?.thread ?? []).map((c) => (
          <CommentNode
            key={c.id}
            comment={c}
            depth={0}
            postId={postId}
            viewerId={viewerId}
            onReply={(parentId, text) => addMutation.mutate({ text, parentId })}
            onDelete={(id) => {
              setBusyId(id);
              deleteMutation.mutate(id);
            }}
            busyId={busyId}
          />
        ))
      )}

      <div className="flex gap-2 pt-1">
        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex-shrink-0" />
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submitRoot()}
          placeholder="Write a comment…"
          className="flex-1 bg-[#3a3b3c] rounded-full px-3 py-1.5 text-sm text-white placeholder-gray-500 outline-none focus:ring-1 focus:ring-blue-500"
        />
        <button
          onClick={submitRoot}
          disabled={!draft.trim() || addMutation.isPending}
          className="px-3 py-1.5 rounded-full bg-blue-600 text-white text-xs font-medium disabled:opacity-40"
        >
          {addMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Post'}
        </button>
      </div>
    </div>
  );
}
