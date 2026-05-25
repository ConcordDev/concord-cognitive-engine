'use client';

/* eslint-disable @next/next/no-img-element */

/**
 * SportsSpectatorHub — ESPN spectator-core surface. Wires the ESPN
 * play-by-play, schedule, standings, news, roster, player-lookup,
 * reminders, bracket and win-probability macros to purpose-built UI.
 * All data is live from ESPN / TheSportsDB public endpoints or
 * pure-compute backend macros — no mock data.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Newspaper, CalendarDays, ListOrdered, PlayCircle, Users, UserSearch,
  Bell, GitBranch, Percent, Loader2, Trash2, Plus, ChevronRight, Trophy,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

type TabId =
  | 'news' | 'schedule' | 'standings' | 'playbyplay'
  | 'roster' | 'players' | 'reminders' | 'bracket' | 'winprob';

const TABS: { id: TabId; label: string; icon: typeof Newspaper }[] = [
  { id: 'news', label: 'News', icon: Newspaper },
  { id: 'schedule', label: 'Schedule', icon: CalendarDays },
  { id: 'standings', label: 'Standings', icon: ListOrdered },
  { id: 'playbyplay', label: 'Play-by-Play', icon: PlayCircle },
  { id: 'roster', label: 'Rosters', icon: Users },
  { id: 'players', label: 'Players', icon: UserSearch },
  { id: 'reminders', label: 'Reminders', icon: Bell },
  { id: 'bracket', label: 'Bracket', icon: GitBranch },
  { id: 'winprob', label: 'Win Prob', icon: Percent },
];

const SPORTS = ['nba', 'nfl', 'mlb', 'nhl', 'wnba', 'ncaab', 'ncaaf', 'soccer'];

async function run<T = Record<string, unknown>>(
  action: string,
  input: Record<string, unknown>,
): Promise<{ ok: boolean; result?: T; error?: string }> {
  try {
    const r = await lensRun('sports', action, input);
    const d = r.data as { ok?: boolean; result?: T; error?: string } | undefined;
    if (!d) return { ok: false, error: 'empty response' };
    return { ok: d.ok !== false, result: d.result, error: d.error };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'request failed' };
  }
}

function SportPicker({ value, onChange }: { value: string; onChange: (s: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1">
      {SPORTS.map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => onChange(s)}
          className={cn(
            'rounded px-2 py-0.5 font-mono text-[10px] uppercase',
            value === s
              ? 'bg-red-500/20 text-red-200'
              : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700',
          )}
        >
          {s === 'soccer' ? 'EPL' : s}
        </button>
      ))}
    </div>
  );
}

/* ── News ──────────────────────────────────────────────────────────── */
interface Article {
  headline: string; description: string | null; published: string | null;
  byline: string | null; image: string | null; link: string | null;
}
function NewsPanel() {
  const [sport, setSport] = useState('nba');
  const [items, setItems] = useState<Article[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    const r = await run<{ articles: Article[] }>('espn-news', { sport, limit: 16 });
    if (r.ok && r.result) setItems(r.result.articles);
    else { setItems([]); setErr(r.error || 'failed'); }
    setLoading(false);
  }, [sport]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <SportPicker value={sport} onChange={setSport} />
        <span className="font-mono text-[10px] uppercase text-zinc-400">espn news</span>
      </div>
      {loading && <Spinner label="Loading headlines" />}
      {err && <ErrLine msg={err} />}
      <div className="space-y-2">
        {items.map((a, i) => (
          <article key={i} className="flex gap-3 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
            {a.image && (
              <img src={a.image} alt="" className="h-16 w-24 shrink-0 rounded object-cover" />
            )}
            <div className="min-w-0">
              <a
                href={a.link || '#'}
                target="_blank"
                rel="noreferrer"
                className="text-sm font-semibold text-zinc-100 hover:text-red-300"
              >
                {a.headline}
              </a>
              {a.description && (
                <p className="mt-0.5 line-clamp-2 text-xs text-zinc-400">{a.description}</p>
              )}
              <p className="mt-1 font-mono text-[10px] text-zinc-400">
                {a.byline ? `${a.byline} · ` : ''}
                {a.published ? new Date(a.published).toLocaleDateString() : ''}
              </p>
            </div>
          </article>
        ))}
        {!loading && !err && items.length === 0 && <EmptyLine msg="No headlines." />}
      </div>
    </div>
  );
}

