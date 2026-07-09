'use client';

/**
 * useMacroDispatchFeedback — instant-feeling feedback for a macro dispatch.
 *
 * `/api/lens/run` is a single request→response; without help, a caller has
 * exactly two moments to react to: "I clicked" and "the fetch resolved".
 * Everything in between (queued on the network, actually running on the
 * backend) is invisible, so a naive spinner either shows nothing until the
 * response lands or lies about progress with a fake timer.
 *
 * The server already solves the "what's really happening mid-flight" half of
 * this: when a caller passes a correlation id (header `x-conkay-run-id` or
 * body `__runId`), `/api/lens/run` emits a REAL lifecycle to the caller's own
 * `user:<id>` socket room — `macro:started` right before dispatch, optional
 * `macro:stage` sub-steps, and `macro:completed` on every terminal outcome
 * (see server.js's "ConKay honest event spine" around the `/api/lens/run`
 * handler; `hooks/../components/conkay/ConKayOverlay.tsx` is the reference
 * consumer this hook mirrors). This hook is the generalized, per-call version
 * of that same pattern for any component that wants a truthful spinner.
 *
 * Status lifecycle (every step is either a REAL local fact or a REAL backend
 * event — never a guess or a timer):
 *   'idle'       — nothing dispatched yet.
 *   'dispatched' — `dispatch()` was just called; set SYNCHRONOUSLY before the
 *                  network call resolves, so a button can show a spinner the
 *                  instant the click happens (this is a real fact: the call
 *                  really was just dispatched).
 *   'running'    — a real `macro:started` arrived for this run id. Only
 *                  reachable when the socket is connected AND the caller is
 *                  authenticated (anon callers have no `user:<id>` room, so
 *                  this status is simply skipped for them — never faked).
 *   'done'       — the real HTTP response came back with `ok: true`.
 *   'error'      — the real HTTP response came back with `ok: false`, or the
 *                  request itself threw/was aborted.
 *
 * `stage` and `ms` mirror `macro:stage`/`macro:completed` payload fields
 * verbatim when they arrive — `stage` is a genuine sub-step name the backend
 * macro reported reaching (via `ctx.emitMacroStage`), never inferred; `ms` is
 * the server's own measured elapsed time, not a client stopwatch.
 *
 * Usage:
 *   const { status, stage, dispatch } = useMacroDispatchFeedback<MyResultT>();
 *   <button onClick={() => dispatch('music', 'ai-playlist', { mood })}>
 *     {status === 'dispatched' || status === 'running' ? <Spinner /> : 'Generate'}
 *   </button>
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { subscribe, connectSocket } from '@/lib/realtime/socket';

export type MacroDispatchStatus = 'idle' | 'dispatched' | 'running' | 'done' | 'error';

export interface MacroDispatchState<T = unknown> {
  status: MacroDispatchStatus;
  /** Correlation id of the most recent dispatch, or null before the first call. */
  runId: string | null;
  domain: string | null;
  action: string | null;
  /** The unwrapped macro result once `status === 'done'`, else null. */
  result: T | null;
  /** Error string once `status === 'error'`, else null. */
  error: string | null;
  /** Real server-measured elapsed ms from `macro:completed`, if the socket
   *  lifecycle delivered one before/alongside the HTTP response; else null. */
  ms: number | null;
  /** Most recent real `macro:stage` sub-step name while running, else null. */
  stage: string | null;
}

export interface UseMacroDispatchFeedbackReturn<T = unknown> extends MacroDispatchState<T> {
  /** Fire a macro call. Never throws — failures land in `status:'error'`. */
  dispatch: (
    domain: string,
    action: string,
    input?: Record<string, unknown>
  ) => Promise<T | null>;
  /** Reset to the idle state (e.g. after a component reuses the hook for a new task). */
  reset: () => void;
}

