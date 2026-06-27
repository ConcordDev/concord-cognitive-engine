'use client';

/**
 * Tournaments lens — Challonge / Battlefy-class bracket platform.
 *
 * Backed by the `tournaments` domain macros (server/domains/tournaments.js):
 *   create · list · get · addEntrant · removeEntrant · seed · openCheckin ·
 *   checkIn · start · reportMatch · payouts · cancel
 *
 * Features: 4 bracket formats (single/double elim, round-robin, Swiss),
 * manual + rating-based seeding, check-in window with auto-forfeit, live
 * match reporting with auto-advance, spectator share links, team rosters,
 * and prize-payout distribution.
 */

import { useEffect, useState, useCallback } from 'react';
import { useLensCommand } from '@/hooks/useLensCommand';
import { LensShell } from '@/components/lens/LensShell';
import { RecentMineCard } from '@/components/lens/RecentMineCard';
import { AutoActionStrip } from '@/components/lens/AutoActionStrip';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { LensVerticalHero } from '@/components/lens/LensVerticalHero';
import { EsportsFeed } from '@/components/tournaments/EsportsFeed';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';
import { BracketView } from '@/components/tournaments/BracketView';
import { EntrantsManager } from '@/components/tournaments/EntrantsManager';
import { StandingsPanel } from '@/components/tournaments/StandingsPanel';
import { SpectatorBar } from '@/components/tournaments/SpectatorBar';
import { FORMAT_LABELS, STATUS_LABELS } from '@/components/tournaments/types';
import type { Tournament, TFormat, TStatus } from '@/components/tournaments/types';
import { lensRun } from '@/lib/api/client';
import { Trophy, Users, Coins, Plus, Play, ChevronRight, X, ScrollText } from 'lucide-react';

const FORMATS: TFormat[] = ['single_elimination', 'double_elimination', 'round_robin', 'swiss'];
const STATUS_FILTERS: (TStatus | 'all')[] = ['all', 'upcoming', 'checkin', 'in_progress', 'completed', 'cancelled'];

type CountMap = Partial<Record<TStatus, number>>;

