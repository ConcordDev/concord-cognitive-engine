/**
 * instrumentation.ts — Next.js server + edge runtime initialization.
 *
 * Replaces the deprecated sentry.server.config.js and sentry.edge.config.js
 * files. Next.js calls register() once per runtime (Node and Edge) at boot.
 * The runtime check picks the right Sentry init for each.
 *
 * Privacy invariants preserved from the legacy files:
 *   - Error-only: tracesSampleRate 0, no performance traces
 *   - sendDefaultPii false
 *   - beforeSend strips event.user and event.request.cookies
 *
 * The matching browser init lives in instrumentation-client.ts (Next 15+
 * convention). Together these three replace the three legacy files.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const Sentry = await import('@sentry/nextjs');
    Sentry.init({
      dsn: process.env.NEXT_PUBLIC_SENTRY_DSN || '',
      enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,
      tracesSampleRate: 0,
      sendDefaultPii: false,
      beforeSend(event) {
        delete event.user;
        if (event.request?.cookies) delete event.request.cookies;
        return event;
      },
    });
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    const Sentry = await import('@sentry/nextjs');
    Sentry.init({
      dsn: process.env.NEXT_PUBLIC_SENTRY_DSN || '',
      enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,
      tracesSampleRate: 0,
      sendDefaultPii: false,
      beforeSend(event) {
        delete event.user;
        if (event.request?.cookies) delete event.request.cookies;
        return event;
      },
    });
  }
}

/**
 * Required by Next.js 15 + @sentry/nextjs to capture errors thrown from
 * nested React Server Components. Re-exports Sentry.captureRequestError
 * so the framework finds it; falls back to a no-op when the SDK doesn't
 * ship the helper (older versions). Silences the
 * "Could not find onRequestError hook" warning.
 */
export async function onRequestError(
  err: unknown,
  request: Request | { path: string; method: string; headers: Record<string, string | string[] | undefined> },
  context: { routerKind: 'Pages Router' | 'App Router'; routePath: string; routeType: 'render' | 'route' | 'action' | 'middleware' },
) {
  try {
    const Sentry = await import('@sentry/nextjs');
    const fn = (Sentry as unknown as { captureRequestError?: (e: unknown, r: unknown, c: unknown) => void })
      .captureRequestError;
    if (typeof fn === 'function') fn(err, request, context);
  } catch { /* SDK unavailable — never block the framework */ }
}

