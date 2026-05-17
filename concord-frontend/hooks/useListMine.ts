'use client';

/**
 * useListMine — "my last N" for any lens domain.
 *
 * Phase 1 of the 10-dimension UX completeness sprint. Every lens should
 * be able to surface the caller's recent work in one line of code.
 * Today 64% of lenses have no such surface; that's the gap this closes.
 *
 * Contract:
 *   - Hits the standard `${domain}.recent_mine` macro that Phase 2 ships
 *     across all domain files.
 *   - Auto-revalidates on the supplied socket events (Phase 4 tile push).
 *   - Manual refetch via the returned `refetch()`.
 *
 * Usage:
 *   const { items, total, loading, refetch } = useListMine<MyKind>('pharmacy', {
 *     limit: 20,
 *     watchEvents: ['pharmacy:updated', 'drafts:saved'],
 *   });
 */

import { useCallback, useEffect, useState, useRef } from 'react';
import { api } from '@/lib/api/client';

export interface ListMineItem {
  id?: string | number;
  title?: string;
  createdAt?: number;
  updatedAt?: number;
  /** Domain-specific payload. */
  [key: string]: unknown;
}

export interface UseListMineOptions {
  /** Default 20, max 100. */
  limit?: number;
  /** Override macro name; defaults to `${domain}.recent_mine`. */
  macro?: string;
  /** Extra input forwarded to the macro. */
  input?: Record<string, unknown>;
  /** Socket event names that should trigger refetch. */
  watchEvents?: string[];
  /** Set false to defer the initial fetch. Default true. */
  enabled?: boolean;
}

export interface UseListMineReturn<T extends ListMineItem> {
  items: T[];
  total: number;
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

interface MacroResponse<T> {
  ok: boolean;
  items?: T[];
  total?: number;
  reason?: string;
}

export function useListMine<T extends ListMineItem = ListMineItem>(
  domain: string,
  options: UseListMineOptions = {},
): UseListMineReturn<T> {
  const {
    limit = 20,
    macro,
    input,
    watchEvents = [],
    enabled = true,
  } = options;

  const [items, setItems] = useState<T[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(enabled);
  const [error, setError] = useState<Error | null>(null);

  const mountedRef = useRef(true);
  const inputKey = JSON.stringify(input ?? {});

  const refetch = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setError(null);
    try {
      const macroName = macro || 'recent_mine';
      const res = await api.post('/api/lens/run', {
        domain,
        name: macroName,
        input: { ...(input ?? {}), limit },
      });
      const data = res?.data as MacroResponse<T>;
      if (!mountedRef.current) return;
      if (data?.ok) {
        setItems(Array.isArray(data.items) ? data.items : []);
        setTotal(typeof data.total === 'number' ? data.total : (data.items?.length ?? 0));
      } else {
        setItems([]);
        setTotal(0);
        if (data?.reason) setError(new Error(data.reason));
      }
    } catch (e) {
      if (!mountedRef.current) return;
      setItems([]);
      setTotal(0);
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [domain, macro, limit, inputKey, enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    mountedRef.current = true;
    void refetch();
    return () => { mountedRef.current = false; };
  }, [refetch]);

  // Socket-driven revalidation. We import the socket lazily so this hook
  // can be used on pages that haven't set up a socket yet (no-op fallback).
  useEffect(() => {
    if (!enabled || watchEvents.length === 0) return;
    let unsubs: Array<() => void> = [];
    let cancelled = false;
    (async () => {
      try {
        const mod = await import('@/lib/realtime/socket').catch(() => null);
        const socket = mod?.getSocket?.();
        if (!socket || cancelled) return;
        for (const evt of watchEvents) {
          const handler = () => { void refetch(); };
          socket.on(evt, handler);
          unsubs.push(() => socket.off(evt, handler));
        }
      } catch {
        // Socket layer unavailable — fall back to manual refetch.
      }
    })();
    return () => {
      cancelled = true;
      unsubs.forEach(fn => { try { fn(); } catch { /* ignore */ } });
      unsubs = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, watchEvents.join(','), refetch]);

  return { items, total, loading, error, refetch };
}
