'use client';

/**
 * Tournaments: north-star chrome over the Challonge/Battlefy-style bracket
 * desk. View union: list | detail | create | esports. Every macro is still
 * driven through useTournamentDesk.run + the detail/create panels.
 */

import { Trophy, Plus, X, List, Gamepad2 } from 'lucide-react';
import { useLensCommand } from '@/hooks/useLensCommand';
import { LensShell } from '@/components/lens/LensShell';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { TournamentListPanel } from '@/components/tournaments/TournamentListPanel';
import { TournamentDetailPanel } from '@/components/tournaments/TournamentDetailPanel';
import { TournamentCreatePanel } from '@/components/tournaments/TournamentCreatePanel';
import { EsportsFeedPanel } from '@/components/tournaments/EsportsFeedPanel';
import { useTournamentDesk, type TourneyView } from '@/components/tournaments/useTournamentDesk';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';

const VIEWS: { id: TourneyView; label: string; keys: string; title: string; hint: string; icon: typeof Trophy }[] = [
  { id: 'list', label: 'Browse', keys: 'l', title: 'Find a bracket', hint: 'Open, running and finished tournaments', icon: List },
  { id: 'create', label: 'Create', keys: 'c', title: 'Run your own tournament', hint: 'Format, seeding, entrants', icon: Plus },
  { id: 'esports', label: 'Esports', keys: 'e', title: 'What the esports scene is saying', hint: 'Live esports community feed', icon: Gamepad2 },
];

export default function TournamentsPage() {
  const desk = useTournamentDesk();
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);

  useLensCommand(
    VIEWS.map((v) => ({
      id: `tab-${v.id}`,
      keys: v.keys,
      description: v.label,
      category: 'navigation' as const,
      action: () => desk.setActive(v.id),
    })),
    { lensId: 'tournaments' },
  );

  const activeTab = desk.active === 'detail' ? 'list' : desk.active;
  const current = desk.active === 'detail' && desk.detail
    ? { title: desk.detail.name || 'Tournament' }
    : VIEWS.find((v) => v.id === desk.active) ?? VIEWS[0];

  return (
    <LensShell lensId="tournaments" asMain={false}>
      <FirstRunTour lensId="tournaments" />
      <DepthBadge lensId="tournaments" size="sm" className="ml-2" />
      <NorthStarFrame
        lensId="tournaments"
        crumb="Tournaments"
        title={`${current.title}${desk.active === 'list' && who ? `, ${who}` : ''}`}
        subtitle="Single and double elimination brackets, entrants, seeding, standings and live results."
        tabs={VIEWS.map((v) => ({ id: v.id, label: v.label, keys: v.keys, hint: v.hint, icon: v.icon }))}
        activeTab={activeTab}
        onTab={(id) => (id === 'list' ? desk.goList() : desk.setActive(id as TourneyView))}
        tabsLabel="Tournament views"
        cta={{ label: 'New tournament', icon: Plus, onClick: () => desk.setActive('create'), title: 'Start a new tournament' }}
      >
        {desk.error && (
          <div role="alert" className="mb-4 flex items-center justify-between rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            <span>Couldn&apos;t load tournaments ({desk.error}).</span>
            <div className="flex items-center gap-2">
              <button onClick={desk.retry} className="rounded-full bg-rose-500/20 px-3 py-1 text-xs font-medium hover:bg-rose-500/30">Retry</button>
              <button onClick={() => desk.setError(null)} aria-label="Dismiss error"><X className="h-4 w-4" /></button>
            </div>
          </div>
        )}

        {desk.loading && !desk.error && desk.active !== 'esports' && (
          <div role="status" className="rounded-2xl border border-white/10 bg-[#111] p-12 text-center text-zinc-400">
            <Trophy className="mx-auto mb-3 h-10 w-10 animate-pulse text-zinc-700" />
            Loading tournaments…
          </div>
        )}

        {(!desk.loading || desk.active === 'esports') && !desk.error && <TourneyPane desk={desk} />}
      </NorthStarFrame>
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
    return <TournamentDetailPanel t={desk.detail} busy={desk.busy} run={desk.run} onRefresh={desk.onRefreshDetail} />;
  }
  if (desk.active === 'create') {
    return <TournamentCreatePanel busy={desk.busy} run={desk.run} onCreated={desk.onCreated} />;
  }
  return null;
}
