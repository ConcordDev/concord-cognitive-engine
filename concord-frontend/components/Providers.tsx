'use client';

import { useState, useEffect } from 'react';
import { MotionConfig } from 'framer-motion';
import { QueryClient, QueryClientProvider, MutationCache } from '@tanstack/react-query';
import { AppShell } from '@/components/shell/AppShell';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import { PermissionProvider } from '@/components/common/PermissionGate';
import { I18nProvider } from '@/components/providers/I18nProvider';
import { KeyboardProvider } from '@/lib/keyboard';
import { GlobalMediaController } from '@/components/media/GlobalMediaController';
import SoundSystem from '@/components/world-lens/SoundSystem';
import AdaptiveComplexity from '@/components/world-lens/AdaptiveComplexity';
import HiddenAssistance from '@/components/world-lens/HiddenAssistance';
import SecretsDiscovery from '@/components/world-lens/SecretsDiscovery';
import SplashScreen from '@/components/SplashScreen';
import { observeWebVitals } from '@/lib/perf';
import { connectSocket, disconnectSocket } from '@/lib/realtime/socket';
import { api } from '@/lib/api/client';
import { useUIStore } from '@/store/ui';
import { reportClientError } from '@/hooks/useBugContext';
import AccessibilityDOMApplier from '@/components/accessibility/AccessibilityDOMApplier';

/**
 * Client-side providers wrapper.
 * Extracted from root layout so layout.tsx can remain a Server Component (FE-002).
 * Initializes Web Vitals observation (FE-018), WebSocket connection, and permission context.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        // Note: Query error toasts are handled by the axios interceptor in lib/api/client.ts.
        // Do NOT add duplicate toasts via QueryCache.onError — that causes an error storm on page load.
        mutationCache: new MutationCache({
          onError: (error) => {
            // Only toast for mutations (user-initiated actions), not queries (background fetches)
            useUIStore.getState().addToast({
              type: 'error',
              message: `Operation failed: ${error.message}`,
            });
          },
        }),
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000,
            refetchOnWindowFocus: false,
          },
        },
      })
  );

  const [userScopes, setUserScopes] = useState<string[]>([]);
  const [splashVisible, setSplashVisible] = useState(true);

  // FE-018: Start performance observation
  useEffect(() => {
    observeWebVitals();
  }, []);

  // Splash screen auto-hide on first paint settled.
  // Skip splash if the user has already entered the world this session.
  useEffect(() => {
    const seenThisSession = sessionStorage.getItem('concord_splash_seen');
    if (seenThisSession) {
      setSplashVisible(false);
      return;
    }
    const id = setTimeout(() => {
      setSplashVisible(false);
      sessionStorage.setItem('concord_splash_seen', '1');
    }, 1400);
    return () => clearTimeout(id);
  }, []);

  // Connect WebSocket and fetch user scopes on mount (if authenticated)
  useEffect(() => {
    const entered = localStorage.getItem('concord_entered');
    if (!entered) return;

    let cancelled = false;

    // Connect WebSocket with existing session cookie
    connectSocket();

    // Fetch CSRF token on app init (ensures POSTs work even if login was in a prior session)
    api.get('/api/auth/csrf-token').catch(() => {});

    // Fetch user scopes for PermissionGate
    api.get('/api/auth/me')
      .then((res) => {
        if (cancelled) return;
        const scopes = res.data?.scopes || res.data?.permissions || [];
        if (Array.isArray(scopes)) setUserScopes(scopes);
      })
      .catch(() => {
        // Not authenticated — the 401 interceptor will handle redirect
      });

    return () => {
      cancelled = true;
      disconnectSocket();
    };
  }, []);

  // E4 — global client-error reporters. React error boundaries only catch
  // render-time throws; these catch the rest: uncaught runtime errors,
  // resource-load failures (img/script/css — only window 'error' sees these),
  // and unhandled promise rejections. Reports funnel through /api/client-error
  // → bug-triage. Best-effort + throttled inside reportClientError.
  useEffect(() => {
    const onError = (e: ErrorEvent) => {
      const isResource = !e.error && !!(e.target && (e.target as HTMLElement).tagName);
      reportClientError({
        kind: isResource ? 'resource_load' : 'uncaught_throw',
        error: e.error,
        message: e.message || (isResource ? `resource failed: ${(e.target as HTMLElement)?.tagName}` : ''),
      });
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      reportClientError({ kind: 'unhandled_rejection', error: e.reason, message: String(e.reason?.message ?? e.reason ?? '') });
    };
    window.addEventListener('error', onError, true); // capture phase to see resource errors
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError, true);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  return (
    <ErrorBoundary
      onError={(error, info) =>
        reportClientError({ kind: 'uncaught_throw', error, componentStack: info?.componentStack ?? undefined })
      }
    >
      {/*
        MotionConfig with reducedMotion="user" — framer-motion respects
        the OS-level prefers-reduced-motion media query for every motion
        component nested below. Users with the pref set get instant
        transitions instead of animations across all 175 lenses + the
        utility pages. Without this, every framer-motion call site
        (~100s of them across the codebase) would need its own
        useReducedMotion guard.
      */}
      <MotionConfig reducedMotion="user">
      {/* G3.1 — applies colorblind / text-scale / high-contrast / reduced-motion
          from the (now-bridged) a11y store to the DOM + the 3D world. */}
      <AccessibilityDOMApplier />
      <I18nProvider>
        <QueryClientProvider client={queryClient}>
          <PermissionProvider scopes={userScopes}>
            {/*
              AdaptiveComplexity + HiddenAssistance are Provider-shaped
              wrappers — they expose context APIs (useAdaptiveComplexity,
              useHiddenAssistance) that lens pages can consume to adapt
              UI complexity by inferred expertise level and surface
              just-in-time near-miss suggestions. Mounted at the
              Providers level so every lens has access without per-page
              wiring. AdaptiveComplexity outermost so HiddenAssistance
              can read expertise level via context if needed.
            */}
            <KeyboardProvider>
              <AdaptiveComplexity>
                <HiddenAssistance>
                  <SecretsDiscovery>
                    <AppShell>{children}</AppShell>
                  </SecretsDiscovery>
                </HiddenAssistance>
              </AdaptiveComplexity>
            </KeyboardProvider>
            {/* Global media layer — mounts once, survives all navigation.
                Owns the <audio> element so playback continues across
                lens switches. */}
            <GlobalMediaController />
            {/*
              SoundSystem is the district-aware ambient audio API
              (separate from GlobalMediaController which owns global
              music playback). Mounted with no props so the
              useSoundSystem() hook is callable from any page; pages
              with district context call setSoundscape(districtId) to
              drive the soundscape. The component itself returns null —
              it's an API initializer, not a UI element.
            */}
            <SoundSystem />
          </PermissionProvider>
        </QueryClientProvider>
      </I18nProvider>
      </MotionConfig>
      {/* Branded splash overlay shown once per session on cold start. */}
      <SplashScreen visible={splashVisible} />
    </ErrorBoundary>
  );
}
