'use client';

import { useEffect } from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';
import Link from 'next/link';

export default function LensError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Lens error:', error);
  }, [error]);

  return (
    <div className="min-h-[80vh] flex items-center justify-center p-6">
      <div className="max-w-lg w-full">
        <div className="bg-lattice-surface border border-sovereignty-warning/30 rounded-2xl p-8">
          {/* Error Icon */}
          <div className="flex items-center gap-4 mb-6">
            <div className="w-14 h-14 rounded-xl bg-sovereignty-warning/20 flex items-center justify-center shrink-0">
              <AlertTriangle className="w-7 h-7 text-sovereignty-warning" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white">
                Lens Error
              </h1>
              <p className="text-gray-400 text-sm">
                This lens encountered an issue
              </p>
            </div>
          </div>

          {/* Error message */}
          <div className="bg-lattice-deep rounded-lg p-4 mb-6">
            <p className="text-gray-300 text-sm font-mono break-words">
              {error.message || 'An unexpected error occurred in this lens.'}
            </p>
            {error.digest && (
              <p className="text-gray-400 text-xs mt-2">
                ID: {error.digest}
              </p>
            )}
          </div>

          {/* Actions */}
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={reset}
              className="flex items-center justify-center gap-2 px-4 py-3 bg-neon-cyan/20 border border-neon-cyan/50 rounded-lg text-neon-cyan hover:bg-neon-cyan/30 transition-colors text-sm font-medium"
            >
              <RefreshCw className="w-4 h-4" />
              Retry Lens
            </button>
            <Link
              href="/"
              className="flex items-center justify-center gap-2 px-4 py-3 bg-lattice-deep border border-lattice-border rounded-lg text-gray-300 hover:text-white hover:border-gray-500 transition-colors text-sm font-medium"
            >
              <Home className="w-4 h-4" />
              Dashboard
            </Link>
          </div>

          {/* Helpful tips */}
          <div className="mt-6 pt-6 border-t border-lattice-border">
            <p className="text-gray-400 text-xs mb-2">Try these:</p>
            <ul className="text-gray-400 text-xs space-y-1">
              <li>* Refresh the page</li>
              <li>* Check if the backend server is running</li>
              <li>* Clear browser cache and try again</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
