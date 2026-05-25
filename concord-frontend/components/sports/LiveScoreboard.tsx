'use client';

import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Trophy, Loader2, Circle, ChevronRight } from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface Competitor { team?: string; abbrev?: string; score?: number | null; homeAway?: string; winner?: boolean; record?: string }
interface GameEvent { id: string; name?: string; shortName?: string; date?: string; status?: { type?: { state?: string; completed?: boolean; description?: string }; period?: number; displayClock?: string }; teams?: Competitor[] }

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }

async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('sports', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) {
    return data.result as MacroEnvelope<T>;
  }
  return data as MacroEnvelope<T>;
}

const SPORTS: { id: string; label: string }[] = [
  { id: 'nba', label: 'NBA' }, { id: 'nfl', label: 'NFL' }, { id: 'mlb', label: 'MLB' }, { id: 'nhl', label: 'NHL' },
  { id: 'wnba', label: 'WNBA' }, { id: 'ncaab', label: 'NCAAB' }, { id: 'soccer', label: 'EPL' },
];

export function LiveScoreboard() {
  const [sport, setSport] = useState('nba');
  const [events, setEvents] = useState<GameEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useMutation({
    mutationFn: async () => {
      setError(null);
      const env = await callMacro<{ events: GameEvent[] }>('scoreboard', { sport });
      if (env.ok && env.result) setEvents(env.result.events);
      else { setEvents([]); setError(env.error || 'failed'); }
    },
  });

  useEffect(() => {
    load.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sport]);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <Trophy className="h-5 w-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">Live scoreboard</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">espn · live</span>
        </div>
        <div className="flex flex-wrap gap-1">
          {SPORTS.map((s) => (
            <button key={s.id} onClick={() => setSport(s.id)} className={`rounded px-2 py-0.5 font-mono text-[10px] uppercase ${sport === s.id ? 'bg-cyan-500/20 text-cyan-200' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'}`}>{s.label}</button>
          ))}
          {events.length > 0 && (
            <SaveAsDtuButton
              compact
              apiSource="espn-scoreboard"
              title={`${sport.toUpperCase()} scoreboard — ${events.length} games`}
              content={events.map((e) => {
                const [a, b] = e.teams || [];
                return `${a?.abbrev || a?.team || '?'} ${a?.score ?? '-'} - ${b?.score ?? '-'} ${b?.abbrev || b?.team || '?'} (${e.status?.type?.description || '?'})`;
              }).join('\n')}
              extraTags={['sports', sport, 'scoreboard']}
              rawData={{ sport, events }}
            />
          )}
        </div>
      </header>

      {error && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">{error}</div>}
      {load.isPending && <div className="flex items-center gap-2 text-xs text-zinc-400"><Loader2 className="h-4 w-4 animate-spin" /> Pulling live scores…</div>}

      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        {events.map((e) => {
          const [a, b] = e.teams || [];
          const live = e.status?.type?.state === 'in';
          const completed = e.status?.type?.completed;
          return (
            <article key={e.id} className={`rounded-lg border ${live ? 'border-red-500/30 bg-red-500/5' : completed ? 'border-zinc-800 bg-zinc-950/40' : 'border-cyan-500/20 bg-zinc-950/40'} p-3`}>
              <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-wider text-zinc-400">
                <span>{e.shortName || e.name}</span>
                <span className={`flex items-center gap-1 font-mono ${live ? 'text-red-300' : completed ? 'text-zinc-400' : 'text-cyan-300'}`}>
                  {live && <Circle className="h-2 w-2 animate-pulse fill-red-300 text-red-300" />}
                  {e.status?.type?.description}{live && e.status?.displayClock ? ` · ${e.status.displayClock}` : ''}
                </span>
              </div>
              <Row team={a} winner={!!a?.winner} live={live} />
              <Row team={b} winner={!!b?.winner} live={live} />
            </article>
          );
        })}
        {events.length === 0 && !load.isPending && !error && (
          <div className="col-span-full rounded border border-dashed border-zinc-800 p-6 text-center text-xs text-zinc-400">No {sport.toUpperCase()} games scheduled.</div>
        )}
      </div>
    </div>
  );
}

function Row({ team, winner, live }: { team?: Competitor; winner: boolean; live: boolean }) {
  if (!team) return null;
  return (
    <div className="flex items-center justify-between py-1 text-sm">
      <div className="flex min-w-0 items-center gap-2">
        {winner && <ChevronRight className="h-3 w-3 text-cyan-400" />}
        <span className={`line-clamp-1 ${winner ? 'font-semibold text-white' : 'text-zinc-300'}`}>{team.team || team.abbrev}</span>
        {team.record && <span className="font-mono text-[10px] text-zinc-400">{team.record}</span>}
      </div>
      <span className={`font-mono text-base ${live ? 'text-red-200' : winner ? 'text-cyan-300' : 'text-zinc-400'}`}>{team.score ?? '-'}</span>
    </div>
  );
}