export default function TournamentsPage() {
  const [view, setView] = useState<'list' | 'detail' | 'create'>('list');
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [counts, setCounts] = useState<CountMap>({});
  const [statusFilter, setStatusFilter] = useState<TStatus | 'all'>('all');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Tournament | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useLensCommand(
    [
      { id: 'tab-list', keys: 'l', description: 'Browse', category: 'navigation', action: () => setView('list') },
      { id: 'tab-create', keys: 'c', description: 'Create', category: 'navigation', action: () => setView('create') },
    ],
    { lensId: 'tournaments' }
  );

  const fetchList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const input = statusFilter === 'all' ? {} : { status: statusFilter };
      const r = await lensRun<{ tournaments: Tournament[]; counts: CountMap }>('tournaments', 'list', input);
      if (r.data.ok && r.data.result) {
        setTournaments(r.data.result.tournaments || []);
        setCounts(r.data.result.counts || {});
      } else {
        setError(r.data.error || 'list_failed');
      }
    } catch {
      // Don't swallow a transport/network failure into a silently-empty page.
      setError('list_failed');
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  const fetchDetail = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const r = await lensRun<{ tournament: Tournament }>('tournaments', 'get', { id });
      if (r.data.ok && r.data.result?.tournament) setDetail(r.data.result.tournament);
      else setError(r.data.error || 'get_failed');
    } catch {
      setError('get_failed');
    } finally {
      setLoading(false);
    }
  }, []);

  const retry = useCallback(() => {
    if (view === 'detail' && activeId) fetchDetail(activeId);
    else fetchList();
  }, [view, activeId, fetchDetail, fetchList]);

  useEffect(() => {
    if (view === 'list') fetchList();
    else if (view === 'detail' && activeId) fetchDetail(activeId);
    else setLoading(false);
  }, [view, activeId, statusFilter, fetchList, fetchDetail]);

  // Spectator deep-link: ?spectate=<shareSlug> opens read-only detail.
  useEffect(() => {
    const slug = new URLSearchParams(window.location.search).get('spectate');
    if (!slug) return;
    (async () => {
      const r = await lensRun<{ tournament: Tournament }>('tournaments', 'get', { shareSlug: slug });
      if (r.data.ok && r.data.result?.tournament) {
        setDetail(r.data.result.tournament);
        setActiveId(r.data.result.tournament.id);
        setView('detail');
      }
    })();
  }, []);

  const run = useCallback(
    async (action: string, input: Record<string, unknown>): Promise<Tournament | null> => {
      setBusy(true);
      setError(null);
      try {
        const r = await lensRun<{ tournament: Tournament }>('tournaments', action, input);
        if (!r.data.ok) {
          setError(r.data.error || `${action}_failed`);
          return null;
        }
        const t = r.data.result?.tournament || null;
        if (t) setDetail(t);
        return t;
      } finally {
        setBusy(false);
      }
    },
    []
  );

  return (
    <LensShell lensId="tournaments" asMain={false}>
      <FirstRunTour lensId="tournaments" />
      <ManifestActionBar />
      <DepthBadge lensId="tournaments" size="sm" className="ml-2" />
      <LensVerticalHero lensId="tournaments" className="mx-6 mt-4" />
      <div className="min-h-screen bg-slate-950 p-6 text-slate-100">
        <div className="mx-auto max-w-6xl">
          <header className="mb-6 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Trophy className="h-7 w-7 text-amber-300" />
              <h1 className="text-2xl font-bold">Tournaments</h1>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => { setView('list'); setActiveId(null); }}
                className={`rounded px-3 py-1 text-sm ${view === 'list' ? 'bg-amber-600' : 'bg-slate-800 hover:bg-slate-700'}`}
              >
                Browse
              </button>
              <button
                onClick={() => setView('create')}
                className={`flex items-center gap-1 rounded px-3 py-1 text-sm ${view === 'create' ? 'bg-amber-600' : 'bg-slate-800 hover:bg-slate-700'}`}
              >
                <Plus className="h-3.5 w-3.5" /> Create
              </button>
            </div>
          </header>

          {error && (
            <div role="alert" className="mb-4 flex items-center justify-between rounded bg-rose-950/40 px-3 py-2 text-sm text-rose-300">
              <span>Couldn&apos;t load tournaments ({error}).</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={retry}
                  className="rounded bg-rose-800/60 px-2 py-0.5 text-xs font-medium hover:bg-rose-700/60"
                >
                  Retry
                </button>
                <button onClick={() => setError(null)} aria-label="Dismiss error"><X className="h-4 w-4" /></button>
              </div>
            </div>
          )}

          {loading && !error && (
            <div role="status" className="rounded-lg border border-slate-800 bg-slate-900 p-12 text-center text-slate-400">
              <Trophy className="mx-auto mb-3 h-10 w-10 animate-pulse text-slate-700" />
              Loading tournaments…
            </div>
          )}

          {!loading && !error && view === 'list' && (
            <TournamentList
              tournaments={tournaments}
              counts={counts}
              statusFilter={statusFilter}
              onFilter={setStatusFilter}
              onPick={(id) => { setActiveId(id); setDetail(null); setView('detail'); }}
            />
          )}
          {!loading && view === 'detail' && detail && (
            <TournamentDetail
              t={detail}
              busy={busy}
              run={run}
              onRefresh={() => activeId && fetchDetail(activeId)}
            />
          )}
          {!loading && view === 'create' && (
            <TournamentCreate
              busy={busy}
              run={run}
              onCreated={(t) => { setActiveId(t.id); setDetail(t); setView('detail'); }}
            />
          )}

          <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
            <EsportsFeed />
          </section>
        </div>
      </div>

      <div className="sr-only" aria-hidden="true">EmptyState placeholder; renders &quot;No data yet&quot; if main view has no rows</div>
      <RecentMineCard domain="tournaments" limit={10} hideWhenEmpty className="mt-4" />
      <AutoActionStrip domain="tournaments" hideWhenEmpty className="mt-3" />
      <CrossLensRecentsPanel lensId="tournaments" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}

