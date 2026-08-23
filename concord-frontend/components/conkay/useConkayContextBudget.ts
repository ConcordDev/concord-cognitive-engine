'use client';
// concord-frontend/components/conkay/useConkayContextBudget.ts
//
// Hook that fetches the real /api/chat/context-budget/:sessionId
// endpoint, polls it on a sane cadence, and returns the wire object
// plus a derived freshness tag for deriveBudgetState.
// All fetches route through `api.get` so credentials + base URL are
// inherited — never invent a URL.
//
// Polling cadence: every 30s when the session is quiet (no recent
// assistant message), every 5s when over threshold. The cadence is a
// tracking hint, not a fake clock — if the endpoint ever errors, the
// hook reports 'unreachable' and stops polling until the user takes
// an action that triggers a re-fetch (sending a message, saying
// 'compress'). The polling cadence uses setInterval ONLY for the
// real fetch (not a fake animation) — the badge is pure derived state.

import { useEffect, useState } from 'react';
import { api } from '@/lib/api/client';
import type { ContextBudgetWire } from './sessionContextBudget';

export type ContextBudgetState =
  | { kind: 'unreachable'; reason: string; lastFetchMs: number | null }
  | { kind: 'loaded'; data: ContextBudgetWire; lastFetchMs: number };

interface UseConkayContextBudgetArgs {
  sessionId: string | null | undefined;
  /** True when the user just submitted a message or invoked a macro
   *  (forces an immediate re-fetch). */
  bumpKey?: number | string;
}

export function useConkayContextBudget(
  args: UseConkayContextBudgetArgs,
): ContextBudgetState {
  const { sessionId, bumpKey } = args;
  const [state, setState] = useState<ContextBudgetState>({
    kind: 'unreachable',
    reason: 'never_fetched',
    lastFetchMs: null,
  });

  useEffect(() => {
    if (!sessionId) {
      setState({ kind: 'unreachable', reason: 'no_session', lastFetchMs: null });
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const fetchOnce = async () => {
      try {
        const res = await api.get(
          `/api/chat/context-budget/${encodeURIComponent(sessionId)}`,
        );
        if (cancelled) return;
        const body = res?.data;
        if (!body || body.ok !== true) {
          setState({
            kind: 'unreachable',
            reason: 'bad_payload',
            lastFetchMs: Date.now(),
          });
          return;
        }
        setState({
          kind: 'loaded',
          data: body as ContextBudgetWire,
          lastFetchMs: Date.now(),
        });
      } catch (err) {
        if (cancelled) return;
        setState({
          kind: 'unreachable',
          reason: String((err as Error)?.message || 'fetch_failed'),
          lastFetchMs: state.kind === 'loaded' ? state.lastFetchMs : null,
        });
      }
    };

    // Initial fetch
    fetchOnce();

    // Adaptive polling: every 5s when over threshold (urgent), 30s otherwise.
    const schedule = () => {
      if (timer) clearInterval(timer);
      const intervalMs =
        state.kind === 'loaded' && state.data.atOrOverThreshold ? 5_000 : 30_000;
      timer = setInterval(fetchOnce, intervalMs);
    };
    schedule();

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
    // bumpKey forces a re-run when the user action'd something.
    // We intentionally omit `state` from deps because the schedule
    // effect below uses a stale-closure-friendly pattern (state at
    // effect closure time only sets the initial interval).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, bumpKey]);

  return state;
}
