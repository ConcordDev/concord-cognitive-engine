'use client';

// Phase DC1 — Sports league standings.
// Calls /api/sports/league/:leagueId/teams for live team standings
// (power_score, wins/losses). Lets the user create a league + add a
// team inline via /api/sports/league + /api/sports/league/:id/team.
//
// `onLeagueChange` lifts the created/active league id+name up to the
// parent (the sports lens's "Leagues (live)" tab) — before this existed
// the id lived only in this component's local state, truncated to 12
// chars in the header with no way to copy the full id, so a freshly
// created league had no path into <MatchSimulator> short of a user
// manually reading the network tab. Real bug, fixed this pass.

import { useCallback, useEffect, useState } from 'react';
import { Trophy, Plus, Loader2, Copy, Check } from 'lucide-react';
import { LEAGUE_SPORTS, actionError, leagueCreateBody } from '@/components/sports/league-wire';

interface Team {
  id: string;
  league_id: string;
  name: string;
  power_score: number;
  wins?: number;
  losses?: number;
  draws?: number;
}

export interface ActiveLeague { id: string; name: string; sportKind: string }

export function LeagueStandings({
  leagueId: initialLeagueId,
  onLeagueChange,
  onRosterChange,
  reloadToken = 0,
}: {
  leagueId?: string;
  onLeagueChange?: (league: ActiveLeague) => void;
  onRosterChange?: () => void;
  reloadToken?: number;
}) {
  const [leagueId, setLeagueId] = useState<string | null>(initialLeagueId || null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newLeagueName, setNewLeagueName] = useState('');
  const [newSportKind, setNewSportKind] = useState<string>(LEAGUE_SPORTS[0]);
  const [newTeamName, setNewTeamName] = useState('');
  const [copied, setCopied] = useState(false);

  // Stay in sync when the parent switches the active league (e.g. picking
  // a different entry from the recent-leagues row) — previously this only
  // ever read `initialLeagueId` once, at mount.
  useEffect(() => {
    if (initialLeagueId && initialLeagueId !== leagueId) setLeagueId(initialLeagueId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialLeagueId]);

  const copyId = useCallback(() => {
    if (!leagueId) return;
    navigator.clipboard?.writeText(leagueId).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  }, [leagueId]);

  const refresh = useCallback(async () => {
    if (!leagueId) return;
    try {
      const r = await fetch(`/api/sports/league/${leagueId}/teams`, { credentials: 'include' });
      const j = await r.json().catch(() => null);
      const err = actionError(j, r.status, 'Standings are unavailable');
      if (err) {
        setError(err);
        return;
      }
      setError(null);
      setTeams(j.teams || []);
    } catch {
      setError('Standings are unavailable.');
    }
  }, [leagueId]);

  useEffect(() => { refresh(); }, [refresh, reloadToken]);

  const createLeague = useCallback(async () => {
    if (!newLeagueName.trim()) return;
    setPending(true);
    setError(null);
    try {
      const r = await fetch('/api/sports/league', {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(leagueCreateBody(newLeagueName, newSportKind)),
      });
      const j = await r.json().catch(() => null);
      const err = actionError(j, r.status, 'League was not created');
      if (err || !j?.leagueId) {
        setError(err || 'League was not created.');
        return;
      }
      setLeagueId(j.leagueId);
      onLeagueChange?.({ id: j.leagueId, name: newLeagueName.trim(), sportKind: newSportKind });
      setNewLeagueName('');
    } catch {
      setError('League was not created.');
    } finally { setPending(false); }
  }, [newLeagueName, newSportKind, onLeagueChange]);

  const addTeam = useCallback(async () => {
    if (!leagueId || !newTeamName.trim()) return;
    setPending(true);
    setError(null);
    try {
      const r = await fetch(`/api/sports/league/${leagueId}/team`, {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: newTeamName.trim() }),
      });
      const j = await r.json().catch(() => null);
      const err = actionError(j, r.status, 'Team was not added');
      if (err || !j?.teamId) {
        setError(err || 'Team was not added.');
        return;
      }
      setNewTeamName('');
      onRosterChange?.();
      await refresh();
    } catch {
      setError('Team was not added.');
    } finally { setPending(false); }
  }, [leagueId, newTeamName, refresh, onRosterChange]);

  if (!leagueId) {
    return (
      <div className="rounded-lg border border-neon-cyan/30 bg-zinc-900/50 p-4">
        <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-neon-cyan">
          <Trophy size={14} /> Create a league
        </h3>
        <div className="space-y-2">
          <input
            value={newLeagueName}
            onChange={(e) => setNewLeagueName(e.target.value)}
            placeholder="League name"
            className="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-100"
          />
          <select aria-label="Sport kind"
            value={newSportKind}
            onChange={(e) => setNewSportKind(e.target.value)}
            className="min-h-11 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-100"
          >
            {LEAGUE_SPORTS.map((sport) => (
              <option key={sport} value={sport}>{sport.charAt(0).toUpperCase() + sport.slice(1)}</option>
            ))}
          </select>
          <p className="text-[10px] text-zinc-400">
            Stored on the hub world. This form has no world picker.
          </p>
          {error && <p role="alert" className="text-xs text-red-300">{error}</p>}
          <button
            onClick={createLeague}
            disabled={pending || !newLeagueName.trim()}
            className="flex w-full items-center justify-center gap-1 rounded bg-neon-cyan/30 px-3 py-1.5 text-xs text-neon-cyan hover:bg-neon-cyan/50 disabled:opacity-50"
          >
            {pending ? <Loader2 className="animate-spin" size={12} /> : <Plus size={12} />} Create league
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-neon-cyan/30 bg-zinc-900/50 p-4">
      <header className="mb-2 flex items-center justify-between gap-2">
        <h3 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-neon-cyan">
          <Trophy size={14} className="shrink-0" /> <span className="truncate">Standings</span>
        </h3>
        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={copyId}
            title={leagueId}
            aria-label="Copy league id"
            className="flex items-center gap-1 rounded border border-neon-cyan/20 px-1.5 py-0.5 font-mono text-[10px] text-neon-cyan/70 hover:border-neon-cyan/50 hover:text-neon-cyan"
          >
            {copied ? <Check size={10} className="text-emerald-300" /> : <Copy size={10} />}
            {copied ? 'copied' : `${leagueId.slice(0, 8)}…`}
          </button>
          <button onClick={refresh} className="text-[10px] text-neon-cyan/70 hover:text-neon-cyan">refresh</button>
        </div>
      </header>

      <div className="mb-3 space-y-1">
        {error && <p role="alert" className="text-xs text-red-300">{error}</p>}
        {teams.length === 0 && <p className="text-center text-xs text-zinc-400">No teams yet.</p>}
        {teams
          .slice()
          .sort((a, b) => (b.wins ?? 0) - (a.wins ?? 0) || b.power_score - a.power_score)
          .map((t, i) => (
            <div key={t.id} className="flex items-center justify-between rounded bg-zinc-950/50 px-2 py-1 text-xs">
              <div className="flex items-center gap-2">
                <span className="w-4 font-mono text-zinc-400">{i + 1}.</span>
                <span className="text-zinc-100">{t.name}</span>
              </div>
              <div className="flex items-center gap-2 font-mono text-[10px]">
                <span className="text-emerald-300">W{t.wins ?? 0}</span>
                <span className="text-red-300">L{t.losses ?? 0}</span>
                <span className="text-zinc-400">D{t.draws ?? 0}</span>
                <span className="text-amber-300">PWR {t.power_score}</span>
              </div>
            </div>
          ))}
      </div>

      <div className="flex gap-2">
        <input
          value={newTeamName}
          onChange={(e) => setNewTeamName(e.target.value)}
          placeholder="Team name"
          className="flex-1 rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-100"
        />
        <button
          aria-label="Add team"
          onClick={addTeam}
          disabled={pending || !newTeamName.trim()}
          className="rounded bg-neon-cyan/30 px-2 py-1.5 text-xs text-neon-cyan hover:bg-neon-cyan/50 disabled:opacity-50"
        >
          <Plus size={12} />
        </button>
      </div>
    </div>
  );
}
