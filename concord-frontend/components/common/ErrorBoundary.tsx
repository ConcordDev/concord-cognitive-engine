'use client';

import React, { Component, type ComponentType, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Optional fallback UI. If not provided, uses the default error panel. */
  fallback?: ReactNode;
  /** Called when an error is caught — use for external error reporting. */
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * React Error Boundary for catching render-time errors in the component tree.
 *
 * Prevents the entire app from crashing when a single component throws.
 * Logs the error and displays a recoverable fallback UI.
 *
 * Usage:
 *   <ErrorBoundary>
 *     <SomeComponent />
 *   </ErrorBoundary>
 *
 *   // With custom fallback:
 *   <ErrorBoundary fallback={<p>Custom error state</p>}>
 *     <SomeComponent />
 *   </ErrorBoundary>
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('[ErrorBoundary] Caught error:', error, errorInfo);
    this.props.onError?.(error, errorInfo);
  }

  private handleReset = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div
          role="alert"
          className="flex flex-col items-center justify-center p-8 rounded-xl bg-lattice-surface border border-red-500/20 m-4"
        >
          <div className="w-12 h-12 rounded-full bg-red-500/20 flex items-center justify-center mb-4">
            <AlertTriangle className="w-6 h-6 text-red-500" />
          </div>
          <h2 className="text-lg font-semibold text-white mb-2">
            Something went wrong
          </h2>
          <p className="text-sm text-gray-400 text-center mb-4 max-w-md">
            {this.state.error?.message || 'An unexpected error occurred in this section.'}
          </p>
          <button
            onClick={this.handleReset}
            className="flex items-center gap-2 px-4 py-2 bg-neon-cyan/20 border border-neon-cyan/50 rounded-lg text-neon-cyan text-sm hover:bg-neon-cyan/30 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            Try Again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export function withErrorBoundary<P extends object>(
  Wrapped: ComponentType<P>,
  fallback?: ReactNode,
): React.FC<P> {
  const WithBoundary: React.FC<P> = (props) => (
    <ErrorBoundary fallback={fallback}>
      <Wrapped {...props} />
    </ErrorBoundary>
  );
  WithBoundary.displayName = `withErrorBoundary(${Wrapped.displayName || Wrapped.name || 'Component'})`;
  return WithBoundary;
}
