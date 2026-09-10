'use client';

import { Coins, Play, ScrollText } from 'lucide-react';
import { BracketView } from '@/components/tournaments/BracketView';
import { EntrantsManager } from '@/components/tournaments/EntrantsManager';
import { StandingsPanel } from '@/components/tournaments/StandingsPanel';
import { SpectatorBar } from '@/components/tournaments/SpectatorBar';
import { FORMAT_LABELS } from '@/components/tournaments/types';
import type { Tournament } from '@/components/tournaments/types';

export function TournamentDetailPanel({
  t,
  busy,
  run,
  onRefresh,
}: {
  t: Tournament;
  busy: boolean;
  run: (action: string, input: Record<string, unknown>) => Promise<Tournament | null>;
  onRefresh: () => void;
}) {
  const champion = t.winnerId ? t.entrants.find((e) => e.id === t.winnerId) : null;

  return (
    <div className="space-y-5">
      <SpectatorBar t={t} />

      <div className="rounded-lg border border-slate-800 bg-slate-900 p-5">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-xl font-semibold text-amber-100">{t.title}</h2>
            <p className="mt-1 text-xs text-slate-400">
              {t.game} · {FORMAT_LABELS[t.format]} · {t.mode === 'team' ? `${t.teamSize}v${t.teamSize} teams` : 'solo'}
              {t.format === 'swiss' ? ` · ${t.swissRounds} rounds` : ''}
            </p>
          </div>
          <div className="text-right">
            <div className="flex items-center gap-1 text-2xl font-bold text-amber-300">
              <Coins className="h-5 w-5" /> {t.prizePoolCc}
            </div>
            <div className="text-xs text-slate-400">prize pool</div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {(t.status === 'upcoming' || t.status === 'checkin') && (
            <button
              onClick={async () => { await run('start', { id: t.id }); onRefresh(); }}
              disabled={busy || t.entrants.length < 2}
              className="flex items-center gap-1 rounded bg-amber-700 px-3 py-1.5 text-sm font-medium hover:bg-amber-600 disabled:opacity-40"
            >
              <Play className="h-3.5 w-3.5" />
              {t.status === 'checkin' ? 'Start & lock bracket' : 'Start now'}
            </button>
          )}
          {(t.status === 'upcoming' || t.status === 'checkin') && (
            <button
              onClick={async () => { await run('cancel', { id: t.id }); onRefresh(); }}
              disabled={busy}
              className="rounded bg-slate-700 px-3 py-1.5 text-sm hover:bg-rose-900/60 disabled:opacity-40"
            >
              Cancel
            </button>
          )}
          {champion && (
            <span className="rounded bg-emerald-900/40 px-3 py-1.5 text-sm font-medium text-emerald-300">
              Champion: {champion.name}
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="lg:col-span-1">
          <EntrantsManager
            t={t}
            busy={busy}
            onAddEntrant={(name, rating, roster) => run('addEntrant', { id: t.id, name, rating, roster })}
            onRemoveEntrant={(entrantId) => run('removeEntrant', { id: t.id, entrantId })}
            onSeedRating={() => run('seed', { id: t.id, mode: 'rating' })}
            onSeedMove={(entrantId, seed) => run('seed', { id: t.id, entrantId, seed })}
            onOpenCheckin={() => run('openCheckin', { id: t.id })}
            onCheckIn={(entrantId) => run('checkIn', { id: t.id, entrantId })}
          />
        </div>

        <div className="space-y-5 lg:col-span-2">
          <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
            <h3 className="mb-3 font-semibold text-slate-200">Bracket</h3>
            <BracketView
              t={t}
              busy={busy}
              canReport={t.status === 'in_progress'}
              onReport={(matchId, a, b) => run('reportMatch', { id: t.id, matchId, scoreA: a, scoreB: b })}
            />
          </div>

          <StandingsPanel
            t={t}
            busy={busy}
            onRepayout={(split) => run('payouts', { id: t.id, payoutSplit: split })}
          />

          {t.log.length > 0 && (
            <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
              <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-200">
                <ScrollText className="h-4 w-4" /> Match log
              </h3>
              <ul className="space-y-0.5 text-[11px] text-slate-400">
                {t.log.slice(0, 12).map((l, i) => (
                  <li key={`${l.at}-${i}`} className="flex gap-2">
                    <span className="shrink-0 font-mono text-slate-600">
                      {new Date(l.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <span>{l.msg}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

