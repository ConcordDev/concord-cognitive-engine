'use client';

import { useMemo } from 'react';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { ErrorState, StatTile } from '@/components/ui';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import type { GameData } from './SportsMatchesPanel';

export function SportsStatsPanel() {
  const { items, isLoading, isError, error, refetch } = useLensData<GameData>('sports', 'game', {
    seed: [],
  });

  const games = useMemo(
    () => items.map((item) => ({ id: item.id, ...item.data })),
    [items],
  );

  const stats = useMemo(() => {
    const played = games.filter((g) => ['win', 'loss', 'draw'].includes(g.result));
    return {
      wins: games.filter((g) => g.result === 'win').length,
      losses: games.filter((g) => g.result === 'loss').length,
      draws: games.filter((g) => g.result === 'draw').length,
      totalGoalsFor: played.reduce((s, g) => s + (g.scoreHome || 0), 0),
      totalGoalsAgainst: played.reduce((s, g) => s + (g.scoreAway || 0), 0),
    };
  }, [games]);

  const decided = stats.wins + stats.losses + stats.draws;

  if (isError) {
    return (
      <div className="flex items-center justify-center p-8" role="alert">
        <ErrorState message={error?.message || 'Could not load record'} onRetry={refetch} />
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className={cn(ds.panel, 'text-center text-gray-400')} role="status">
        Computing record…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatTile label="Wins" value={stats.wins} tone="positive" />
        <StatTile label="Losses" value={stats.losses} tone="negative" />
        <StatTile label="Draws" value={stats.draws} />
        <StatTile
          label="For / Against"
          value={`${stats.totalGoalsFor}–${stats.totalGoalsAgainst}`}
        />
      </div>

      {decided > 0 && (
        <div className={ds.panel}>
          <h3 className={cn(ds.heading3, 'mb-3')}>Record</h3>
          <div className="flex rounded-full overflow-hidden h-3 bg-lattice-elevated">
            {stats.wins > 0 && (
              <div
                className="bg-emerald-400/70"
                style={{ width: `${(stats.wins / decided) * 100}%` }}
              />
            )}
            {stats.draws > 0 && (
              <div
                className="bg-yellow-400/70"
                style={{ width: `${(stats.draws / decided) * 100}%` }}
              />
            )}
            {stats.losses > 0 && (
              <div
                className="bg-red-400/70"
                style={{ width: `${(stats.losses / decided) * 100}%` }}
              />
            )}
          </div>
          <div className="flex justify-between mt-2 text-xs font-mono text-gray-400">
            <span className="text-emerald-400">{stats.wins}W</span>
            <span className="text-yellow-400">{stats.draws}D</span>
            <span className="text-red-400">{stats.losses}L</span>
          </div>
        </div>
      )}

      {games.filter((g) => g.result !== 'upcoming').length > 0 && (
        <div className={ds.panel}>
          <h3 className={cn(ds.heading3, 'mb-3')}>Form</h3>
          <div className="flex gap-1">
            {[...games]
              .filter((g) => g.result !== 'upcoming')
              .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
              .slice(0, 10)
              .map((g) => (
                <div
                  key={g.id}
                  title={g.title}
                  className={cn(
                    'w-8 h-8 rounded flex items-center justify-center text-xs font-bold font-mono',
                    g.result === 'win'
                      ? 'bg-emerald-400/20 text-emerald-400'
                      : g.result === 'loss'
                        ? 'bg-red-400/20 text-red-400'
                        : 'bg-yellow-400/20 text-yellow-400',
                  )}
                >
                  {g.result === 'win' ? 'W' : g.result === 'loss' ? 'L' : 'D'}
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
