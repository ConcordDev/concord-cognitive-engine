'use client';

/**
 * NewsTodayPanel — Today digest (top stories + topic sections),
 * trending, and an add-article form to populate the directory.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Flame } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { NewsArticleCard, type NewsArticle } from './NewsArticleCard';

interface Section { topic: string; items: NewsArticle[]; count: number }

export function NewsTodayPanel({ onChange }: { onChange: () => void }) {
  const [topStories, setTopStories] = useState<NewsArticle[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [trending, setTrending] = useState<NewsArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ title: '', source: '', topic: 'general', summary: '', url: '' });

  const refresh = useCallback(async () => {
    setLoading(true);
    const [d, t] = await Promise.all([
      lensRun('news', 'today-digest', {}),
      lensRun('news', 'trending', {}),
    ]);
    setTopStories(d.data?.result?.topStories || []);
    setSections(d.data?.result?.sections || []);
    setTrending(t.data?.result?.articles || []);
    setLoading(false);
    onChange();
  }, [onChange]);

  useEffect(() => { void refresh(); }, [refresh]);

  const addArticle = async () => {
    if (!form.title.trim()) { setError('Headline is required.'); return; }
    const r = await lensRun('news', 'article-add', {
      title: form.title.trim(), source: form.source.trim(),
      topic: form.topic.trim() || 'general', summary: form.summary.trim(), url: form.url.trim(),
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setForm({ title: '', source: '', topic: 'general', summary: '', url: '' });
    setShowAdd(false); setError(null);
    await refresh();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-500"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button type="button" onClick={() => setShowAdd((v) => !v)}
          className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-rose-600 hover:bg-rose-500 text-white rounded-lg">
          <Plus className="w-3.5 h-3.5" /> Add story
        </button>
      </div>

      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      {showAdd && (
        <div className="grid grid-cols-2 gap-2 bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
          <input placeholder="Headline" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
            className="col-span-2 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="Source" value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="Topic" value={form.topic} onChange={(e) => setForm({ ...form, topic: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="Summary" value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })}
            className="col-span-2 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="URL (optional)" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })}
            className="col-span-2 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <button type="button" onClick={addArticle}
            className="col-span-2 bg-rose-600 hover:bg-rose-500 text-white text-xs font-medium rounded-lg px-2 py-1.5">Add to directory</button>
        </div>
      )}

      {topStories.length === 0 ? (
        <div className="text-center text-zinc-500 text-sm italic py-10 border border-zinc-800 rounded-xl">
          No stories yet. Add one to build your Today digest.
        </div>
      ) : (
        <>
          <section>
            <h3 className="text-xs font-semibold text-zinc-300 mb-2">Top stories</h3>
            <ul className="space-y-2">
              {topStories.map((a) => <NewsArticleCard key={a.id} article={a} onChange={refresh} />)}
            </ul>
          </section>

          {trending.length > 0 && (
            <section>
              <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
                <Flame className="w-3.5 h-3.5 text-rose-400" /> Trending
              </h3>
              <ul className="space-y-2">
                {trending.slice(0, 5).map((a) => <NewsArticleCard key={a.id} article={a} onChange={refresh} />)}
              </ul>
            </section>
          )}

          {sections.map((sec) => (
            <section key={sec.topic}>
              <h3 className="text-xs font-semibold text-zinc-300 mb-2 capitalize">{sec.topic} <span className="text-zinc-600">({sec.count})</span></h3>
              <ul className="space-y-2">
                {sec.items.map((a) => <NewsArticleCard key={a.id} article={a} onChange={refresh} />)}
              </ul>
            </section>
          ))}
        </>
      )}
    </div>
  );
}
