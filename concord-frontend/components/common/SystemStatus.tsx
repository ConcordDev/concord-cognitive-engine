'use client';

/**
 * SystemStatus — Always-visible system status indicator.
 *
 * Shows:
 * - Backend reachable status
 * - Auth mode
 * - Recent errors (from requestErrors store)
 * - "No silent failures" guarantee
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { useUIStore } from '@/store/ui';
import { cn } from '@/lib/utils';
import { Wifi, WifiOff, Shield, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';

interface StatusResponse {
  ok: boolean;
  infrastructure?: {
    auth?: {
      mode?: string;
      usesJwt?: boolean;
      usesApiKey?: boolean;
    };
  };
  version?: string;
}

function SystemStatus() {
  const requestErrors = useUIStore((s) => s.requestErrors);
  const clearRequestErrors = useUIStore((s) => s.clearRequestErrors);
  const authPosture = useUIStore((s) => s.authPosture);
  const [expanded, setExpanded] = useState(false);

  const {
    data: status,
    isError: isBackendDown,
    error: backendError,
  } = useQuery<StatusResponse>({
    queryKey: ['system-status'],
    queryFn: async () => {
      const res = await api.get('/api/status');
      return res.data;
    },
    refetchInterval: 30_000,
    retry: 1,
  });

  const isHealthy = status?.ok && !isBackendDown;

  // Filter errors: only show critical ones (500+, timeouts, network errors)
  // Suppress: 404 resource lookups, 401 auth checks, WebSocket reconnects
  const criticalErrors = requestErrors.filter((err) => {
    if (!err.status) return true; // network errors are critical
    if (err.status >= 500) return true; // server errors are critical
    if (err.status === 408 || err.status === 504) return true; // timeouts
    // Suppress expected errors
    if (err.status === 404) return false; // resource not found = expected
    if (err.status === 401) return false; // auth check = expected
    if (err.status === 403) return false; // permission = handled by toast
    if (err.status === 429) return false; // rate limit = handled by toast
    return true; // show anything else
  });
  const recentErrors = criticalErrors.slice(-5);
  const hasErrors = recentErrors.length > 0;

  // Don't show if everything is fine and no errors
  if (isHealthy && !hasErrors && !expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="fixed bottom-4 left-4 z-40 flex items-center gap-1.5 px-2 py-1 rounded-full bg-neon-green/10 border border-neon-green/20 text-neon-green text-xs hover:bg-neon-green/20 transition-colors"
      >
        <Wifi className="w-3 h-3" />
        <span>System OK</span>
      </button>
    );
  }

  return (
    <div
      className={cn(
        'fixed bottom-4 left-4 z-40 rounded-lg border shadow-lg text-sm max-w-sm',
        isHealthy ? 'bg-lattice-surface border-lattice-border' : 'bg-red-950/90 border-red-500/40'
      )}
    >
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full px-3 py-2"
      >
        {isHealthy ? (
          <Wifi className="w-4 h-4 text-neon-green" />
        ) : (
          <WifiOff className="w-4 h-4 text-red-400 animate-pulse" />
        )}
        <span className={cn('font-medium', isHealthy ? 'text-white' : 'text-red-300')}>
          {isHealthy ? 'System Status' : 'Backend Unreachable'}
        </span>
        {hasErrors && (
          <span className="ml-auto px-1.5 py-0.5 bg-red-500/20 text-red-400 rounded-full text-xs">
            {recentErrors.length}
          </span>
        )}
        {expanded ? (
          <ChevronDown className="w-4 h-4 ml-auto text-gray-400" />
        ) : (
          <ChevronUp className="w-4 h-4 ml-auto text-gray-400" />
        )}
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="px-3 pb-3 space-y-2 border-t border-lattice-border/50 pt-2">
          {/* Backend status */}
          <div className="flex items-center justify-between text-xs">
            <span className="text-gray-400">Backend:</span>
            <span className={isHealthy ? 'text-neon-green' : 'text-red-400'}>
              {isHealthy ? 'Connected' : (backendError as Error)?.message || 'Unreachable'}
            </span>
          </div>

          {/* Auth mode */}
          <div className="flex items-center justify-between text-xs">
            <span className="text-gray-400">Auth Mode:</span>
            <span className="flex items-center gap-1 text-gray-300">
              <Shield className="w-3 h-3" />
              {authPosture?.mode || status?.infrastructure?.auth?.mode || 'unknown'}
            </span>
          </div>

          {/* Version */}
          {status?.version && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-400">Version:</span>
              <span className="text-gray-300">{status.version}</span>
            </div>
          )}

          {/* Recent errors */}
          {hasErrors && (
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-400 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3 text-amber-400" />
                  Recent Errors
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    clearRequestErrors();
                  }}
                  className="text-xs text-gray-500 hover:text-white"
                >
                  Clear
                </button>
              </div>
              {recentErrors.map((err) => (
                <div
                  key={err.id}
                  className="text-xs p-1.5 rounded bg-red-500/10 border border-red-500/20"
                >
                  <div className="flex items-center gap-1">
                    <span className="text-red-400 font-mono">{err.status || '???'}</span>
                    <span className="text-gray-400 truncate">
                      {err.method} {err.path}
                    </span>
                  </div>
                  <p className="text-red-300 truncate mt-0.5">{err.reason || err.message}</p>
                </div>
              ))}
            </div>
          )}

          {/* Close */}
          <button
            onClick={() => setExpanded(false)}
            className="w-full text-center text-xs text-gray-500 hover:text-gray-300 pt-1"
          >
            Collapse
          </button>
        </div>
      )}
    </div>
  );
}

import { withErrorBoundary } from '@/components/common/ErrorBoundary';
const _WrappedSystemStatus = withErrorBoundary(SystemStatus);
export { _WrappedSystemStatus as SystemStatus };
