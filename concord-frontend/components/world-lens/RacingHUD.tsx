'use client';

/**
 * RacingHUD — minimal UI for an active vehicle race.
 *
 * Shows lap counter, current checkpoint, racer position, and
 * race-completion banner. Subscribes to `minigame:scored` and
 * `minigame:complete` for updates.
 */

import { useEffect, useState } from 'react';
import { Flag, Trophy } from 'lucide-react';
import { subscribe } from '@/lib/realtime/socket';

interface RaceState {
  scores: Record<string, { lap: number; lastCheckpoint: number; lastCheckpointAt?: number }>;
  players: string[];
  status: string;
  meta: { lapCount: number; trackId: string };
}

interface Props {
  raceId: string | null;
  myUserId: string | null;
}

export function RacingHUD({ raceId, myUserId }: Props) {
  const [race, setRace] = useState<RaceState | null>(null);
  const [winner, setWinner] = useState<string | null>(null);

  useEffect(() => {
    if (!raceId) return;
    const fetchRace = () =>
      fetch(`/api/minigames/racing/${raceId}`, { credentials: 'same-origin' })
        .then((r) => r.json())
        .then((j) => { if (j?.ok) setRace(j.race); })
        .catch(() => {});
    fetchRace();
    const off = subscribe<{ matchId: string; winner: string }>(
      'minigame:complete',
      (msg) => {
        if (msg.matchId === raceId) {
          setWinner(msg.winner);
          fetchRace();
        }
      },
    );
    const interval = setInterval(fetchRace, 2500);
    return () => { off(); clearInterval(interval); };
  }, [raceId]);

  if (!raceId || !race) return null;

  const myState = myUserId ? race.scores[myUserId] : null;
  const standings = race.players
    .map((p) => ({ id: p, ...race.scores[p] }))
    .sort((a, b) => (b.lap - a.lap) || (b.lastCheckpoint - a.lastCheckpoint));
  const myPosition = myUserId ? standings.findIndex((s) => s.id === myUserId) + 1 : 0;

  return (
    <div className="absolute right-4 top-20 z-30 w-64">
      <div className="rounded-lg border border-emerald-500/30 bg-black/70 backdrop-blur-md shadow-lg">
        <div className="flex items-center justify-between px-3 py-2 border-b border-emerald-500/20">
          <div className="flex items-center gap-2 text-xs font-semibold text-emerald-200">
            <Flag className="h-3.5 w-3.5" />
            <span>{race.meta.trackId}</span>
          </div>
          <span className="text-[10px] text-slate-400">
            Lap {myState ? myState.lap + 1 : 1} / {race.meta.lapCount}
          </span>
        </div>

        {winner && (
          <div className="border-b border-emerald-500/20 bg-emerald-950/40 px-3 py-2 text-center text-xs font-bold text-emerald-200">
            <Trophy className="mr-1 inline h-3.5 w-3.5" />
            {winner === myUserId ? 'You won!' : `${winner.slice(0, 12)} wins`}
          </div>
        )}

        <div className="px-3 py-2">
          <div className="mb-1 text-[10px] uppercase tracking-wider text-slate-400">
            Position {myPosition || '—'} / {race.players.length}
          </div>
          <ul className="space-y-1">
            {standings.slice(0, 5).map((s, i) => (
              <li
                key={s.id}
                className={`flex items-center justify-between text-[10px] ${
                  s.id === myUserId ? 'font-bold text-emerald-200' : 'text-slate-400'
                }`}
              >
                <span className="font-mono">
                  {i + 1}. {s.id.slice(0, 14)}
                </span>
                <span className="tabular-nums">L{s.lap} · CP{s.lastCheckpoint}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
