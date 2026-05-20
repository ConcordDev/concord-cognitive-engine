'use client';

/**
 * FmTopicsPanel — the topic list and a threaded discussion view with
 * voting and replies.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Loader2, Plus, ChevronUp, ChevronDown, ArrowLeft, Pin, Lock, Trash2, Flag,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Category { id: string; name: string }
interface Topic {
  id: string; categoryId: string | null; title: string; body: string; tags: string[];
  author: string; pinned: boolean; locked: boolean; score: number; replyCount?: number;
}
interface Post { id: string; topicId: string; body: string; author: string; score: number }

export function FmTopicsPanel({ onChange }: { onChange: () => void }) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterCat, setFilterCat] = useState('');
  const [sort, setSort] = useState('latest');
  const [form, setForm] = useState({ title: '', body: '', categoryId: '', tags: '' });
  const [openTopic, setOpenTopic] = useState<Topic | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [reply, setReply] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    const [c, t] = await Promise.all([
      lensRun('forum', 'category-list', {}),
      lensRun('forum', 'topic-list', { categoryId: filterCat || undefined, sort }),
    ]);
    setCategories(c.data?.result?.categories || []);
    setTopics(t.data?.result?.topics || []);
    setLoading(false);
    onChange();
  }, [filterCat, sort, onChange]);

  useEffect(() => { void refresh(); }, [refresh]);

  const addTopic = async () => {
    if (!form.title.trim()) { setError('Topic title is required.'); return; }
    const r = await lensRun('forum', 'topic-create', {
      title: form.title.trim(), body: form.body.trim(),
      categoryId: form.categoryId || undefined,
      tags: form.tags.split(',').map((x) => x.trim()).filter(Boolean),
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setForm({ title: '', body: '', categoryId: '', tags: '' });
    setError(null);
    await refresh();
  };

  const openThread = async (topic: Topic) => {
    const r = await lensRun('forum', 'topic-get', { id: topic.id });
    setOpenTopic((r.data?.result?.topic as Topic) || topic);
    setPosts(r.data?.result?.posts || []);
  };

  const reloadThread = async (id: string) => {
    const r = await lensRun('forum', 'topic-get', { id });
    setOpenTopic((r.data?.result?.topic as Topic) || null);
    setPosts(r.data?.result?.posts || []);
    await refresh();
  };

  const voteOn = async (targetType: 'topic' | 'post', targetId: string, direction: number) => {
    await lensRun('forum', 'vote', { targetType, targetId, direction });
    if (openTopic) await reloadThread(openTopic.id);
  };

  const postReply = async () => {
    if (!openTopic || !reply.trim()) return;
    const r = await lensRun('forum', 'post-reply', { topicId: openTopic.id, body: reply.trim() });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setReply('');
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

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-500"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  // Thread view
  if (openTopic) {
    return (
      <div className="space-y-3">
        <button type="button" onClick={() => { setOpenTopic(null); void refresh(); }}
          className="flex items-center gap-1 px-2.5 py-1.5 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg">
          <ArrowLeft className="w-3.5 h-3.5" /> All topics
        </button>

        <div className="flex gap-3 bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
          <Voter score={openTopic.score}
            onUp={() => voteOn('topic', openTopic.id, 1)}
            onDown={() => voteOn('topic', openTopic.id, -1)} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              {openTopic.pinned && <Pin className="w-3.5 h-3.5 text-orange-400" />}
              {openTopic.locked && <Lock className="w-3.5 h-3.5 text-zinc-500" />}
              <h3 className="text-sm font-bold text-zinc-100">{openTopic.title}</h3>
            </div>
            {openTopic.body && <p className="text-xs text-zinc-300 mt-1 whitespace-pre-wrap">{openTopic.body}</p>}
            <div className="flex flex-wrap items-center gap-2 mt-2">
              {openTopic.tags.map((t) => <span key={t} className="text-[10px] text-orange-400">#{t}</span>)}
              <div className="flex-1" />
              <button type="button" onClick={togglePin} className="text-[10px] text-zinc-500 hover:text-orange-300">
                {openTopic.pinned ? 'Unpin' : 'Pin'}
              </button>
              <button type="button" onClick={toggleLock} className="text-[10px] text-zinc-500 hover:text-orange-300">
                {openTopic.locked ? 'Unlock' : 'Lock'}
              </button>
              <button type="button" onClick={flagTopic} className="flex items-center gap-0.5 text-[10px] text-zinc-500 hover:text-rose-300">
                <Flag className="w-3 h-3" /> Flag
              </button>
              <button type="button" onClick={delTopic} className="text-zinc-600 hover:text-rose-400">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>

        <h4 className="text-xs font-semibold text-zinc-400">{posts.length} repl{posts.length === 1 ? 'y' : 'ies'}</h4>
        <ul className="space-y-2">
          {posts.map((p) => (
            <li key={p.id} className="flex gap-3 bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
              <Voter score={p.score}
                onUp={() => voteOn('post', p.id, 1)}
                onDown={() => voteOn('post', p.id, -1)} />
              <div className="flex-1 min-w-0">
                <p className="text-xs text-zinc-200 whitespace-pre-wrap">{p.body}</p>
                <p className="text-[10px] text-zinc-500 mt-1">{p.author}</p>
              </div>
            </li>
          ))}
        </ul>

        {!openTopic.locked && (
          <div className="flex items-center gap-2">
            <input placeholder="Write a reply" value={reply} onChange={(e) => setReply(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void postReply(); }}
              className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
            <button type="button" onClick={postReply}
              className="px-3 py-1.5 text-xs font-medium bg-orange-600 hover:bg-orange-500 text-white rounded-lg">Reply</button>
          </div>
        )}
      </div>
    );
  }

  // List view
  return (
    <div className="space-y-4">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      <section className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-2">
        <input placeholder="Topic title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
          className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
        <textarea placeholder="Body" value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })}
          rows={2} className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100 resize-y" />
        <div className="grid grid-cols-3 gap-2">
          <select value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
            <option value="">No category</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <input placeholder="Tags (comma-sep)" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <button type="button" onClick={addTopic}
            className="flex items-center justify-center gap-1 bg-orange-600 hover:bg-orange-500 text-white text-xs font-medium rounded-lg">
            <Plus className="w-3.5 h-3.5" /> Post topic
          </button>
        </div>
      </section>

      <div className="flex items-center gap-2">
        <select value={filterCat} onChange={(e) => setFilterCat(e.target.value)}
          className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-[11px] text-zinc-100">
          <option value="">All categories</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
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
        <p className="text-[11px] text-zinc-500 italic py-6 text-center">No topics yet. Start a discussion above.</p>
      ) : (
        <ul className="space-y-1.5">
          {topics.map((t) => (
            <li key={t.id} className="flex items-center gap-3 bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-2">
              <span className="text-xs font-bold text-zinc-300 w-8 text-center">{t.score}</span>
              <button type="button" onClick={() => openThread(t)} className="flex-1 text-left min-w-0">
                <p className="text-xs text-zinc-100 flex items-center gap-1">
                  {t.pinned && <Pin className="w-3 h-3 text-orange-400" />}
                  {t.locked && <Lock className="w-3 h-3 text-zinc-500" />}
                  {t.title}
                </p>
                <p className="text-[10px] text-zinc-500">
                  {t.replyCount || 0} replies
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
      <button type="button" onClick={onUp} className="text-zinc-500 hover:text-orange-400">
        <ChevronUp className="w-4 h-4" />
      </button>
      <span className="text-xs font-bold text-zinc-200">{score}</span>
      <button type="button" onClick={onDown} className="text-zinc-500 hover:text-sky-400">
        <ChevronDown className="w-4 h-4" />
      </button>
    </div>
  );
}
