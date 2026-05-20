'use client';

/**
 * FmProfilePanel — the caller's trust tier plus forum-wide search.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Award, Search } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Reputation {
  tier: string; contributions: number; topics: number; replies: number; karma: number;
}
interface Topic { id: string; title: string; score: number }

const TIERS = ['new', 'basic', 'member', 'regular', 'leader'];
const TIER_COLOR: Record<string, string> = {
  new: 'text-zinc-400', basic: 'text-sky-400', member: 'text-emerald-400',
  regular: 'text-amber-400', leader: 'text-orange-400',
};

export function FmProfilePanel() {
  const [rep, setRep] = useState<Reputation | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Topic[] | null>(null);

  const refresh = useCallback(async () => {
    const r = await lensRun('forum', 'user-reputation', {});
    setRep((r.data?.result as Reputation | null) || null);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const search = async () => {
    if (!query.trim()) { setResults(null); return; }
    const r = await lensRun('forum', 'forum-search', { query: query.trim() });
    setResults(r.data?.result?.topics || []);
  };

  if (loading || !rep) {
    return <div className="flex items-center justify-center py-10 text-zinc-500"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  const tierIdx = TIERS.indexOf(rep.tier);

  return (
    <div className="space-y-4">
      {/* Trust tier */}
      <div className="bg-gradient-to-br from-orange-900/40 to-zinc-900/70 border border-orange-900/50 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-2">
          <Award className={cn('w-5 h-5', TIER_COLOR[rep.tier])} />
          <span className={cn('text-lg font-bold capitalize', TIER_COLOR[rep.tier])}>{rep.tier}</span>
          <span className="text-[11px] text-zinc-500">trust tier</span>
        </div>
        <div className="flex gap-1 mb-2">
          {TIERS.map((t, i) => (
            <div key={t} className={cn('flex-1 h-1.5 rounded-full', i <= tierIdx ? 'bg-orange-500' : 'bg-zinc-800')} />
          ))}
        </div>
        <div className="grid grid-cols-3 gap-2 mt-3">
          <Stat label="Topics" value={rep.topics} />
          <Stat label="Replies" value={rep.replies} />
          <Stat label="Karma" value={rep.karma} />
        </div>
      </div>

      {/* Search */}
      <section>
        <h3 className="text-xs font-semibold text-zinc-300 mb-2">Search the forum</h3>
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
                <li key={t.id} className="flex items-center justify-between bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-1.5">
                  <span className="text-xs text-zinc-200">{t.title}</span>
                  <span className="text-[10px] text-zinc-500">{t.score} pts</span>
                </li>
              ))}
            </ul>
          )
        )}
      </section>
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
