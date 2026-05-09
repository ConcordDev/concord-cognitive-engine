// Concord Mobile — Beats Hook
//
// Phase 6d: surfaces personal beats (Phase 3 server) on mobile. Polls
// list every 30s and exposes a realise() that submits the player's
// choice. Beats arrive via socket too (when the realtime layer is
// wired); this hook does best-effort fallback polling.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Beats, type BeatPayload } from '../api/macro-client';

interface UseBeatsResult {
  openBeat: BeatPayload | null;
  history: BeatPayload[];
  realise: (outcome: 'realised' | 'rejected' | 'ignored') => Promise<void>;
  refresh: () => Promise<void>;
  busy: boolean;
}

const POLL_INTERVAL_MS = 30000;

export function useBeats(): UseBeatsResult {
  const [history, setHistory] = useState<BeatPayload[]>([]);
  const [openBeat, setOpenBeat] = useState<BeatPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const cancelled = useRef(false);

  const refresh = useCallback(async () => {
    const r = await Beats.list(20);
    if (cancelled.current) return;
    if (r.ok && Array.isArray((r as { beats?: BeatPayload[] }).beats)) {
      const beats = (r as { beats: BeatPayload[] }).beats;
      setHistory(beats);
      setOpenBeat(beats.find(b => !b.completed_at) || null);
    }
  }, []);

  useEffect(() => {
    cancelled.current = false;
    refresh();
    const t = setInterval(refresh, POLL_INTERVAL_MS);
    return () => {
      cancelled.current = true;
      clearInterval(t);
    };
  }, [refresh]);

  const realise = useCallback(async (outcome: 'realised' | 'rejected' | 'ignored') => {
    if (!openBeat || busy) return;
    setBusy(true);
    try {
      await Beats.realise(openBeat.id, outcome);
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [openBeat, busy, refresh]);

  return { openBeat, history, realise, refresh, busy };
}
