'use client';

/**
 * One project's live state for the workbench: the file tree, open editor
 * buffers (autosaved to the project, so the proof always describes what is
 * really stored), and the Proof ledger, re-read after every save.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { code, languageOf, type Ledger, type Project, type TreeEntry } from './proofApi';

/**
 * `content` follows every keystroke. `rev` changes only when the file's text
 * comes from outside the keyboard (open, reload, format, an accepted
 * proposal), which re-mounts the editor with that text; `seed` records it.
 */
export interface Buffer { path: string; content: string; saved: string; seed: string; rev: number; language: string; loading: boolean }
export type SaveState = 'saved' | 'saving' | 'unsaved' | 'error';

const AUTOSAVE_MS = 700;

export function useProject(projectId: string) {
  const [project, setProject] = useState<Project | null>(null);
  const [tree, setTree] = useState<TreeEntry[] | null>(null);
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [buffers, setBuffers] = useState<Buffer[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [error, setError] = useState<string | null>(null);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const buffersRef = useRef(buffers);
  buffersRef.current = buffers;

  const refreshLedger = useCallback(async () => {
    const r = await code<{ proof: Ledger }>('proof-get', { projectId });
    if (r.ok) setLedger(r.result.proof); else setError(r.message);
    return r.ok ? r.result.proof : null;
  }, [projectId]);

  const refreshTree = useCallback(async () => {
    const r = await code<{ tree: TreeEntry[] }>('files-tree', { projectId });
    if (r.ok) setTree(r.result.tree); else { setTree([]); setError(r.message); }
    return r.ok ? r.result.tree : [];
  }, [projectId]);

  const openFile = useCallback(async (path: string) => {
    setActive(path);
    if (buffersRef.current.some((b) => b.path === path)) return;
    setBuffers((bs) => [...bs, { path, content: '', saved: '', seed: '', rev: 0, language: languageOf(path), loading: true }]);
    const r = await code<{ content: string }>('files-read', { projectId, path });
    const content = r.ok ? r.result.content : '';
    setBuffers((bs) => bs.map((b) => (b.path === path ? { ...b, content, saved: content, seed: content, rev: b.rev + 1, loading: false } : b)));
    if (!r.ok) setError(r.message);
  }, [projectId]);

  useEffect(() => {
    let live = true;
    void (async () => {
      const list = await code<{ projects: Project[] }>('projects-list');
      if (live && list.ok) setProject(list.result.projects.find((p) => p.id === projectId) || null);
      const t = await refreshTree();
      await refreshLedger();
      if (!live) return;
      // Open the most useful first file: a changed one, else the entry point, else the first file.
      const first = t.find((x) => /(^|\/)(index|main)\.[jt]sx?$/.test(x.path)) || t.find((x) => !x.path.endsWith('.json')) || t[0];
      if (first && !buffersRef.current.length) void openFile(first.path);
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const save = useCallback(async (path: string) => {
    const t = timers.current.get(path); if (t) { clearTimeout(t); timers.current.delete(path); }
    const b = buffersRef.current.find((x) => x.path === path);
    if (!b || b.loading || b.content === b.saved) return true;
    const content = b.content;
    setSaveState('saving');
    const r = await code('files-write', { projectId, path, content });
    if (!r.ok) { setSaveState('error'); setError(r.message); return false; }
    setBuffers((bs) => bs.map((x) => (x.path === path ? { ...x, saved: content } : x)));
    setSaveState(buffersRef.current.some((x) => x.path !== path && x.content !== x.saved) ? 'unsaved' : 'saved');
    void refreshLedger();
    if (!tree?.some((e) => e.path === path)) void refreshTree();
    return true;
  }, [projectId, refreshLedger, refreshTree, tree]);

  const edit = useCallback((path: string, content: string) => {
    setBuffers((bs) => bs.map((b) => (b.path === path ? { ...b, content } : b)));
    setSaveState('unsaved');
    const t = timers.current.get(path); if (t) clearTimeout(t);
    timers.current.set(path, setTimeout(() => { void save(path); }, AUTOSAVE_MS));
  }, [save]);

  /** Replace a buffer's text from outside the keyboard (format): the editor is re-seeded. */
  const replace = useCallback((path: string, content: string) => {
    setBuffers((bs) => bs.map((b) => (b.path === path ? { ...b, content, seed: content, rev: b.rev + 1 } : b)));
    setSaveState('unsaved');
    const t = timers.current.get(path); if (t) clearTimeout(t);
    timers.current.set(path, setTimeout(() => { void save(path); }, AUTOSAVE_MS));
  }, [save]);

  const saveAll = useCallback(async () => {
    for (const b of buffersRef.current) if (b.content !== b.saved) await save(b.path);
  }, [save]);

  const close = useCallback((path: string) => {
    void save(path);
    setBuffers((bs) => {
      const next = bs.filter((b) => b.path !== path);
      setActive((a) => (a === path ? next[next.length - 1]?.path ?? null : a));
      return next;
    });
  }, [save]);

  /** Re-read files the server changed (rename, replace, accepted proposals), keeping unsaved edits elsewhere. */
  const reload = useCallback(async (paths?: string[]) => {
    const t = await refreshTree();
    const exists = new Set(t.map((e) => e.path));
    const targets = buffersRef.current.filter((b) => !paths || paths.includes(b.path));
    for (const b of targets) {
      if (!exists.has(b.path)) { setBuffers((bs) => bs.filter((x) => x.path !== b.path)); continue; }
      const r = await code<{ content: string }>('files-read', { projectId, path: b.path });
      if (r.ok && r.result.content !== b.content) setBuffers((bs) => bs.map((x) => (x.path === b.path ? { ...x, content: r.result.content, saved: r.result.content, seed: r.result.content, rev: x.rev + 1 } : x)));
    }
    setActive((a) => (a && !exists.has(a) ? null : a));
    await refreshLedger();
  }, [projectId, refreshLedger, refreshTree]);

  useEffect(() => () => { for (const t of timers.current.values()) clearTimeout(t); }, []);

  return { project, tree, ledger, setLedger, buffers, active, setActive, saveState, error, setError, openFile, edit, replace, save, saveAll, close, reload, refreshLedger, refreshTree };
}

export type ProjectState = ReturnType<typeof useProject>;
