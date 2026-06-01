'use client';

// E4/E6 — useBugContext: auto-context for client-error reports.
//
// The "right half" of the Track-E observability loop on the client. A ring-buffer
// of breadcrumbs + a context gatherer (lens/world, route, build, UA/viewport) +
// a fire-and-forget reporter that POSTs to `/api/client-error` (the intake that
// classifies via bug-triage, counts, mints a kind='client_error' DTU, and pages
// Critical). Wired at three sites: the root ErrorBoundary `onError`,
// `app/global-error.tsx`, and the FeedbackWidget bug-report path.
//
// Design notes (2026 client-error best-practice):
//  - capture happens via boundaries + a global window listener (see GlobalErrorReporter);
//    window.addEventListener('error') also catches resource-load failures.
//  - the client clock is untrusted — the server stamps reportedAt; we only send breadcrumbs.
//  - reporting MUST never throw and is throttled so an error loop can't self-DoS.
//  - keepalive:true so a report survives a navigation/crash unload.

import { useCallback, useEffect } from 'react';
import { usePathname } from 'next/navigation';

const MAX_BREADCRUMBS = 20;
const BREADCRUMB_LEN = 160;
const _breadcrumbs: string[] = [];
let _lensId = 'unknown';

/** Record a user-action / nav breadcrumb into the ring buffer (last 20 kept). */
export function pushBreadcrumb(crumb: string): void {
  try {
    _breadcrumbs.push(`${Date.now()}:${String(crumb).slice(0, BREADCRUMB_LEN)}`);
    if (_breadcrumbs.length > MAX_BREADCRUMBS) {
      _breadcrumbs.splice(0, _breadcrumbs.length - MAX_BREADCRUMBS);
    }
  } catch { /* never throw */ }
}

/** Let the active lens override the path-derived id (LensShell knows it precisely). */
export function setBugLensId(lensId: string): void {
  if (lensId) _lensId = lensId;
}

function lensFromPath(path: string): string {
  const m = /^\/lenses\/([^/]+)/.exec(path || '');
  return m?.[1] || _lensId || 'unknown';
}

export interface BugContext {
  lensId: string;
  worldId: string;
  route: string;
  buildId: string;
  ua: string;
  viewport: string;
  breadcrumbs: string[];
}

/** Plain (non-hook) context gatherer — safe to call from class components + global handlers. */
export function gatherBugContext(extra: Partial<BugContext> = {}): BugContext {
  let route = '';
  let ua = '';
  let viewport = '';
  let worldId = '';
  try {
    if (typeof window !== 'undefined') {
      route = window.location?.pathname || '';
      ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
      viewport = `${window.innerWidth || 0}x${window.innerHeight || 0}`;
      worldId = window.localStorage?.getItem('concordia:activeWorldId') || '';
    }
  } catch { /* SSR / locked-down env */ }
  return {
    lensId: extra.lensId || lensFromPath(route),
    worldId: extra.worldId || worldId,
    route: extra.route || route,
    buildId: extra.buildId || process.env.NEXT_PUBLIC_BUILD_ID || 'dev',
    ua: extra.ua || ua,
    viewport: extra.viewport || viewport,
    breadcrumbs: extra.breadcrumbs || _breadcrumbs.slice(-MAX_BREADCRUMBS),
  };
}

// Client-side throttle — cap reports/window so an error loop can't flood the route.
const _recent: number[] = [];
const REPORT_MAX = 20;
const REPORT_WINDOW_MS = 60_000;
function throttled(): boolean {
  const now = Date.now();
  while (_recent.length && now - _recent[0] > REPORT_WINDOW_MS) _recent.shift();
  if (_recent.length >= REPORT_MAX) return true;
  _recent.push(now);
  return false;
}

export interface ReportInput {
  kind?: string;
  error?: unknown;
  message?: string;
  componentStack?: string;
  lensId?: string;
  signals?: { dataLoss?: boolean; security?: boolean; moneyMoved?: boolean; affectedUsers?: number };
}

/** Fire-and-forget report to /api/client-error. Never throws; throttled; keepalive. */
export function reportClientError(input: ReportInput = {}): void {
  try {
    if (throttled()) return;
    const err = input.error as { message?: string; stack?: string } | undefined;
    const message = String(input.message ?? err?.message ?? (typeof input.error === 'string' ? input.error : '') ?? '').slice(0, 1000);
    const stack = String(err?.stack ?? '').slice(0, 4000);
    const context = gatherBugContext(input.lensId ? { lensId: input.lensId } : {});
    const body = JSON.stringify({
      kind: input.kind || 'uncaught_throw',
      message,
      stack,
      componentStack: input.componentStack ? String(input.componentStack).slice(0, 2000) : undefined,
      signals: input.signals,
      context,
    });
    void fetch('/api/client-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => { /* swallow — reporting is best-effort */ });
  } catch { /* reporting must never throw */ }
}

/**
 * Hook form. Keeps the active lensId synced from the route + drops a nav breadcrumb;
 * returns a stable `report` plus the context gatherer.
 */
export function useBugContext() {
  const pathname = usePathname();
  useEffect(() => {
    if (pathname) {
      setBugLensId(lensFromPath(pathname));
      pushBreadcrumb(`nav:${pathname}`);
    }
  }, [pathname]);

  const report = useCallback((input: ReportInput) => reportClientError(input), []);
  return { report, gatherBugContext, pushBreadcrumb, context: gatherBugContext() };
}

export default useBugContext;
