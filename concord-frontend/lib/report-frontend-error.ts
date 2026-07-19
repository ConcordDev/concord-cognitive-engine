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
}

export async function reportFrontendError(
  error: ReportableError,
  opts: { componentStack?: string | null; lens?: string } = {}
): Promise<void> {
  try {
    await fetch('/api/repair/frontend-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: { message: error.message, stack: error.stack, name: error.name },
        componentStack: opts.componentStack?.slice(0, 500),
        lens: opts.lens || 'unknown',
        url: typeof window !== 'undefined' ? window.location.pathname : '',
        timestamp: new Date().toISOString(),
      }),
    });
  } catch {
    console.error('[reportFrontendError] Failed to report error:', error);
  }
}
