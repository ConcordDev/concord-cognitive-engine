'use client';

/**
 * SportsTeamsPanel — followed teams, team news and league standings.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Star, Newspaper, ListOrdered } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface Team { id: string; name: string; league: string }
interface News { id: string; team: string; headline: string; summary: string | null; date: string }
interface Standing { id: string; team: string; league: string; wins: number; losses: number; winPct: number; rank: number }

export function SportsTeamsPanel({ onChange }: { onChange: () => void }) {
  const [teams, setTeams] = useState<Team[]>([]);
  const [news, setNews] = useState<News[]>([]);
  const [standings, setStandings] = useState<Standing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [teamForm, setTeamForm] = useState({ name: '', league: 'nba' });
  const [newsForm, setNewsForm] = useState({ team: '', headline: '' });
  const [stForm, setStForm] = useState({ team: '', league: 'nba', wins: '', losses: '' });

  const refresh = useCallback(async () => {
    setLoading(true);
    const [t, n, st] = await Promise.all([
      lensRun('sports', 'team-list', {}),
      lensRun('sports', 'team-news-list', {}),
      lensRun('sports', 'standings-table', {}),
    ]);
    setTeams(t.data?.result?.teams || []);
    setNews(n.data?.result?.news || []);
    setStandings(st.data?.result?.table || []);
    setLoading(false);
    onChange();
  }, [onChange]);

  useEffect(() => { void refresh(); }, [refresh]);

  const follow = async () => {
    if (!teamForm.name.trim()) { setError('Team name is required.'); return; }
    await lensRun('sports', 'team-follow', { name: teamForm.name.trim(), league: teamForm.league });
    setTeamForm({ name: '', league: 'nba' }); setError(null);
    await refresh();
  };
  const unfollow = async (t: Team) => {
    await lensRun('sports', 'team-follow', { name: t.name, league: t.league });
    await refresh();
  };
  const addNews = async () => {
    if (!newsForm.team.trim() || !newsForm.headline.trim()) { setError('Team and headline are required.'); return; }
    const r = await lensRun('sports', 'team-news-add', { team: newsForm.team.trim(), headline: newsForm.headline.trim() });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setNewsForm({ team: '', headline: '' }); setError(null);
    await refresh();
  };
  const setStanding = async () => {
    if (!stForm.team.trim()) { setError('Team is required.'); return; }
    await lensRun('sports', 'standing-set', {
      team: stForm.team.trim(), league: stForm.league,
      wins: Number(stForm.wins) || 0, losses: Number(stForm.losses) || 0,
    });
    setStForm({ team: '', league: 'nba', wins: '', losses: '' }); setError(null);
    await refresh();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-500"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      {/* Followed teams */}
      <section>
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
          <Star className="w-3.5 h-3.5 text-red-400" /> Followed teams
        </h3>
        <div className="flex gap-2 mb-2">
          <input value={teamForm.name} onChange={(e) => setTeamForm({ ...teamForm, name: e.target.value })} placeholder="Team name"
            className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input value={teamForm.league} onChange={(e) => setTeamForm({ ...teamForm, league: e.target.value })} placeholder="League"
            className="w-24 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <button type="button" onClick={follow}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-red-600 hover:bg-red-500 text-white rounded-lg">
            <Plus className="w-3.5 h-3.5" /> Follow
          </button>
        </div>
        {teams.length === 0 ? (
          <p className="text-[11px] text-zinc-500 italic">Not following any teams.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {teams.map((t) => (
              <button key={t.id} type="button" onClick={() => unfollow(t)}
                className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border border-red-700/50 bg-red-950/40 text-red-300">
                {t.name} <span className="text-zinc-500 uppercase">{t.league}</span> ✕
              </button>
            ))}
          </div>
        )}
      </section>

      {/* Standings */}
      <section>
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
          <ListOrdered className="w-3.5 h-3.5 text-red-400" /> Standings
        </h3>
        <div className="grid grid-cols-4 gap-2 mb-2">
          <input placeholder="Team" value={stForm.team} onChange={(e) => setStForm({ ...stForm, team: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="Wins" inputMode="numeric" value={stForm.wins} onChange={(e) => setStForm({ ...stForm, wins: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="Losses" inputMode="numeric" value={stForm.losses} onChange={(e) => setStForm({ ...stForm, losses: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <button type="button" onClick={setStanding}
            className="bg-red-600 hover:bg-red-500 text-white text-xs font-medium rounded-lg">Set</button>
        </div>
        {standings.length === 0 ? (
          <p className="text-[11px] text-zinc-500 italic">No standings recorded.</p>
        ) : (
          <ul className="space-y-1">
            {standings.map((r) => (
              <li key={r.id} className="flex items-center justify-between bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-1.5">
                <span className="text-xs text-zinc-200"><span className="text-zinc-500">{r.rank}.</span> {r.team}</span>
                <span className="text-[11px] text-zinc-400 font-mono">{r.wins}-{r.losses} · {(r.winPct * 100).toFixed(0)}%</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* News */}
      <section>
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
          <Newspaper className="w-3.5 h-3.5 text-red-400" /> Team news
        </h3>
        <div className="flex gap-2 mb-2">
          <input value={newsForm.team} onChange={(e) => setNewsForm({ ...newsForm, team: e.target.value })} placeholder="Team"
            className="w-28 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input value={newsForm.headline} onChange={(e) => setNewsForm({ ...newsForm, headline: e.target.value })} placeholder="Headline"
            className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <button type="button" onClick={addNews}
            className="px-2.5 py-1.5 text-xs bg-red-600 hover:bg-red-500 text-white rounded-lg">Add</button>
        </div>
        {news.length > 0 && (
          <ul className="space-y-1">
            {news.slice(0, 8).map((n) => (
              <li key={n.id} className="bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-2">
                <p className="text-xs text-zinc-200">{n.headline}</p>
                <p className="text-[10px] text-zinc-500">{n.team} · {n.date}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
