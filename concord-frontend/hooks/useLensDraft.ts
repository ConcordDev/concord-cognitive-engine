'use client';

/**
 * useLensDraft — debounced per-lens auto-save.
 *
 * Phase 1 of the 10-dimension UX completeness sprint. Closes the "close
 * the tab, lose the draft" gap that hit 94.6% of the fleet pre-sprint.
 *
 * Contract:
 *   - On mount: hydrate from server via drafts.load. If localStorage holds
 *     a newer mirror (offline edits queued), it wins and is immediately
 *     re-pushed.
 *   - On change: debounce 1500ms (configurable), POST drafts.save, mirror
 *     to localStorage on every write so a same-tab refresh never loses
 *     more than the last keystroke.
 *   - On `clear()`: hard-delete via drafts.delete AND remove the
 *     localStorage mirror. Use after a successful mint — the draft has
 *     graduated to a real DTU.
 *   - Network failure: queue stays in localStorage; next successful
 *     server write flushes it. No retries, no exponential backoff — the
 *     next keystroke will retry naturally.
 *
 * Storage:
 *   - Server: lens_drafts table, keyed (user_id, lens_id, draft_key).
 *   - Local: `concord:draft:${lensId}:${draftKey}` JSON: { payload, updatedAt }.
 *
 * Usage:
 *   const { value, setValue, status, clear } = useLensDraft<string>(
 *     'pharmacy',
 *     'rxIntakeText',
 *     { initial: '' }
 *   );
 *
 *   <textarea value={value} onChange={(e) => setValue(e.target.value)} />
 *   <span>{status === 'saved' ? 'Saved' : status === 'saving' ? 'Saving…' : ''}</span>
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api/client';

export type DraftStatus = 'idle' | 'loading' | 'dirty' | 'saving' | 'saved' | 'error';

export interface UseLensDraftOptions<T> {
  /** Starting value before server hydration finishes. */
  initial: T;
  /** Debounce window in ms before server save. Default 1500. */
  debounceMs?: number;
  /** Bumped to invalidate old payloads when shape evolves. Default 1. */
  schemaVersion?: number;
  /** Called after a successful server save. */
  onSaved?: (payload: T, updatedAt: number) => void;
  /** Called on hydrate (server load OR localStorage replay). */
  onHydrated?: (payload: T, source: 'server' | 'local' | 'initial') => void;
}

export interface UseLensDraftReturn<T> {
  value: T;
  setValue: (next: T) => void;
  status: DraftStatus;
  lastSavedAt: number | null;
  /** Force flush pending debounced write immediately. Returns when save resolves. */
  flush: () => Promise<void>;
  /** Delete the draft server-side + locally. Call after a successful mint. */
  clear: () => Promise<void>;
}

interface ServerLoadResponse {
  ok: boolean;
  draft: null | {
    payload: unknown;
    schemaVersion: number;
    createdAt: number;
    updatedAt: number;
  };
  reason?: string;
}

interface ServerSaveResponse {
  ok: boolean;
  savedAt?: number;
  reason?: string;
}

interface LocalMirror<T> {
  payload: T;
  updatedAt: number;
}

function localKey(lensId: string, draftKey: string): string {
  return `concord:draft:${lensId}:${draftKey}`;
}

function readLocal<T>(lensId: string, draftKey: string): LocalMirror<T> | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(localKey(lensId, draftKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LocalMirror<T>;
    if (!parsed || typeof parsed.updatedAt !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeLocal<T>(lensId: string, draftKey: string, payload: T, updatedAt: number) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      localKey(lensId, draftKey),
      JSON.stringify({ payload, updatedAt }),
    );
  } catch {
    // QuotaExceeded — the in-memory state still has the value; user
    // doesn't lose this session, just offline durability.
  }
}

function clearLocal(lensId: string, draftKey: string) {
  if (typeof window === 'undefined') return;
  try { window.localStorage.removeItem(localKey(lensId, draftKey)); } catch { /* ignore */ }
}

async function runMacro<T>(domain: string, name: string, input: Record<string, unknown>): Promise<T | null> {
  try {
    const r = await api.post('/api/lens/run', { domain, name, input });
    return r?.data as T;
  } catch {
    return null;
  }
}

