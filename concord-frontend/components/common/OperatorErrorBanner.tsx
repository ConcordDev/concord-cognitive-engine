'use client';

import { AlertTriangle, Copy, Shield, X } from 'lucide-react';
import { useMemo, useEffect, useState } from 'react';
import { useUIStore } from '@/store/ui';
import { usePathname } from 'next/navigation';

function _reasonToAction(reason?: string): string {
  if (!reason) return 'Check request details and try again.';
  const normalized = reason.toLowerCase();
  if (normalized.includes('login required')) return 'Log in and retry the action.';
  if (normalized.includes('api key missing')) return 'Attach an x-api-key header or switch AUTH_MODE to jwt/hybrid.';
  if (normalized.includes('origin blocked')) return 'Add your frontend origin to ALLOWED_ORIGINS and redeploy.';
  if (normalized.includes('permission denied')) return 'Use an account/key with the required permission.';
  return 'Review the debug bundle and server logs for this request ID.';
}

/** Paths where the error banner should be suppressed to not block auth flows */
const SUPPRESSED_PATHS = ['/', '/login', '/register', '/forgot-password'];

export function OperatorErrorBanner() {
  const requestErrors = useUIStore((state) => state.requestErrors);
  const clearRequestErrors = useUIStore((state) => state.clearRequestErrors);
  const authPosture = useUIStore((state) => state.authPosture);
  const pathname = usePathname();
  const [dismissed, setDismissed] = useState(true); // Hidden by default

  const latest = requestErrors[requestErrors.length - 1];

  // Do NOT auto-show on new errors — banner is hidden by default.
  // Only show when user explicitly clicks "Debug" elsewhere.
  useEffect(() => {
    // Keep dismissed unless user explicitly opens
  }, [latest?.id, latest]);

  // Reset dismissed state when errors are cleared
  useEffect(() => {
    if (requestErrors.length === 0) {
      setDismissed(true);
    }
  }, [requestErrors.length]);

  const debugBundle = useMemo(() => {
    return JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        authPosture,
        recentErrors: requestErrors,
      },
      null,
      2
    );
  }, [authPosture, requestErrors]);

  const copyDebugBundle = async () => {
    try {
      await navigator.clipboard.writeText(debugBundle);
    } catch {
      // no-op fallback
    }
  };

  // Don't show on auth pages or when no errors
  if (!latest || SUPPRESSED_PATHS.includes(pathname)) return null;

  // Show a subtle indicator instead of the full banner
  if (dismissed) {
    return (
      <div className="flex justify-end px-4 py-1">
        <button
          onClick={() => setDismissed(false)}
          className="inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-xs text-gray-400 hover:text-gray-300 hover:bg-white/5 transition-colors"
          aria-label="Show debug panel"
        >
          <AlertTriangle className="h-3 w-3" />
          <span>{requestErrors.length} issue{requestErrors.length !== 1 ? 's' : ''}</span>
        </button>
      </div>
    );
  }

  const reason = latest.reason || latest.message;

  return (
    <div
      className="border-b border-red-500/40 bg-red-500/10 backdrop-blur px-4 py-2"
      role="alert"
      aria-live="polite"
    >
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <AlertTriangle className="h-4 w-4 text-red-400 flex-shrink-0" />
        <p className="font-medium text-red-200 flex-1 min-w-0 truncate">{reason}</p>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <span className="hidden sm:inline-flex items-center gap-1 rounded border border-white/15 bg-black/20 px-1.5 py-0.5 text-xs text-gray-300">
            <Shield className="h-3 w-3" /> {authPosture.mode}
          </span>
          <button
            onClick={copyDebugBundle}
            className="inline-flex items-center gap-1 rounded border border-white/20 px-1.5 py-0.5 text-xs text-white hover:bg-white/10"
            aria-label="Copy debug bundle to clipboard"
          >
            <Copy className="h-3 w-3" /> Debug
          </button>
          <button
            onClick={() => { clearRequestErrors(); setDismissed(true); }}
            className="rounded border border-white/20 p-1 text-white hover:bg-white/10"
            aria-label="Dismiss error banner"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      </div>
    </div>
  );
}
