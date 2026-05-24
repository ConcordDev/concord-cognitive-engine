'use client';

/**
 * NewsSavedPanel — saved stories, reading history and reading stats.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, BookOpen } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { NewsArticleCard, type NewsArticle } from './NewsArticleCard';

interface Stats { totalRead: number; thisWeek: number; saved: number; topTopics: { topic: string; count: number }[] }

export function NewsSavedPanel({ onChange }: { onChange: () => void }) {
  const [saved, setSaved] = useState<NewsArticle[]>([]);
  const [history, setHistory] = useState<NewsArticle[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [sv, h, st] = await Promise.all([
      lensRun('news', 'saved-list', {}),
      lensRun('news', 'reading-history', {}),
      lensRun('news', 'reading-stats', {}),
    ]);
    setSaved(sv.data?.result?.articles || []);
    setHistory(h.data?.result?.history || []);
    setStats((st.data?.result as Stats | null) || null);
    setLoading(false);
    onChange();
  }, [onChange]);

  useEffect(() => { void refresh(); }, [refresh]);

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      {stats && (
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 text-center">
            <p className="text-lg font-bold text-zinc-100">{stats.totalRead}</p>
            <p className="text-[10px] text-zinc-400 uppercase tracking-wide">Total read</p>
          </div>
          <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 text-center">
            <p className="text-lg font-bold text-zinc-100">{stats.thisWeek}</p>
            <p className="text-[10px] text-zinc-400 uppercase tracking-wide">This week</p>
          </div>
          <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 text-center">
            <p className="text-lg font-bold text-zinc-100">{stats.saved}</p>
            <p className="text-[10px] text-zinc-400 uppercase tracking-wide">Saved</p>
          </div>
        </div>
      )}

      {stats && stats.topTopics.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {stats.topTopics.map((t) => (
            <span key={t.topic} className="text-[11px] px-2 py-0.5 rounded-full border border-zinc-700 text-zinc-300 capitalize">
              {t.topic}: {t.count}
            </span>
          ))}
        </div>
      )}

      <section>
        <h3 className="text-xs font-semibold text-zinc-300 mb-2">Saved stories</h3>
        {saved.length === 0 ? (
          <p className="text-[11px] text-zinc-400 italic">No saved stories. Tap the bookmark on any article.</p>
        ) : (
          <ul className="space-y-2">
            {saved.map((a) => <NewsArticleCard key={a.id} article={a} onChange={refresh} />)}
          </ul>
        )}
      </section>

      <section>
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
          <BookOpen className="w-3.5 h-3.5 text-rose-400" /> Reading history
        </h3>
        {history.length === 0 ? (
          <p className="text-[11px] text-zinc-400 italic">No reading history yet.</p>
        ) : (
          <ul className="space-y-2">
            {history.slice(0, 15).map((a) => <NewsArticleCard key={a.id} article={a} onChange={refresh} />)}
          </ul>
        )}
      </section>
    </div>
  );
}
