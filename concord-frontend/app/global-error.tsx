'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { reportClientError } from '@/hooks/useBugContext';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // E4 — global-error renders OUTSIDE Providers (it catches errors in the root
  // layout itself), so the window listeners there never fire for it. Report
  // here directly. This is the white-screen class — the highest-value signal.
  useEffect(() => {
    reportClientError({ kind: 'white_screen', error, message: error?.message || `global-error${error?.digest ? ` (${error.digest})` : ''}` });
  }, [error]);

  return (
    <html lang="en">
      <body className="min-h-screen bg-[#0a0a0f] flex items-center justify-center px-4">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-red-500/10 flex items-center justify-center">
            <svg className="w-8 h-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white mb-2">
            Something went wrong
          </h1>
          <p className="text-gray-400 mb-2">
            A critical error occurred in the application.
          </p>
          {error.digest && (
            <p className="text-gray-400 text-xs mb-6 font-mono">
              Error ID: {error.digest}
            </p>
          )}
          <div className="flex gap-3 justify-center">
            <button
              onClick={reset}
              className="px-6 py-2.5 bg-gradient-to-r from-cyan-500 to-blue-500 rounded-lg text-white font-medium hover:shadow-lg transition-all"
            >
              Try Again
            </button>
            <Link
              href="/"
              className="px-6 py-2.5 border border-gray-600 rounded-lg text-gray-300 hover:bg-gray-800 transition-colors"
            >
              Go Home
            </Link>
          </div>
          <p className="text-gray-600 text-xs mt-8">
            Your data remains safe — Concord operates sovereignty-first.
          </p>
        </div>
      </body>
    </html>
  );
}
