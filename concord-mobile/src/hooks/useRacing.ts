// Concord Mobile — Racing Hook (Phase Y).
//
// Polls the active race leaderboard every 30s + exposes start/submit.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Racing } from '../api/macro-client';

export interface RaceLapEntry { userId: string; lapMs: number; }
interface UseRacingResult {
  raceId: string | null;
  leaderboard: RaceLapEntry[];
  startRace: (worldId: string, durationS?: number) => Promise<void>;
  submitLap: (lapMs: number) => Promise<void>;
  busy: boolean;
}

const POLL_INTERVAL_MS = 30_000;

export function useRacing(): UseRacingResult {
  const [raceId, setRaceId] = useState<string | null>(null);
  const [leaderboard, setLeaderboard] = useState<RaceLapEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const cancelled = useRef(false);

  const refresh = useCallback(async () => {
    if (!raceId) return;
    const r = await Racing.leaderboard(raceId);
    if (cancelled.current) return;
    const board = (r as unknown as { board?: RaceLapEntry[] }).board;
    if (r.ok && Array.isArray(board)) setLeaderboard(board);
  }, [raceId]);

  useEffect(() => {
    cancelled.current = false;
    refresh();
    const t = setInterval(refresh, POLL_INTERVAL_MS);
    return () => { cancelled.current = true; clearInterval(t); };
  }, [refresh]);

  const startRace = useCallback(async (worldId: string, durationS = 180) => {
    setBusy(true);
    try {
      const r = await Racing.startRace(worldId, 0, 0, durationS);
      const id = (r as unknown as { raceId?: string }).raceId;
      if (id) setRaceId(id);
    } finally { setBusy(false); }
  }, []);

  const submitLap = useCallback(async (lapMs: number) => {
    if (!raceId) return;
    setBusy(true);
    try { await Racing.submitLap(raceId, lapMs); await refresh(); }
    finally { setBusy(false); }
  }, [raceId, refresh]);

  return { raceId, leaderboard, startRace, submitLap, busy };
}
