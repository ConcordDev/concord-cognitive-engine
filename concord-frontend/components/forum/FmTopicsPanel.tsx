'use client';

/**
 * FmTopicsPanel — the topic list and a threaded discussion view with
 * nested comment trees, a markdown-aware rich editor, awards, saved
 * posts and per-thread subscriptions. All data flows through the
 * `forum` domain macros — no local mock data.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Loader2, Plus, ChevronUp, ChevronDown, ArrowLeft, Pin, Lock, Trash2, Flag,
  Award, Bookmark, Bell, BellRing,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { FmMarkdown } from './fmMarkdown';
import { FmRichEditor, type RichDraft } from './FmRichEditor';
import { FmCommentTree, type ForumPost } from './FmCommentTree';
import { FmAwardPicker } from './FmAwardPicker';

interface Category { id: string; name: string }
interface Subforum { id: string; name: string; icon: string }
interface Topic {
  id: string; categoryId: string | null; subforumId: string | null; title: string;
  body: string; format?: string; images?: string[]; tags: string[];
  author: string; pinned: boolean; locked: boolean; score: number; replyCount?: number;
  awards?: { id: string; icon: string; name: string }[];
}

const EMPTY_DRAFT: RichDraft = { body: '', format: 'plain', images: [] };

export function FmTopicsPanel({
  onChange, initialTopicId, onTopicConsumed,
}: {
  onChange: () => void;
  initialTopicId?: string | null;
  onTopicConsumed?: () => void;
}) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [subforums, setSubforums] = useState<Subforum[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterCat, setFilterCat] = useState('');
  const [filterSub, setFilterSub] = useState('');
  const [sort, setSort] = useState('latest');

  const [composeOpen, setComposeOpen] = useState(false);
  const [form, setForm] = useState({ title: '', categoryId: '', subforumId: '', tags: '' });
  const [draft, setDraft] = useState<RichDraft>(EMPTY_DRAFT);

  const [openTopic, setOpenTopic] = useState<Topic | null>(null);
  const [tree, setTree] = useState<ForumPost[]>([]);
  const [replyCount, setReplyCount] = useState(0);
  const [subscribed, setSubscribed] = useState(false);
  const [rootReply, setRootReply] = useState<RichDraft>(EMPTY_DRAFT);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [awardTarget, setAwardTarget] = useState<{ type: 'topic' | 'post'; id: string } | null>(null);

  const loadSaved = useCallback(async () => {
    const r = await lensRun('forum', 'saved-list', {});
    const ids = new Set<string>(((r.data?.result?.saved as { targetId: string }[]) || []).map((s) => s.targetId));
    setSavedIds(ids);
  }, []);

  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [c, sf, t] = await Promise.all([
      lensRun('forum', 'category-list', {}),
      lensRun('forum', 'subforum-list', {}),
      lensRun('forum', 'topic-list', {
        categoryId: filterCat || undefined,
        subforumId: filterSub || undefined,
        sort,
      }),
    ]);
    // Distinguish a genuine empty forum from a swallowed fetch failure: the
    // topic-list call is the load-bearing one. ok===false (or a thrown/caught
    // request → result:null + error) surfaces a real error with a retry,
    // never an identical-looking empty list (the silent-empty defect).
    if (t.data?.ok === false) {
      setLoadError(t.data?.error || 'Failed to load topics.');
      setLoading(false);
      return;
    }
    setLoadError(null);
    setCategories(c.data?.result?.categories || []);
    setSubforums(sf.data?.result?.subforums || []);
    setTopics(t.data?.result?.topics || []);
    setLoading(false);
    await loadSaved();
    onChange();
  }, [filterCat, filterSub, sort, loadSaved, onChange]);

  useEffect(() => { void refresh(); }, [refresh]);

  const consumedRef = useRef<string | null>(null);

  const addTopic = async () => {
    if (!form.title.trim()) { setError('Topic title is required.'); return; }
    const r = await lensRun('forum', 'topic-create', {
      title: form.title.trim(),
      body: draft.body.trim(),
      format: draft.format,
      images: draft.images,
      categoryId: form.categoryId || undefined,
      subforumId: form.subforumId || undefined,
      tags: form.tags.split(',').map((x) => x.trim()).filter(Boolean),
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setForm({ title: '', categoryId: '', subforumId: '', tags: '' });
    setDraft(EMPTY_DRAFT);
    setComposeOpen(false);
    setError(null);
    await refresh();
  };

  const openThread = useCallback(async (topicId: string) => {
    const r = await lensRun('forum', 'topic-get', { id: topicId });
    if (r.data?.ok === false) { setError(r.data?.error || 'Topic not found'); return; }
    setOpenTopic((r.data?.result?.topic as Topic) || null);
    setTree((r.data?.result?.tree as ForumPost[]) || []);
    setReplyCount((r.data?.result?.replyCount as number) || 0);
    setSubscribed(Boolean(r.data?.result?.subscribed));
    await loadSaved();
  }, [loadSaved]);

  const reloadThread = useCallback(async (id: string) => {
    await openThread(id);
    await refresh();
  }, [openThread, refresh]);

  // Auto-open a topic requested by another panel (trending/inbox/profile).
  useEffect(() => {
    if (!initialTopicId || consumedRef.current === initialTopicId) return;
    consumedRef.current = initialTopicId;
    void openThread(initialTopicId);
    onTopicConsumed?.();
  }, [initialTopicId, openThread, onTopicConsumed]);

  const voteOnTopic = async (direction: number) => {
    if (!openTopic) return;
    await lensRun('forum', 'vote', { targetType: 'topic', targetId: openTopic.id, direction });
    await reloadThread(openTopic.id);
  };

  const voteOnPost = async (postId: string, direction: number) => {
    if (!openTopic) return;
    await lensRun('forum', 'vote', { targetType: 'post', targetId: postId, direction });
    await reloadThread(openTopic.id);
  };

  const submitReply = async (parentId: string | null, d: RichDraft) => {
    if (!openTopic || !d.body.trim()) return;
    const r = await lensRun('forum', 'post-reply', {
      topicId: openTopic.id, parentId: parentId || undefined,
      body: d.body.trim(), format: d.format, images: d.images,
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Reply failed'); return; }
    if (!parentId) setRootReply(EMPTY_DRAFT);
    await reloadThread(openTopic.id);
  };

  const togglePin = async () => {
    if (!openTopic) return;
    await lensRun('forum', 'topic-pin', { id: openTopic.id, pinned: !openTopic.pinned });
    await reloadThread(openTopic.id);
  };
  const toggleLock = async () => {
    if (!openTopic) return;
    await lensRun('forum', 'topic-lock', { id: openTopic.id, locked: !openTopic.locked });
    await reloadThread(openTopic.id);
  };
  const delTopic = async () => {
    if (!openTopic) return;
    await lensRun('forum', 'topic-delete', { id: openTopic.id });
    setOpenTopic(null);
    await refresh();
  };
  const flagTopic = async () => {
    if (!openTopic) return;
    await lensRun('forum', 'flag-create', { targetType: 'topic', targetId: openTopic.id, reason: 'other' });
    await refresh();
  };
  const toggleSubscribe = async () => {
    if (!openTopic) return;
    const r = await lensRun('forum', 'thread-subscribe', { topicId: openTopic.id });
    if (r.data?.ok) setSubscribed(Boolean(r.data?.result?.subscribed));
  };
  const toggleSave = async (type: 'topic' | 'post', id: string) => {
    const r = await lensRun('forum', 'save-toggle', { targetType: type, targetId: id });
    if (r.data?.ok) {
      setSavedIds((prev) => {
        const next = new Set(prev);
        if (r.data?.result?.saved) next.add(id); else next.delete(id);
        return next;
      });
    }
  };

  const subforumName = useMemo(() => {
    const m: Record<string, string> = {};
    for (const s of subforums) m[s.id] = s.name;
    return m;
  }, [subforums]);

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  if (loadError) {
    return (
      <div role="alert" className="flex flex-col items-center gap-3 py-10 text-center">
        <p className="text-xs text-rose-300 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">
          {loadError}
        </p>
        <button type="button" onClick={() => { void refresh(); }}
          className="px-3 py-1.5 text-xs font-medium bg-orange-600 hover:bg-orange-500 text-white rounded-lg">
          Retry
        </button>
      </div>
    );
  }

  // ── Thread view ──────────────────────────────────────────────────────
  if (openTopic) {
    return (
      <div className="space-y-3">
        {awardTarget && (
          <FmAwardPicker target={awardTarget} onClose={() => setAwardTarget(null)}
            onGiven={() => { void reloadThread(openTopic.id); }} />
        )}
        <button type="button" onClick={() => { setOpenTopic(null); void refresh(); }}
          className="flex items-center gap-1 px-2.5 py-1.5 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg">
          <ArrowLeft className="w-3.5 h-3.5" /> All topics
        </button>

        <div className="flex gap-3 bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
          <Voter score={openTopic.score} onUp={() => voteOnTopic(1)} onDown={() => voteOnTopic(-1)} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              {openTopic.pinned && <Pin className="w-3.5 h-3.5 text-orange-400" />}
              {openTopic.locked && <Lock className="w-3.5 h-3.5 text-zinc-400" />}
              <h3 className="text-sm font-bold text-zinc-100">{openTopic.title}</h3>
              {(openTopic.awards || []).map((a) => (
                <span key={a.id} title={a.name} className="text-sm">{a.icon}</span>
              ))}
            </div>
            {openTopic.body && (
              <div className="mt-1.5"><FmMarkdown text={openTopic.body} format={openTopic.format} /></div>
            )}
            {(openTopic.images || []).length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {(openTopic.images || []).map((src) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={src} src={src} alt="embedded" loading="lazy"
                    className="max-h-44 rounded-lg border border-zinc-800 object-cover" />
                ))}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2 mt-2">
              {openTopic.tags.map((t) => <span key={t} className="text-[10px] text-orange-400">#{t}</span>)}
              <div className="flex-1" />
              <button type="button" onClick={toggleSubscribe}
                className={cn('flex items-center gap-0.5 text-[10px]', subscribed ? 'text-orange-400' : 'text-zinc-400 hover:text-orange-300')}>
                {subscribed ? <BellRing className="w-3 h-3" /> : <Bell className="w-3 h-3" />}
                {subscribed ? 'Subscribed' : 'Subscribe'}
              </button>
              <button type="button" onClick={() => toggleSave('topic', openTopic.id)}
                className={cn('flex items-center gap-0.5 text-[10px]', savedIds.has(openTopic.id) ? 'text-orange-400' : 'text-zinc-400 hover:text-orange-300')}>
                <Bookmark className="w-3 h-3" /> {savedIds.has(openTopic.id) ? 'Saved' : 'Save'}
              </button>
              <button type="button" onClick={() => setAwardTarget({ type: 'topic', id: openTopic.id })}
                className="flex items-center gap-0.5 text-[10px] text-zinc-400 hover:text-amber-300">
                <Award className="w-3 h-3" /> Award
              </button>
              <button type="button" onClick={togglePin} className="text-[10px] text-zinc-400 hover:text-orange-300">
                {openTopic.pinned ? 'Unpin' : 'Pin'}
              </button>
              <button type="button" onClick={toggleLock} className="text-[10px] text-zinc-400 hover:text-orange-300">
                {openTopic.locked ? 'Unlock' : 'Lock'}
              </button>
              <button type="button" onClick={flagTopic} className="flex items-center gap-0.5 text-[10px] text-zinc-400 hover:text-rose-300">
                <Flag className="w-3 h-3" /> Flag
              </button>
              <button type="button" onClick={delTopic} className="text-zinc-600 hover:text-rose-400" aria-label="Delete topic">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>

        <h4 className="text-xs font-semibold text-zinc-400">{replyCount} repl{replyCount === 1 ? 'y' : 'ies'}</h4>

        {!openTopic.locked && (
          <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-2">
            <FmRichEditor value={rootReply} onChange={setRootReply} rows={3} placeholder="Add a top-level reply…" />
            <div className="flex justify-end">
              <button type="button" onClick={() => submitReply(null, rootReply)} disabled={!rootReply.body.trim()}
                className="px-3 py-1.5 text-xs font-medium bg-orange-600 hover:bg-orange-500 disabled:opacity-40 text-white rounded-lg">
                Post reply
              </button>
            </div>
          </div>
        )}
        {openTopic.locked && (
          <p className="text-[11px] text-zinc-400 italic">This thread is locked — replies disabled.</p>
        )}

        <FmCommentTree nodes={tree} locked={openTopic.locked} savedIds={savedIds}
          onVote={voteOnPost}
          onReply={(parentId, d) => submitReply(parentId, d)}
          onAward={(postId) => setAwardTarget({ type: 'post', id: postId })}
          onSave={(postId) => toggleSave('post', postId)} />
      </div>
    );
  }

  // ── List view ────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      {composeOpen ? (
        <section className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-2">
          <input placeholder="Topic title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
            className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <FmRichEditor value={draft} onChange={setDraft} rows={4} placeholder="Body — supports markdown and image embeds" />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <select value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
              className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
              <option value="">No category</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select value={form.subforumId} onChange={(e) => setForm({ ...form, subforumId: e.target.value })}
              className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
              <option value="">No community</option>
              {subforums.map((s) => <option key={s.id} value={s.id}>{s.icon} {s.name}</option>)}
            </select>
            <input placeholder="Tags (comma-sep)" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })}
              className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
            <button type="button" onClick={addTopic}
              className="flex items-center justify-center gap-1 bg-orange-600 hover:bg-orange-500 text-white text-xs font-medium rounded-lg">
              <Plus className="w-3.5 h-3.5" /> Post topic
            </button>
          </div>
          <button type="button" onClick={() => { setComposeOpen(false); setError(null); }}
            className="text-[11px] text-zinc-400 hover:text-zinc-300">Cancel</button>
        </section>
      ) : (
        <button type="button" onClick={() => setComposeOpen(true)}
          className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-orange-600 hover:bg-orange-500 text-white rounded-lg">
          <Plus className="w-4 h-4" /> Start a discussion
        </button>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <select value={filterCat} onChange={(e) => setFilterCat(e.target.value)}
          className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-[11px] text-zinc-100">
          <option value="">All categories</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={filterSub} onChange={(e) => setFilterSub(e.target.value)}
          className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-[11px] text-zinc-100">
          <option value="">All communities</option>
          {subforums.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <div className="flex-1" />
        {['latest', 'top', 'new'].map((sx) => (
          <button key={sx} type="button" onClick={() => setSort(sx)}
            className={cn('text-[11px] px-2 py-1 rounded-lg capitalize',
              sort === sx ? 'bg-orange-600 text-white' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700')}>
            {sx}
          </button>
        ))}
      </div>

      {topics.length === 0 ? (
        <p className="text-[11px] text-zinc-400 italic py-6 text-center">No topics yet. Start a discussion above.</p>
      ) : (
        <ul className="space-y-1.5">
          {topics.map((t) => (
            <li key={t.id} className="flex items-center gap-3 bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-2">
              <span className="text-xs font-bold text-zinc-300 w-8 text-center">{t.score}</span>
              <button type="button" onClick={() => openThread(t.id)} className="flex-1 text-left min-w-0">
                <p className="text-xs text-zinc-100 flex items-center gap-1 flex-wrap">
                  {t.pinned && <Pin className="w-3 h-3 text-orange-400" />}
                  {t.locked && <Lock className="w-3 h-3 text-zinc-400" />}
                  {t.title}
                  {(t.awards || []).map((a) => <span key={a.id} className="text-[11px]">{a.icon}</span>)}
                </p>
                <p className="text-[10px] text-zinc-400">
                  {t.replyCount || 0} replies
                  {t.subforumId && subforumName[t.subforumId] && (
                    <span className="text-orange-400/70"> · {subforumName[t.subforumId]}</span>
                  )}
                  {t.tags.map((tag) => <span key={tag} className="text-orange-400/80"> #{tag}</span>)}
                </p>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Voter({ score, onUp, onDown }: { score: number; onUp: () => void; onDown: () => void }) {
  return (
    <div className="flex flex-col items-center shrink-0">
      <button type="button" onClick={onUp} className="text-zinc-400 hover:text-orange-400" aria-label="Upvote">
        <ChevronUp className="w-4 h-4" />
      </button>
      <span className="text-xs font-bold text-zinc-200">{score}</span>
      <button type="button" onClick={onDown} className="text-zinc-400 hover:text-sky-400" aria-label="Downvote">
        <ChevronDown className="w-4 h-4" />
      </button>
    </div>
  );
}
