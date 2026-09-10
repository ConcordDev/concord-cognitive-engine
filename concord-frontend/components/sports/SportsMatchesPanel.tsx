'use client';

import { useCallback, useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  Calendar,
  Loader2,
  MapPin,
  Medal,
  Plus,
  Search,
  Swords,
  Trash2,
  Trophy,
  X,
} from 'lucide-react';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { EmptyState, ErrorState, StatTile } from '@/components/ui';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';

export interface GameData {
  title: string;
  sport: string;
  team: string;
  opponent: string;
  date: string;
  time: string;
  location: string;
  result: 'win' | 'loss' | 'draw' | 'upcoming';
  scoreHome: number;
  scoreAway: number;
  notes: string;
}

const RESULT_COLORS: Record<string, string> = {
  win: 'text-emerald-400 bg-emerald-400/10',
  loss: 'text-red-400 bg-red-400/10',
  draw: 'text-yellow-400 bg-yellow-400/10',
  upcoming: 'text-cyan-400 bg-cyan-400/10',
};

const EMPTY_GAME = {
  title: '',
  sport: '',
  team: '',
  opponent: '',
  date: '',
  location: '',
};

export function SportsMatchesPanel() {
  const reduceMotion = useReducedMotion();
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [newGame, setNewGame] = useState(EMPTY_GAME);

  const { items, isLoading, isError, error, refetch, create, createMut, remove, deleteMut } =
    useLensData<GameData>('sports', 'game', { seed: [] });

  const games = useMemo(
    () =>
      items
        .map((item) => ({
          id: item.id,
          ...item.data,
          title: item.title || item.data?.title || 'Untitled Game',
        }))
        .filter(
          (g) =>
            !search ||
            g.title?.toLowerCase().includes(search.toLowerCase()) ||
            g.sport?.toLowerCase().includes(search.toLowerCase()) ||
            g.team?.toLowerCase().includes(search.toLowerCase()),
        ),
    [items, search],
  );

  const stats = useMemo(() => {
    const played = games.filter((g) => ['win', 'loss', 'draw'].includes(g.result));
    return {
      total: games.length,
      wins: games.filter((g) => g.result === 'win').length,
      upcoming: games.filter((g) => g.result === 'upcoming').length,
      winRate:
        played.length > 0
          ? Math.round((games.filter((g) => g.result === 'win').length / played.length) * 100)
          : 0,
      streak: (() => {
        const recent = [...played].sort(
          (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
        );
        if (recent.length === 0) return { type: 'none', count: 0 };
        const streakType = recent[0].result;
        let count = 0;
        for (const g of recent) {
          if (g.result === streakType) count++;
          else break;
        }
        return { type: streakType, count };
      })(),
    };
  }, [games]);

  const [nowMs] = useState(() => Date.now());
  const nextGame = useMemo(() => {
    const upcoming = games
      .filter((g) => g.result === 'upcoming' && g.date)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    return upcoming[0] || null;
  }, [games]);
  const daysUntilNext = nextGame
    ? Math.ceil((new Date(nextGame.date).getTime() - nowMs) / 86400000)
    : null;

  const handleCreate = useCallback(async () => {
    if (!newGame.title.trim()) return;
    await create({
      title: newGame.title,
      data: {
        title: newGame.title,
        sport: newGame.sport,
        team: newGame.team,
        opponent: newGame.opponent,
        date: newGame.date,
        time: '',
        location: newGame.location,
        result: 'upcoming',
        scoreHome: 0,
        scoreAway: 0,
        notes: '',
      },
    });
    setNewGame(EMPTY_GAME);
    setShowCreate(false);
  }, [newGame, create]);

  if (isError) {
    return (
      <div className="flex items-center justify-center p-8" role="alert">
        <ErrorState message={error?.message || 'Could not load fixtures'} onRetry={refetch} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {nextGame && daysUntilNext !== null && daysUntilNext >= 0 && (
        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className={cn(ds.panel, 'flex items-center justify-between border-[var(--lens-accent)]/25')}
        >
          <div className="flex items-center gap-3 min-w-0">
            <Swords className="w-5 h-5 shrink-0" style={{ color: 'var(--lens-accent)' }} />
            <div className="min-w-0">
              <p className="text-sm font-medium text-white truncate">
                {nextGame.team} vs{' '}
                <span style={{ color: 'var(--lens-accent)' }}>{nextGame.opponent}</span>
              </p>
              <p className={cn(ds.textMuted, 'text-xs')}>
                {nextGame.sport ? `${nextGame.sport} — ` : ''}
                {nextGame.date}
                {nextGame.location ? ` @ ${nextGame.location}` : ''}
              </p>
            </div>
          </div>
          <div className="text-right shrink-0">
            <p className="text-2xl font-bold font-mono" style={{ color: 'var(--lens-accent)' }}>
              {daysUntilNext === 0 ? 'TODAY' : daysUntilNext}
            </p>
            {daysUntilNext > 0 && (
              <p className="text-[10px] text-gray-400 uppercase tracking-wider">days away</p>
            )}
          </div>
        </motion.div>
      )}

      {stats.streak.count >= 2 && (
        <div
          className={cn(
            ds.panel,
            'flex items-center gap-3 py-3',
            stats.streak.type === 'win' && 'border-emerald-400/30',
            stats.streak.type === 'loss' && 'border-red-400/30',
          )}
        >
          <Medal
            className={cn(
              'w-5 h-5',
              stats.streak.type === 'win' ? 'text-emerald-400' : 'text-red-400',
            )}
          />
          <p className="text-sm">
            <span className="font-bold">
              {stats.streak.count} game {stats.streak.type} streak
            </span>
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatTile label="Games" value={stats.total} icon={<Trophy className="w-4 h-4" />} />
        <StatTile label="Wins" value={stats.wins} tone="positive" />
        <StatTile label="Upcoming" value={stats.upcoming} />
        <StatTile label="Win rate" value={`${stats.winRate}%`} unit="" />
      </div>

      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search fixtures..."
            className={cn(ds.input, 'pl-9')}
            aria-label="Search games"
          />
        </div>
        <button type="button" onClick={() => setShowCreate((v) => !v)} className={ds.btnPrimary}>
          <Plus className="w-4 h-4" /> Add
        </button>
      </div>

      <AnimatePresence>
        {showCreate && (
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={reduceMotion ? { opacity: 1 } : { opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className={cn(ds.panel, 'space-y-3')}>
              <div className="flex items-center justify-between">
                <h3 className={ds.heading3}>Log a match</h3>
                <button
                  type="button"
                  onClick={() => setShowCreate(false)}
                  className={ds.btnGhost}
                  aria-label="Close"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <input
                  value={newGame.title}
                  onChange={(e) => setNewGame((p) => ({ ...p, title: e.target.value }))}
                  placeholder="Match title"
                  className={ds.input}
                />
                <input
                  value={newGame.sport}
                  onChange={(e) => setNewGame((p) => ({ ...p, sport: e.target.value }))}
                  placeholder="Sport"
                  className={ds.input}
                />
                <input
                  value={newGame.team}
                  onChange={(e) => setNewGame((p) => ({ ...p, team: e.target.value }))}
                  placeholder="Your team"
                  className={ds.input}
                />
                <input
                  value={newGame.opponent}
                  onChange={(e) => setNewGame((p) => ({ ...p, opponent: e.target.value }))}
                  placeholder="Opponent"
                  className={ds.input}
                />
                <input
                  type="date"
                  value={newGame.date}
                  onChange={(e) => setNewGame((p) => ({ ...p, date: e.target.value }))}
                  className={ds.input}
                />
                <input
                  value={newGame.location}
                  onChange={(e) => setNewGame((p) => ({ ...p, location: e.target.value }))}
                  placeholder="Venue"
                  className={ds.input}
                />
              </div>
              <button
                type="button"
                onClick={handleCreate}
                disabled={createMut.isPending || !newGame.title.trim()}
                className={ds.btnPrimary}
              >
                {createMut.isPending ? 'Adding…' : 'Add match'}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {isLoading ? (
        <div className={cn(ds.panel, 'text-center text-gray-400')} role="status">
          Loading fixtures…
        </div>
      ) : games.length === 0 ? (
        <EmptyState
          icon={<Trophy className="w-10 h-10" />}
          title="No fixtures yet"
          description="Log a match to start the season table."
          action={{ label: 'Add match', onClick: () => setShowCreate(true) }}
        />
      ) : (
        <div className="space-y-2">
          {games.map((g, i) => (
            <motion.div
              key={g.id}
              initial={reduceMotion ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: reduceMotion ? 0 : i * 0.02 }}
              className={cn(
                ds.panel,
                'py-3',
                g.result === 'win' && 'border-l-2 border-l-emerald-400',
                g.result === 'loss' && 'border-l-2 border-l-red-400',
              )}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <h3 className="font-semibold text-white truncate">{g.title}</h3>
                    <span
                      className={cn(
                        'text-[10px] uppercase tracking-wide px-2 py-0.5 rounded font-medium',
                        RESULT_COLORS[g.result || 'upcoming'],
                      )}
                    >
                      {g.result}
                    </span>
                    {g.sport && (
                      <span className="text-[10px] px-2 py-0.5 rounded bg-lattice-elevated text-gray-300">
                        {g.sport}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-4 text-xs text-gray-400 flex-wrap">
                    {g.team && g.opponent && (
                      <span className="flex items-center gap-1">
                        <Swords className="w-3 h-3" />
                        <span className="text-white">{g.team}</span> vs{' '}
                        <span style={{ color: 'var(--lens-accent)' }}>{g.opponent}</span>
                      </span>
                    )}
                    {g.date && (
                      <span className="flex items-center gap-1 font-mono">
                        <Calendar className="w-3 h-3" />
                        {g.date}
                      </span>
                    )}
                    {g.location && (
                      <span className="flex items-center gap-1">
                        <MapPin className="w-3 h-3" />
                        {g.location}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {g.result !== 'upcoming' && (
                    <p
                      className={cn(
                        'text-xl font-bold font-mono',
                        g.result === 'win'
                          ? 'text-emerald-400'
                          : g.result === 'loss'
                            ? 'text-red-400'
                            : 'text-yellow-400',
                      )}
                    >
                      {g.scoreHome}–{g.scoreAway}
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={() => remove(g.id)}
                    disabled={deleteMut.isPending}
                    className="text-gray-500 hover:text-red-400 p-1"
                    aria-label="Delete match"
                  >
                    {deleteMut.isPending ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Trash2 className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
