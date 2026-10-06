'use client';

/**
 * useEngWorkspace — per-user, server-side state for an Engineering panel.
 *
 * The Calcs, Multi-physics and Actions tabs used to keep their inputs and
 * results in React state only, so a reload threw the user's work away. This
 * hook reads the saved state for `key` from `engineering.workspace-get` on
 * mount and debounce-saves every change through `engineering.workspace-save`
 * (stored in engineeringLens.workspaces, persisted with the rest of the
 * lens state). Saving is gated until the stored copy has been read back, so
 * the initial defaults never overwrite real work.
 */

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { lensRun } from '@/lib/api/client';

export type WsSaveState = 'loading' | 'idle' | 'saving' | 'saved' | 'error';

export function useEngWorkspace<T extends Record<string, unknown>>(
  key: string,
  initial: T,
): [T, Dispatch<SetStateAction<T>>, WsSaveState] {
  const [state, setState] = useState<T>(initial);
  const [save, setSave] = useState<WsSaveState>('loading');
  const initialRef = useRef(initial);
  const loaded = useRef(false);
  const skipNext = useRef(false);

  useEffect(() => {
    let cancelled = false;
    loaded.current = false;
    (async () => {
      try {
        const r = await lensRun<{ state: Partial<T> | null }>('engineering', 'workspace-get', { key });
        if (cancelled) return;
        const stored = r.data?.ok ? r.data.result?.state : null;
        if (stored && typeof stored === 'object') {
          skipNext.current = true;
          setState({ ...initialRef.current, ...stored });
          setSave('saved');
        } else {
          setSave(r.data?.ok ? 'idle' : 'error');
        }
      } catch {
        if (!cancelled) setSave('error');
      } finally {
        if (!cancelled) loaded.current = true;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [key]);

  useEffect(() => {
    if (!loaded.current) return;
    if (skipNext.current) {
      skipNext.current = false;
      return;
    }
    setSave('saving');
    const t = setTimeout(() => {
      lensRun('engineering', 'workspace-save', { key, state })
        .then((r) => setSave(r.data?.ok ? 'saved' : 'error'))
        .catch(() => setSave('error'));
    }, 600);
    return () => clearTimeout(t);
  }, [state, key]);

  return [state, setState, save];
}

export function WsBadge({ state, testId }: { state: WsSaveState; testId: string }) {
  const text =
    state === 'loading' ? 'Loading your saved work…'
      : state === 'saving' ? 'Saving…'
        : state === 'saved' ? 'Saved to your account'
          : state === 'error' ? 'Not saved — the server refused; your next change retries'
            : 'Nothing saved yet — your inputs and results save as you work';
  const tone = state === 'error' ? 'text-rose-300' : state === 'saved' ? 'text-emerald-300' : 'text-zinc-400';
  return (
    <span data-testid={testId} data-state={state} className={`text-[11px] ${tone}`}>
      {text}
    </span>
  );
}

export function computedAt(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
