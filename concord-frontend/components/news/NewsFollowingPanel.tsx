'use client';

/**
 * NewsFollowingPanel — follow / unfollow channels and topics, and
 * view the inferred interest weights driving recommendations.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Rss, Hash, Check, TrendingUp } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Channel { source: string; articleCount: number; followed: boolean }
interface Topic { topic: string; articleCount: number; followed: boolean }
interface Weight { name: string; weight: number }

export function NewsFollowingPanel({ onChange }: { onChange: () => void }) {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [interests, setInterests] = useState<{ topics: Weight[]; sources: Weight[] }>({ topics: [], sources: [] });
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [c, t, i] = await Promise.all([
      lensRun('news', 'channel-list', {}),
      lensRun('news', 'topic-list', {}),
      lensRun('news', 'interests', {}),
    ]);
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

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
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
            {channels.map((c) => (
              <li key={c.source} className="flex items-center justify-between bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-2">
                <span className="text-xs text-zinc-200">{c.source} <span className="text-zinc-600">· {c.articleCount} stories</span></span>
                <button type="button" onClick={() => followChannel(c.source)}
                  className={cn('flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-lg border',
                    c.followed ? 'border-rose-700/50 bg-rose-950/40 text-rose-300' : 'border-zinc-700 text-zinc-400')}>
                  {c.followed && <Check className="w-3 h-3" />}
                  {c.followed ? 'Following' : 'Follow'}
                </button>
              </li>
            ))}
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
              <button key={t.topic} type="button" onClick={() => followTopic(t.topic)}
                className={cn('text-[11px] px-2 py-0.5 rounded-full border capitalize',
                  t.followed ? 'border-rose-700/50 bg-rose-950/40 text-rose-300' : 'border-zinc-700 text-zinc-400')}>
                {t.topic} ({t.articleCount})
              </button>
            ))}
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
