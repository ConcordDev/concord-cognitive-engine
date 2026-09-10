'use client';

/**
 * Tournaments — Challonge/Battlefy bracket desk.
 * Single view union: list | detail | create | esports.
 * Macros preserved via useTournamentDesk.run + detail/create panels.
 */

import { Trophy, Plus, X } from 'lucide-react';
import { useLensCommand } from '@/hooks/useLensCommand';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { LensVerticalHero } from '@/components/lens/LensVerticalHero';
import { TournamentListPanel } from '@/components/tournaments/TournamentListPanel';
import { TournamentDetailPanel } from '@/components/tournaments/TournamentDetailPanel';
import { TournamentCreatePanel } from '@/components/tournaments/TournamentCreatePanel';
import { EsportsFeedPanel } from '@/components/tournaments/EsportsFeedPanel';
import { useTournamentDesk, type TourneyView } from '@/components/tournaments/useTournamentDesk';
import { cn } from '@/lib/utils';

const VIEWS: { id: TourneyView; label: string; keys: string }[] = [
  { id: 'list', label: 'Browse', keys: 'l' },
  { id: 'create', label: 'Create', keys: 'c' },
  { id: 'esports', label: 'Esports', keys: 'e' },
];

export default function TournamentsPage() {
  const desk = useTournamentDesk();

  useLensCommand(
    [
      ...VIEWS.map((v) => ({
        id: `tab-${v.id}`,
        keys: v.keys,
        description: v.label,
        category: 'navigation' as const,
        action: () => desk.setActive(v.id),
      })),
    ],
    { lensId: 'tournaments' },
  );

  return (
    <LensShell lensId="tournaments" asMain={false}>
      <FirstRunTour lensId="tournaments" />
      <DepthBadge lensId="tournaments" size="sm" className="ml-2" />
      <LensVerticalHero lensId="tournaments" className="mx-6 mt-4" />
      <div className="min-h-screen bg-slate-950 p-6 text-slate-100">
        <div className="mx-auto max-w-6xl">
          <header className="mb-6 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Trophy className="h-7 w-7 text-amber-300" />
              <h1 className="text-2xl font-bold">Tournaments</h1>
            </div>
            <nav className="flex gap-2" aria-label="Tournament views">
              {VIEWS.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => (v.id === 'list' ? desk.goList() : desk.setActive(v.id))}
                  className={cn(
                    'flex items-center gap-1 rounded px-3 py-1 text-sm',
                    desk.active === v.id || (v.id === 'list' && desk.active === 'detail')
                      ? 'bg-amber-600'
                      : 'bg-slate-800 hover:bg-slate-700',
                  )}
                >
                  {v.id === 'create' && <Plus className="h-3.5 w-3.5" />}
                  {v.label}
                </button>
              ))}
            </nav>
          </header>

          {desk.error && (
            <div role="alert" className="mb-4 flex items-center justify-between rounded bg-rose-950/40 px-3 py-2 text-sm text-rose-300">
              <span>Couldn&apos;t load tournaments ({desk.error}).</span>
              <div className="flex items-center gap-2">
                <button onClick={desk.retry} className="rounded bg-rose-800/60 px-2 py-0.5 text-xs font-medium hover:bg-rose-700/60">Retry</button>
                <button onClick={() => desk.setError(null)} aria-label="Dismiss error"><X className="h-4 w-4" /></button>
              </div>
            </div>
          )}

          {desk.loading && !desk.error && desk.active !== 'esports' && (
            <div role="status" className="rounded-lg border border-slate-800 bg-slate-900 p-12 text-center text-slate-400">
              <Trophy className="mx-auto mb-3 h-10 w-10 animate-pulse text-slate-700" />
              Loading tournaments…
            </div>
          )}

          {(!desk.loading || desk.active === 'esports') && !desk.error && (
            <TourneyPane desk={desk} />
          )}
        </div>
      </div>
      <CrossLensRecentsPanel lensId="tournaments" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}

function TourneyPane({ desk }: { desk: ReturnType<typeof useTournamentDesk> }) {
  if (desk.active === 'esports') return <EsportsFeedPanel />;
  if (desk.active === 'list') {
    return (
      <TournamentListPanel
        tournaments={desk.tournaments}
        counts={desk.counts}
        statusFilter={desk.statusFilter}
        onFilter={desk.setStatusFilter}
        onPick={desk.pick}
      />
    );
  }
  if (desk.active === 'detail' && desk.detail) {
    return (
      <TournamentDetailPanel t={desk.detail} busy={desk.busy} run={desk.run} onRefresh={desk.onRefreshDetail} />
    );
  }
  if (desk.active === 'create') {
    return <TournamentCreatePanel busy={desk.busy} run={desk.run} onCreated={desk.onCreated} />;
  }
  return null;
}
