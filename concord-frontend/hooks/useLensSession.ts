'use client';

/**
 * useLensSession — multi-step workflow session hook.
 *
 * Phase 5 of the UX completeness sprint. Built on the sessions domain
 * (server/domains/sessions.js + migration 195). State is opaque to the
 * server; the lens owns the shape.
 *
 * Contract:
 *   - { sessionId } passed: load existing session on mount.
 *   - Otherwise: caller may invoke `start()` to create one.
 *   - `advance({ toStep, note?, stateMerge? })` transitions step.
 *   - `update({ statePatch })` deep-merges state without changing step.
 *   - `close({ outcome })` transitions to completed/abandoned.
 *   - All operations are debounced when the caller asks (`autoSyncMs`),
 *     otherwise the caller fires them imperatively.
 *
 * Usage:
 *   const session = useLensSession<KingdomsState>({ lensId: 'kingdoms' });
 *   const start = () => session.start({ title: 'Iron Crown', initialStep: 'plan' });
 *   const onNext = () => session.advance({ toStep: 'muster', stateMerge: { phase: 2 } });
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api/client';

export type SessionStatus = 'open' | 'paused' | 'completed' | 'abandoned';

export interface LensSession<T = Record<string, unknown>> {
  id: string;
  lensId: string;
  title: string | null;
  status: SessionStatus;
  currentStep: string | null;
  state: T;
  stepCount: number;
  createdAt: number;
  updatedAt: number;
  closedAt: number | null;
}

export interface LensSessionEvent {
  id: number;
  kind: 'started' | 'advanced' | 'state_merged' | 'paused' | 'resumed' | 'completed' | 'abandoned' | 'annotated';
  fromStep: string | null;
  toStep: string | null;
  note: string | null;
  payload: unknown;
  createdAt: number;
}

export interface UseLensSessionOptions {
  /** Lens domain owning the session. */
  lensId: string;
  /** If provided, load this session on mount instead of waiting for start(). */
  sessionId?: string;
  /** Max events to load with get(). Default 50. */
  eventLimit?: number;
  /** Callback after every successful state change. */
  onChange?: <T>(session: LensSession<T>) => void;
}

export interface UseLensSessionReturn<T = Record<string, unknown>> {
  session: LensSession<T> | null;
  events: LensSessionEvent[];
  loading: boolean;
  error: string | null;
  start: (input: { title?: string; initialStep?: string; initialState?: Partial<T> }) => Promise<LensSession<T> | null>;
  advance: (input: { toStep: string; note?: string; stateMerge?: Partial<T> }) => Promise<LensSession<T> | null>;
  update: (input: { statePatch: Partial<T> }) => Promise<T | null>;
  close: (input: { outcome: 'completed' | 'abandoned'; note?: string }) => Promise<boolean>;
  refresh: () => Promise<void>;
}

async function runMacro<R = unknown>(name: string, input: Record<string, unknown>): Promise<R | null> {
  try {
    const r = await api.post('/api/lens/run', { domain: 'sessions', name, input });
    return r?.data as R;
  } catch {
    return null;
  }
}

