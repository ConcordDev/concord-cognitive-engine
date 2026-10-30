'use client';

// CommentThread — nested comment view for a single post. Wires the
// timeline.comment-list / comment-add / comment-delete macros. Renders a
// real recursive reply tree (no placeholder input).

import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { lensRun } from '@/lib/api/client';
import { useUIStore } from '@/store/ui';
import {
  MessageCircle, CornerDownRight, Trash2, Loader2, Pencil, History,
  ThumbsUp, Heart, Laugh, Frown, Angry, Smile, Flag,
} from 'lucide-react';
import { ReportDialog } from './ReportDialog';
import { cn } from '@/lib/utils';
import type { Comment, ReactionKind } from './types';
import { timeAgo, exactTime } from './timeFormat';

interface CommentThreadProps {
  postId: string;
  /** Current viewer's id — used to gate the delete control. */
  viewerId: string;
}

// S-TL-6: comments react with the same 5-kind picker as posts (F9).
const REACTIONS: { id: ReactionKind; icon: typeof ThumbsUp; color: string; label: string }[] = [
  { id: 'like', icon: ThumbsUp, color: 'text-blue-500', label: 'Like' },
  { id: 'love', icon: Heart, color: 'text-red-500', label: 'Love' },
  { id: 'haha', icon: Laugh, color: 'text-yellow-500', label: 'Haha' },
  { id: 'sad', icon: Frown, color: 'text-yellow-500', label: 'Sad' },
  { id: 'angry', icon: Angry, color: 'text-orange-500', label: 'Angry' },
];

