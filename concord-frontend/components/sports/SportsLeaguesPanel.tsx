'use client';

import { useCallback, useState } from 'react';
import { LeagueStandings, type ActiveLeague } from '@/components/sports/LeagueStandings';
import { MatchSimulator } from '@/components/sports/MatchSimulator';
import { useRecentLeagues } from '@/components/sports/use-recent-leagues';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';

export function SportsLeaguesPanel() {
  const [active, setActive] = useState<ActiveLeague | null>(null);
  const [tableRev, setTableRev] = useState(0);
  const { leagues, remember } = useRecentLeagues();
  const bumpTable = useCallback(() => setTableRev((n) => n + 1), []);

  const onLeagueChange = useCallback(
    (league: ActiveLeague) => {
      setActive(league);
      remember(league);
    },
    [remember],
  );

  return (
    <div className="space-y-3">
      <div>
        <h2 className={ds.heading3}>Live league engine</h2>
        <p className={cn(ds.textMuted, 'text-xs mt-1')}>
          Create a league, add teams, schedule and simulate matches. Each play uses the
          sports-league-engine power-score formula on the server.
        </p>
      </div>

      {leagues.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-wider text-zinc-400">
            Recent (this browser)
          </span>
          {leagues.map((l) => (
            <button
              key={l.id}
              type="button"
              onClick={() => setActive(l)}
              className={cn(
                'rounded-full border px-2.5 py-1 text-[11px] transition-colors',
                active?.id === l.id
                  ? 'border-[var(--lens-accent)]/60 bg-[var(--lens-accent)]/10'
                  : 'border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200',
              )}
            >
              {l.name} <span className="text-zinc-400">· {l.sportKind}</span>
            </button>
          ))}
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        <LeagueStandings
          leagueId={active?.id}
          onLeagueChange={onLeagueChange}
          onRosterChange={bumpTable}
          reloadToken={tableRev}
        />
        {active ? (
          <MatchSimulator leagueId={active.id} reloadToken={tableRev} onPlayed={bumpTable} />
        ) : (
          <div className={cn(ds.panel, 'text-center text-xs text-zinc-400')}>
            Create a league on the left to unlock match scheduling.
          </div>
        )}
      </div>
    </div>
  );
}
