// Concord Mobile — Markers Hook (Phase Y).

import { useCallback, useEffect, useRef, useState } from 'react';
import { Markers } from '../api/macro-client';

export interface MarkerEntry {
  id: string;
  world_id: string;
  kind: 'poi' | 'quest' | 'caution' | 'celebration' | 'system';
  label?: string | null;
  x: number; z: number;
  placed_by?: string | null;
  placed_at: number;
  expires_at?: number | null;
}

interface UseMarkersResult {
  markers: MarkerEntry[];
  refresh: () => Promise<void>;
  place: (kind: MarkerEntry['kind'], x: number, z: number, label?: string) => Promise<void>;
  remove: (markerId: string) => Promise<void>;
  busy: boolean;
}

const POLL_INTERVAL_MS = 30_000;

export function useMarkers(worldId: string): UseMarkersResult {
  const [markers, setMarkers] = useState<MarkerEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const cancelled = useRef(false);

  const refresh = useCallback(async () => {
    const r = await Markers.list(worldId);
    if (cancelled.current) return;
    const next = (r as unknown as { markers?: MarkerEntry[] }).markers;
    if (r.ok && Array.isArray(next)) setMarkers(next);
  }, [worldId]);

  useEffect(() => {
    cancelled.current = false;
    refresh();
    const t = setInterval(refresh, POLL_INTERVAL_MS);
    return () => { cancelled.current = true; clearInterval(t); };
  }, [refresh]);

  const place = useCallback(async (kind: MarkerEntry['kind'], x: number, z: number, label?: string) => {
    setBusy(true);
    try { await Markers.place(worldId, kind, x, z, label); await refresh(); }
    finally { setBusy(false); }
  }, [worldId, refresh]);

  const remove = useCallback(async (markerId: string) => {
    setBusy(true);
    try { await Markers.remove(markerId); await refresh(); }
    finally { setBusy(false); }
  }, [refresh]);

  return { markers, refresh, place, remove, busy };
}
