/**
 * Shared client-error → repair-cortex reporter. `RepairBoundary` and any
 * inner error boundary that intentionally swallows an error (rather than
 * letting it bubble to `RepairBoundary`) should both funnel through this so
 * `/api/repair/frontend-error` sees every caught crash, not just the ones
 * that reach the outermost boundary.
 */
export interface ReportableError {
  message: string;
  stack?: string;
  name?: string;
  digest?: string;
}

const REDACTED = '[redacted]';

/** Best-effort scrub before the body leaves the browser. The server scrubs again. */
function scrubText(value: unknown, max: number): string {
  let s = String(value ?? '');
  if (s.length > Math.max(max * 8, 4096)) s = s.slice(0, Math.max(max * 8, 4096));
  const rules: Array<[RegExp, string]> = [
    [/Bearer\s+[A-Za-z0-9\-._~+/]{8,}=*/gi, REDACTED],
    [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, REDACTED],
    [/\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{8,}\b/g, REDACTED],
    [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, REDACTED],
    [/((?:access_token|refresh_token|api[_-]?key|private[_-]?key|password|passwd|secret|authorization|session|cookie|jwt|token|auth)\s*[=:]\s*)[^\s&#]+/gi, `$1${REDACTED}`],
    [/\/(?:Users|home)\/[^/\s]+/g, '/[user]'],
    [/[A-Za-z]:\\Users\\[^\\\s]+/g, '[user]'],
    [/\b[a-f0-9]{64,}\b/gi, REDACTED],
  ];
  for (const [re, to] of rules) s = s.replace(re, to);
  return s.slice(0, max);
}

function routeOnly(value: string): string {
  const cut = value.search(/[?#]/);
  const path = cut >= 0 ? value.slice(0, cut) : value;
  return scrubText(path, 200);
}

export async function reportFrontendError(
  error: ReportableError,
  opts: { componentStack?: string | null; lens?: string; route?: string } = {}
): Promise<void> {
  try {
    const path = typeof window !== 'undefined' ? window.location.pathname : '';
    const route = routeOnly(opts.route || path);
    const errorBody: { message: string; stack?: string; name?: string; digest?: string } = {
      message: scrubText(error.message, 500),
    };
    if (error.stack) errorBody.stack = scrubText(error.stack, 1500);
    if (error.name) errorBody.name = scrubText(error.name, 80);
    if (error.digest) errorBody.digest = scrubText(error.digest, 64);
    await fetch('/api/repair/frontend-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: errorBody,
        componentStack: opts.componentStack ? scrubText(opts.componentStack, 500) : undefined,
        lens: scrubText(opts.lens || 'unknown', 80) || 'unknown',
        route,
        url: routeOnly(path),
        timestamp: new Date().toISOString(),
      }),
    });
  } catch {
    console.error('[reportFrontendError] Failed to report error:', error);
  }
}
