'use client';

/**
 * FmProfilePanel — the caller's profile page: trust tier, karma and
 * award breakdown, saved posts, full post history and forum-wide
 * search. All data via the `forum` domain macros.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Award, Search, Bookmark, History, Trophy } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Reputation {
  tier: string; contributions: number; topics: number; replies: number; karma: number;
}
interface Profile {
  author: string; topics: number; replies: number; karma: number;
  awardsEarned: number; awardBreakdown: Record<string, number>;
  joinedAt: string | null; lastActiveAt: string | null;
}
interface SavedItem { targetType: string; targetId: string; title: string; score: number; snippet: string }
interface HistoryItem {
  type: string; id: string; topicId?: string; title: string;
  snippet?: string; score: number; at: string;
}
interface SearchTopic { id: string; title: string; score: number }

const TIERS = ['new', 'basic', 'member', 'regular', 'leader'];
const TIER_COLOR: Record<string, string> = {
  new: 'text-zinc-400', basic: 'text-sky-400', member: 'text-emerald-400',
  regular: 'text-amber-400', leader: 'text-orange-400',
};
const AWARD_ICONS: Record<string, string> = {
  helpful: '🙌', insightful: '💡', gold: '🏆', welcoming: '🤝', breakthrough: '🚀',
};

type SubTab = 'overview' | 'saved' | 'history' | 'search';

export function FmProfilePanel({ onOpenTopic }: { onOpenTopic?: (id: string) => void }) {
  const [rep, setRep] = useState<Reputation | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [saved, setSaved] = useState<SavedItem[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [sub, setSub] = useState<SubTab>('overview');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchTopic[] | null>(null);

  const refresh = useCallback(async () => {
    const [r, p, s, h] = await Promise.all([
      lensRun('forum', 'user-reputation', {}),
      lensRun('forum', 'user-profile', {}),
      lensRun('forum', 'saved-list', {}),
      lensRun('forum', 'post-history', {}),
    ]);
    setRep((r.data?.result as Reputation | null) || null);
    setProfile((p.data?.result as Profile | null) || null);
    setSaved((s.data?.result?.saved as SavedItem[]) || []);
    setHistory((h.data?.result?.history as HistoryItem[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const unsave = async (item: SavedItem) => {
    await lensRun('forum', 'save-toggle', { targetType: item.targetType, targetId: item.targetId });
    await refresh();
  };

  const search = async () => {
    if (!query.trim()) { setResults(null); return; }
    const r = await lensRun('forum', 'forum-search', { query: query.trim() });
    setResults((r.data?.result?.topics as SearchTopic[]) || []);
  };

  if (loading || !rep || !profile) {
    return <div className="flex items-center justify-center py-10 text-zinc-500"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  const tierIdx = TIERS.indexOf(rep.tier);

  return (
    <div className="space-y-4">
      <div className="bg-gradient-to-br from-orange-900/40 to-zinc-900/70 border border-orange-900/50 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-2">
          <Award className={cn('w-5 h-5', TIER_COLOR[rep.tier])} />
          <span className={cn('text-lg font-bold capitalize', TIER_COLOR[rep.tier])}>{rep.tier}</span>
          <span className="text-[11px] text-zinc-500">trust tier</span>
          <div className="flex-1" />
          <span className="text-[10px] text-zinc-500">
            {profile.joinedAt ? `joined ${new Date(profile.joinedAt).toLocaleDateString()}` : 'no activity yet'}
          </span>
        </div>
        <div className="flex gap-1 mb-2">
          {TIERS.map((t, i) => (
            <div key={t} className={cn('flex-1 h-1.5 rounded-full', i <= tierIdx ? 'bg-orange-500' : 'bg-zinc-800')} />
          ))}
        </div>
        <div className="grid grid-cols-4 gap-2 mt-3">
          <Stat label="Topics" value={profile.topics} />
          <Stat label="Replies" value={profile.replies} />
          <Stat label="Karma" value={profile.karma} />
          <Stat label="Awards" value={profile.awardsEarned} />
        </div>
        {Object.keys(profile.awardBreakdown).length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {Object.entries(profile.awardBreakdown).map(([kind, n]) => (
              <span key={kind} className="flex items-center gap-1 text-[10px] text-zinc-200 bg-zinc-800 border border-zinc-700 rounded-full px-2 py-0.5">
                {AWARD_ICONS[kind] || '🎖'} {kind} ×{n}
              </span>
            ))}
          </div>
        )}
      </div>

      <nav className="flex gap-1">
        {([
          { id: 'overview' as SubTab, label: 'Overview', icon: Trophy },
          { id: 'saved' as SubTab, label: `Saved (${saved.length})`, icon: Bookmark },
          { id: 'history' as SubTab, label: `History (${history.length})`, icon: History },
          { id: 'search' as SubTab, label: 'Search', icon: Search },
        ]).map((t) => {
          const Icon = t.icon;
          return (
            <button key={t.id} type="button" onClick={() => setSub(t.id)}
              className={cn('flex items-center gap-1 px-2.5 py-1.5 text-[11px] rounded-lg',
                sub === t.id ? 'bg-orange-600 text-white' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700')}>
              <Icon className="w-3 h-3" /> {t.label}
            </button>
          );
        })}
      </nav>

      {sub === 'overview' && (
        <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 text-[11px] text-zinc-400 space-y-1">
          <p>Contributions: <span className="text-zinc-200 font-medium">{rep.contributions}</span></p>
          <p>Last active: <span className="text-zinc-200 font-medium">
            {profile.lastActiveAt ? new Date(profile.lastActiveAt).toLocaleString() : '—'}
          </span></p>
          <p>Earn karma by posting topics and replies that get upvoted; awards from other members raise your standing.</p>
        </div>
      )}

      {sub === 'saved' && (
        saved.length === 0 ? (
          <p className="text-[11px] text-zinc-500 italic py-4 text-center">No saved posts. Bookmark topics or replies to find them here.</p>
        ) : (
          <ul className="space-y-1.5">
            {saved.map((s) => (
              <li key={`${s.targetType}-${s.targetId}`} className="bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] uppercase text-orange-400/80">{s.targetType}</span>
                  <span className="flex-1 text-xs text-zinc-100 min-w-0 truncate">{s.title}</span>
                  <span className="text-[10px] text-zinc-500">{s.score} pts</span>
                  <button type="button" onClick={() => unsave(s)}
                    className="text-[10px] text-zinc-500 hover:text-rose-300">Unsave</button>
                </div>
                {s.snippet && <p className="text-[10px] text-zinc-500 mt-0.5 line-clamp-2">{s.snippet}</p>}
              </li>
            ))}
          </ul>
        )
      )}

      {sub === 'history' && (
        history.length === 0 ? (
          <p className="text-[11px] text-zinc-500 italic py-4 text-center">No post history yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {history.map((h) => (
              <li key={`${h.type}-${h.id}`} className="bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-2">
                <button type="button" onClick={() => onOpenTopic?.(h.topicId || h.id)}
                  className="w-full text-left">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] uppercase text-orange-400/80">{h.type}</span>
                    <span className="flex-1 text-xs text-zinc-100 min-w-0 truncate">{h.title}</span>
                    <span className="text-[10px] text-zinc-500">{h.score} pts</span>
                    <span className="text-[10px] text-zinc-600">{new Date(h.at).toLocaleDateString()}</span>
                  </div>
                  {h.snippet && <p className="text-[10px] text-zinc-500 mt-0.5 line-clamp-1">{h.snippet}</p>}
                </button>
              </li>
            ))}
          </ul>
        )
      )}

      {sub === 'search' && (
        <section>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2">
              <Search className="w-3.5 h-3.5 text-zinc-500" />
              <input placeholder="Search topics and replies" value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void search(); }}
                className="flex-1 bg-transparent py-1.5 text-xs text-zinc-100 focus:outline-none" />
            </div>
            <button type="button" onClick={search}
              className="px-3 py-1.5 text-xs font-medium bg-orange-600 hover:bg-orange-500 text-white rounded-lg">Search</button>
          </div>
          {results != null && (
            results.length === 0 ? (
              <p className="text-[11px] text-zinc-500 italic mt-2">No topics match your search.</p>
            ) : (
              <ul className="space-y-1 mt-2">
                {results.map((t) => (
                  <li key={t.id}>
                    <button type="button" onClick={() => onOpenTopic?.(t.id)}
                      className="w-full flex items-center justify-between bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-1.5 hover:border-orange-900/50">
                      <span className="text-xs text-zinc-200">{t.title}</span>
                      <span className="text-[10px] text-zinc-500">{t.score} pts</span>
                    </button>
                  </li>
                ))}
              </ul>
            )
          )}
        </section>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="text-center">
      <p className="text-lg font-bold text-zinc-100">{value}</p>
      <p className="text-[10px] text-zinc-500 uppercase tracking-wide">{label}</p>
    </div>
  );
}
