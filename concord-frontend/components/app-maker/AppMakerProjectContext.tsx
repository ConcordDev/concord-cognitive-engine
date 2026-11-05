'use client';

/**
 * AppMakerProjectContext — the one piece of state Studio and Compute
 * (ActionsPanel) must share, per AGENTS.md's sibling-panel guidance: "Lift
 * to a local React context ... only when two sibling panels must share
 * mutating state." Studio (AppBuilderStudio) and Compute are mutually
 * exclusive tabs (page.tsx renders exactly one `Panel` at a time), so this
 * context is what lets Compute know which Studio project is "open" after
 * Studio unmounts.
 *
 * Fixes F4 (lens-reviews/app-maker.md): ActionsPanel previously ran its
 * compute actions (scaffoldApp/uiComplexity/wireframeValidate) against an
 * auto-created, always-empty generic artifact that had no connection to
 * any real Studio project — so "No pages defined in spec" fired even with
 * a fully-built project open. Compute now resolves the real project
 * through this context instead.
 */

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

interface AppMakerProjectContextValue {
  activeProjectId: string | null;
  setActiveProjectId: (id: string | null) => void;
}

const AppMakerProjectContext = createContext<AppMakerProjectContextValue | null>(null);

export function AppMakerProjectProvider({ children }: { children: ReactNode }) {
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const value = useMemo(() => ({ activeProjectId, setActiveProjectId }), [activeProjectId]);
  return <AppMakerProjectContext.Provider value={value}>{children}</AppMakerProjectContext.Provider>;
}

export function useAppMakerProject(): AppMakerProjectContextValue {
  const ctx = useContext(AppMakerProjectContext);
  // Honest fallback for any test/tree that renders a panel without the
  // provider mounted — never throws, just reports "no project open".
  if (!ctx) {
    return { activeProjectId: null, setActiveProjectId: () => {} };
  }
  return ctx;
}