/* ── Schedule ──────────────────────────────────────────────────────── */
interface Fixture {
  id: string; name: string; date: string; home: string; away: string;
  homeScore: number | null; awayScore: number | null; status: string | null;
  completed: boolean; venue: string | null;
}
function SchedulePanel({ onPickGame }: { onPickGame: (sport: string, eventId: string) => void }) {
  const [sport, setSport] = useState('nba');
  const [days, setDays] = useState(7);
  const [items, setItems] = useState<Fixture[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [reminding, setReminding] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    const r = await run<{ fixtures: Fixture[] }>('espn-schedule', { sport, days });
    if (r.ok && r.result) setItems(r.result.fixtures);
    else { setItems([]); setErr(r.error || 'failed'); }
    setLoading(false);
  }, [sport, days]);

  useEffect(() => { void load(); }, [load]);

  const addReminder = async (f: Fixture) => {
    setReminding(f.id);
    await run('reminder-set', {
      matchup: `${f.away} @ ${f.home}`,
      sport,
      eventId: f.id,
      kickoff: f.date,
      note: f.venue || '',
    });
    setReminding(null);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SportPicker value={sport} onChange={setSport} />
        <div className="flex items-center gap-1">
          {[3, 7, 14].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDays(d)}
              className={cn(
                'rounded px-2 py-0.5 font-mono text-[10px]',
                days === d ? 'bg-red-500/20 text-red-200' : 'bg-zinc-800 text-zinc-400',
              )}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>
      {loading && <Spinner label="Loading fixtures" />}
      {err && <ErrLine msg={err} />}
      <div className="space-y-1.5">
        {items.map((f) => (
          <div
            key={f.id}
            className="flex items-center justify-between gap-2 rounded-lg border border-zinc-800 bg-zinc-950/40 px-3 py-2"
          >
            <div className="min-w-0">
              <p className="truncate text-sm text-zinc-200">
                <span className="font-semibold">{f.away}</span> @{' '}
                <span className="font-semibold">{f.home}</span>
                {f.completed && f.homeScore != null && (
                  <span className="ml-2 font-mono text-emerald-400">
                    {f.awayScore}-{f.homeScore}
                  </span>
                )}
              </p>
              <p className="font-mono text-[10px] text-zinc-400">
                {new Date(f.date).toLocaleString()} · {f.status || '?'}
                {f.venue ? ` · ${f.venue}` : ''}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {f.completed && (
                <button
                  type="button"
                  onClick={() => onPickGame(sport, f.id)}
                  className="rounded bg-zinc-800 px-2 py-1 text-[10px] text-zinc-300 hover:bg-zinc-700"
                >
                  Play-by-play
                </button>
              )}
              {!f.completed && (
                <button
                  type="button"
                  onClick={() => addReminder(f)}
                  disabled={reminding === f.id}
                  className="flex items-center gap-1 rounded bg-amber-500/15 px-2 py-1 text-[10px] text-amber-300 hover:bg-amber-500/25 disabled:opacity-50"
                >
                  {reminding === f.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Bell className="h-3 w-3" />}
                  Remind
                </button>
              )}
            </div>
          </div>
        ))}
        {!loading && !err && items.length === 0 && <EmptyLine msg="No fixtures in range." />}
      </div>
    </div>
  );
}

