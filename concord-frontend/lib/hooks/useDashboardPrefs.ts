'use client';

// concord-frontend/lib/hooks/useDashboardPrefs.ts
//
// Personalization for the user dashboard (MyDashboard). There was no dashboard
// personalization mechanism in the app before this — sidebar/theme/lens live in
// the Zustand UI store, but per-widget show/hide did not exist. This is a small,
// self-contained localStorage layer: which dashboard widgets are visible, and a
// "classic view" escape hatch back to the legacy 28-panel DashboardPage.

import { useCallback, useEffect, useState } from 'react';

export type DashboardWidget =
  | 'featureCards'
  | 'activityChart'
  | 'concordiaEvents'
  | 'presence'
  | 'messages'
  | 'news'
  | 'quickPost';

export const DASHBOARD_WIDGETS: { id: DashboardWidget; label: string }[] = [
  { id: 'featureCards', label: 'Quick actions' },
  { id: 'activityChart', label: 'Activity chart' },
  { id: 'concordiaEvents', label: 'Concordia events' },
  { id: 'presence', label: 'Who’s around' },
  { id: 'messages', label: 'Messages' },
  { id: 'news', label: 'Update news' },
  { id: 'quickPost', label: 'Quick post' },
];

interface DashboardPrefs {
  hidden: Partial<Record<DashboardWidget, boolean>>;
  classic: boolean;
}

const KEY = 'concord:dashboard:prefs';
const DEFAULT: DashboardPrefs = { hidden: {}, classic: false };

function read(): DashboardPrefs {
  if (typeof window === 'undefined') return DEFAULT;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULT;
    const parsed = JSON.parse(raw) as Partial<DashboardPrefs>;
    return { hidden: parsed.hidden ?? {}, classic: !!parsed.classic };
  } catch {
    return DEFAULT;
  }
}

export function useDashboardPrefs() {
  const [prefs, setPrefs] = useState<DashboardPrefs>(DEFAULT);

  // Hydrate from localStorage after mount (avoids SSR mismatch).
  useEffect(() => { setPrefs(read()); }, []);

  const persist = useCallback((next: DashboardPrefs) => {
    setPrefs(next);
    try { window.localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* quota / private mode */ }
  }, []);

  const isVisible = useCallback((w: DashboardWidget) => !prefs.hidden[w], [prefs]);

  const toggle = useCallback((w: DashboardWidget) => {
    persist({ ...prefs, hidden: { ...prefs.hidden, [w]: !prefs.hidden[w] } });
  }, [prefs, persist]);

  const setClassic = useCallback((on: boolean) => persist({ ...prefs, classic: on }), [prefs, persist]);

  const reset = useCallback(() => persist(DEFAULT), [persist]);

  return { prefs, isVisible, toggle, setClassic, reset };
}