export function useLensSession<T = Record<string, unknown>>(opts: UseLensSessionOptions): UseLensSessionReturn<T> {
  const { lensId, sessionId, eventLimit = 50, onChange } = opts;
  const [session, setSession] = useState<LensSession<T> | null>(null);
  const [events, setEvents] = useState<LensSessionEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

  const notify = useCallback((s: LensSession<T>) => {
    onChangeRef.current?.(s);
  }, []);

  const refresh = useCallback(async () => {
    if (!session?.id && !sessionId) return;
    const id = session?.id || sessionId;
    setLoading(true);
    setError(null);
    const r = await runMacro<{ ok: boolean; session?: LensSession<T>; events?: LensSessionEvent[]; reason?: string }>('get', { sessionId: id, eventLimit });
    if (r?.ok) {
      setSession(r.session || null);
      setEvents(r.events || []);
    } else setError(r?.reason || 'fetch_failed');
    setLoading(false);
  }, [session?.id, sessionId, eventLimit]);

  // Initial load if sessionId provided.
  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      const r = await runMacro<{ ok: boolean; session?: LensSession<T>; events?: LensSessionEvent[]; reason?: string }>('get', { sessionId, eventLimit });
      if (cancelled) return;
      if (r?.ok) {
        setSession(r.session || null);
        setEvents(r.events || []);
      } else setError(r?.reason || 'fetch_failed');
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [sessionId, eventLimit]);

  const start = useCallback(async (input: { title?: string; initialStep?: string; initialState?: Partial<T> }) => {
    setLoading(true);
    setError(null);
    const r = await runMacro<{ ok: boolean; session?: LensSession<T>; reason?: string }>('start', {
      lensId, ...input,
    });
    setLoading(false);
    if (r?.ok && r.session) {
      setSession(r.session);
      setEvents([{
        id: 0,
        kind: 'started',
        fromStep: null,
        toStep: r.session.currentStep,
        note: r.session.title,
        payload: null,
        createdAt: r.session.createdAt,
      }]);
      notify(r.session);
      return r.session;
    }
    setError(r?.reason || 'start_failed');
    return null;
  }, [lensId, notify]);

  const advance = useCallback(async (input: { toStep: string; note?: string; stateMerge?: Partial<T> }) => {
    if (!session?.id) {
      setError('no_active_session');
      return null;
    }
    setLoading(true);
    setError(null);
    const r = await runMacro<{ ok: boolean; session?: LensSession<T>; reason?: string }>('advance', {
      sessionId: session.id, ...input,
    });
    setLoading(false);
    if (r?.ok && r.session) {
      const next = r.session;
      setSession(next);
      // Optimistically prepend event; refresh() will reconcile.
      setEvents(prev => [{
        id: -1, kind: 'advanced', fromStep: session.currentStep, toStep: input.toStep,
        note: input.note || null, payload: input.stateMerge || null, createdAt: next.updatedAt,
      }, ...prev]);
      notify(next);
      return next;
    }
    setError(r?.reason || 'advance_failed');
    return null;
  }, [session, notify]);

  const update = useCallback(async (input: { statePatch: Partial<T> }) => {
    if (!session?.id) {
      setError('no_active_session');
      return null;
    }
    setError(null);
    const r = await runMacro<{ ok: boolean; state?: T; updatedAt?: number; reason?: string }>('update_state', {
      sessionId: session.id, statePatch: input.statePatch,
    });
    if (r?.ok && r.state !== undefined) {
      const next: LensSession<T> = { ...session, state: r.state, updatedAt: r.updatedAt || session.updatedAt };
      setSession(next);
      notify(next);
      return r.state;
    }
    setError(r?.reason || 'update_failed');
    return null;
  }, [session, notify]);

  const close = useCallback(async (input: { outcome: 'completed' | 'abandoned'; note?: string }) => {
    if (!session?.id) return false;
    setLoading(true);
    setError(null);
    const r = await runMacro<{ ok: boolean; status?: SessionStatus; closedAt?: number; reason?: string }>('close', {
      sessionId: session.id, ...input,
    });
    setLoading(false);
    if (r?.ok) {
      const closed: LensSession<T> = { ...session, status: r.status || input.outcome, closedAt: r.closedAt || Math.floor(Date.now() / 1000) };
      setSession(closed);
      setEvents(prev => [{
        id: -1, kind: input.outcome, fromStep: session.currentStep, toStep: null,
        note: input.note || null, payload: null, createdAt: closed.closedAt!,
      }, ...prev]);
      notify(closed);
      return true;
    }
    setError(r?.reason || 'close_failed');
    return false;
  }, [session, notify]);

  return { session, events, loading, error, start, advance, update, close, refresh };
}

export default useLensSession;
