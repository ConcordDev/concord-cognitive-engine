// Concord Mobile — Basketball Hook (Phase Y).

import { useCallback, useEffect, useRef, useState } from 'react';
import { Basketball } from '../api/macro-client';

export interface BasketboardEntry { userId: string; score: number; }
interface UseBasketballResult {
  courtId: string | null;
  board: BasketboardEntry[];
  startMatch: (worldId: string) => Promise<void>;
  score: (points?: number) => Promise<void>;
  busy: boolean;
}

const POLL_INTERVAL_MS = 30_000;

export function useBasketball(): UseBasketballResult {
  const [courtId, setCourtId] = useState<string | null>(null);
  const [board, setBoard] = useState<BasketboardEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const cancelled = useRef(false);

  const refresh = useCallback(async () => {
    if (!courtId) return;
    const r = await Basketball.leaderboard(courtId);
    if (cancelled.current) return;
    const next = (r as unknown as { board?: BasketboardEntry[] }).board;
    if (r.ok && Array.isArray(next)) setBoard(next);
  }, [courtId]);

  useEffect(() => {
    cancelled.current = false;
    refresh();
    const t = setInterval(refresh, POLL_INTERVAL_MS);
    return () => { cancelled.current = true; clearInterval(t); };
  }, [refresh]);

  const startMatch = useCallback(async (worldId: string) => {
    setBusy(true);
    try {
      const r = await Basketball.startMatch(worldId);
      const id = (r as unknown as { courtId?: string }).courtId;
      if (id) setCourtId(id);
    } finally { setBusy(false); }
  }, []);

  const score = useCallback(async (points = 2) => {
    if (!courtId) return;
    setBusy(true);
    try { await Basketball.score(courtId, points); await refresh(); }
    finally { setBusy(false); }
  }, [courtId, refresh]);

  return { courtId, board, startMatch, score, busy };
}