function newDispatchRunId(): string {
  return `mdf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const IDLE_STATE: MacroDispatchState<never> = {
  status: 'idle',
  runId: null,
  domain: null,
  action: null,
  result: null,
  error: null,
  ms: null,
  stage: null,
};

export function useMacroDispatchFeedback<T = unknown>(): UseMacroDispatchFeedbackReturn<T> {
  const [state, setState] = useState<MacroDispatchState<T>>(IDLE_STATE as MacroDispatchState<T>);

  // The run id this hook instance currently considers "live" — guards against
  // a stale dispatch's late socket events or late HTTP response clobbering a
  // newer dispatch's state (e.g. a double-click that re-fires before the
  // first call resolves).
  const liveRunRef = useRef<string | null>(null);
  const unsubsRef = useRef<Array<() => void>>([]);
  const mountedRef = useRef(true);

  const teardownSubs = useCallback(() => {
    unsubsRef.current.forEach((off) => off());
    unsubsRef.current = [];
  }, []);

  useEffect(
    () => () => {
      mountedRef.current = false;
      teardownSubs();
    },
    [teardownSubs]
  );

  const dispatch = useCallback(
    async (domain: string, action: string, input: Record<string, unknown> = {}): Promise<T | null> => {
      teardownSubs();
      const rid = newDispatchRunId();
      liveRunRef.current = rid;

      // INSTANT feedback: this is a real, synchronous fact (the call really is
      // being dispatched right now) — set before any await, so a button's
      // spinner starts on the click frame, not on the eventual response.
      if (mountedRef.current) {
        setState({
          status: 'dispatched',
          runId: rid,
          domain,
          action,
          result: null,
          error: null,
          ms: null,
          stage: null,
        });
      }

      // Best-effort: ensure the socket is connecting so macro:started/completed
      // have a chance to arrive before the HTTP response does. If the socket
      // never connects (offline, anon caller with no user room, etc.) this
      // hook still resolves correctly off the HTTP response alone — the
      // 'running' status is a bonus signal, never a requirement.
      try {
        connectSocket();
      } catch {
        /* socket layer is best-effort here; HTTP path still completes the flow */
      }

      const offStarted = subscribe<{ runId?: string; domain?: string; action?: string }>(
        'macro:started',
        (d) => {
          if (!d?.runId || d.runId !== liveRunRef.current || !mountedRef.current) return;
          setState((s) => (s.runId === rid && s.status === 'dispatched' ? { ...s, status: 'running' } : s));
        }
      );
      const offStage = subscribe<{ runId?: string; stage?: string; detail?: string }>(
        'macro:stage',
        (d) => {
          if (!d?.runId || d.runId !== liveRunRef.current || !d.stage || !mountedRef.current) return;
          setState((s) => (s.runId === rid ? { ...s, stage: String(d.stage) } : s));
        }
      );
      const offCompleted = subscribe<{ runId?: string; ok?: boolean; ms?: number; error?: string }>(
        'macro:completed',
        (d) => {
          if (!d?.runId || d.runId !== liveRunRef.current || !mountedRef.current) return;
          // Mirror the server's real elapsed-ms measurement if it arrives; the
          // terminal status itself is still decided by the HTTP response below
          // (the socket event carries no result payload to resolve to).
          if (typeof d.ms === 'number') {
            setState((s) => (s.runId === rid ? { ...s, ms: d.ms as number } : s));
          }
        }
      );
      unsubsRef.current = [offStarted, offStage, offCompleted];

      try {
        const { data } = await lensRun<T>(domain, action, input, rid);
        // A newer dispatch superseded this one while it was in flight — drop
        // this result silently rather than clobbering fresher state.
        if (liveRunRef.current !== rid) return null;
        teardownSubs();
        if (!mountedRef.current) return data.ok ? data.result : null;

        if (data.ok) {
          setState((s) => (s.runId === rid ? { ...s, status: 'done', result: data.result, error: null } : s));
          return data.result;
        }
        setState((s) => (s.runId === rid ? { ...s, status: 'error', error: data.error || 'macro failed', result: null } : s));
        return null;
      } catch (e) {
        if (liveRunRef.current !== rid) return null;
        teardownSubs();
        const message = e instanceof Error ? e.message : String(e);
        if (mountedRef.current) {
          setState((s) => (s.runId === rid ? { ...s, status: 'error', error: message, result: null } : s));
        }
        return null;
      }
    },
    [teardownSubs]
  );

  const reset = useCallback(() => {
    teardownSubs();
    liveRunRef.current = null;
    setState(IDLE_STATE as MacroDispatchState<T>);
  }, [teardownSubs]);

  return { ...state, dispatch, reset };
}
