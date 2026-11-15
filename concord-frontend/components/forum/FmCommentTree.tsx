'use client';

/**
 * FmCommentTree — recursive nested reply tree with per-node
 * collapse/expand, inline voting, awards, save and reply.
 */

import { useState } from 'react';
import { ChevronUp, ChevronDown, MessageSquare, Award, Bookmark, Minus, Plus } from 'lucide-react';
import { FmMarkdown } from './fmMarkdown';
import { FmRichEditor, type RichDraft } from './FmRichEditor';

export interface ForumPost {
  id: string;
  parentId: string | null;
  body: string;
  format?: string;
  images?: string[];
  author: string;
  authorId?: string;
  editedAt?: string;
  score: number;
  depth?: number;
  createdAt?: string;
  awards?: { id: string; icon: string; name: string }[];
  replies?: ForumPost[];
}

const EMPTY_DRAFT: RichDraft = { body: '', format: 'plain', images: [] };

function timeAgo(iso?: string) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3600000);
  if (h < 1) return 'just now';
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function FmCommentTree({
  nodes, locked, savedIds, viewerId = null,
  onVote, onReply, onAward, onSave, onEdit, onDelete,
}: {
  nodes: ForumPost[];
  locked: boolean;
  savedIds: Set<string>;
  viewerId?: string | null;
  onVote: (postId: string, direction: number) => void;
  onReply: (parentId: string, draft: RichDraft) => Promise<void>;
  onAward: (postId: string) => void;
  onSave: (postId: string) => void;
  onEdit?: (postId: string, draft: RichDraft) => Promise<void>;
  onDelete?: (postId: string) => Promise<void>;
}) {
  if (nodes.length === 0) {
    return <p className="text-[11px] text-zinc-400 italic py-4 text-center">No replies yet.</p>;
  }
  return (
    <ul className="space-y-2">
      {nodes.map((n) => (
        <CommentNode key={n.id} node={n} locked={locked} savedIds={savedIds} viewerId={viewerId}
          onVote={onVote} onReply={onReply} onAward={onAward} onSave={onSave}
          onEdit={onEdit} onDelete={onDelete} />
      ))}
    </ul>
  );
}

