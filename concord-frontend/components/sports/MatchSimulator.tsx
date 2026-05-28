'use client';

// Phase DC1 — Sports match simulator.
// Lets the user schedule a match between two teams + play it.
// Calls /api/sports/match/schedule + /api/sports/match/:id/play.

import { useCallback, useEffect, useState } from 'react';
import { Swords, Loader2, Trophy } from 'lucide-react';

interface Team {
  id: string;
  name: string;
  power_score: number;
}

interface MatchResult {
  matchId: string;
  homeScore: number;
  awayScore: number;
  winnerTeamId: string | null;
  mvpMemberId?: string;
}

export function MatchSimulator({ leagueId }: { leagueId: string }) {
  const [teams, setTeams] = useState<Team[]>([]);
  const [homeId, setHomeId] = useState<string | null>(null);
  const [awayId, setAwayId] = useState<string | null>(null);
  const [matchId, setMatchId] = useState<string | null>(null);
  const [result, setResult] = useState<MatchResult | null>(null);
  const [pending, setPending] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const j = await fetch(`/api/sports/league/${leagueId}/teams`, { credentials: 'include' }).then(r => r.json());
      if (j?.ok) setTeams(j.teams || []);
    } catch { /* swallow */ }
  }, [leagueId]);

  useEffect(() => { refresh(); }, [refresh]);

  const schedule = useCallback(async () => {
    if (!homeId || !awayId) return;
    setPending(true);
    try {
      const r = await fetch('/api/sports/match/schedule', {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          leagueId,
          homeTeamId: homeId,
          awayTeamId: awayId,
          scheduledAt: Math.floor(Date.now() / 1000),
        }),
      });
      const j = await r.json();
      if (j?.ok && j.matchId) {
        setMatchId(j.matchId);
        setResult(null);
      }
    } finally { setPending(false); }
  }, [homeId, awayId, leagueId]);

  const play = useCallback(async () => {
    if (!matchId) return;
    setPending(true);
    try {
      const r = await fetch(`/api/sports/match/${matchId}/play`, {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' }, body: '{}',
      });
      const j = await r.json();
      if (j?.ok) setResult({ matchId, ...j });
    } finally { setPending(false); }
  }, [matchId]);

  return (
    <div className="rounded-lg border border-amber-500/30 bg-zinc-900/50 p-4">
      <header className="mb-2 flex items-center gap-2 text-sm font-semibold text-amber-200">
        <Swords size={14} /> Match simulator
      </header>

      {!matchId ? (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <select
              value={homeId ?? ''}
              onChange={(e) => setHomeId(e.target.value || null)}
              className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-100"
            >
              <option value="">Home team</option>
              {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <select
              value={awayId ?? ''}
              onChange={(e) => setAwayId(e.target.value || null)}
              className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-100"
            >
              <option value="">Away team</option>
              {teams.filter((t) => t.id !== homeId).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <button
            onClick={schedule}
            disabled={pending || !homeId || !awayId}
            className="w-full rounded bg-amber-500/30 px-3 py-1.5 text-xs text-amber-100 hover:bg-amber-500/50 disabled:opacity-50"
          >
            {pending ? <Loader2 className="inline animate-spin" size={12} /> : 'Schedule match'}
          </button>
        </div>
      ) : !result ? (
        <div className="space-y-2">
          <p className="text-center text-xs text-zinc-400">Match scheduled · {matchId.slice(0, 12)}</p>
          <button
            onClick={play}
            disabled={pending}
            className="w-full rounded bg-amber-500/30 px-3 py-1.5 text-xs text-amber-100 hover:bg-amber-500/50 disabled:opacity-50"
          >
            {pending ? <Loader2 className="inline animate-spin" size={12} /> : 'Play match'}
          </button>
        </div>
      ) : (
        <div className="space-y-2 text-center">
          <Trophy className="mx-auto text-amber-400" size={20} />
          <div className="font-mono text-3xl text-amber-100">
            {result.homeScore} – {result.awayScore}
          </div>
          <p className="text-xs text-amber-300/70">
            winner: {result.winnerTeamId ? teams.find((t) => t.id === result.winnerTeamId)?.name : 'draw'}
          </p>
          <button
            onClick={() => { setMatchId(null); setResult(null); }}
            className="w-full rounded bg-zinc-800 px-3 py-1 text-[10px] text-zinc-300 hover:bg-zinc-700"
          >
            New match
          </button>
        </div>
      )}
    </div>
  );
}
