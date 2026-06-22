'use client';

// Phase DC1 — Sports league standings.
// Calls /api/sports/league/:leagueId/teams for live team standings
// (power_score, wins/losses). Lets the user create a league + add a
// team inline via /api/sports/league + /api/sports/league/:id/team.

import { useCallback, useEffect, useState } from 'react';
import { Trophy, Plus, Loader2 } from 'lucide-react';

interface Team {
  id: string;
  league_id: string;
  name: string;
  power_score: number;
  wins?: number;
  losses?: number;
}

export function LeagueStandings({ leagueId: initialLeagueId }: { leagueId?: string }) {
  const [leagueId, setLeagueId] = useState<string | null>(initialLeagueId || null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [pending, setPending] = useState(false);
  const [newLeagueName, setNewLeagueName] = useState('');
  const [newSportKind, setNewSportKind] = useState('soccer');
  const [newTeamName, setNewTeamName] = useState('');

  const refresh = useCallback(async () => {
    if (!leagueId) return;
    try {
      const j = await fetch(`/api/sports/league/${leagueId}/teams`, { credentials: 'include' }).then(r => r.json());
      if (j?.ok) setTeams(j.teams || []);
    } catch { /* swallow */ }
  }, [leagueId]);

  useEffect(() => { refresh(); }, [refresh]);

  const createLeague = useCallback(async () => {
    if (!newLeagueName.trim()) return;
    setPending(true);
    try {
      const r = await fetch('/api/sports/league', {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: newLeagueName, sportKind: newSportKind }),
      });
      const j = await r.json();
      if (j?.ok && j.leagueId) {
        setLeagueId(j.leagueId);
        setNewLeagueName('');
      }
    } finally { setPending(false); }
  }, [newLeagueName, newSportKind]);

  const addTeam = useCallback(async () => {
    if (!leagueId || !newTeamName.trim()) return;
    setPending(true);
    try {
      await fetch(`/api/sports/league/${leagueId}/team`, {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: newTeamName, powerScore: 50 + Math.floor(Math.random() * 30) }),
      });
      setNewTeamName('');
      refresh();
    } finally { setPending(false); }
  }, [leagueId, newTeamName, refresh]);

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
          <select
            value={newSportKind}
            onChange={(e) => setNewSportKind(e.target.value)}
            className="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-100"
          >
            <option value="soccer">Soccer</option>
            <option value="basketball">Basketball</option>
            <option value="tennis">Tennis</option>
            <option value="cricket">Cricket</option>
          </select>
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
      <header className="mb-2 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-neon-cyan">
          <Trophy size={14} /> Standings · {leagueId.slice(0, 12)}
        </h3>
        <button onClick={refresh} className="text-[10px] text-neon-cyan/70 hover:text-neon-cyan">refresh</button>
      </header>

      <div className="mb-3 space-y-1">
        {teams.length === 0 && <p className="text-center text-xs text-zinc-400">No teams yet.</p>}
        {teams
          .slice()
          .sort((a, b) => (b.wins ?? 0) - (a.wins ?? 0) || b.power_score - a.power_score)
          .map((t, i) => (
            <div key={t.id} className="flex items-center justify-between rounded bg-zinc-950/50 px-2 py-1 text-xs">
              <div className="flex items-center gap-2">
                <span className="w-4 font-mono text-zinc-500">{i + 1}.</span>
                <span className="text-zinc-100">{t.name}</span>
              </div>
              <div className="flex items-center gap-2 font-mono text-[10px]">
                <span className="text-emerald-300">W{t.wins ?? 0}</span>
                <span className="text-red-300">L{t.losses ?? 0}</span>
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
