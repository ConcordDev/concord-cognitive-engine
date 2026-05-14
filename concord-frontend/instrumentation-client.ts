/**
 * instrumentation-client.ts — Next.js 15+ browser-side Sentry init.
 *
 * Replaces the deprecated sentry.client.config.js (which still works under
 * Webpack but breaks under Turbopack). Next runs this once per page load
 * before any other client code.
 *
 * Privacy invariants preserved from the legacy file:
 *   - Error-only: no performance tracing, no session replay, no user tracking
 *   - sendDefaultPii false
 *   - beforeSend strips event.user and event.request.cookies
 */

import * as Sentry from '@sentry/nextjs';
import { installR3FShim } from '@/lib/react18-internals-shim';

// Walkthrough hotfix — Next 15 bundles React 19; @react-three/fiber
// v8 reaches into React 18's __SECRET_INTERNALS.ReactCurrentOwner at
// module-evaluation time and throws TypeError. Install the shim
// BEFORE any R3F chunk loads so the world lens 3D scene renders.
// Long-term fix: upgrade @react-three/fiber to v9.
installR3FShim();

// Walkthrough hotfix — @monaco-editor/loader fires a window 'error'
// Event when its CDN is unreachable (no body, no proper Error
// object). The bare Event escapes React's render boundary and gets
// counted as a fatal pageerror — crashing the /lenses/code lens for
// every user without CDN access. Swallow Monaco-loader error events
// specifically; surface everything else.
if (typeof window !== 'undefined') {
  window.addEventListener('error', (ev) => {
    const target = ev?.target as { src?: string; tagName?: string } | null;
    const src = target?.src ?? '';
    if (target?.tagName === 'SCRIPT' && /monaco|@monaco-editor|jsdelivr|unpkg.*monaco|cdn.+monaco/i.test(src)) {
      ev.stopImmediatePropagation();
      ev.preventDefault();
      // Quiet client-side log for ops.
      console.warn('[Monaco] loader fetch failed, editor will be unavailable:', src);
    }
  }, true);
}

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN || '',
  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0,
  replaysOnErrorSampleRate: 0,
  replaysSessionSampleRate: 0,
  sendDefaultPii: false,
  beforeSend(event) {
    delete event.user;
    if (event.request?.cookies) delete event.request.cookies;
    return event;
  },
});

/**
 * Optional: capture router transitions when @sentry/nextjs exposes the
 * helper. Falls back to a no-op when the SDK version doesn't ship it.
 */
export const onRouterTransitionStart =
  typeof Sentry.captureRouterTransitionStart === 'function'
    ? Sentry.captureRouterTransitionStart
    : undefined;
