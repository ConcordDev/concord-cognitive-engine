'use client';

/**
 * LensErrorBoundary — Sprint 17
 *
 * Production-grade error boundary auto-mounted via LensShell. Catches
 * any uncaught render or effect error in a lens and shows a recoverable
 * fallback instead of a blank screen.
 *
 * Per the production-grade-per-lens invariant (ISO/IEC 25010 reliability
 * + Core Web Vitals UX polish): no lens may crash the user-visible
 * surface. Errors must be:
 *   - Captured (no white screen)
 *   - Surfaced with enough info to retry
 *   - Logged for observability
 *   - Recoverable without page reload
 */

import React from 'react';
import Link from 'next/link';

interface Props {
  lensId: string;
  children: React.ReactNode;
}

interface State {
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

export class LensErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error, errorInfo: null };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    this.setState({ error, errorInfo });
    // Best-effort logging — never throw from here.
    try {
      console.error(`[LensErrorBoundary:${this.props.lensId}]`, error, errorInfo);
      // Post to backend observability if available.
      fetch('/api/lens/run', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain: 'observability', name: 'log_error',
          input: {
            lensId: this.props.lensId,
            message: error.message,
            stack: (error.stack || '').slice(0, 4000),
            componentStack: (errorInfo.componentStack || '').slice(0, 4000),
          },
        }),
      }).catch(() => { /* observability is best-effort */ });
    } catch { /* never block recovery */ }
  }

  reset = () => {
    this.setState({ error: null, errorInfo: null });
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div
        role="alert"
        className="min-h-[400px] flex items-center justify-center px-6 py-8 bg-zinc-950 text-zinc-100"
      >
        <div className="max-w-xl text-center space-y-4">
          <div className="text-4xl">⚠</div>
          <h2 className="text-xl font-semibold text-zinc-100">
            The <span className="font-mono text-amber-400">{this.props.lensId}</span> lens hit an error
          </h2>
          <p className="text-sm text-zinc-400 leading-relaxed">
            Something broke while rendering this surface. The error has been logged;
            you can try recovering without losing your data.
          </p>
          <details className="text-left text-xs bg-zinc-900/60 rounded-lg p-3 ring-1 ring-zinc-800">
            <summary className="cursor-pointer text-zinc-400 hover:text-zinc-200">
              technical details
            </summary>
            <pre className="mt-2 text-[10px] text-red-400 whitespace-pre-wrap break-words">
              {this.state.error.message}
              {this.state.error.stack && '\n\n' + this.state.error.stack.slice(0, 800)}
            </pre>
          </details>
          <div className="flex items-center justify-center gap-3 pt-2">
            <button
              onClick={this.reset}
              className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-amber-50 text-sm font-medium"
            >
              Try again
            </button>
            <button
              onClick={() => {
                if (typeof window !== 'undefined') window.location.reload();
              }}
              className="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-sm"
            >
              Reload page
            </button>
            <Link
              href="/lenses/hub"
              className="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-sm"
            >
              Back to hub
            </Link>
          </div>
        </div>
      </div>
    );
  }
}

export default LensErrorBoundary;
