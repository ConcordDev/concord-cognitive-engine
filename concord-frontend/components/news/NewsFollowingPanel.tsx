'use client';

/**
 * NewsFollowingPanel — follow / unfollow channels and topics, and
 * view the inferred interest weights driving recommendations.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Rss, Hash, Check, TrendingUp, ChevronDown, ChevronRight } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { NewsArticleCard, type NewsArticle } from './NewsArticleCard';
import { ErrorState } from '@/components/ui';

interface Channel { source: string; articleCount: number; followed: boolean }
interface Topic { topic: string; articleCount: number; followed: boolean }
interface Weight { name: string; weight: number }

export function NewsFollowingPanel({ onChange }: { onChange: () => void }) {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [interests, setInterests] = useState<{ topics: Weight[]; sources: Weight[] }>({ topics: [], sources: [] });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [openChannel, setOpenChannel] = useState<string | null>(null);
  const [openTopic, setOpenTopic] = useState<string | null>(null);
  const [channelArticles, setChannelArticles] = useState<NewsArticle[]>([]);
  const [topicArticles, setTopicArticles] = useState<NewsArticle[]>([]);
  const [drillLoading, setDrillLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [c, t, i] = await Promise.all([
      lensRun('news', 'channel-list', {}),
      lensRun('news', 'topic-list', {}),
      lensRun('news', 'interests', {}),
    ]);
    if (c.data?.ok === false || t.data?.ok === false || i.data?.ok === false) {
      setLoadError((c.data?.ok === false ? c.data?.error : t.data?.ok === false ? t.data?.error : i.data?.error) || 'Could not load following.');
      setLoading(false);
      return;
    }
    setLoadError(null);
    setChannels(c.data?.result?.channels || []);
    setTopics(t.data?.result?.topics || []);
    setInterests({ topics: i.data?.result?.topics || [], sources: i.data?.result?.sources || [] });
    setLoading(false);
    onChange();
  }, [onChange]);

  useEffect(() => { void refresh(); }, [refresh]);

  const followChannel = async (source: string) => {
    await lensRun('news', 'channel-follow', { source });
    await refresh();
  };
  const followTopic = async (topic: string) => {
    await lensRun('news', 'topic-follow', { topic });
    await refresh();
  };

  const loadChannelArticles = async (source: string) => {
    setDrillLoading(true);
    const r = await lensRun('news', 'channel-articles', { source });
    setChannelArticles(r.data?.ok ? (r.data.result?.articles as NewsArticle[]) || [] : []);
    setDrillLoading(false);
  };
  const loadTopicArticles = async (topic: string) => {
    setDrillLoading(true);
    const r = await lensRun('news', 'topic-articles', { topic });
    setTopicArticles(r.data?.ok ? (r.data.result?.articles as NewsArticle[]) || [] : []);
    setDrillLoading(false);
  };
  const toggleChannelDrill = async (source: string) => {
    if (openChannel === source) { setOpenChannel(null); return; }
    setOpenChannel(source); setOpenTopic(null);
    await loadChannelArticles(source);
  };
  const toggleTopicDrill = async (topic: string) => {
    if (openTopic === topic) { setOpenTopic(null); return; }
    setOpenTopic(topic); setOpenChannel(null);
    await loadTopicArticles(topic);
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  if (loadError) {
    return <div className="p-4"><ErrorState message={loadError} onRetry={refresh} /></div>;
  }

  return (
    <div className="space-y-4">
      {/* Channels */}
      <section>
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
          <Rss className="w-3.5 h-3.5 text-rose-400" /> Channels
        </h3>
        {channels.length === 0 ? (
          <p className="text-[11px] text-zinc-400 italic">No sources yet — add stories in the Today tab.</p>
        ) : (
          <ul className="space-y-1">
            {channels.map((c) => {
              const open = openChannel === c.source;
              return (
                <li key={c.source} className="bg-zinc-900/70 border border-zinc-800 rounded-lg overflow-hidden">
                  <div className="flex items-center justify-between px-3 py-2">
                    <button type="button" onClick={() => void toggleChannelDrill(c.source)}
                      className="flex items-center gap-1 text-xs text-zinc-200 hover:text-white min-w-0">
                      {open ? <ChevronDown className="w-3 h-3 shrink-0 text-zinc-500" /> : <ChevronRight className="w-3 h-3 shrink-0 text-zinc-500" />}
                      <span className="truncate">{c.source}</span>
                      <span className="text-zinc-600 shrink-0">· {c.articleCount} stories</span>
                    </button>
                    <button type="button" onClick={() => followChannel(c.source)}
                      className={cn('flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-lg border shrink-0',
                        c.followed ? 'border-rose-700/50 bg-rose-950/40 text-rose-300' : 'border-zinc-700 text-zinc-400')}>
                      {c.followed && <Check className="w-3 h-3" />}
                      {c.followed ? 'Following' : 'Follow'}
                    </button>
                  </div>
                  {open && (
                    <div className="border-t border-zinc-800 px-3 py-2">
                      {drillLoading ? (
                        <div className="flex items-center justify-center py-4 text-zinc-400"><Loader2 className="w-4 h-4 animate-spin" /></div>
                      ) : channelArticles.length === 0 ? (
                        <p className="text-[11px] text-zinc-500 italic py-2">No articles from this source yet.</p>
                      ) : (
                        <ul className="space-y-2">
                          {channelArticles.map((a) => <NewsArticleCard key={a.id} article={a} onChange={() => void loadChannelArticles(c.source)} />)}
                        </ul>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Topics */}
      <section>
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
          <Hash className="w-3.5 h-3.5 text-rose-400" /> Topics
        </h3>
        {topics.length === 0 ? (
          <p className="text-[11px] text-zinc-400 italic">No topics yet.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {topics.map((t) => (
              <span key={t.topic}
                className={cn('inline-flex items-center gap-1 rounded-full border pl-2 pr-1 py-0.5 text-[11px] capitalize',
                  t.followed ? 'border-rose-700/50 bg-rose-950/40 text-rose-300' : 'border-zinc-700 text-zinc-400')}>
                <button type="button" onClick={() => void toggleTopicDrill(t.topic)} className="hover:underline">
                  {t.topic} ({t.articleCount})
                </button>
                <button type="button" onClick={() => followTopic(t.topic)} aria-label={t.followed ? `Unfollow ${t.topic}` : `Follow ${t.topic}`}
                  className={cn('rounded-full p-0.5', t.followed ? 'text-rose-300 hover:text-rose-100' : 'text-zinc-500 hover:text-zinc-200')}>
                  {t.followed ? <Check className="w-3 h-3" /> : <span className="block h-3 w-3 text-center leading-3">+</span>}
                </button>
              </span>
            ))}
          </div>
        )}
        {openTopic && (
          <div className="mt-2 rounded-lg border border-zinc-800 bg-zinc-900/70 px-3 py-2">
            <p className="mb-1.5 text-[10px] uppercase tracking-wide text-zinc-500 capitalize">{openTopic} — articles</p>
            {drillLoading ? (
              <div className="flex items-center justify-center py-4 text-zinc-400"><Loader2 className="w-4 h-4 animate-spin" /></div>
            ) : topicArticles.length === 0 ? (
              <p className="text-[11px] text-zinc-500 italic py-2">No articles tagged with this topic yet.</p>
            ) : (
              <ul className="space-y-2">
                {topicArticles.map((a) => <NewsArticleCard key={a.id} article={a} onChange={() => void loadTopicArticles(openTopic)} />)}
              </ul>
            )}
          </div>
        )}
      </section>

      {/* Interests */}
      {(interests.topics.length > 0 || interests.sources.length > 0) && (
        <section>
          <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
            <TrendingUp className="w-3.5 h-3.5 text-rose-400" /> Your interests
          </h3>
          <p className="text-[11px] text-zinc-400 mb-2">
            Inferred from follows, reads and reactions — these drive recommendations.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {interests.topics.filter((w) => w.weight !== 0).slice(0, 10).map((w) => (
              <span key={w.name} className={cn('text-[11px] px-2 py-0.5 rounded-full border capitalize',
                w.weight > 0 ? 'border-emerald-800/50 text-emerald-300' : 'border-zinc-700 text-zinc-400')}>
                {w.name} {w.weight > 0 ? '+' : ''}{w.weight}
              </span>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
