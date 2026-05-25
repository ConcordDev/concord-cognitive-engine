'use client';

import { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  lens?: string;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  retryCount: number;
  autoRecovering: boolean;
}

export class RepairBoundary extends Component<Props, State> {
  state: State = {
    hasError: false,
    error: null,
    retryCount: 0,
    autoRecovering: false,
  };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.reportError(error, errorInfo);
    this.attemptAutoRecovery(error);
  }

  async reportError(error: Error, errorInfo: ErrorInfo) {
    try {
      await fetch('/api/repair/frontend-error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: { message: error.message, stack: error.stack, name: error.name },
          componentStack: errorInfo.componentStack?.slice(0, 500),
          lens: this.props.lens || 'unknown',
          url: typeof window !== 'undefined' ? window.location.pathname : '',
          timestamp: new Date().toISOString(),
        }),
      });
    } catch {
      console.error('[RepairBoundary] Failed to report error:', error);
    }
  }

  attemptAutoRecovery(error: Error) {
    if (this.state.retryCount >= 3) return;
    this.setState({ autoRecovering: true });

    const strategy = this.selectRecoveryStrategy(error);
    const delay = 1000 * Math.pow(2, this.state.retryCount);

    if (strategy === 'clear_cache_retry') {
      try {
        // Clear relevant cached data from localStorage
        const keysToRemove: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && (key.startsWith('concord-') || key.startsWith('cache-'))) {
            keysToRemove.push(key);
          }
        }
        keysToRemove.forEach((key) => localStorage.removeItem(key));
        // Clear all sessionStorage as it is session-scoped cache
        sessionStorage.clear();
      } catch {
        // Storage access may fail in some environments
      }
      setTimeout(() => {
        this.setState((prev) => ({
          hasError: false,
          error: null,
          retryCount: prev.retryCount + 1,
          autoRecovering: false,
        }));
      }, delay);
    } else if (strategy === 'retry_render' || strategy === 'reload_lens') {
      setTimeout(() => {
        this.setState((prev) => ({
          hasError: false,
          error: null,
          retryCount: prev.retryCount + 1,
          autoRecovering: false,
        }));
      }, delay);
    } else {
      this.setState({ autoRecovering: false });
    }
  }

  selectRecoveryStrategy(error: Error): string {
    if (/fetch|network|Failed to fetch/i.test(error.message)) return 'clear_cache_retry';
    if (/Cannot read|undefined|null/i.test(error.message)) return 'retry_render';
    if (/state|Zustand|hydration/i.test(error.message)) return 'reload_lens';
    return 'retry_render';
  }

  render() {
    if (this.state.hasError) {
      if (this.state.autoRecovering) {
        return (
          <div className="flex items-center justify-center h-full p-8">
            <div className="text-center space-y-3">
              <div className="w-8 h-8 border-2 border-amber-400 border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-sm text-amber-400">Self-repairing... Attempt {this.state.retryCount + 1} of 3</p>
            </div>
          </div>
        );
      }

      if (this.props.fallback) return this.props.fallback;

      return (
        <div className="flex items-center justify-center h-full p-8">
          <div className="text-center space-y-4 max-w-md">
            <div className="w-12 h-12 rounded-full bg-red-500/20 flex items-center justify-center mx-auto">
              <span className="text-red-400 text-xl">!</span>
            </div>
            <h3 className="text-lg font-medium text-white">Something went wrong</h3>
            <p className="text-sm text-gray-400">{this.state.error?.message}</p>
            {this.state.retryCount < 3 ? (
              <button
                onClick={() => this.attemptAutoRecovery(this.state.error!)}
                className="px-4 py-2 bg-amber-500/20 text-amber-400 rounded-lg hover:bg-amber-500/30 transition-colors text-sm"
              >
                Try Auto-Repair
              </button>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-gray-400">Auto-repair failed after 3 attempts.</p>
                <button
                  onClick={() => typeof window !== 'undefined' && window.location.reload()}
                  className="px-4 py-2 bg-white/10 text-white rounded-lg hover:bg-white/20 transition-colors text-sm"
                >
                  Reload Page
                </button>
                <p className="text-xs text-gray-400">This error has been reported to the repair cortex.</p>
              </div>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
