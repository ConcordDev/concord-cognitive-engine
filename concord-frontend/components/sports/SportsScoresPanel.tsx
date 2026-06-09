'use client';

/**
 * SportsScoresPanel — track games, update live scores, watchlist and a
 * personalized my-scores feed for followed teams.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Star, Trash2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Game {
  id: string; homeTeam: string; awayTeam: string; league: string;
  date: string; homeScore: number; awayScore: number; status: string; winner: string | null;
}

const STATUS_COLOR: Record<string, string> = {
  scheduled: 'text-zinc-400', live: 'text-red-400', final: 'text-emerald-400',
};

function GameCard({ g, onChange, watchIds, refresh }: {
  g: Game; onChange: () => void; watchIds: string[]; refresh: () => void;
}) {
  const score = async (which: 'home' | 'away', delta: number) => {
    await lensRun('sports', 'game-update-score', {
      id: g.id,
      homeScore: which === 'home' ? Math.max(0, g.homeScore + delta) : g.homeScore,
      awayScore: which === 'away' ? Math.max(0, g.awayScore + delta) : g.awayScore,
      status: g.status === 'scheduled' ? 'live' : g.status,
    });
    refresh(); onChange();
  };
  const setStatus = async (status: string) => {
    await lensRun('sports', 'game-update-score', { id: g.id, status });
    refresh(); onChange();
  };
  const watch = async () => {
    const onList = watchIds.includes(g.id);
    await lensRun('sports', onList ? 'watchlist-remove' : 'watchlist-add', { gameId: g.id });
    refresh(); onChange();
  };
  const del = async () => { await lensRun('sports', 'game-delete', { id: g.id }); refresh(); onChange(); };

  return (
    <li className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
      <div className="flex items-center justify-between">
        <span className={cn('text-[10px] uppercase', STATUS_COLOR[g.status])}>{g.status}</span>
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-zinc-400 uppercase">{g.league} · {g.date}</span>
          <button aria-label="Favorite" type="button" onClick={watch}
            className={cn('p-0.5', watchIds.includes(g.id) ? 'text-amber-400' : 'text-zinc-600 hover:text-amber-400')}>
            <Star className={cn('w-3.5 h-3.5', watchIds.includes(g.id) && 'fill-amber-400')} />
          </button>
          <button aria-label="Delete" type="button" onClick={del} className="text-zinc-600 hover:text-rose-400"><Trash2 className="w-3.5 h-3.5" /></button>
        </div>
      </div>
      <div className="mt-1 space-y-1">
        {(['away', 'home'] as const).map((side) => {
          const team = side === 'home' ? g.homeTeam : g.awayTeam;
          const sc = side === 'home' ? g.homeScore : g.awayScore;
          return (
            <div key={side} className="flex items-center justify-between">
              <span className={cn('text-sm', g.winner === team ? 'font-bold text-zinc-100' : 'text-zinc-300')}>{team}</span>
              <div className="flex items-center gap-1">
                {g.status !== 'final' && (
                  <button type="button" onClick={() => score(side, -1)} className="w-5 h-5 text-xs bg-zinc-800 rounded text-zinc-400">−</button>
                )}
                <span className="w-7 text-center text-sm font-mono text-zinc-100">{sc}</span>
                {g.status !== 'final' && (
                  <button type="button" onClick={() => score(side, 1)} className="w-5 h-5 text-xs bg-zinc-800 rounded text-zinc-400">+</button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {g.status !== 'final' && (
        <button type="button" onClick={() => setStatus('final')}
          className="mt-1.5 text-[10px] text-zinc-400 hover:text-emerald-400">Mark final</button>
      )}
    </li>
  );
}

export function SportsScoresPanel({ onChange }: { onChange: () => void }) {
  const [games, setGames] = useState<Game[]>([]);
  const [myGames, setMyGames] = useState<Game[]>([]);
  const [watchIds, setWatchIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ homeTeam: '', awayTeam: '', league: 'nba', date: new Date().toISOString().slice(0, 10) });

  const refresh = useCallback(async () => {
    setLoading(true);
    const [g, ms, w] = await Promise.all([
      lensRun('sports', 'game-list', {}),
      lensRun('sports', 'my-scores', {}),
      lensRun('sports', 'watchlist-list', {}),
    ]);
    setGames(g.data?.result?.games || []);
    setMyGames(ms.data?.result?.games || []);
    setWatchIds((w.data?.result?.games || []).map((x: Game) => x.id));
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const add = async () => {
    if (!form.homeTeam.trim() || !form.awayTeam.trim()) { setError('Both teams are required.'); return; }
    const r = await lensRun('sports', 'game-add', {
      homeTeam: form.homeTeam.trim(), awayTeam: form.awayTeam.trim(), league: form.league, date: form.date,
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setForm({ homeTeam: '', awayTeam: '', league: 'nba', date: new Date().toISOString().slice(0, 10) });
    setShowAdd(false); setError(null);
    await refresh(); onChange();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button type="button" onClick={() => setShowAdd((v) => !v)}
          className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-red-600 hover:bg-red-500 text-white rounded-lg">
          <Plus className="w-3.5 h-3.5" /> Add game
        </button>
      </div>

      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      {showAdd && (
        <div className="grid grid-cols-2 gap-2 bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
          <input placeholder="Away team" value={form.awayTeam} onChange={(e) => setForm({ ...form, awayTeam: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="Home team" value={form.homeTeam} onChange={(e) => setForm({ ...form, homeTeam: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="League" value={form.league} onChange={(e) => setForm({ ...form, league: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <button type="button" onClick={add}
            className="col-span-2 bg-red-600 hover:bg-red-500 text-white text-xs font-medium rounded-lg px-2 py-1.5">Add game</button>
        </div>
      )}

      {myGames.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold text-zinc-300 mb-2">My teams</h3>
          <ul className="space-y-2">
            {myGames.map((g) => <GameCard key={g.id} g={g} onChange={onChange} watchIds={watchIds} refresh={refresh} />)}
          </ul>
        </section>
      )}

      <section>
        <h3 className="text-xs font-semibold text-zinc-300 mb-2">All games</h3>
        {games.length === 0 ? (
          <div className="text-center text-zinc-400 text-sm italic py-10 border border-zinc-800 rounded-xl">
            No games tracked. Add one to follow the score.
          </div>
        ) : (
          <ul className="space-y-2">
            {games.map((g) => <GameCard key={g.id} g={g} onChange={onChange} watchIds={watchIds} refresh={refresh} />)}
          </ul>
        )}
      </section>
    </div>
  );
}
