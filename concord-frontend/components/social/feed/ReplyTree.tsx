'use client';

/**
 * ReplyTree — threaded reply / comment tree for a social-domain post.
 *
 * Backlog item 1: threaded replies. Calls social.replyTree + social.addReply.
 * Renders a real nested comment tree with inline reply boxes at any depth.
 */

import { useCallback, useState } from 'react';
import { CornerDownRight, Loader2, Send, MessageSquare } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import type { SocialReply } from './types';

function relTime(iso: string): string {
  const d = Date.now() - new Date(iso).getTime();
  if (d < 60_000) return 'now';
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h`;
  return `${Math.floor(d / 86_400_000)}d`;
}

interface ReplyNodeProps {
  reply: SocialReply;
  postId: string;
  username: string;
  depth: number;
  onChanged: () => void;
}

function ReplyNode({ reply, postId, username, depth, onChanged }: ReplyNodeProps) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = useCallback(async () => {
    const trimmed = body.trim();
    if (!trimmed) return;
    setBusy(true);
    const r = await lensRun('social', 'addReply', {
      postId, parentId: reply.id, body: trimmed, username,
    });
    setBusy(false);
    if (r.data?.ok) { setBody(''); setOpen(false); onChanged(); }
  }, [body, postId, reply.id, username, onChanged]);

  return (
    <div style={{ marginLeft: depth > 0 ? 14 : 0 }} className={depth > 0 ? 'border-l border-zinc-800 pl-2.5' : ''}>
      <div className="py-1.5">
        <div className="flex items-baseline gap-1.5">
          <span className="text-xs font-medium text-zinc-200">@{reply.username}</span>
          <span className="text-[10px] text-zinc-600">{relTime(reply.createdAt)}</span>
        </div>
        <p className="text-xs text-zinc-300 leading-snug">{reply.body}</p>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="mt-0.5 flex items-center gap-1 text-[10px] text-zinc-500 hover:text-indigo-300"
        >
          <CornerDownRight className="w-3 h-3" /> Reply
        </button>
        {open && (
          <div className="mt-1 flex items-center gap-1.5">
            <input
              value={body}
              onChange={(e) => setBody(e.target.value.slice(0, 1000))}
              placeholder={`Reply to @${reply.username}…`}
              className="flex-1 rounded bg-zinc-900 px-2 py-1 text-xs text-zinc-100 placeholder-zinc-600 outline-none"
              onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
            />
            <button
              type="button"
              onClick={() => void submit()}
              disabled={busy}
              className="rounded bg-indigo-600 p-1 text-white hover:bg-indigo-500 disabled:opacity-50"
              aria-label="Send reply"
            >
              {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
            </button>
          </div>
        )}
      </div>
      {(reply.children || []).map((child) => (
        <ReplyNode
          key={child.id}
          reply={child}
          postId={postId}
          username={username}
          depth={depth + 1}
          onChanged={onChanged}
        />
      ))}
    </div>
  );
}

interface ReplyTreeProps {
  postId: string;
  username: string;
}

export function ReplyTree({ postId, username }: ReplyTreeProps) {
  const [tree, setTree] = useState<SocialReply[]>([]);
  const [total, setTotal] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await lensRun<{ tree: SocialReply[]; total: number }>('social', 'replyTree', { postId });
    setLoading(false);
    setLoaded(true);
    if (r.data?.ok && r.data.result) {
      setTree(r.data.result.tree || []);
      setTotal(r.data.result.total || 0);
    }
  }, [postId]);

  const submitRoot = useCallback(async () => {
    const trimmed = body.trim();
    if (!trimmed) return;
    setBusy(true);
    const r = await lensRun('social', 'addReply', { postId, body: trimmed, username });
    setBusy(false);
    if (r.data?.ok) { setBody(''); void load(); }
  }, [body, postId, username, load]);

  if (!loaded) {
    return (
      <button
        type="button"
        onClick={() => void load()}
        className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-indigo-300"
      >
        <MessageSquare className="w-3.5 h-3.5" />
        {loading ? 'Loading replies…' : 'Show replies'}
      </button>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <input
          value={body}
          onChange={(e) => setBody(e.target.value.slice(0, 1000))}
          placeholder="Write a reply…"
          className="flex-1 rounded bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100 placeholder-zinc-600 outline-none"
          onKeyDown={(e) => { if (e.key === 'Enter') void submitRoot(); }}
        />
        <button
          type="button"
          onClick={() => void submitRoot()}
          disabled={busy}
          className="rounded bg-indigo-600 p-1.5 text-white hover:bg-indigo-500 disabled:opacity-50"
          aria-label="Send reply"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
        </button>
      </div>
      {total === 0 ? (
        <p className="text-[11px] text-zinc-600 italic">No replies yet — be the first.</p>
      ) : (
        <div>
          {tree.map((node) => (
            <ReplyNode key={node.id} reply={node} postId={postId} username={username} depth={0} onChanged={load} />
          ))}
        </div>
      )}
    </div>
  );
}