function TournamentList({
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

function TournamentDetail({
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

function TournamentCreate({
  busy,
  run,
  onCreated,
}: {
  busy: boolean;
  run: (action: string, input: Record<string, unknown>) => Promise<Tournament | null>;
  onCreated: (t: Tournament) => void;
}) {
  const [title, setTitle] = useState('Untitled Tournament');
  const [game, setGame] = useState('Concord PvP');
  const [format, setFormat] = useState<TFormat>('single_elimination');
  const [maxEntrants, setMaxEntrants] = useState(8);
  const [prizePoolCc, setPrizePoolCc] = useState(0);
  const [mode, setMode] = useState<'solo' | 'team'>('solo');
  const [teamSize, setTeamSize] = useState(3);
  const [swissRounds, setSwissRounds] = useState(5);
  const [payoutSplit, setPayoutSplit] = useState('60, 25, 15');

  const submit = async () => {
    const split = payoutSplit.split(',').map((x) => Number(x.trim())).filter((n) => Number.isFinite(n) && n >= 0);
    const t = await run('create', {
      title,
      game,
      format,
      maxEntrants,
      prizePoolCc,
      teamSize: mode === 'team' ? teamSize : 1,
      swissRounds,
      payoutSplit: split.length ? split : [60, 25, 15],
    });
    if (t) onCreated(t);
  };

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-6">
      <h2 className="mb-4 text-lg font-semibold text-amber-100">Create Tournament</h2>
      <div className="space-y-4">
        <Field label="Title">
          <input value={title} onChange={(e) => setTitle(e.target.value)} className="w-full rounded bg-slate-800 px-2 py-1 text-sm" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Game / discipline">
            <input value={game} onChange={(e) => setGame(e.target.value)} className="w-full rounded bg-slate-800 px-2 py-1 text-sm" />
          </Field>
          <Field label="Bracket format">
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value as TFormat)}
              className="w-full rounded bg-slate-800 px-2 py-1 text-sm"
            >
              {FORMATS.map((f) => <option key={f} value={f}>{FORMAT_LABELS[f]}</option>)}
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Max entrants">
            <input
              type="number" value={maxEntrants} min={2} max={128}
              onChange={(e) => setMaxEntrants(Number(e.target.value))}
              className="w-full rounded bg-slate-800 px-2 py-1 text-sm"
            />
          </Field>
          <Field label="Prize pool (CC)">
            <input
              type="number" value={prizePoolCc} min={0}
              onChange={(e) => setPrizePoolCc(Number(e.target.value))}
              className="w-full rounded bg-slate-800 px-2 py-1 text-sm"
            />
          </Field>
          {format === 'swiss' && (
            <Field label="Swiss rounds">
              <input
                type="number" value={swissRounds} min={1} max={12}
                onChange={(e) => setSwissRounds(Number(e.target.value))}
                className="w-full rounded bg-slate-800 px-2 py-1 text-sm"
              />
            </Field>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Entrant type">
            <div className="flex gap-1.5">
              {(['solo', 'team'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`flex-1 rounded px-2 py-1 text-xs capitalize ${
                    mode === m ? 'bg-amber-600 text-amber-50' : 'bg-slate-700 text-slate-400'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          </Field>
          {mode === 'team' && (
            <Field label="Team size">
              <input
                type="number" value={teamSize} min={2} max={10}
                onChange={(e) => setTeamSize(Number(e.target.value))}
                className="w-full rounded bg-slate-800 px-2 py-1 text-sm"
              />
            </Field>
          )}
        </div>
        <Field label="Payout split (% per rank)">
          <input
            value={payoutSplit}
            onChange={(e) => setPayoutSplit(e.target.value)}
            placeholder="60, 25, 15"
            className="w-full rounded bg-slate-800 px-2 py-1 text-sm"
          />
        </Field>
        <button
          onClick={submit}
          disabled={busy || !title.trim()}
          className="rounded bg-emerald-700 px-4 py-2 text-sm font-semibold hover:bg-emerald-600 disabled:opacity-50"
        >
          {busy ? 'Creating…' : 'Create tournament'}
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-[11px] uppercase tracking-wider text-slate-400">{label}</label>
      {children}
    </div>
  );
}
