'use client';

/**
 * CodeProjectContext — shares a single "current project" selection across
 * the code lens's three independent surfaces: the quick-script tabs (no
 * picker of its own), the virtual-git `CodeWorkbenchSection` (has its own
 * `ProjectSwitcher`), and `CodeAdvancedPanel` (had a second, disconnected
 * `ProjectSwitcher` instance). Before this, picking a project in one
 * surface had zero effect on the other two — three independent project
 * contexts on one page. See `docs/lens-specs/code-capability-map.md`
 * ("Honest observation, not fixed this pass" / "Flagged as a scoped
 * future build task").
 *
 * `CodeLensPage` is the sole provider. The hook is safe to call outside a
 * provider (falls back to local-only state) so any consumer — including
 * one under test in isolation — never crashes; it just loses sharing.
 *
 * Scope note: this only shares WHICH project is selected. It does not
 * change what the quick-script tabs' ephemeral `code-lens-live` semantic
 * buffer writes to — that stays untouched by design (repointing it at a
 * user's real project would mean quick-script keystrokes silently
 * overwrite real project files, which is exactly the kind of cross-surface
 * risk the deferral called out).
 */

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

interface CodeProjectContextValue {
  projectId: string | null;
  setProjectId: (id: string | null) => void;
}

const CodeProjectContext = createContext<CodeProjectContextValue | null>(null);

const PROJECT_STORAGE_KEY = 'concord.code.projectId';

export function CodeProjectProvider({ children }: { children: ReactNode }) {
  const [projectId, setProjectIdState] = useState<string | null>(null);
  // S17 (F17): the selected project survives reload/navigation. The
  // project and its files always persisted server-side; only the
  // SELECTION was memory-only, so every return started at
  // "— Select project —". Restore once on mount, persist on change.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(PROJECT_STORAGE_KEY);
      if (saved) setProjectIdState(saved);
    } catch { /* storage unavailable */ }
  }, []);
  const setProjectId = (id: string | null) => {
    setProjectIdState(id);
    try {
      if (id) window.localStorage.setItem(PROJECT_STORAGE_KEY, id);
      else window.localStorage.removeItem(PROJECT_STORAGE_KEY);
    } catch { /* storage unavailable */ }
  };
  const value = useMemo<CodeProjectContextValue>(() => ({ projectId, setProjectId }), [projectId]);
  return <CodeProjectContext.Provider value={value}>{children}</CodeProjectContext.Provider>;
}

export function useCodeProject(): CodeProjectContextValue {
  const ctx = useContext(CodeProjectContext);
  // Hooks must run unconditionally regardless of whether ctx is present.
  const [localProjectId, setLocalProjectId] = useState<string | null>(null);
  if (ctx) return ctx;
  return { projectId: localProjectId, setProjectId: setLocalProjectId };
}

export default CodeProjectContext;
