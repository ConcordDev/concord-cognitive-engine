'use client';

/**
 * FmTrendingPanel — the personalized "hot" ranking across categories.
 * Surfaces the backend hot score (log-weighted votes + age decay) and
 * the viewer's tag-affinity personalization boost.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Flame, Sparkles, MessageSquare, ArrowBigUp } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface TrendingTopic {
  id: string; title: string; tags: string[]; score: number;
  replyCount: number; hotScore: number; personalBoost: number;
}
interface AffinityTag { tag: string; weight: number }

export function FmTrendingPanel({ onOpenTopic }: { onOpenTopic?: (id: string) => void }) {
  const [trending, setTrending] = useState<TrendingTopic[]>([]);
  const [affinity, setAffinity] = useState<AffinityTag[]>([]);
  const [loading, setLoading] = useState(true);
  const [personalize, setPersonalize] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('forum', 'trending', { personalize, limit: 30 });
    setTrending((r.data?.result?.trending as TrendingTopic[]) || []);
    setAffinity((r.data?.result?.affinityTags as AffinityTag[]) || []);
    setLoading(false);
  }, [personalize]);

  useEffect(() => { void refresh(); }, [refresh]);

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-500"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  const maxHot = trending.reduce((m, t) => Math.max(m, t.hotScore), 0.001);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Flame className="w-4 h-4 text-orange-400" />
        <h3 className="text-xs font-semibold text-zinc-200">Trending across all categories</h3>
        <div className="flex-1" />
        <label className="flex items-center gap-1.5 text-[10px] text-zinc-400 cursor-pointer select-none">
          <input type="checkbox" checked={personalize}
            onChange={(e) => setPersonalize(e.target.checked)} className="accent-orange-500" />
          <Sparkles className="w-3 h-3 text-amber-400" /> Personalized
        </label>
      </div>

      {affinity.length > 0 && (
        <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
          <p className="text-[10px] uppercase tracking-wide text-zinc-500 mb-1.5">Your tag affinity</p>
          <div className="flex flex-wrap gap-1.5">
            {affinity.map((a) => (
              <span key={a.tag} className="text-[10px] text-amber-300 bg-amber-950/40 border border-amber-900/50 rounded-full px-2 py-0.5">
                #{a.tag} ×{a.weight}
              </span>
            ))}
          </div>
        </div>
      )}

      {trending.length === 0 ? (
        <p className="text-[11px] text-zinc-500 italic py-6 text-center">No trending topics yet. Post and vote to populate the ranking.</p>
      ) : (
        <ol className="space-y-1.5">
          {trending.map((t, i) => (
            <li key={t.id} className="bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-2">
              <button type="button" onClick={() => onOpenTopic?.(t.id)} className="w-full text-left">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-orange-400 w-6 text-center">{i + 1}</span>
                  <span className="flex-1 text-xs text-zinc-100 min-w-0 truncate">{t.title}</span>
                  {t.personalBoost > 0 && (
                    <span className="flex items-center gap-0.5 text-[10px] text-amber-300">
                      <Sparkles className="w-3 h-3" />+{t.personalBoost.toFixed(2)}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 mt-1 pl-8">
                  <span className="flex items-center gap-0.5 text-[10px] text-zinc-400">
                    <ArrowBigUp className="w-3 h-3" />{t.score}
                  </span>
                  <span className="flex items-center gap-0.5 text-[10px] text-zinc-400">
                    <MessageSquare className="w-3 h-3" />{t.replyCount}
                  </span>
                  <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                    <div className={cn('h-full rounded-full', t.hotScore >= 0 ? 'bg-orange-500' : 'bg-zinc-600')}
                      style={{ width: `${Math.max(4, Math.min(100, (t.hotScore / maxHot) * 100))}%` }} />
                  </div>
                  <span className="text-[10px] text-zinc-500 w-12 text-right">{t.hotScore.toFixed(2)}</span>
                </div>
                {t.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1 pl-8">
                    {t.tags.map((tag) => <span key={tag} className="text-[10px] text-orange-400/80">#{tag}</span>)}
                  </div>
                )}
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
