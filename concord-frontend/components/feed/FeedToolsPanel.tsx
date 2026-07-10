'use client';

/**
 * FeedToolsPanel — the 2026 X/Threads parity surface for the feed lens.
 *
 * Seven tabs, each wired to real `feed` domain macros via lensRun:
 *   For You   — algorithmic ranked recommendation model (affinity-summary / rank-for-you)
 *   Threads   — quote-post + threaded reply trees with collapse (thread-*)
 *   Lists     — curated timelines and per-list feeds (list-*)
 *   Polls     — composer polls + live results (poll-*)
 *   Saved     — bookmark folders + saved-search alerts (folder-*, saved-search-*)
 *   Spaces    — live audio rooms (space-*)
 *   Controls  — mute words / sensitive-media / block (controls-*)
 *
 * No mock data — every value is real user input or computed by the backend.
 */

import { useState, useEffect, useCallback } from 'react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import {
  Sparkles,
  MessageSquare,
  ListChecks,
  BarChart3,
  Bookmark,
  Radio,
  ShieldAlert,
  Plus,
  Trash2,
  ChevronDown,
  ChevronRight,
  Loader2,
  Pin,
  Mic,
  Ear,
  Search,
  X,
} from 'lucide-react';

// ── Shared types ───────────────────────────────────────────────────────────

type ToolTab =
  | 'for-you'
  | 'threads'
  | 'lists'
  | 'polls'
  | 'saved'
  | 'spaces'
  | 'controls';

interface AffinityAuthor {
  authorId: string;
  affinity: number;
  likes: number;
  replies: number;
  reposts: number;
  views: number;
  bookmarks: number;
}

interface ThreadNode {
  id: string;
  parentId: string | null;
  kind: 'post' | 'reply' | 'quote';
  body: string;
  quotedId: string | null;
  quotedAuthor: string | null;
  quotedBody: string | null;
  author: string;
  collapsed: boolean;
  createdAt: string;
  replyCount: number;
  children: ThreadNode[];
}

interface FeedList {
  id: string;
  name: string;
  description: string;
  members: string[];
  pinned: boolean;
  createdAt: string;
}

interface PollOption {
  id: string;
  label: string;
  votes: number;
  percent: number;
}
interface Poll {
  id: string;
  question: string;
  options: PollOption[];
  totalVotes: number;
  closesAt: string;
  closed: boolean;
  myVote: string | null;
}

interface BookmarkFolder {
  id: string;
  name: string;
  items: string[];
  itemCount: number;
  createdAt: string;
}

interface SavedSearch {
  id: string;
  query: string;
  alert: boolean;
  lastChecked: string;
  createdAt: string;
}

interface Space {
  id: string;
  title: string;
  topic: string;
  hostId: string;
  speakers: string[];
  listeners: string[];
  speakerCount: number;
  listenerCount: number;
  status: 'live' | 'ended';
  createdAt: string;
  endedAt: string | null;
}

interface Controls {
  mutedWords: string[];
  blockedUsers: string[];
  sensitiveMedia: 'blur' | 'show' | 'hide';
}

/**
 * CandidatePost — the shape `rank-for-you` / `list-feed` / `saved-search-run`
 * / `controls-apply` all expect for their `candidates` param (server/domains/
 * feed.js). These 4 macros are pure filter/rank functions over a caller-
 * supplied post set — the feed domain's own shadow state only holds
 * per-user preference/interaction state (affinity, lists, saved searches,
 * controls), not the actual post corpus (that lives in the real social
 * feed system). The parent page passes the real, currently-loaded feed
 * posts down as `candidates` so these 4 macros have real data to operate
 * on instead of being structurally unreachable.
 */
export interface CandidatePost {
  id: string;
  authorId: string;
  content: string;
  tags?: string[];
  likes?: number;
  comments?: number;
  reposts?: number;
  createdAt?: string;
  sensitive?: boolean;
}

interface RankedPost {
  id: string;
  authorId: string;
  score: number;
  affinity: number;
  recency: number;
  engagement: number;
  reasons: string[];
}

// ── Small UI atoms ─────────────────────────────────────────────────────────

function SectionHeader({ icon: Icon, title, hint }: { icon: typeof Plus; title: string; hint?: string }) {
  return (
    <div className="mb-3">
      <h3 className="flex items-center gap-2 text-sm font-bold text-white">
        <Icon className="w-4 h-4 text-neon-cyan" />
        {title}
      </h3>
      {hint && <p className="mt-0.5 text-[11px] text-gray-400">{hint}</p>}
    </div>
  );
}

function EmptyHint({ text }: { text: string }) {
  return <p className="py-6 text-center text-xs text-gray-400">{text}</p>;
}

// ── For You — affinity model ───────────────────────────────────────────────