function CommentNode({
  comment,
  depth,
  postId,
  viewerId,
  onReply,
  onDelete,
  onEdit,
  onReact,
  busyId,
}: {
  comment: Comment;
  depth: number;
  postId: string;
  viewerId: string;
  onReply: (parentId: string, text: string) => void;
  onDelete: (commentId: string) => void;
  onEdit: (commentId: string, text: string) => void;
  onReact: (commentId: string, kind: ReactionKind) => void;
  busyId: string | null;
}) {
  const [replying, setReplying] = useState(false);
  const [draft, setDraft] = useState('');
  // S-TL-2: inline comment editing with viewable history.
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  // S-TL-6: the comment reaction picker.
  const [showPicker, setShowPicker] = useState(false);
  // S-TL-9: report someone else's comment (F12).
  const [reporting, setReporting] = useState(false);
  const mine = comment.isMine || (comment.authorId != null && comment.authorId === viewerId);
  const myReaction = comment.userReaction ? REACTIONS.find((r) => r.id === comment.userReaction) : null;

  const submit = () => {
    if (!draft.trim()) return;
    onReply(comment.id, draft.trim());
    setDraft('');
    setReplying(false);
  };

  const submitEdit = () => {
    if (!editDraft.trim() || editDraft.trim() === comment.text) return;
    onEdit(comment.id, editDraft.trim());
    setEditing(false);
  };

  return (
    <div className={cn(depth > 0 && 'ml-5 border-l border-gray-700 pl-3')}>
      <div className="flex gap-2 py-1.5">
        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="bg-[#3a3b3c] rounded-2xl px-3 py-1.5 inline-block max-w-full">
            <p className="text-xs font-semibold text-white">{comment.displayName || comment.authorId || 'Member'}</p>
            {editing ? (
              <span className="flex items-center gap-1.5 mt-0.5">
                <input
                  value={editDraft}
                  onChange={(e) => setEditDraft(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && submitEdit()}
                  autoFocus
                  className="bg-[#242526] rounded-full px-3 py-1 text-sm text-white placeholder-gray-500 outline-none focus:ring-1 focus:ring-blue-500"
                />
                <button
                  onClick={submitEdit}
                  disabled={!editDraft.trim() || editDraft.trim() === comment.text || busyId === comment.id}
                  className="px-2.5 py-1 rounded-full bg-blue-600 text-white text-[11px] disabled:opacity-40"
                >
                  Save
                </button>
                <button onClick={() => setEditing(false)} className="text-[11px] text-gray-300 hover:text-white">
                  Cancel
                </button>
              </span>
            ) : (
              <p className="text-sm text-gray-200 whitespace-pre-wrap break-words">{comment.text}</p>
            )}
          </div>
          <div className="flex items-center gap-3 mt-0.5 ml-2 text-[11px] text-gray-400">
            <span title={exactTime(comment.createdAt)}>{timeAgo(comment.createdAt)}</span>
            <button
              onClick={() => setShowPicker((p) => !p)}
              className={cn('hover:text-white font-medium inline-flex items-center gap-1', myReaction && myReaction.color)}
              aria-expanded={showPicker}
            >
              {myReaction ? <myReaction.icon className="w-3 h-3" /> : <Smile className="w-3 h-3" />}
              {myReaction ? myReaction.label : 'React'}
            </button>
            <button onClick={() => setReplying((r) => !r)} className="hover:text-white font-medium">
              Reply
            </button>
            {comment.editedAt && (
              <button
                onClick={() => setShowHistory((h) => !h)}
                className="hover:text-white inline-flex items-center gap-1"
                aria-expanded={showHistory}
                title="See what changed"
              >
                <History className="w-3 h-3" /> Edited
              </button>
            )}
            {mine && !editing && (
              <button
                onClick={() => { setEditDraft(comment.text); setEditing(true); }}
                className="hover:text-white inline-flex items-center gap-1"
              >
                <Pencil className="w-3 h-3" />
                Edit
              </button>
            )}
            {mine && (
              <button
                onClick={() => onDelete(comment.id)}
                disabled={busyId === comment.id}
                className="hover:text-red-400 inline-flex items-center gap-1"
              >
                {busyId === comment.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                Delete
              </button>
            )}
            {!mine && (
              <button
                onClick={() => setReporting(true)}
                className="hover:text-amber-400 inline-flex items-center gap-1"
              >
                <Flag className="w-3 h-3" />
                Report
              </button>
            )}
          </div>
          {/* S-TL-6: reaction picker + counts (F9) */}
          {showPicker && (
            <div className="flex gap-1 mt-1 ml-2 p-1 bg-[#242526] rounded-full border border-gray-700 w-fit">
              {REACTIONS.map((r) => {
                const Icon = r.icon;
                return (
                  <button
                    key={r.id}
                    onClick={() => { onReact(comment.id, r.id); setShowPicker(false); }}
                    title={r.label}
                    className={cn(
                      'p-1.5 rounded-full hover:bg-[#3a3b3c] hover:scale-125 transition-all',
                      comment.userReaction === r.id && 'bg-[#3a3b3c]',
                    )}
                  >
                    <Icon className={cn('w-4 h-4', r.color)} />
                  </button>
                );
              })}
            </div>
          )}
          {(comment.reactionTotal ?? 0) > 0 && (
            <div className="flex items-center gap-1 mt-1 ml-2">
              {REACTIONS.filter((r) => (comment.reactionCounts?.[r.id] ?? 0) > 0).map((r) => {
                const Icon = r.icon;
                return (
                  <button
                    key={r.id}
                    onClick={() => onReact(comment.id, r.id)}
                    title={`${r.label} — click to toggle yours`}
                    className={cn(
                      'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-[#3a3b3c] text-[10px]',
                      comment.userReaction === r.id ? 'text-white ring-1 ring-blue-500' : 'text-gray-300',
                    )}
                  >
                    <Icon className={cn('w-3 h-3', r.color)} />
                    {comment.reactionCounts?.[r.id]}
                  </button>
                );
              })}
            </div>
          )}
          {showHistory && comment.editHistory && comment.editHistory.length > 0 && (
            <div className="mt-1 ml-2 rounded-lg border border-gray-700 bg-[#242526] px-3 py-2 space-y-1.5 max-w-md">
              <p className="text-[11px] font-semibold text-gray-300">Edit history</p>
              {[...comment.editHistory].reverse().map((v, i) => (
                <div key={`${v.editedAt}-${i}`} className="border-t border-gray-700 pt-1.5 first:border-0 first:pt-0">
                  <p className="text-[10px] text-gray-500">Replaced {new Date(v.editedAt).toLocaleString()}</p>
                  <p className="text-xs text-gray-400 whitespace-pre-wrap break-words">{v.text}</p>
                </div>
              ))}
            </div>
          )}
          {replying && (
            <div className="flex gap-2 mt-1.5 ml-2">
              <CornerDownRight className="w-4 h-4 text-gray-400 mt-1.5 flex-shrink-0" />
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submit()}
                placeholder={`Reply to ${comment.displayName || comment.authorId || 'Member'}…`}
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
          onEdit={onEdit}
          onReact={onReact}
          busyId={busyId}
        />
      ))}
      {reporting && (
        <ReportDialog
          targetType="comment"
          targetId={comment.id}
          postId={postId}
          authorName={comment.displayName || 'Member'}
          onClose={() => setReporting(false)}
        />
      )}
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
    onSuccess: (r) => {
      if (r.data.ok) {
        invalidate();
        // D2/M7: commenting was silent.
        useUIStore.getState().addToast({ type: 'success', message: 'Comment posted' });
      } else {
        useUIStore.getState().addToast({ type: 'error', message: r.data.error || 'Could not post comment' });
      }
    },
  });

  const reactMutation = useMutation({
    mutationFn: (vars: { commentId: string; kind: ReactionKind }) =>
      lensRun('timeline', 'comment-react', { postId, commentId: vars.commentId, kind: vars.kind }),
    onSuccess: (r) => {
      if (r.data.ok) {
        qc.invalidateQueries({ queryKey: ['timeline-comments', postId] });
        const action = (r.data.result as { action?: string } | undefined)?.action;
        if (action === 'added' || action === 'changed') {
          useUIStore.getState().addToast({ type: 'success', message: 'Reaction added' });
        }
      } else {
        useUIStore.getState().addToast({ type: 'error', message: r.data.error || 'Could not react' });
      }
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (commentId: string) => lensRun('timeline', 'comment-delete', { postId, commentId }),
    onSuccess: invalidate,
    onSettled: () => setBusyId(null),
  });

  const updateMutation = useMutation({
    mutationFn: (vars: { commentId: string; text: string }) =>
      lensRun('timeline', 'comment-update', { postId, commentId: vars.commentId, text: vars.text }),
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
            onEdit={(id, text) => {
              setBusyId(id);
              updateMutation.mutate({ commentId: id, text });
            }}
            onReact={(commentId, kind) => reactMutation.mutate({ commentId, kind })}
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
