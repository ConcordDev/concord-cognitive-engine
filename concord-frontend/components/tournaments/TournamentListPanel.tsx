'use client';

import { Trophy, Users, Coins, ChevronRight } from 'lucide-react';
import { FORMAT_LABELS, STATUS_LABELS } from '@/components/tournaments/types';
import type { Tournament, TStatus } from '@/components/tournaments/types';

const STATUS_FILTERS: (TStatus | 'all')[] = ['all', 'upcoming', 'checkin', 'in_progress', 'completed', 'cancelled'];

type CountMap = Partial<Record<TStatus, number>>;

export function TournamentListPanel({
  tournaments,
  counts,
  statusFilter,
  onFilter,
  onPick,
}: {
  tournaments: Tournament[];
  counts: CountMap;
  statusFilter: TStatus | 'all';
  onFilter: (s: TStatus | 'all') => void;
  onPick: (id: string) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {STATUS_FILTERS.map((s) => (
          <button
            key={s}
            onClick={() => onFilter(s)}
            className={`rounded px-2.5 py-1 text-xs ${
              statusFilter === s ? 'bg-amber-600 text-amber-50' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
            }`}
          >
            {s === 'all' ? 'All' : STATUS_LABELS[s]}
            {s !== 'all' && counts[s] ? <span className="ml-1 opacity-60">{counts[s]}</span> : null}
          </button>
        ))}
      </div>

      {tournaments.length === 0 ? (
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-12 text-center text-slate-400">
          <Trophy className="mx-auto mb-3 h-12 w-12 text-slate-700" />
          No tournaments here. Create one to start a competitive scene.
        </div>
      ) : (
        <ul className="space-y-3">
          {tournaments.map((t) => (
            <li key={t.id}>
              <button
                onClick={() => onPick(t.id)}
                className="flex w-full items-center justify-between rounded-lg border border-slate-800 bg-slate-900 p-4 text-left hover:border-amber-500/50 hover:bg-slate-800"
              >
                <div className="flex-1">
                  <div className="flex items-baseline gap-3">
                    <h3 className="font-semibold text-amber-100">{t.title}</h3>
                    <span className="text-xs text-slate-400">{t.game}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                    <span className="rounded bg-slate-800 px-1.5 py-0.5">{FORMAT_LABELS[t.format]}</span>
                    <span className="rounded bg-slate-800 px-1.5 py-0.5">{STATUS_LABELS[t.status]}</span>
                    <span>{t.mode === 'team' ? `teams · ${t.teamSize}v${t.teamSize}` : 'solo'}</span>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-1 text-amber-300">
                    <Coins className="h-4 w-4" />
                    <span className="tabular-nums">{t.prizePoolCc}</span>
                  </div>
                  <div className="flex items-center gap-1 text-slate-400">
                    <Users className="h-4 w-4" />
                    <span className="tabular-nums">{t.entrants.length}/{t.maxEntrants}</span>
                  </div>
                  <ChevronRight className="h-5 w-5 text-slate-600" />
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

