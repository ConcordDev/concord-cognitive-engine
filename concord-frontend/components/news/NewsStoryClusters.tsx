'use client';

/**
 * NewsStoryClusters — groups articles covering the same event into one story
 * via the `news.story-clusters` macro. Each cluster expands to show its member
 * articles and the left/center/right spread of its coverage.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Layers, ChevronDown, ChevronRight, Newspaper } from 'lucide-react';

import { lensRun } from '@/lib/api/client';

interface ClusterArticle {
  id: string;
  title: string;
  source: string;
  summary: string | null;
  url: string | null;
  publishedAt: string;
}

interface StoryCluster {
  storyId: string;
  headline: string;
  articleCount: number;
  sourceCount: number;
  sources: string[];
  latest: string;
  spread: { left: number; center: number; right: number };
  articles: ClusterArticle[];
}

interface ClusterResult {
  clusters: StoryCluster[];
  storyCount: number;
  multiSource: number;
}

export function NewsStoryClusters() {
  const [result, setResult] = useState<ClusterResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('news', 'story-clusters', {});
    if (r.data?.ok) setResult(r.data.result as ClusterResult);
    else setResult(null);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 overflow-hidden">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800 bg-gradient-to-r from-violet-600/15 to-transparent">
        <Layers className="w-5 h-5 text-violet-400" />
        <h2 className="text-sm font-bold text-zinc-100">Story Clusters</h2>
        {result && (
          <span className="text-[11px] text-zinc-500">
            {result.storyCount} {result.storyCount === 1 ? 'story' : 'stories'} · {result.multiSource} multi-source
          </span>
        )}
      </header>

      {loading ? (
        <div className="flex items-center justify-center py-10 text-zinc-500">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      ) : !result || result.clusters.length === 0 ? (
        <div className="px-4 py-10 text-center text-zinc-500 text-sm italic">
          No data yet — add articles to the news directory to see clustered stories.
        </div>
      ) : (
        <ul className="divide-y divide-zinc-800">
          {result.clusters.map((c) => {
            const open = expanded === c.storyId;
            const total = c.spread.left + c.spread.center + c.spread.right;
            return (
              <li key={c.storyId}>
                <button
                  type="button"
                  onClick={() => setExpanded(open ? null : c.storyId)}
                  className="w-full flex items-start gap-2 px-4 py-3 text-left hover:bg-zinc-900/60 focus:outline-none focus:ring-2 focus:ring-violet-500"
                >
                  {open ? (
                    <ChevronDown className="w-4 h-4 text-zinc-500 mt-0.5 shrink-0" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-zinc-500 mt-0.5 shrink-0" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-zinc-100 line-clamp-2">{c.headline}</p>
                    <p className="text-[10px] text-zinc-500 mt-0.5">
                      {c.articleCount} {c.articleCount === 1 ? 'article' : 'articles'} ·{' '}
                      {c.sourceCount} {c.sourceCount === 1 ? 'source' : 'sources'} · latest{' '}
                      {String(c.latest).slice(0, 10)}
                    </p>
                  </div>
                  {total > 0 && (
                    <div className="flex h-1.5 w-16 rounded-full overflow-hidden bg-zinc-800 mt-1.5 shrink-0">
                      {c.spread.left > 0 && (
                        <div className="bg-blue-500" style={{ width: `${(c.spread.left / total) * 100}%` }} />
                      )}
                      {c.spread.center > 0 && (
                        <div className="bg-zinc-400" style={{ width: `${(c.spread.center / total) * 100}%` }} />
                      )}
                      {c.spread.right > 0 && (
                        <div className="bg-red-500" style={{ width: `${(c.spread.right / total) * 100}%` }} />
                      )}
                    </div>
                  )}
                </button>
                {open && (
                  <ul className="px-4 pb-3 pl-10 space-y-2">
                    {c.articles.map((a) => (
                      <li key={a.id} className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-2.5">
                        <div className="flex items-start gap-2">
                          <Newspaper className="w-3.5 h-3.5 text-zinc-600 mt-0.5 shrink-0" />
                          <div className="min-w-0">
                            <p className="text-xs font-medium text-zinc-100">{a.title}</p>
                            <p className="text-[10px] text-zinc-500">
                              {a.source} · {String(a.publishedAt).slice(0, 10)}
                            </p>
                            {a.summary && (
                              <p className="text-[10px] text-zinc-400 mt-1 line-clamp-2">{a.summary}</p>
                            )}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
