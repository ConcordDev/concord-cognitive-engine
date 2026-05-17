'use client';

/**
 * useTilePush — subscribe a result tile to socket events so it updates live
 * instead of only on request/response. Returns the last received event and
 * an `at` timestamp so the tile can flash on change.
 *
 *   const { last, at } = useTilePush<{ buildingId: string }>('world:building-state');
 *   useEffect(() => { if (last) refetchTile(); }, [at]);
 *
 * Plays nicely with the existing socket helper in lib/realtime/socket.ts —
 * never opens a second socket, just registers a listener.
 */

import { useEffect, useRef, useState } from 'react';
import { subscribe } from '@/lib/realtime/socket';
import type { SocketEvent } from '@/lib/realtime/socket';

interface State<T> { last: T | null; at: number; count: number }

export function useTilePush<T = unknown>(
  event: SocketEvent,
  /** Optional client-side filter (drop events that don't match). */
  filter?: (data: T) => boolean,
) {
  const [state, setState] = useState<State<T>>({ last: null, at: 0, count: 0 });
  const filterRef = useRef(filter);
  useEffect(() => { filterRef.current = filter; }, [filter]);

  useEffect(() => {
    const off = subscribe<T>(event, (data) => {
      if (filterRef.current && !filterRef.current(data)) return;
      setState((s) => ({ last: data, at: Date.now(), count: s.count + 1 }));
    });
    return off;
  }, [event]);

  return state;
}