function ForYouTool({ candidates }: { candidates: CandidatePost[] }) {
  const [authors, setAuthors] = useState<AffinityAuthor[]>([]);
  const [loading, setLoading] = useState(false);
  const [ranked, setRanked] = useState<RankedPost[] | null>(null);
  const [ranking, setRanking] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await lensRun<{ authors: AffinityAuthor[] }>('feed', 'affinity-summary', {});
    if (r.data?.ok && r.data.result) setAuthors(r.data.result.authors || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const runRanking = useCallback(async () => {
    setRanking(true);
    const r = await lensRun<{ ranked: RankedPost[] }>('feed', 'rank-for-you', { candidates });
    if (r.data?.ok && r.data.result) setRanked(r.data.result.ranked || []);
    setRanking(false);
  }, [candidates]);

  const maxAffinity = Math.max(1, ...authors.map((a) => a.affinity));

  return (
    <div>
      <SectionHeader
        icon={Sparkles}
        title="For You — recommendation model"
        hint="The ranking model learns a per-author affinity from your own likes, replies, reposts and bookmarks. Engage with posts in the feed to train it."
      />
      {loading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="w-5 h-5 animate-spin text-neon-cyan" />
        </div>
      ) : authors.length === 0 ? (
        <EmptyHint text="No signals learned yet. Like, reply or repost to teach the For You ranking." />
      ) : (
        <ul className="space-y-2">
          {authors.map((a) => (
            <li key={a.authorId} className="rounded-lg bg-lattice-deep border border-lattice-border p-2.5">
              <div className="flex items-center justify-between text-sm">
                <span className="font-semibold text-white">@{a.authorId}</span>
                <span className="font-mono text-xs text-neon-cyan">affinity {a.affinity}</span>
              </div>
              <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-white/5">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-neon-cyan to-neon-purple"
                  style={{ width: `${(a.affinity / maxAffinity) * 100}%` }}
                />
              </div>
              <p className="mt-1 text-[11px] text-gray-400">
                {a.likes} likes · {a.replies} replies · {a.reposts} reposts · {a.bookmarks} bookmarks
              </p>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 border-t border-lattice-border pt-3">
        <button
          onClick={runRanking}
          disabled={ranking || candidates.length === 0}
          className="flex items-center gap-1.5 rounded-full bg-white/5 px-3 py-1.5 text-xs font-medium text-neon-cyan hover:bg-white/10 disabled:opacity-40"
        >
          {ranking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
          Rank the {candidates.length} posts currently loaded
        </button>
        {candidates.length === 0 && (
          <p className="mt-1.5 text-[11px] text-gray-400">Scroll the main feed to load posts, then rank them here.</p>
        )}
        {ranked && (
          <ul className="mt-2 space-y-1.5">
            {ranked.length === 0 && <EmptyHint text="Nothing ranked — the loaded posts were all muted or blocked." />}
            {ranked.slice(0, 10).map((r, i) => (
              <li key={r.id} className="rounded-lg bg-lattice-deep border border-lattice-border p-2 text-[11px]">
                <span className="text-gray-400 font-mono mr-1.5">#{i + 1}</span>
                <span className="text-white font-medium">@{r.authorId}</span>
                <span className="ml-2 font-mono text-neon-cyan">score {r.score}</span>
                {r.reasons.length > 0 && <span className="ml-2 text-gray-400">{r.reasons.join(' · ')}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ── Threads — quote-post / reply trees ─────────────────────────────────────

function ThreadNodeView({
  node,
  depth,
  onReply,
  onCollapse,
  onDelete,
}: {
  node: ThreadNode;
  depth: number;
  onReply: (parentId: string) => void;
  onCollapse: (nodeId: string) => void;
  onDelete: (nodeId: string) => void;
}) {
  return (
    <div style={{ marginLeft: depth > 0 ? 14 : 0 }} className={depth > 0 ? 'border-l border-lattice-border pl-2' : ''}>
      <div className="rounded-lg bg-lattice-deep border border-lattice-border p-2.5">
        <div className="flex items-center gap-2 text-[11px] text-gray-400">
          <span
            className={cn(
              'rounded px-1.5 py-0.5 font-semibold uppercase',
              node.kind === 'quote'
                ? 'bg-neon-purple/15 text-neon-purple'
                : node.kind === 'reply'
                  ? 'bg-neon-cyan/15 text-neon-cyan'
                  : 'bg-white/5 text-gray-400'
            )}
          >
            {node.kind}
          </span>
          <span>@{node.author}</span>
          {node.replyCount > 0 && <span>· {node.replyCount} in thread</span>}
        </div>
        {node.quotedBody && (
          <div className="mt-1.5 rounded border border-lattice-border bg-black/30 p-2 text-[11px] text-gray-400">
            <span className="text-gray-400">Quoting{node.quotedAuthor ? ` @${node.quotedAuthor}` : ''}: </span>
            {node.quotedBody}
          </div>
        )}
        <p className="mt-1.5 whitespace-pre-wrap text-sm text-gray-200">{node.body}</p>
        <div className="mt-2 flex items-center gap-3 text-[11px]">
          <button onClick={() => onReply(node.id)} className="text-neon-cyan hover:underline">
            Reply
          </button>
          {node.replyCount > 0 && (
            <button
              onClick={() => onCollapse(node.id)}
              className="flex items-center gap-0.5 text-gray-400 hover:text-white"
            >
              {node.collapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              {node.collapsed ? 'Expand' : 'Collapse'}
            </button>
          )}
          <button aria-label="Delete"
            onClick={() => onDelete(node.id)}
            className="ml-auto flex items-center gap-0.5 text-gray-400 hover:text-red-400"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>
      {!node.collapsed && node.children.length > 0 && (
        <div className="mt-1.5 space-y-1.5">
          {node.children.map((c) => (
            <ThreadNodeView
              key={c.id}
              node={c}
              depth={depth + 1}
              onReply={onReply}
              onCollapse={onCollapse}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ThreadsTool() {
  const [tree, setTree] = useState<ThreadNode[]>([]);
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [quoteId, setQuoteId] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await lensRun<{ tree: ThreadNode[] }>('feed', 'thread-tree', {});
    if (r.data?.ok && r.data.result) setTree(r.data.result.tree || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async () => {
    if (!draft.trim() || busy) return;
    setBusy(true);
    const params: Record<string, unknown> = { body: draft.trim() };
    if (replyTo) params.parentId = replyTo;
    if (quoteId.trim()) params.quotedId = quoteId.trim();
    const r = await lensRun('feed', 'thread-add', params);
    if (r.data?.ok) {
      setDraft('');
      setReplyTo(null);
      setQuoteId('');
      await load();
    }
    setBusy(false);
  };

  const collapse = async (nodeId: string) => {
    await lensRun('feed', 'thread-collapse', { nodeId });
    await load();
  };
  const del = async (nodeId: string) => {
    await lensRun('feed', 'thread-delete', { nodeId });
    await load();
  };

  return (
    <div>
      <SectionHeader
        icon={MessageSquare}
        title="Threads — quote-posts & reply trees"
        hint="Compose a root post, reply into a thread, or quote-post an external post by id. Threads collapse to keep deep conversations readable."
      />
      <div className="mb-3 rounded-lg bg-lattice-deep border border-lattice-border p-2.5">
        {replyTo && (
          <div className="mb-1.5 flex items-center gap-2 text-[11px] text-neon-cyan">
            Replying in thread
            <button aria-label="Cancel reply" onClick={() => setReplyTo(null)} className="text-gray-400 hover:text-white">
              <X className="w-3 h-3" />
            </button>
          </div>
        )}
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={replyTo ? 'Write your reply...' : 'Start a thread...'}
          rows={2}
          className="w-full resize-none bg-transparent text-sm text-white placeholder-gray-600 focus:outline-none"
        />
        <div className="mt-1.5 flex items-center gap-2">
          <input
            value={quoteId}
            onChange={(e) => setQuoteId(e.target.value)}
            placeholder="Quote post id (optional)"
            className="flex-1 rounded border border-lattice-border bg-lattice-surface px-2 py-1 text-[11px] text-white placeholder-gray-600 focus:outline-none focus:border-neon-purple"
          />
          <button
            onClick={add}
            disabled={!draft.trim() || busy}
            className="rounded-full bg-neon-cyan px-4 py-1 text-xs font-bold text-black hover:bg-neon-cyan/90 disabled:opacity-40"
          >
            {busy ? 'Posting...' : 'Post'}
          </button>
        </div>
      </div>
      {loading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="w-5 h-5 animate-spin text-neon-cyan" />
        </div>
      ) : tree.length === 0 ? (
        <EmptyHint text="No threads yet. Start one above." />
      ) : (
        <div className="space-y-2">
          {tree.map((n) => (
            <ThreadNodeView
              key={n.id}
              node={n}
              depth={0}
              onReply={setReplyTo}
              onCollapse={collapse}
              onDelete={del}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Lists — curated timelines ──────────────────────────────────────────────

function ListsTool({ candidates }: { candidates: CandidatePost[] }) {
  const [lists, setLists] = useState<FeedList[]>([]);
  const [name, setName] = useState('');
  const [members, setMembers] = useState('');
  const [loading, setLoading] = useState(false);
  const [memberDraft, setMemberDraft] = useState<Record<string, string>>({});
  const [openListId, setOpenListId] = useState<string | null>(null);
  const [listFeed, setListFeed] = useState<{ listId: string; posts: CandidatePost[]; memberCount: number } | null>(null);
  const [viewingFeed, setViewingFeed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await lensRun<{ lists: FeedList[] }>('feed', 'list-all', {});
    if (r.data?.ok && r.data.result) setLists(r.data.result.lists || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    if (!name.trim()) return;
    const memberArr = members
      .split(',')
      .map((m) => m.trim())
      .filter(Boolean);
    const r = await lensRun('feed', 'list-create', { name: name.trim(), members: memberArr });
    if (r.data?.ok) {
      setName('');
      setMembers('');
      await load();
    }
  };

  const updateMembers = async (listId: string, member: string, op: 'add' | 'remove') => {
    await lensRun('feed', 'list-update-members', { listId, member, op });
    await load();
  };
  const togglePin = async (l: FeedList) => {
    await lensRun('feed', 'list-update-members', { listId: l.id, pinned: !l.pinned });
    await load();
  };
  const del = async (listId: string) => {
    await lensRun('feed', 'list-delete', { listId });
    await load();
  };
  const viewFeed = async (listId: string) => {
    if (openListId === listId) { setOpenListId(null); setListFeed(null); return; }
    setOpenListId(listId);
    setViewingFeed(true);
    const r = await lensRun<{ posts: CandidatePost[]; memberCount: number }>('feed', 'list-feed', { listId, candidates });
    if (r.data?.ok && r.data.result) setListFeed({ listId, posts: r.data.result.posts || [], memberCount: r.data.result.memberCount });
    setViewingFeed(false);
  };

  return (
    <div>
      <SectionHeader
        icon={ListChecks}
        title="Lists — curated timelines"
        hint="Group authors into a list to read a focused, per-list feed instead of the firehose."
      />
      <div className="mb-3 space-y-1.5 rounded-lg bg-lattice-deep border border-lattice-border p-2.5">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="List name"
          className="w-full rounded border border-lattice-border bg-lattice-surface px-2 py-1.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-neon-cyan"
        />
        <input
          value={members}
          onChange={(e) => setMembers(e.target.value)}
          placeholder="Members, comma-separated (optional)"
          className="w-full rounded border border-lattice-border bg-lattice-surface px-2 py-1.5 text-[11px] text-white placeholder-gray-600 focus:outline-none focus:border-neon-cyan"
        />
        <button
          onClick={create}
          disabled={!name.trim()}
          className="flex items-center gap-1 rounded-full bg-neon-cyan px-3 py-1 text-xs font-bold text-black hover:bg-neon-cyan/90 disabled:opacity-40"
        >
          <Plus className="w-3 h-3" /> Create list
        </button>
      </div>
      {loading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="w-5 h-5 animate-spin text-neon-cyan" />
        </div>
      ) : lists.length === 0 ? (
        <EmptyHint text="No lists yet. Create one above." />
      ) : (
        <ul className="space-y-2">
          {lists.map((l) => (
            <li key={l.id} className="rounded-lg bg-lattice-deep border border-lattice-border p-2.5">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-white">{l.name}</span>
                <span className="text-[11px] text-gray-400">{l.members.length} members</span>
                <button
                  onClick={() => togglePin(l)}
                  className={cn('ml-auto p-1', l.pinned ? 'text-neon-cyan' : 'text-gray-600 hover:text-white')}
                  aria-label="Pin list"
                >
                  <Pin className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => del(l.id)}
                  className="p-1 text-gray-600 hover:text-red-400"
                  aria-label="Delete list"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              <button
                onClick={() => viewFeed(l.id)}
                disabled={viewingFeed && openListId === l.id}
                className="mt-1.5 text-[11px] text-neon-cyan hover:underline disabled:opacity-40"
              >
                {openListId === l.id ? 'Hide feed' : `View feed (from ${candidates.length} loaded posts)`}
              </button>
              {openListId === l.id && listFeed?.listId === l.id && (
                <div className="mt-1.5 space-y-1">
                  {listFeed.posts.length === 0 ? (
                    <p className="text-[11px] text-gray-400">None of this list's members have a post in the currently-loaded feed.</p>
                  ) : (
                    listFeed.posts.map((p) => (
                      <div key={p.id} className="rounded bg-white/5 p-1.5 text-[11px] text-gray-300">
                        <span className="text-white font-medium">@{p.authorId}</span> {p.content?.slice(0, 100)}
                      </div>
                    ))
                  )}
                </div>
              )}
              {l.members.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {l.members.map((m) => (
                    <span
                      key={m}
                      className="inline-flex items-center gap-1 rounded-full bg-white/5 px-2 py-0.5 text-[11px] text-gray-300"
                    >
                      @{m}
                      <button aria-label="Remove member"
                        onClick={() => updateMembers(l.id, m, 'remove')}
                        className="text-gray-400 hover:text-red-400"
                      >
                        <X className="w-2.5 h-2.5" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <div className="mt-1.5 flex gap-1.5">
                <input
                  value={memberDraft[l.id] || ''}
                  onChange={(e) => setMemberDraft((p) => ({ ...p, [l.id]: e.target.value }))}
                  placeholder="Add member"
                  className="flex-1 rounded border border-lattice-border bg-lattice-surface px-2 py-1 text-[11px] text-white placeholder-gray-600 focus:outline-none focus:border-neon-cyan"
                />
                <button
                  onClick={() => {
                    const m = (memberDraft[l.id] || '').trim();
                    if (m) {
                      void updateMembers(l.id, m, 'add');
                      setMemberDraft((p) => ({ ...p, [l.id]: '' }));
                    }
                  }}
                  className="rounded bg-white/5 px-2 py-1 text-[11px] text-neon-cyan hover:bg-white/10"
                >
                  Add
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Polls ──────────────────────────────────────────────────────────────────

function PollsTool() {
  const [polls, setPolls] = useState<Poll[]>([]);
  const [question, setQuestion] = useState('');
  const [opts, setOpts] = useState(['', '']);
  const [duration, setDuration] = useState(1440);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await lensRun<{ polls: Poll[] }>('feed', 'poll-list', {});
    if (r.data?.ok && r.data.result) setPolls(r.data.result.polls || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    const options = opts.map((o) => o.trim()).filter(Boolean);
    if (!question.trim() || options.length < 2) return;
    const r = await lensRun('feed', 'poll-create', {
      question: question.trim(),
      options,
      durationMinutes: duration,
    });
    if (r.data?.ok) {
      setQuestion('');
      setOpts(['', '']);
      await load();
    }
  };

  const vote = async (pollId: string, optionId: string) => {
    const r = await lensRun<{ poll: Poll }>('feed', 'poll-vote', { pollId, optionId });
    if (r.data?.ok && r.data.result) {
      setPolls((prev) => prev.map((p) => (p.id === pollId ? r.data!.result!.poll : p)));
    }
  };

  return (
    <div>
      <SectionHeader
        icon={BarChart3}
        title="Polls — composer & live results"
        hint="Add a poll to a post. Results update live as people vote; one vote per person, re-votes replace the prior choice."
      />
      <div className="mb-3 space-y-1.5 rounded-lg bg-lattice-deep border border-lattice-border p-2.5">
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Poll question"
          className="w-full rounded border border-lattice-border bg-lattice-surface px-2 py-1.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-neon-cyan"
        />
        {opts.map((o, i) => (
          <div key={i} className="flex gap-1.5">
            <input
              value={o}
              onChange={(e) => setOpts((p) => p.map((v, j) => (j === i ? e.target.value : v)))}
              placeholder={`Option ${i + 1}`}
              className="flex-1 rounded border border-lattice-border bg-lattice-surface px-2 py-1 text-[11px] text-white placeholder-gray-600 focus:outline-none focus:border-neon-cyan"
            />
            {opts.length > 2 && (
              <button
                onClick={() => setOpts((p) => p.filter((_, j) => j !== i))}
                className="px-1 text-gray-400 hover:text-red-400"
                aria-label="Remove option"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        ))}
        {opts.length < 4 && (
          <button
            onClick={() => setOpts((p) => [...p, ''])}
            className="text-[11px] text-neon-cyan hover:underline"
          >
            + Add option
          </button>
        )}
        <div className="flex items-center gap-2">
          <label className="text-[11px] text-gray-400">Closes in (min)</label>
          <input
            type="number"
            value={duration}
            min={5}
            max={10080}
            onChange={(e) => setDuration(parseInt(e.target.value) || 1440)}
            className="w-24 rounded border border-lattice-border bg-lattice-surface px-2 py-1 text-[11px] text-white focus:outline-none focus:border-neon-cyan"
          />
          <button
            onClick={create}
            disabled={!question.trim() || opts.filter((o) => o.trim()).length < 2}
            className="ml-auto rounded-full bg-neon-cyan px-3 py-1 text-xs font-bold text-black hover:bg-neon-cyan/90 disabled:opacity-40"
          >
            Create poll
          </button>
        </div>
      </div>
      {loading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="w-5 h-5 animate-spin text-neon-cyan" />
        </div>
      ) : polls.length === 0 ? (
        <EmptyHint text="No polls yet. Create one above." />
      ) : (
        <ul className="space-y-2">
          {polls.map((p) => (
            <li key={p.id} className="rounded-lg bg-lattice-deep border border-lattice-border p-2.5">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-white">{p.question}</span>
                <span
                  className={cn(
                    'rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase',
                    p.closed ? 'bg-white/5 text-gray-400' : 'bg-neon-green/15 text-neon-green'
                  )}
                >
                  {p.closed ? 'closed' : 'live'}
                </span>
              </div>
              <div className="mt-2 space-y-1.5">
                {p.options.map((o) => (
                  <button
                    key={o.id}
                    onClick={() => !p.closed && vote(p.id, o.id)}
                    disabled={p.closed}
                    className={cn(
                      'relative w-full overflow-hidden rounded border px-2 py-1.5 text-left text-xs transition-colors',
                      p.myVote === o.id
                        ? 'border-neon-cyan text-white'
                        : 'border-lattice-border text-gray-300 hover:border-white/20',
                      p.closed && 'cursor-default'
                    )}
                  >
                    <div
                      className="absolute inset-y-0 left-0 bg-neon-cyan/15"
                      style={{ width: `${o.percent}%` }}
                    />
                    <span className="relative flex items-center justify-between">
                      <span>
                        {o.label}
                        {p.myVote === o.id && <span className="ml-1 text-neon-cyan">✓</span>}
                      </span>
                      <span className="font-mono text-gray-400">
                        {o.percent}% · {o.votes}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-[11px] text-gray-400">{p.totalVotes} total votes</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Saved — folders + saved searches ───────────────────────────────────────

function SavedTool({ candidates }: { candidates: CandidatePost[] }) {
  const [folders, setFolders] = useState<BookmarkFolder[]>([]);
  const [searches, setSearches] = useState<SavedSearch[]>([]);
  const [folderName, setFolderName] = useState('');
  const [query, setQuery] = useState('');
  const [alertOn, setAlertOn] = useState(true);
  const [loading, setLoading] = useState(false);
  const [runResult, setRunResult] = useState<{ searchId: string; matches: CandidatePost[]; newSinceLastCheck: number } | null>(null);
  const [running, setRunning] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [f, s] = await Promise.all([
      lensRun<{ folders: BookmarkFolder[] }>('feed', 'folder-list', {}),
      lensRun<{ searches: SavedSearch[] }>('feed', 'saved-search-list', {}),
    ]);
    if (f.data?.ok && f.data.result) setFolders(f.data.result.folders || []);
    if (s.data?.ok && s.data.result) setSearches(s.data.result.searches || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const createFolder = async () => {
    if (!folderName.trim()) return;
    const r = await lensRun('feed', 'folder-create', { name: folderName.trim() });
    if (r.data?.ok) {
      setFolderName('');
      await load();
    }
  };
  const delFolder = async (folderId: string) => {
    await lensRun('feed', 'folder-delete', { folderId });
    await load();
  };
  const createSearch = async () => {
    if (!query.trim()) return;
    const r = await lensRun('feed', 'saved-search-create', { query: query.trim(), alert: alertOn });
    if (r.data?.ok) {
      setQuery('');
      await load();
    }
  };
  const delSearch = async (searchId: string) => {
    await lensRun('feed', 'saved-search-delete', { searchId });
    await load();
  };
  const runSearch = async (searchId: string) => {
    setRunning(searchId);
    const r = await lensRun<{ searchId: string; matches: CandidatePost[]; newSinceLastCheck: number }>('feed', 'saved-search-run', { searchId, candidates });
    if (r.data?.ok && r.data.result) setRunResult(r.data.result);
    setRunning(null);
  };

  return (
    <div>
      <SectionHeader
        icon={Bookmark}
        title="Saved — folders & search alerts"
        hint="Organise bookmarks into folders and save searches that alert you when new matching posts appear."
      />
      <div className="mb-3 flex gap-1.5">
        <input
          value={folderName}
          onChange={(e) => setFolderName(e.target.value)}
          placeholder="New bookmark folder"
          className="flex-1 rounded border border-lattice-border bg-lattice-surface px-2 py-1.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-neon-cyan"
        />
        <button aria-label="Create folder"
          onClick={createFolder}
          disabled={!folderName.trim()}
          className="rounded-full bg-neon-cyan px-3 py-1 text-xs font-bold text-black hover:bg-neon-cyan/90 disabled:opacity-40"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>
      {loading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="w-5 h-5 animate-spin text-neon-cyan" />
        </div>
      ) : (
        <>
          {folders.length === 0 ? (
            <EmptyHint text="No bookmark folders yet." />
          ) : (
            <ul className="mb-4 space-y-1.5">
              {folders.map((f) => (
                <li
                  key={f.id}
                  className="flex items-center gap-2 rounded-lg bg-lattice-deep border border-lattice-border p-2.5"
                >
                  <Bookmark className="w-3.5 h-3.5 text-neon-cyan" />
                  <span className="text-sm text-white">{f.name}</span>
                  <span className="text-[11px] text-gray-400">{f.itemCount} saved</span>
                  <button
                    onClick={() => delFolder(f.id)}
                    className="ml-auto p-1 text-gray-600 hover:text-red-400"
                    aria-label="Delete folder"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="mb-3 space-y-1.5 rounded-lg bg-lattice-deep border border-lattice-border p-2.5">
            <div className="flex items-center gap-2">
              <Search className="w-3.5 h-3.5 text-gray-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Save a search query"
                className="flex-1 bg-transparent text-sm text-white placeholder-gray-600 focus:outline-none"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 text-[11px] text-gray-400">
                <input
                  type="checkbox"
                  checked={alertOn}
                  onChange={(e) => setAlertOn(e.target.checked)}
                  className="accent-neon-cyan"
                />
                Alert on new matches
              </label>
              <button
                onClick={createSearch}
                disabled={!query.trim()}
                className="ml-auto rounded-full bg-neon-cyan px-3 py-1 text-xs font-bold text-black hover:bg-neon-cyan/90 disabled:opacity-40"
              >
                Save search
              </button>
            </div>
          </div>
          {searches.length === 0 ? (
            <EmptyHint text="No saved searches yet." />
          ) : (
            <ul className="space-y-1.5">
              {searches.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center gap-2 rounded-lg bg-lattice-deep border border-lattice-border p-2.5"
                >
                  <Search className="w-3.5 h-3.5 text-neon-purple" />
                  <span className="text-sm text-white">{s.query}</span>
                  {s.alert && (
                    <span className="rounded bg-neon-purple/15 px-1.5 py-0.5 text-[10px] text-neon-purple">
                      alerts on
                    </span>
                  )}
                  <button
                    onClick={() => runSearch(s.id)}
                    disabled={running === s.id}
                    className="ml-auto text-[11px] text-neon-cyan hover:underline disabled:opacity-40"
                  >
                    {running === s.id ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Run'}
                  </button>
                  <button
                    onClick={() => delSearch(s.id)}
                    className="p-1 text-gray-600 hover:text-red-400"
                    aria-label="Delete saved search"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {runResult && (
            <div className="mt-3 rounded-lg bg-lattice-deep border border-lattice-border p-2.5">
              <p className="text-[11px] text-gray-400 mb-1.5">
                {runResult.matches.length} match{runResult.matches.length === 1 ? '' : 'es'} in the {candidates.length} currently-loaded posts
                {runResult.newSinceLastCheck > 0 && <span className="ml-1 text-neon-purple">· {runResult.newSinceLastCheck} new since last check</span>}
              </p>
              {runResult.matches.slice(0, 5).map((p) => (
                <div key={p.id} className="text-[11px] text-gray-300">
                  <span className="text-white font-medium">@{p.authorId}</span> {p.content?.slice(0, 100)}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Spaces — live audio rooms ──────────────────────────────────────────────

function SpacesTool() {
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [title, setTitle] = useState('');
  const [topic, setTopic] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await lensRun<{ spaces: Space[] }>('feed', 'space-list', {});
    if (r.data?.ok && r.data.result) setSpaces(r.data.result.spaces || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    if (!title.trim()) return;
    const r = await lensRun('feed', 'space-create', { title: title.trim(), topic: topic.trim() });
    if (r.data?.ok) {
      setTitle('');
      setTopic('');
      await load();
    }
  };
  const join = async (spaceId: string, role: 'speaker' | 'listener') => {
    await lensRun('feed', 'space-join', { spaceId, role });
    await load();
  };
  const leave = async (spaceId: string) => {
    await lensRun('feed', 'space-leave', { spaceId });
    await load();
  };
  const end = async (spaceId: string) => {
    await lensRun('feed', 'space-end', { spaceId });
    await load();
  };

  return (
    <div>
      <SectionHeader
        icon={Radio}
        title="Spaces — live audio rooms"
        hint="Host a live audio room from the feed, or join one as a speaker or listener."
      />
      <div className="mb-3 space-y-1.5 rounded-lg bg-lattice-deep border border-lattice-border p-2.5">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Space title"
          className="w-full rounded border border-lattice-border bg-lattice-surface px-2 py-1.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-neon-cyan"
        />
        <input
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="Topic (optional)"
          className="w-full rounded border border-lattice-border bg-lattice-surface px-2 py-1 text-[11px] text-white placeholder-gray-600 focus:outline-none focus:border-neon-cyan"
        />
        <button
          onClick={create}
          disabled={!title.trim()}
          className="flex items-center gap-1 rounded-full bg-neon-cyan px-3 py-1 text-xs font-bold text-black hover:bg-neon-cyan/90 disabled:opacity-40"
        >
          <Radio className="w-3 h-3" /> Go live
        </button>
      </div>
      {loading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="w-5 h-5 animate-spin text-neon-cyan" />
        </div>
      ) : spaces.length === 0 ? (
        <EmptyHint text="No spaces yet. Start one above." />
      ) : (
        <ul className="space-y-2">
          {spaces.map((sp) => (
            <li key={sp.id} className="rounded-lg bg-lattice-deep border border-lattice-border p-2.5">
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    'flex h-2 w-2 rounded-full',
                    sp.status === 'live' ? 'animate-pulse bg-neon-green' : 'bg-gray-600'
                  )}
                />
                <span className="text-sm font-bold text-white">{sp.title}</span>
                <span className="ml-auto text-[11px] text-gray-400">
                  <Mic className="mr-0.5 inline w-3 h-3" />
                  {sp.speakerCount}
                  <Ear className="ml-1.5 mr-0.5 inline w-3 h-3" />
                  {sp.listenerCount}
                </span>
              </div>
              {sp.topic && <p className="mt-0.5 text-[11px] text-gray-400">{sp.topic}</p>}
              {sp.status === 'live' && (
                <div className="mt-2 flex gap-1.5">
                  <button
                    onClick={() => join(sp.id, 'speaker')}
                    className="rounded bg-white/5 px-2 py-1 text-[11px] text-neon-cyan hover:bg-white/10"
                  >
                    Join as speaker
                  </button>
                  <button
                    onClick={() => join(sp.id, 'listener')}
                    className="rounded bg-white/5 px-2 py-1 text-[11px] text-gray-300 hover:bg-white/10"
                  >
                    Listen
                  </button>
                  <button
                    onClick={() => leave(sp.id)}
                    className="rounded bg-white/5 px-2 py-1 text-[11px] text-gray-400 hover:bg-white/10"
                  >
                    Leave
                  </button>
                  <button
                    onClick={() => end(sp.id)}
                    className="ml-auto rounded bg-red-500/10 px-2 py-1 text-[11px] text-red-400 hover:bg-red-500/20"
                  >
                    End
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Controls — mute / block / sensitive media ──────────────────────────────

function ControlsTool({ candidates }: { candidates: CandidatePost[] }) {
  const [controls, setControls] = useState<Controls | null>(null);
  const [word, setWord] = useState('');
  const [blockUser, setBlockUser] = useState('');
  const [preview, setPreview] = useState<{ posts: CandidatePost[]; removed: { muted: number; blocked: number }; sensitiveFlagged: number } | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const load = useCallback(async () => {
    const r = await lensRun<{ controls: Controls }>('feed', 'controls-get', {});
    if (r.data?.ok && r.data.result) setControls(r.data.result.controls);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const muteWord = async (op: 'add' | 'remove', w: string) => {
    const r = await lensRun<{ controls: Controls }>('feed', 'controls-mute-word', { word: w, op });
    if (r.data?.ok && r.data.result) setControls(r.data.result.controls);
  };
  const block = async (op: 'add' | 'remove', u: string) => {
    const r = await lensRun<{ controls: Controls }>('feed', 'controls-block-user', { userId: u, op });
    if (r.data?.ok && r.data.result) setControls(r.data.result.controls);
  };
  const setMedia = async (mode: 'blur' | 'show' | 'hide') => {
    const r = await lensRun<{ controls: Controls }>('feed', 'controls-sensitive-media', { mode });
    if (r.data?.ok && r.data.result) setControls(r.data.result.controls);
  };
  const runPreview = async () => {
    setPreviewing(true);
    const r = await lensRun<{ posts: CandidatePost[]; removed: { muted: number; blocked: number }; sensitiveFlagged: number }>(
      'feed', 'controls-apply', { candidates },
    );
    if (r.data?.ok && r.data.result) setPreview(r.data.result);
    setPreviewing(false);
  };

  return (
    <div>
      <SectionHeader
        icon={ShieldAlert}
        title="Content controls"
        hint="Mute words, block accounts, and choose how sensitive media is shown. Preview below shows exactly which currently-loaded posts these rules would remove or flag."
      />
      {!controls ? (
        <div className="flex justify-center py-6">
          <Loader2 className="w-5 h-5 animate-spin text-neon-cyan" />
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <p className="mb-1.5 text-xs font-semibold text-gray-400">Sensitive media</p>
            <div className="flex gap-1.5">
              {(['blur', 'show', 'hide'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMedia(m)}
                  className={cn(
                    'flex-1 rounded border px-2 py-1.5 text-xs capitalize transition-colors',
                    controls.sensitiveMedia === m
                      ? 'border-neon-cyan bg-neon-cyan/10 text-neon-cyan'
                      : 'border-lattice-border text-gray-400 hover:border-white/20'
                  )}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-1.5 text-xs font-semibold text-gray-400">Muted words</p>
            <div className="flex gap-1.5">
              <input
                value={word}
                onChange={(e) => setWord(e.target.value)}
                placeholder="Add a muted word"
                className="flex-1 rounded border border-lattice-border bg-lattice-surface px-2 py-1.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-neon-cyan"
              />
              <button
                onClick={() => {
                  if (word.trim()) {
                    void muteWord('add', word.trim());
                    setWord('');
                  }
                }}
                disabled={!word.trim()}
                className="rounded-full bg-neon-cyan px-3 py-1 text-xs font-bold text-black hover:bg-neon-cyan/90 disabled:opacity-40"
              >
                Mute
              </button>
            </div>
            {controls.mutedWords.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {controls.mutedWords.map((w) => (
                  <span
                    key={w}
                    className="inline-flex items-center gap-1 rounded-full bg-white/5 px-2 py-0.5 text-[11px] text-gray-300"
                  >
                    {w}
                    <button aria-label="Remove muted word"
                      onClick={() => muteWord('remove', w)}
                      className="text-gray-400 hover:text-red-400"
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
          <div>
            <p className="mb-1.5 text-xs font-semibold text-gray-400">Blocked accounts</p>
            <div className="flex gap-1.5">
              <input
                value={blockUser}
                onChange={(e) => setBlockUser(e.target.value)}
                placeholder="Block an account id"
                className="flex-1 rounded border border-lattice-border bg-lattice-surface px-2 py-1.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-neon-cyan"
              />
              <button
                onClick={() => {
                  if (blockUser.trim()) {
                    void block('add', blockUser.trim());
                    setBlockUser('');
                  }
                }}
                disabled={!blockUser.trim()}
                className="rounded-full bg-red-500/80 px-3 py-1 text-xs font-bold text-white hover:bg-red-500 disabled:opacity-40"
              >
                Block
              </button>
            </div>
            {controls.blockedUsers.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {controls.blockedUsers.map((u) => (
                  <span
                    key={u}
                    className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-[11px] text-red-300"
                  >
                    @{u}
                    <button aria-label="Unblock user"
                      onClick={() => block('remove', u)}
                      className="text-red-400/70 hover:text-red-400"
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="border-t border-lattice-border pt-3">
            <button
              onClick={runPreview}
              disabled={previewing || candidates.length === 0}
              className="flex items-center gap-1.5 rounded-full bg-white/5 px-3 py-1.5 text-xs font-medium text-neon-cyan hover:bg-white/10 disabled:opacity-40"
            >
              {previewing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldAlert className="w-3.5 h-3.5" />}
              Preview effect on the {candidates.length} currently-loaded posts
            </button>
            {preview && (
              <p className="mt-1.5 text-[11px] text-gray-400">
                {preview.posts.length} kept · {preview.removed.blocked} removed (blocked) · {preview.removed.muted} removed (muted) · {preview.sensitiveFlagged} flagged sensitive
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Panel shell ────────────────────────────────────────────────────────────

const TABS: { key: ToolTab; label: string; icon: typeof Plus }[] = [
  { key: 'for-you', label: 'For You', icon: Sparkles },
  { key: 'threads', label: 'Threads', icon: MessageSquare },
  { key: 'lists', label: 'Lists', icon: ListChecks },
  { key: 'polls', label: 'Polls', icon: BarChart3 },
  { key: 'saved', label: 'Saved', icon: Bookmark },
  { key: 'spaces', label: 'Spaces', icon: Radio },
  { key: 'controls', label: 'Controls', icon: ShieldAlert },
];

export function FeedToolsPanel({ className, candidates = [] }: { className?: string; candidates?: CandidatePost[] }) {
  const [tab, setTab] = useState<ToolTab>('for-you');

  return (
    <div className={cn('panel p-4', className)}>
      <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-white">
        <Sparkles className="w-4 h-4 text-neon-cyan" />
        Feed Tools
      </h2>
      <div className="mb-4 flex flex-wrap gap-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              'flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
              tab === t.key
                ? 'bg-neon-cyan text-black'
                : 'bg-lattice-deep text-gray-400 hover:text-white'
            )}
          >
            <t.icon className="w-3.5 h-3.5" />
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'for-you' && <ForYouTool candidates={candidates} />}
      {tab === 'threads' && <ThreadsTool />}
      {tab === 'lists' && <ListsTool candidates={candidates} />}
      {tab === 'polls' && <PollsTool />}
      {tab === 'saved' && <SavedTool candidates={candidates} />}
      {tab === 'spaces' && <SpacesTool />}
      {tab === 'controls' && <ControlsTool candidates={candidates} />}
    </div>
  );
}
