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
  score: number;
  depth?: number;
  createdAt?: string;
  awards?: { id: string; icon: string; name: string }[];
  replies?: ForumPost[];
}

const EMPTY_DRAFT: RichDraft = { body: '', format: 'plain', images: [] };

export function FmCommentTree({
  nodes, locked, savedIds,
  onVote, onReply, onAward, onSave,
}: {
  nodes: ForumPost[];
  locked: boolean;
  savedIds: Set<string>;
  onVote: (postId: string, direction: number) => void;
  onReply: (parentId: string, draft: RichDraft) => Promise<void>;
  onAward: (postId: string) => void;
  onSave: (postId: string) => void;
}) {
  if (nodes.length === 0) {
    return <p className="text-[11px] text-zinc-400 italic py-4 text-center">No replies yet.</p>;
  }
  return (
    <ul className="space-y-2">
      {nodes.map((n) => (
        <CommentNode key={n.id} node={n} locked={locked} savedIds={savedIds}
          onVote={onVote} onReply={onReply} onAward={onAward} onSave={onSave} />
      ))}
    </ul>
  );
}

function CommentNode({
  node, locked, savedIds, onVote, onReply, onAward, onSave,
}: {
  node: ForumPost;
  locked: boolean;
  savedIds: Set<string>;
  onVote: (postId: string, direction: number) => void;
  onReply: (parentId: string, draft: RichDraft) => Promise<void>;
  onAward: (postId: string) => void;
  onSave: (postId: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [replying, setReplying] = useState(false);
  const [draft, setDraft] = useState<RichDraft>(EMPTY_DRAFT);
  const [busy, setBusy] = useState(false);
  const kids = node.replies || [];
  const saved = savedIds.has(node.id);

  const submitReply = async () => {
    if (!draft.body.trim() || busy) return;
    setBusy(true);
    await onReply(node.id, draft);
    setBusy(false);
    setDraft(EMPTY_DRAFT);
    setReplying(false);
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
                <FmMarkdown text={node.body} format={node.format} />
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
                  <FmCommentTree nodes={kids} locked={locked} savedIds={savedIds}
                    onVote={onVote} onReply={onReply} onAward={onAward} onSave={onSave} />
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