/* ── Standings ─────────────────────────────────────────────────────── */
interface StandRow {
  team: string; abbrev: string; logo: string | null;
  wins: number | null; losses: number | null; ties: number | null;
  winPercent: number | null; streak: string | null; rank: number | null;
}
interface StandGroup { name: string; teams: StandRow[] }
function StandingsPanel() {
  const [sport, setSport] = useState('nba');
  const [groups, setGroups] = useState<StandGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    const r = await run<{ groups: StandGroup[] }>('espn-standings', { sport });
    if (r.ok && r.result) setGroups(r.result.groups);
    else { setGroups([]); setErr(r.error || 'failed'); }
    setLoading(false);
  }, [sport]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="space-y-3">
      <SportPicker value={sport} onChange={setSport} />
      {loading && <Spinner label="Loading standings" />}
      {err && <ErrLine msg={err} />}
      <div className="space-y-4">
        {groups.map((g, gi) => (
          <div key={gi}>
            <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">{g.name}</h4>
            <div className="overflow-hidden rounded-lg border border-zinc-800">
              <table className="w-full text-xs">
                <thead className="bg-zinc-900 text-zinc-400">
                  <tr>
                    <th className="px-2 py-1.5 text-left">#</th>
                    <th className="px-2 py-1.5 text-left">Team</th>
                    <th className="px-2 py-1.5 text-right">W</th>
                    <th className="px-2 py-1.5 text-right">L</th>
                    <th className="px-2 py-1.5 text-right">PCT</th>
                    <th className="px-2 py-1.5 text-right">Strk</th>
                  </tr>
                </thead>
                <tbody>
                  {g.teams.map((t, ti) => (
                    <tr key={ti} className="border-t border-zinc-800/60">
                      <td className="px-2 py-1.5 font-mono text-zinc-400">{t.rank ?? ti + 1}</td>
                      <td className="px-2 py-1.5">
                        <span className="flex items-center gap-1.5">
                          {t.logo && <img src={t.logo} alt="" className="h-4 w-4" />}
                          <span className="text-zinc-200">{t.team}</span>
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono text-emerald-400">{t.wins ?? '-'}</td>
                      <td className="px-2 py-1.5 text-right font-mono text-rose-400">{t.losses ?? '-'}</td>
                      <td className="px-2 py-1.5 text-right font-mono text-zinc-300">
                        {t.winPercent != null ? t.winPercent.toFixed(3) : '-'}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono text-zinc-400">{t.streak || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
        {!loading && !err && groups.length === 0 && <EmptyLine msg="No standings available." />}
      </div>
    </div>
  );
}

/* ── Play-by-play ──────────────────────────────────────────────────── */
interface Play {
  id: string | number | null; text: string; period: number | null;
  clock: string | null; team: string | null; scoringPlay: boolean;
  homeScore: number | null; awayScore: number | null;
}
interface SummaryTeam {
  team: string; abbrev: string; score: number | null; homeAway: string;
  winner: boolean; logo: string | null; record: string | null;
}
function PlayByPlayPanel({ initial }: { initial: { sport: string; eventId: string } | null }) {
  const [sport, setSport] = useState(initial?.sport || 'nba');
  const [eventId, setEventId] = useState(initial?.eventId || '');
  const [teams, setTeams] = useState<SummaryTeam[]>([]);
  const [plays, setPlays] = useState<Play[]>([]);
  const [recap, setRecap] = useState<{ headline: string; body: string } | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async (s: string, e: string) => {
    if (!e.trim()) return;
    setLoading(true); setErr(null);
    const r = await run<{
      teams: SummaryTeam[]; plays: Play[];
      recap: { headline: string; body: string } | null; status: string | null;
    }>('espn-game-summary', { sport: s, eventId: e.trim() });
    if (r.ok && r.result) {
      setTeams(r.result.teams); setPlays(r.result.plays);
      setRecap(r.result.recap); setStatus(r.result.status);
    } else { setTeams([]); setPlays([]); setRecap(null); setErr(r.error || 'failed'); }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (initial?.eventId) {
      setSport(initial.sport); setEventId(initial.eventId);
      void load(initial.sport, initial.eventId);
    }
  }, [initial, load]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <SportPicker value={sport} onChange={setSport} />
        <input
          value={eventId}
          onChange={(e) => setEventId(e.target.value)}
          placeholder="ESPN event ID"
          className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200"
        />
        <button
          type="button"
          onClick={() => load(sport, eventId)}
          className="rounded bg-red-500/20 px-3 py-1 text-xs text-red-200 hover:bg-red-500/30"
        >
          Load
        </button>
      </div>
      <p className="text-[10px] text-zinc-400">
        Tip: pick a completed game from the Schedule tab to auto-load its play-by-play.
      </p>
      {loading && <Spinner label="Loading game" />}
      {err && <ErrLine msg={err} />}
      {teams.length > 0 && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
          {teams.map((t, i) => (
            <div key={i} className="flex items-center justify-between py-1">
              <span className="flex items-center gap-2">
                {t.logo && <img src={t.logo} alt="" className="h-5 w-5" />}
                <span className={cn('text-sm', t.winner ? 'font-bold text-white' : 'text-zinc-300')}>
                  {t.team}
                </span>
                {t.record && <span className="font-mono text-[10px] text-zinc-400">{t.record}</span>}
              </span>
              <span className={cn('font-mono text-lg', t.winner ? 'text-emerald-300' : 'text-zinc-400')}>
                {t.score ?? '-'}
              </span>
            </div>
          ))}
          {status && <p className="mt-1 font-mono text-[10px] uppercase text-zinc-400">{status}</p>}
        </div>
      )}
      {recap && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
          <p className="text-xs font-semibold text-zinc-200">{recap.headline}</p>
          <p className="mt-1 text-xs text-zinc-400">{recap.body}</p>
        </div>
      )}
      {plays.length > 0 && (
        <div className="max-h-80 space-y-1 overflow-y-auto rounded-lg border border-zinc-800 p-2">
          {plays.map((p, i) => (
            <div
              key={i}
              className={cn(
                'flex gap-2 rounded px-2 py-1 text-xs',
                p.scoringPlay ? 'bg-emerald-500/10' : 'bg-transparent',
              )}
            >
              <span className="shrink-0 font-mono text-[10px] text-zinc-400">
                {p.period != null ? `P${p.period}` : ''}
                {p.clock ? ` ${p.clock}` : ''}
              </span>
              <span className="text-zinc-300">{p.text}</span>
              {p.homeScore != null && p.awayScore != null && (
                <span className="ml-auto shrink-0 font-mono text-[10px] text-zinc-400">
                  {p.awayScore}-{p.homeScore}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
      {!loading && !err && eventId && plays.length === 0 && teams.length === 0 && (
        <EmptyLine msg="No game data for that event ID." />
      )}
    </div>
  );
}

/* ── Roster ────────────────────────────────────────────────────────── */
interface RosterPlayer {
  id: string; name: string; position: string | null; nationality: string | null;
  number: string | null; thumb: string | null; height: string | null; weight: string | null;
}
interface TeamHit {
  id: string; name: string; league: string; sport: string; badge: string | null;
  stadium: string | null; formedYear: number | null;
}
function RosterPanel() {
  const [query, setQuery] = useState('');
  const [teams, setTeams] = useState<TeamHit[]>([]);
  const [players, setPlayers] = useState<RosterPlayer[]>([]);
  const [activeTeam, setActiveTeam] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const search = async () => {
    if (!query.trim()) return;
    setLoading(true); setErr(null); setPlayers([]); setActiveTeam(null);
    const r = await run<{ teams: TeamHit[] }>('team-lookup', { name: query.trim() });
    if (r.ok && r.result) setTeams(r.result.teams);
    else { setTeams([]); setErr(r.error || 'failed'); }
    setLoading(false);
  };

  const loadRoster = async (t: TeamHit) => {
    setRosterLoading(true); setActiveTeam(t.name); setErr(null);
    const r = await run<{ players: RosterPlayer[] }>('team-roster', { teamId: t.id });
    if (r.ok && r.result) setPlayers(r.result.players);
    else { setPlayers([]); setErr(r.error || 'failed'); }
    setRosterLoading(false);
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && search()}
          placeholder="Search team (e.g. Arsenal, Lakers)"
          className="flex-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-200"
        />
        <button
          type="button"
          onClick={search}
          className="rounded bg-red-500/20 px-3 py-1.5 text-xs text-red-200 hover:bg-red-500/30"
        >
          Find
        </button>
      </div>
      {loading && <Spinner label="Searching teams" />}
      {err && <ErrLine msg={err} />}
      {teams.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {teams.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => loadRoster(t)}
              className={cn(
                'flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs',
                activeTeam === t.name
                  ? 'border-red-500/40 bg-red-500/10 text-red-200'
                  : 'border-zinc-800 bg-zinc-950/40 text-zinc-300 hover:border-zinc-700',
              )}
            >
              {t.badge && <img src={t.badge} alt="" className="h-4 w-4" />}
              {t.name}
              <span className="font-mono text-[9px] text-zinc-400">{t.league}</span>
            </button>
          ))}
        </div>
      )}
      {rosterLoading && <Spinner label="Loading roster" />}
      {players.length > 0 && (
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {players.map((p) => (
            <div key={p.id} className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950/40 p-2">
              {p.thumb && <img src={p.thumb} alt="" className="h-9 w-9 rounded-full object-cover" />}
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold text-zinc-200">
                  {p.number ? `#${p.number} ` : ''}{p.name}
                </p>
                <p className="font-mono text-[10px] text-zinc-400">
                  {[p.position, p.nationality, p.height].filter(Boolean).join(' · ')}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
      {!rosterLoading && activeTeam && players.length === 0 && !err && (
        <EmptyLine msg={`No roster data for ${activeTeam}.`} />
      )}
    </div>
  );
}

/* ── Player lookup ─────────────────────────────────────────────────── */
interface PlayerHit {
  id: string; name: string; team: string | null; sport: string | null;
  position: string | null; nationality: string | null; birthDate: string | null;
  height: string | null; weight: string | null; thumb: string | null;
  description: string | null;
}
function PlayersPanel() {
  const [query, setQuery] = useState('');
  const [players, setPlayers] = useState<PlayerHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const search = async () => {
    if (!query.trim()) return;
    setLoading(true); setErr(null);
    const r = await run<{ players: PlayerHit[] }>('player-lookup', { name: query.trim() });
    if (r.ok && r.result) setPlayers(r.result.players);
    else { setPlayers([]); setErr(r.error || 'failed'); }
    setLoading(false);
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && search()}
          placeholder="Search player (e.g. LeBron James)"
          className="flex-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-200"
        />
        <button
          type="button"
          onClick={search}
          className="rounded bg-red-500/20 px-3 py-1.5 text-xs text-red-200 hover:bg-red-500/30"
        >
          Find
        </button>
      </div>
      {loading && <Spinner label="Searching players" />}
      {err && <ErrLine msg={err} />}
      <div className="space-y-2">
        {players.map((p) => (
          <article key={p.id} className="flex gap-3 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
            {p.thumb && <img src={p.thumb} alt="" className="h-20 w-20 shrink-0 rounded-lg object-cover" />}
            <div className="min-w-0">
              <p className="text-sm font-bold text-zinc-100">{p.name}</p>
              <p className="font-mono text-[10px] text-zinc-400">
                {[p.team, p.position, p.sport, p.nationality].filter(Boolean).join(' · ')}
              </p>
              <p className="mt-0.5 font-mono text-[10px] text-zinc-400">
                {[p.birthDate && `Born ${p.birthDate}`, p.height, p.weight].filter(Boolean).join(' · ')}
              </p>
              {p.description && (
                <p className="mt-1 line-clamp-3 text-xs text-zinc-400">{p.description}</p>
              )}
            </div>
          </article>
        ))}
        {!loading && !err && players.length === 0 && query && (
          <EmptyLine msg="No players found." />
        )}
      </div>
    </div>
  );
}

/* ── Reminders ─────────────────────────────────────────────────────── */
interface Reminder {
  id: string; matchup: string; sport: string; kickoff: string | null;
  note: string | null; upcoming: boolean | null;
}
function RemindersPanel() {
  const [items, setItems] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ matchup: '', sport: 'nba', kickoff: '', note: '' });

  const load = useCallback(async () => {
    setLoading(true);
    const r = await run<{ reminders: Reminder[] }>('reminder-list', {});
    setItems(r.ok && r.result ? r.result.reminders : []);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const add = async () => {
    if (!form.matchup.trim()) return;
    await run('reminder-set', form);
    setForm({ matchup: '', sport: 'nba', kickoff: '', note: '' });
    void load();
  };
  const del = async (id: string) => {
    await run('reminder-delete', { id });
    void load();
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-2 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 sm:grid-cols-2">
        <input
          value={form.matchup}
          onChange={(e) => setForm((p) => ({ ...p, matchup: e.target.value }))}
          placeholder="Matchup (e.g. Lakers vs Celtics)"
          className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-200"
        />
        <input
          type="datetime-local"
          value={form.kickoff}
          onChange={(e) => setForm((p) => ({ ...p, kickoff: e.target.value }))}
          className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-200"
        />
        <select
          value={form.sport}
          onChange={(e) => setForm((p) => ({ ...p, sport: e.target.value }))}
          className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-200"
        >
          {SPORTS.map((s) => <option key={s} value={s}>{s.toUpperCase()}</option>)}
        </select>
        <input
          value={form.note}
          onChange={(e) => setForm((p) => ({ ...p, note: e.target.value }))}
          placeholder="Note (optional)"
          className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-200"
        />
        <button
          type="button"
          onClick={add}
          disabled={!form.matchup.trim()}
          className="flex items-center justify-center gap-1 rounded bg-amber-500/20 px-3 py-1.5 text-xs text-amber-200 hover:bg-amber-500/30 disabled:opacity-50 sm:col-span-2"
        >
          <Plus className="h-3.5 w-3.5" /> Add reminder
        </button>
      </div>
      {loading && <Spinner label="Loading reminders" />}
      <div className="space-y-1.5">
        {items.map((r) => (
          <div
            key={r.id}
            className="flex items-center justify-between gap-2 rounded-lg border border-zinc-800 bg-zinc-950/40 px-3 py-2"
          >
            <div className="min-w-0">
              <p className="truncate text-sm text-zinc-200">
                {r.matchup}
                {r.upcoming && (
                  <span className="ml-2 rounded bg-emerald-500/15 px-1.5 py-0.5 font-mono text-[9px] text-emerald-300">
                    UPCOMING
                  </span>
                )}
              </p>
              <p className="font-mono text-[10px] text-zinc-400">
                {r.sport.toUpperCase()}
                {r.kickoff ? ` · ${new Date(r.kickoff).toLocaleString()}` : ''}
                {r.note ? ` · ${r.note}` : ''}
              </p>
            </div>
            <button
              type="button"
              onClick={() => del(r.id)}
              className="shrink-0 text-zinc-400 hover:text-rose-400"
              aria-label="Delete reminder"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
        {!loading && items.length === 0 && <EmptyLine msg="No reminders set." />}
      </div>
    </div>
  );
}

/* ── Bracket ───────────────────────────────────────────────────────── */
interface BMatch {
  id: string; round: number; slot: number;
  teamA: string | null; teamB: string | null; winner: string | null;
}
interface Bracket {
  id: string; name: string; size: number; rounds: number;
  matches: BMatch[]; champion?: string | null;
}
function BracketPanel() {
  const [items, setItems] = useState<Bracket[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [teamsText, setTeamsText] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const r = await run<{ brackets: Bracket[] }>('bracket-list', {});
    setItems(r.ok && r.result ? r.result.brackets : []);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const create = async () => {
    const teams = teamsText.split(/[\n,]/).map((t) => t.trim()).filter(Boolean);
    if (!name.trim() || teams.length < 2) return;
    await run('bracket-create', { name: name.trim(), teams });
    setName(''); setTeamsText('');
    void load();
  };
  const advance = async (bracketId: string, matchId: string, winner: string) => {
    await run('bracket-advance', { bracketId, matchId, winner });
    void load();
  };
  const del = async (id: string) => {
    await run('bracket-delete', { id });
    void load();
  };

  return (
    <div className="space-y-3">
      <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Bracket name"
          className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-200"
        />
        <textarea
          value={teamsText}
          onChange={(e) => setTeamsText(e.target.value)}
          placeholder="Teams — one per line or comma-separated (min 2)"
          rows={3}
          className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-200"
        />
        <button
          type="button"
          onClick={create}
          className="flex items-center gap-1 rounded bg-red-500/20 px-3 py-1.5 text-xs text-red-200 hover:bg-red-500/30"
        >
          <GitBranch className="h-3.5 w-3.5" /> Create bracket
        </button>
      </div>
      {loading && <Spinner label="Loading brackets" />}
      <div className="space-y-3">
        {items.map((b) => {
          const rounds = Array.from({ length: b.rounds }, (_, r) =>
            b.matches.filter((m) => m.round === r).sort((x, y) => x.slot - y.slot),
          );
          return (
            <div key={b.id} className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-semibold text-zinc-100">
                  {b.name}
                  <span className="ml-2 font-mono text-[10px] text-zinc-400">{b.size}-team</span>
                  {b.champion && (
                    <span className="ml-2 inline-flex items-center gap-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-300">
                      <Trophy className="h-3 w-3" /> {b.champion}
                    </span>
                  )}
                </p>
                <button
                  type="button"
                  onClick={() => del(b.id)}
                  className="text-zinc-400 hover:text-rose-400"
                  aria-label="Delete bracket"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <div className="flex gap-3 overflow-x-auto">
                {rounds.map((round, ri) => (
                  <div key={ri} className="flex min-w-[150px] flex-col justify-around gap-2">
                    <p className="font-mono text-[9px] uppercase text-zinc-400">
                      {ri === b.rounds - 1 ? 'Final' : `Round ${ri + 1}`}
                    </p>
                    {round.map((m) => (
                      <div key={m.id} className="rounded border border-zinc-800 bg-zinc-900 p-1.5">
                        {(['teamA', 'teamB'] as const).map((slot) => {
                          const team = m[slot];
                          const decided = !!m.winner;
                          return (
                            <button
                              key={slot}
                              type="button"
                              disabled={!team || team === 'BYE' || decided}
                              onClick={() => team && advance(b.id, m.id, team)}
                              className={cn(
                                'flex w-full items-center justify-between rounded px-1.5 py-0.5 text-[11px]',
                                m.winner === team
                                  ? 'bg-emerald-500/20 font-semibold text-emerald-200'
                                  : team && team !== 'BYE' && !decided
                                    ? 'text-zinc-300 hover:bg-zinc-800'
                                    : 'text-zinc-600',
                              )}
                            >
                              <span className="truncate">{team || 'TBD'}</span>
                              {m.winner === team && <ChevronRight className="h-3 w-3" />}
                            </button>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
        {!loading && items.length === 0 && <EmptyLine msg="No brackets yet." />}
      </div>
    </div>
  );
}

/* ── Win probability ───────────────────────────────────────────────── */
interface WinProb {
  homeWinPct: number; awayWinPct: number; leader: string; margin: number;
  elapsedFraction: number; favored: string; confidence: string;
}
function WinProbPanel() {
  const [form, setForm] = useState({
    homeScore: 0, awayScore: 0, period: 1, periodsTotal: 4, clock: '12:00',
  });
  const [result, setResult] = useState<WinProb | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const compute = async () => {
    setErr(null);
    const r = await run<WinProb>('win-probability', form);
    if (r.ok && r.result) setResult(r.result);
    else { setResult(null); setErr(r.error || 'failed'); }
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 sm:grid-cols-3">
        <NumField label="Home score" value={form.homeScore}
          onChange={(v) => setForm((p) => ({ ...p, homeScore: v }))} />
        <NumField label="Away score" value={form.awayScore}
          onChange={(v) => setForm((p) => ({ ...p, awayScore: v }))} />
        <NumField label="Period" value={form.period}
          onChange={(v) => setForm((p) => ({ ...p, period: v }))} />
        <NumField label="Periods total" value={form.periodsTotal}
          onChange={(v) => setForm((p) => ({ ...p, periodsTotal: v }))} />
        <div>
          <label className="block font-mono text-[10px] uppercase text-zinc-400">Clock (mm:ss)</label>
          <input
            value={form.clock}
            onChange={(e) => setForm((p) => ({ ...p, clock: e.target.value }))}
            className="mt-0.5 w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200"
          />
        </div>
        <button
          type="button"
          onClick={compute}
          className="self-end rounded bg-red-500/20 px-3 py-1.5 text-xs text-red-200 hover:bg-red-500/30"
        >
          Compute
        </button>
      </div>
      {err && <ErrLine msg={err} />}
      {result && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
          <div className="mb-2 flex h-6 overflow-hidden rounded-full">
            <div
              className="flex items-center justify-start bg-emerald-500/60 px-2 text-[10px] font-bold text-white"
              style={{ width: `${result.homeWinPct}%` }}
            >
              {result.homeWinPct}%
            </div>
            <div
              className="flex items-center justify-end bg-rose-500/60 px-2 text-[10px] font-bold text-white"
              style={{ width: `${result.awayWinPct}%` }}
            >
              {result.awayWinPct}%
            </div>
          </div>
          <div className="flex justify-between text-[10px] uppercase tracking-wide text-zinc-400">
            <span className="text-emerald-400">Home win</span>
            <span className="text-rose-400">Away win</span>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <Metric label="Favored" value={result.favored} />
            <Metric label="Confidence" value={result.confidence} />
            <Metric label="Game elapsed" value={`${Math.round(result.elapsedFraction * 100)}%`} />
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Shared bits ───────────────────────────────────────────────────── */
function Spinner({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 text-xs text-zinc-400">
      <Loader2 className="h-4 w-4 animate-spin" /> {label}…
    </div>
  );
}
function ErrLine({ msg }: { msg: string }) {
  return (
    <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">
      {msg}
    </div>
  );
}
function EmptyLine({ msg }: { msg: string }) {
  return (
    <div className="rounded border border-dashed border-zinc-800 p-4 text-center text-xs text-zinc-400">
      {msg}
    </div>
  );
}
function NumField({ label, value, onChange }: {
  label: string; value: number; onChange: (v: number) => void;
}) {
  return (
    <div>
      <label className="block font-mono text-[10px] uppercase text-zinc-400">{label}</label>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-0.5 w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200"
      />
    </div>
  );
}
function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded bg-zinc-900 p-2">
      <p className="text-sm font-bold capitalize text-zinc-100">{value}</p>
      <p className="font-mono text-[9px] uppercase text-zinc-400">{label}</p>
    </div>
  );
}

export function SportsSpectatorHub() {
  const [tab, setTab] = useState<TabId>('news');
  const [pickedGame, setPickedGame] = useState<{ sport: string; eventId: string } | null>(null);

  const pickGame = useCallback((sport: string, eventId: string) => {
    setPickedGame({ sport, eventId });
    setTab('playbyplay');
  }, []);

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 overflow-hidden">
      <header className="flex items-center gap-2 border-b border-zinc-800 bg-gradient-to-r from-red-600/15 to-transparent px-4 py-3">
        <Trophy className="h-5 w-5 text-red-400" />
        <h2 className="text-sm font-bold text-zinc-100">Spectator Center</h2>
        <span className="text-[11px] text-zinc-400">
          ESPN shape — play-by-play, schedules, standings, news, rosters, brackets
        </span>
      </header>
      <nav className="flex gap-1 overflow-x-auto border-b border-zinc-800 px-2 pt-2">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                'flex items-center gap-1.5 whitespace-nowrap rounded-t-lg px-3 py-2 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-red-500',
                active
                  ? 'border-x border-t border-zinc-800 bg-zinc-900 text-red-300'
                  : 'text-zinc-400 hover:text-zinc-200',
              )}
            >
              <Icon className="h-3.5 w-3.5" /> {t.label}
            </button>
          );
        })}
      </nav>
      <div className="p-4">
        {tab === 'news' && <NewsPanel />}
        {tab === 'schedule' && <SchedulePanel onPickGame={pickGame} />}
        {tab === 'standings' && <StandingsPanel />}
        {tab === 'playbyplay' && <PlayByPlayPanel initial={pickedGame} />}
        {tab === 'roster' && <RosterPanel />}
        {tab === 'players' && <PlayersPanel />}
        {tab === 'reminders' && <RemindersPanel />}
        {tab === 'bracket' && <BracketPanel />}
        {tab === 'winprob' && <WinProbPanel />}
      </div>
    </div>
  );
}