export function useLensDraft<T>(
  lensId: string,
  draftKey: string,
  options: UseLensDraftOptions<T>,
): UseLensDraftReturn<T> {
  const { initial, debounceMs = 1500, schemaVersion = 1, onSaved, onHydrated } = options;

  const [value, setValueState] = useState<T>(initial);
  const [status, setStatus] = useState<DraftStatus>('loading');
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);

  const mountedRef = useRef(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<T | null>(null);
  // Avoid re-firing save right after hydrate plants a value.
  const hydratedRef = useRef(false);
  const saveSerialRef = useRef(0);

  const pushSave = useCallback(async (payload: T): Promise<void> => {
    const mySerial = ++saveSerialRef.current;
    setStatus('saving');
    const now = Math.floor(Date.now() / 1000);
    // Mirror immediately — server write may fail; localStorage is the
    // offline floor.
    writeLocal(lensId, draftKey, payload, now);

    const res = await runMacro<ServerSaveResponse>('drafts', 'save', {
      lensId, draftKey, payload, schemaVersion,
    });

    if (!mountedRef.current) return;
    if (mySerial !== saveSerialRef.current) {
      // A newer save started while we awaited; let it set the final status.
      return;
    }
    if (res?.ok && typeof res.savedAt === 'number') {
      setStatus('saved');
      setLastSavedAt(res.savedAt);
      onSaved?.(payload, res.savedAt);
    } else {
      setStatus('error');
    }
  }, [lensId, draftKey, schemaVersion, onSaved]);

  const flush = useCallback(async (): Promise<void> => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (pendingRef.current !== null) {
      const payload = pendingRef.current;
      pendingRef.current = null;
      await pushSave(payload);
    }
  }, [pushSave]);

  // Hydrate on mount.
  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;

    (async () => {
      const localMirror = readLocal<T>(lensId, draftKey);
      const serverRes = await runMacro<ServerLoadResponse>('drafts', 'load', { lensId, draftKey });
      if (cancelled || !mountedRef.current) return;

      const serverDraft = serverRes?.ok ? serverRes.draft : null;

      // Newer-wins reconciliation.
      const serverNewer =
        serverDraft && (!localMirror || serverDraft.updatedAt >= localMirror.updatedAt);

      if (serverDraft && serverNewer) {
        setValueState(serverDraft.payload as T);
        setLastSavedAt(serverDraft.updatedAt);
        setStatus('saved');
        onHydrated?.(serverDraft.payload as T, 'server');
      } else if (localMirror) {
        // Local copy is newer → adopt + re-push to flush the offline queue.
        setValueState(localMirror.payload);
        setStatus('dirty');
        onHydrated?.(localMirror.payload, 'local');
        await pushSave(localMirror.payload);
      } else {
        // No draft anywhere → keep initial.
        setStatus('idle');
        onHydrated?.(initial, 'initial');
      }
      hydratedRef.current = true;
    })();

    return () => {
      cancelled = true;
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // lensId+draftKey are the identity of the draft. initial intentionally
    // omitted: it's a starting placeholder, not a reactive input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lensId, draftKey]);

  const setValue = useCallback((next: T) => {
    setValueState(next);
    if (!hydratedRef.current) {
      // Don't fire saves before hydrate finishes — would clobber the
      // server copy with the initial sentinel.
      return;
    }
    setStatus('dirty');
    pendingRef.current = next;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      const payload = pendingRef.current;
      pendingRef.current = null;
      if (payload !== null) void pushSave(payload);
    }, debounceMs);
  }, [debounceMs, pushSave]);

  const clear = useCallback(async (): Promise<void> => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    pendingRef.current = null;
    clearLocal(lensId, draftKey);
    await runMacro<{ ok: boolean }>('drafts', 'delete', { lensId, draftKey });
    if (mountedRef.current) {
      setValueState(initial);
      setStatus('idle');
      setLastSavedAt(null);
    }
  }, [lensId, draftKey, initial]);

  // Flush on tab close / visibility-hidden. Best-effort.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onPagehide = () => {
      if (pendingRef.current !== null) {
        // Sync localStorage write — server flush will rehydrate next mount.
        writeLocal(lensId, draftKey, pendingRef.current, Math.floor(Date.now() / 1000));
      }
    };
    window.addEventListener('pagehide', onPagehide);
    window.addEventListener('beforeunload', onPagehide);
    return () => {
      window.removeEventListener('pagehide', onPagehide);
      window.removeEventListener('beforeunload', onPagehide);
    };
  }, [lensId, draftKey]);

  return { value, setValue, status, lastSavedAt, flush, clear };
}
