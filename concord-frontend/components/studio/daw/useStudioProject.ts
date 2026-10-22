'use client';

/**
 * Project state for the Studio editor: immutable project + undo/redo history,
 * engine sync, and autosave. Every edit goes through `edit()`, so undo, the
 * crash journal and the server save all see the same change.
 */

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { DAWProject } from '@/lib/daw/types';
import { createHistory, pushHistory, undo as undoH, redo as redoH, replacePresent, canUndo, canRedo, type History } from '@/lib/daw/history';
import { Autosaver, type SaveStatus } from '@/lib/daw/persistence';
import { studioTransport, browserLocalStore } from '@/lib/daw/studio-api';
import { getStudioEngine } from '@/lib/daw/playback-engine';
import { ensurePitchWorklet } from '@/lib/daw/worklets/load-pitch-worklet';

type Action =
  | { type: 'edit'; fn: (p: DAWProject) => DAWProject; key?: string }
  | { type: 'replace'; fn: (p: DAWProject) => DAWProject }
  | { type: 'reset'; project: DAWProject }
  | { type: 'undo' }
  | { type: 'redo' };

function reducer(h: History<DAWProject>, a: Action): History<DAWProject> {
  switch (a.type) {
    case 'edit': {
      const next = a.fn(h.present);
      if (next === h.present) return h;
      return pushHistory(h, { ...next, updatedAt: Date.now() }, { coalesceKey: a.key });
    }
    case 'replace':
      return replacePresent(h, a.fn(h.present));
    case 'reset':
      return createHistory(a.project);
    case 'undo':
      return undoH(h);
    case 'redo':
      return redoH(h);
  }
}

export interface SaveInfo {
  status: SaveStatus;
  at: number | null;
  error: string | null;
}

export function useStudioProject(initial: DAWProject, initialRev: number) {
  const [history, dispatch] = useReducer(reducer, initial, createHistory);
  const project = history.present;
  const [save, setSave] = useState<SaveInfo>({ status: 'idle', at: null, error: null });
  const saverRef = useRef<Autosaver | null>(null);

  // Autosaver lifecycle (one per opened project).
  useEffect(() => {
    const saver = new Autosaver({
      transport: studioTransport,
      local: browserLocalStore,
      onStatus: (status, info) => setSave((s) => ({ status, at: info?.at ?? s.at, error: info?.error ?? (status === 'error' ? s.error : null) })),
      onProjectId: (_old, id) => dispatch({ type: 'replace', fn: (p) => ({ ...p, id }) }),
      onAssetsUploaded: (ids) => dispatch({
        type: 'replace',
        fn: (p) => ({ ...p, audioAssets: Object.fromEntries(Object.entries(p.audioAssets || {}).map(([k, v]) => [k, ids.includes(k) ? { ...v, uploaded: true } : v])) }),
      }),
    });
    saver.prime(initial, initialRev);
    saverRef.current = saver;
    const onHide = () => { void saver.flush(); };
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onHide);
      void saver.flush().finally(() => saver.dispose());
      saverRef.current = null;
    };
    // initial/initialRev identify the opened project; re-running would reset history.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Engine + autosave follow every state change (cheap: graph.sync diff-updates).
  // Pitch Correct appears in the chain only after its worklet module loads.
  useEffect(() => {
    const eng = getStudioEngine();
    eng.setProject(project);
    saverRef.current?.update(project);
    const needsPitch = project.tracks.some((t) => (t.effectChain || []).some((e) => e.type === 'pitchCorrect' && e.enabled !== false));
    if (!needsPitch) return;
    let cancel = false;
    void ensurePitchWorklet(eng.ctx).then((ok) => {
      if (cancel || !ok) return;
      eng.setProject(project);
    });
    return () => { cancel = true; };
  }, [project]);

  const edit = useCallback((fn: (p: DAWProject) => DAWProject, key?: string) => dispatch({ type: 'edit', fn, key }), []);
  const replace = useCallback((fn: (p: DAWProject) => DAWProject) => dispatch({ type: 'replace', fn }), []);
  const reset = useCallback((p: DAWProject) => dispatch({ type: 'reset', project: p }), []);
  /** Replace the whole project with a server copy (version restore) and mark it saved. */
  const load = useCallback((p: DAWProject, rev: number) => {
    saverRef.current?.prime(p, rev);
    dispatch({ type: 'reset', project: p });
  }, []);
  const undo = useCallback(() => dispatch({ type: 'undo' }), []);
  const redo = useCallback(() => dispatch({ type: 'redo' }), []);
  const saveNow = useCallback(() => saverRef.current?.flush() ?? Promise.resolve(), []);

  return useMemo(() => ({
    project, edit, replace, reset, load, undo, redo, saveNow, save,
    canUndo: canUndo(history), canRedo: canRedo(history),
    rev: () => saverRef.current?.revision ?? initialRev,
  }), [project, edit, replace, reset, load, undo, redo, saveNow, save, history, initialRev]);
}

export type StudioProjectApi = ReturnType<typeof useStudioProject>;
