'use client';

import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import dynamic from 'next/dynamic';
import { MotionConfig } from 'framer-motion';
import { QueryClient, QueryClientProvider, MutationCache } from '@tanstack/react-query';
import { AppShell } from '@/components/shell/AppShell';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import { PermissionProvider } from '@/components/common/PermissionGate';
import { I18nProvider } from '@/components/providers/I18nProvider';
import { KeyboardProvider } from '@/lib/keyboard';
import { GlobalMediaController } from '@/components/media/GlobalMediaController';
import SplashScreen from '@/components/SplashScreen';
import { observeWebVitals } from '@/lib/perf';
import { connectSocket, disconnectSocket } from '@/lib/realtime/socket';
import { api } from '@/lib/api/client';
import { useUIStore } from '@/store/ui';
import { reportClientError } from '@/hooks/useBugContext';
import AccessibilityDOMApplier from '@/components/accessibility/AccessibilityDOMApplier';
import { safeGetItem, safeSetItem } from '@/lib/safe-storage';
import { useEverTrue } from '@/hooks/useEverTrue';

/**
 * Shell-diet — SoundSystem / AdaptiveComplexity / HiddenAssistance /
 * SecretsDiscovery all live under `components/world-lens/` and are, in
 * fact, Concordia (the 3D world lens)-specific: their exported hooks
 * (`useSoundSystem`, `useAdaptiveComplexity`, `useHiddenAssistance`,
 * `useDiscovery`) have zero consumers outside world-lens code (verified by
 * grep — `useDiscovery` is consumed only by
 * `components/concordia/dialogue/DialoguePanel.tsx`, itself only mounted
 * from `app/lenses/world/page.tsx`; the other three hooks have no
 * consumers at all beyond their own defining file). They were nonetheless
 * mounted unconditionally in Providers, at the root of every page, meaning
 * their behavior-tracking state machines, near-miss heuristics, and nudge
 * engines ran (and their code shipped) on every non-world lens too.
 *
 * They're now `next/dynamic({ ssr: false })` (real code-split, off the
 * initial bundle) AND gated on `pathname.startsWith('/lenses/world')`
 * (never even mounted outside Concordia). Each component's context
 * provider already ships a no-op default value (see their `createContext`
 * calls), so any future non-world caller of these hooks still gets a safe,
 * inert API instead of crashing — this change doesn't remove that safety
 * net, it just stops paying for the real implementation where it can't be
 * used.
 */
const SoundSystem = dynamic(() => import('@/components/world-lens/SoundSystem'), { ssr: false });
const AdaptiveComplexity = dynamic(() => import('@/components/world-lens/AdaptiveComplexity'), { ssr: false });
const HiddenAssistance = dynamic(() => import('@/components/world-lens/HiddenAssistance'), { ssr: false });
const SecretsDiscovery = dynamic(() => import('@/components/world-lens/SecretsDiscovery'), { ssr: false });

/**
 * Client-side providers wrapper.
 * Extracted from root layout so layout.tsx can remain a Server Component (FE-002).
 * Initializes Web Vitals observation (FE-018), WebSocket connection, and permission context.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  // World-lens gate for the four Concordia-only providers below. `usePathname`
  // is null on the very first server-rendered pass in some Next configurations,
  // so this defaults to `false` (not-world) until the client confirms a route —
  // matching the pre-existing "no chrome until mounted" caution elsewhere in
  // the shell (AppShell's own `mounted` gate). `useEverTrue` means once a
  // session visits the world lens these providers mount and then STAY
  // mounted for the rest of the session (matching their pre-existing
  // always-mounted behavior exactly — journal/behavior state that re-
  // hydrates from the backend or localStorage keeps doing so the same way);
  // the only change is that a session which never visits the world lens
  // never pays to mount them at all.
  const pathname = usePathname();
  const isWorldLens = !!pathname && pathname.startsWith('/lenses/world');
  const worldLensEverVisited = useEverTrue(isWorldLens);

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
    const seenThisSession = safeGetItem(sessionStorage, 'concord_splash_seen');
    if (seenThisSession) {
      setSplashVisible(false);
      return;
    }
    const id = setTimeout(() => {
      setSplashVisible(false);
      safeSetItem(sessionStorage, 'concord_splash_seen', '1');
    }, 1400);
    return () => clearTimeout(id);
  }, []);

  // Connect WebSocket and fetch user scopes on mount (if authenticated)
  useEffect(() => {
    const entered = safeGetItem(localStorage, 'concord_entered');
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
              useHiddenAssistance) that Concordia (world-lens) code consumes
              to adapt UI complexity by inferred expertise level and surface
              just-in-time near-miss suggestions. Both — plus SecretsDiscovery
              — are genuinely world-lens-specific (see the shell-diet note
              above the dynamic() declarations), so they're only mounted once
              a session has visited `/lenses/world`. AdaptiveComplexity
              outermost so HiddenAssistance can read expertise level via
              context if needed. Non-world routes render AppShell directly —
              every context here ships a safe no-op default, so nothing that
              might call these hooks off-world breaks.
            */}
            <KeyboardProvider>
              {worldLensEverVisited ? (
                <AdaptiveComplexity>
                  <HiddenAssistance>
                    <SecretsDiscovery>
                      <AppShell>{children}</AppShell>
                    </SecretsDiscovery>
                  </HiddenAssistance>
                </AdaptiveComplexity>
              ) : (
                <AppShell>{children}</AppShell>
              )}
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
              it's an API initializer, not a UI element. World-lens-only
              (see the shell-diet note above) — gated the same way as the
              three context providers.
            */}
            {worldLensEverVisited && <SoundSystem />}
          </PermissionProvider>
        </QueryClientProvider>
      </I18nProvider>
      </MotionConfig>
      {/* Branded splash overlay shown once per session on cold start. */}
      <SplashScreen visible={splashVisible} />
    </ErrorBoundary>
  );
}
