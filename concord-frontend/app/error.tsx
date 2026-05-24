'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log error to console in development
    console.error('Global error:', error);
  }, [error]);

  return (
    <div className="min-h-screen bg-lattice-void flex items-center justify-center p-6">
      <div className="max-w-md w-full">
        <div className="bg-lattice-surface border border-red-500/30 rounded-2xl p-8 text-center">
          {/* Error Icon */}
          <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-red-500/20 flex items-center justify-center">
            <AlertTriangle className="w-8 h-8 text-red-500" />
          </div>

          {/* Title */}
          <h1 className="text-2xl font-bold text-white mb-2">
            Something went wrong
          </h1>

          {/* Message */}
          <p className="text-gray-400 mb-6">
            {error.message || 'An unexpected error occurred. Please try again.'}
          </p>

          {/* Error digest for debugging */}
          {error.digest && (
            <p className="text-xs text-gray-400 font-mono mb-6">
              Error ID: {error.digest}
            </p>
          )}

          {/* Actions */}
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <button
              onClick={reset}
              className="flex items-center justify-center gap-2 px-6 py-3 bg-neon-cyan/20 border border-neon-cyan/50 rounded-lg text-neon-cyan hover:bg-neon-cyan/30 transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              Try Again
            </button>
            <Link
              href="/"
              className="flex items-center justify-center gap-2 px-6 py-3 bg-lattice-deep border border-lattice-border rounded-lg text-gray-300 hover:text-white hover:border-gray-500 transition-colors"
            >
              <Home className="w-4 h-4" />
              Go Home
            </Link>
          </div>
        </div>

        {/* Sovereignty reminder */}
        <p className="text-center text-gray-400 text-sm mt-6">
          Your data remains safe and local. Errors don&apos;t leave your machine.
        </p>
      </div>
    </div>
  );
}
