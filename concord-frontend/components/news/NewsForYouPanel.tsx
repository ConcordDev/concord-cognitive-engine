'use client';

/**
 * NewsForYouPanel — the personalized feed plus interest-ranked
 * recommendations.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { NewsArticleCard, type NewsArticle } from './NewsArticleCard';

export function NewsForYouPanel({ onChange }: { onChange: () => void }) {
  const [feed, setFeed] = useState<NewsArticle[]>([]);
  const [recommended, setRecommended] = useState<NewsArticle[]>([]);
  const [personalized, setPersonalized] = useState(false);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [f, r] = await Promise.all([
      lensRun('news', 'feed', {}),
      lensRun('news', 'recommended', {}),
    ]);
    setFeed(f.data?.result?.articles || []);
    setPersonalized(!!f.data?.result?.personalized);
    setUnread(f.data?.result?.unread || 0);
    setRecommended(r.data?.result?.articles || []);
    setLoading(false);
    onChange();
  }, [onChange]);

  useEffect(() => { void refresh(); }, [refresh]);

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      {recommended.length > 0 && (
        <section>
          <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
            <Sparkles className="w-3.5 h-3.5 text-rose-400" /> Recommended for you
          </h3>
          <p className="text-[11px] text-zinc-400 mb-2">
            Ranked by topics and sources you&apos;ve reacted positively to.
          </p>
          <ul className="space-y-2">
            {recommended.slice(0, 8).map((a) => <NewsArticleCard key={a.id} article={a} onChange={refresh} />)}
          </ul>
        </section>
      )}

      <section>
        <h3 className="text-xs font-semibold text-zinc-300 mb-2">
          Your feed
          <span className="text-zinc-600 ml-1">
            {personalized ? `· ${unread} unread` : '· following nothing yet — showing everything'}
          </span>
        </h3>
        {feed.length === 0 ? (
          <div className="text-center text-zinc-400 text-sm italic py-10 border border-zinc-800 rounded-xl">
            Your feed is empty. Follow channels and topics under the Following tab.
          </div>
        ) : (
          <ul className="space-y-2">
            {feed.map((a) => <NewsArticleCard key={a.id} article={a} onChange={refresh} />)}
          </ul>
        )}
      </section>
    </div>
  );
}