function CommentNode({
  node, locked, savedIds, viewerId = null, onVote, onReply, onAward, onSave, onEdit, onDelete,
}: {
  node: ForumPost;
  locked: boolean;
  savedIds: Set<string>;
  viewerId?: string | null;
  onVote: (postId: string, direction: number) => void;
  onReply: (parentId: string, draft: RichDraft) => Promise<void>;
  onAward: (postId: string) => void;
  onSave: (postId: string) => void;
  onEdit?: (postId: string, draft: RichDraft) => Promise<void>;
  onDelete?: (postId: string) => Promise<void>;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [replying, setReplying] = useState(false);
  const [draft, setDraft] = useState<RichDraft>(EMPTY_DRAFT);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState<RichDraft>(EMPTY_DRAFT);
  const [armDelete, setArmDelete] = useState(false);
  const kids = node.replies || [];
  const saved = savedIds.has(node.id);
  const mine = !!viewerId && !!node.authorId && node.authorId === viewerId;

  const submitReply = async () => {
    if (!draft.body.trim() || busy) return;
    setBusy(true);
    await onReply(node.id, draft);
    setBusy(false);
    setDraft(EMPTY_DRAFT);
    setReplying(false);
  };

  const submitEdit = async () => {
    if (!onEdit || !editDraft.body.trim() || busy) return;
    setBusy(true);
    await onEdit(node.id, editDraft);
    setBusy(false);
    setEditing(false);
  };

  return (
    <li className="border-l-2 border-zinc-800 pl-2.5">
      <div className="flex gap-2.5">
        <div className="flex flex-col items-center shrink-0">
          <button type="button" onClick={() => onVote(node.id, 1)}
            className="text-zinc-400 hover:text-orange-400" aria-label="Upvote">
            <ChevronUp className="w-3.5 h-3.5" />
          </button>
          <span className="text-[11px] font-bold text-zinc-200">{node.score}</span>
          <button type="button" onClick={() => onVote(node.id, -1)}
            className="text-zinc-400 hover:text-sky-400" aria-label="Downvote">
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setCollapsed((c) => !c)}
              className="flex items-center gap-1 text-[10px] text-zinc-400 hover:text-orange-300"
              aria-label={collapsed ? 'Expand thread' : 'Collapse thread'}>
              {collapsed ? <Plus className="w-3 h-3" /> : <Minus className="w-3 h-3" />}
            </button>
            <span className="text-[10px] font-medium text-orange-300">{node.author}</span>
            {node.createdAt && <span className="text-[10px] text-zinc-400">{timeAgo(node.createdAt)}</span>}
            {node.editedAt && <span className="text-[10px] text-zinc-400">edited</span>}
            {kids.length > 0 && (
              <span className="text-[10px] text-zinc-400">
                {countDescendants(node)} repl{countDescendants(node) === 1 ? 'y' : 'ies'}
              </span>
            )}
            {(node.awards || []).map((a) => (
              <span key={a.id} title={a.name} className="text-[11px]">{a.icon}</span>
            ))}
          </div>

          {!collapsed && (
            <>
              <div className="mt-1">
                {editing ? (
                  <div className="space-y-2">
                    <FmRichEditor value={editDraft} onChange={setEditDraft} rows={2} placeholder="Edit your reply…" />
                    <div className="flex justify-end gap-2">
                      <button type="button" onClick={() => setEditing(false)}
                        className="px-2.5 py-1 text-[11px] text-zinc-400 hover:text-zinc-200">Cancel edit</button>
                      <button type="button" onClick={submitEdit} disabled={busy || !editDraft.body.trim()}
                        className="px-3 py-1 text-[11px] font-medium bg-orange-600 hover:bg-orange-500 disabled:opacity-40 text-white rounded-lg">
                        Save changes
                      </button>
                    </div>
                  </div>
                ) : (
                  <FmMarkdown text={node.body} format={node.format} />
                )}
              </div>
              {(node.images || []).length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {(node.images || []).map((src) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={src} src={src} alt="embedded" loading="lazy"
                      className="max-h-32 rounded-lg border border-zinc-800 object-cover" />
                  ))}
                </div>
              )}
              <div className="flex items-center gap-3 mt-1.5">
                {!locked && (
                  <button type="button" onClick={() => setReplying((r) => !r)}
                    className="flex items-center gap-1 text-[10px] text-zinc-400 hover:text-orange-300">
                    <MessageSquare className="w-3 h-3" /> Reply
                  </button>
                )}
                <button type="button" onClick={() => onAward(node.id)}
                  className="flex items-center gap-1 text-[10px] text-zinc-400 hover:text-amber-300">
                  <Award className="w-3 h-3" /> Award
                </button>
                <button type="button" onClick={() => onSave(node.id)}
                  className={`flex items-center gap-1 text-[10px] ${saved ? 'text-orange-400' : 'text-zinc-400 hover:text-orange-300'}`}>
                  <Bookmark className="w-3 h-3" /> {saved ? 'Saved' : 'Save'}
                </button>
                {mine && onEdit && !editing && (
                  <button type="button" onClick={() => { setEditDraft({ body: node.body, format: (node.format as 'plain' | 'markdown') || 'plain', images: node.images || [] }); setEditing(true); }}
                    className="text-[10px] text-zinc-400 hover:text-orange-300">
                    Edit
                  </button>
                )}
                {mine && onDelete && (
                  armDelete ? (
                    <span className="flex items-center gap-1.5">
                      <button type="button" onClick={() => { void onDelete(node.id); }}
                        className="text-[10px] font-medium text-rose-300 hover:text-rose-200">
                        Delete this reply? Click again to confirm
                      </button>
                      <button type="button" onClick={() => setArmDelete(false)}
                        className="text-[10px] text-zinc-400 hover:text-zinc-200">
                        Keep
                      </button>
                    </span>
                  ) : (
                    <button type="button" onClick={() => setArmDelete(true)}
                      className="text-[10px] text-zinc-400 hover:text-rose-300">
                      Delete
                    </button>
                  )
                )}
              </div>

              {replying && (
                <div className="mt-2 space-y-2">
                  <FmRichEditor value={draft} onChange={setDraft} rows={2} placeholder="Write a reply…" />
                  <div className="flex justify-end gap-2">
                    <button type="button" onClick={() => { setReplying(false); setDraft(EMPTY_DRAFT); }}
                      className="px-2.5 py-1 text-[11px] text-zinc-400 hover:text-zinc-200">Cancel</button>
                    <button type="button" onClick={submitReply} disabled={busy || !draft.body.trim()}
                      className="px-3 py-1 text-[11px] font-medium bg-orange-600 hover:bg-orange-500 disabled:opacity-40 text-white rounded-lg">
                      Reply
                    </button>
                  </div>
                </div>
              )}

              {kids.length > 0 && (
                <div className="mt-2">
                  <FmCommentTree nodes={kids} locked={locked} savedIds={savedIds} viewerId={viewerId}
                    onVote={onVote} onReply={onReply} onAward={onAward} onSave={onSave}
                    onEdit={onEdit} onDelete={onDelete} />
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </li>
  );
}

function countDescendants(node: ForumPost): number {
  return (node.replies || []).reduce((s, c) => s + 1 + countDescendants(c), 0);
}
