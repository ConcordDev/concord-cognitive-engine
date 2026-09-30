'use client';

import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import dynamic from 'next/dynamic';
import { useDiegetic } from '@/hooks/useDiegetic';
import { useWorldHudHidden } from '@/hooks/useWorldHudHidden';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { useUIStore } from '@/store/ui';
import { Toasts } from '@/components/common/Toasts';
import { OperatorErrorBanner } from '@/components/common/OperatorErrorBanner';
import { SystemStatus } from '@/components/common/SystemStatus';
import { LensErrorBoundary } from '@/components/common/LensErrorBoundary';
import { InstallPrompt } from '@/components/pwa/InstallPrompt';
import { CookieConsent } from '@/components/common/CookieConsent';
import { ThemeToggle } from '@/components/common/ThemeToggle';
import { OfflineBanner } from '@/components/ui/OfflineBanner';
import SyncIndicator from '@/components/pwa/SyncIndicator';
import { ConnectionStatus } from '@/components/common/ConnectionStatus';
import { MobileNav } from '@/components/shell/MobileNav';
// State-only hooks are kept as static imports (they gate whether the heavy
// UI below is ever needed at all — QuickCapture/OnboardingWizard's hooks
// also own global keyboard shortcuts that must always be live). Each hook
// now lives in its own small module, split out of the same file as its
// heavy component (shell-diet pass) — importing the hook here no longer
// drags the component's render tree into the initial bundle.
import { useQuickCapture } from '@/components/capture/useQuickCapture';
import { useOnboarding } from '@/components/onboarding/useOnboarding';
import { useEverTrue } from '@/hooks/useEverTrue';
import { useRouter } from 'next/navigation';
import { useSessionStore } from '@/store/sessions';
import { useMusicStore } from '@/lib/music/store';
import { useEventRouter } from '@/lib/event-router';
import { useSocialNotificationToast } from '@/hooks/useSocialNotificationToast';
import { useChannelInboundToast } from '@/hooks/useChannelInboundToast';
import { api } from '@/lib/api/client';

/**
 * Shell-diet lazy imports (see docs/NEXT_ARC_PLAN.md perf backlog).
 *
 * These components were previously static imports, meaning all of their
 * code (and transitive deps — framer-motion trees, icon sets, the full
 * lens/panel registries for CommandPalette) parsed and evaluated on every
 * single page load for every user, regardless of whether the surface was
 * ever opened. `next/dynamic(..., { ssr: false })` code-splits each into
 * its own chunk that only loads on the client, off the critical initial-
 * render path.
 *
 * CommandPalette, SystemGuidePanel, FirstWinWizard, HelpButton and
 * LegalFooter are still mounted unconditionally (same as before) — they're
 * genuinely global chrome — but their CODE no longer ships in the main
 * bundle; it streams in as a separate chunk right after first paint. An
 * idle-time prefetch below warms the CommandPalette chunk specifically, so
 * Cmd/Ctrl+K still feels instant for the overwhelming majority of sessions
 * (that don't press it in the first second of a page load).
 */
const CommandPalette = dynamic(
  () => import('@/components/common/CommandPalette').then((m) => ({ default: m.CommandPalette })),
  { ssr: false }
);
const SystemGuidePanel = dynamic(
  () => import('@/components/guidance/SystemGuidePanel').then((m) => ({ default: m.SystemGuidePanel })),
  { ssr: false }
);
const FirstWinWizard = dynamic(
  () => import('@/components/guidance/FirstWinWizard').then((m) => ({ default: m.FirstWinWizard })),
  { ssr: false }
);
const HelpButton = dynamic(
  () => import('@/components/help/HelpButton').then((m) => ({ default: m.HelpButton })),
  { ssr: false }
);
const LegalFooter = dynamic(
  () => import('@/components/legal/LegalFooter').then((m) => ({ default: m.LegalFooter })),
  { ssr: false }
);
// ConKay widget shell (V1.1 unit CK1) — ambient, always-present, dismissible
// ConKay presence above lens content. Unconditionally mounted like the five
// above (its own internal hidden-state check, not this gate, governs
// visibility) but code-split the same way so it doesn't cost anything on
// pages nobody ever interacts with it from.
const ConKayWidgetLayer = dynamic(
  () => import('@/components/conkay/widget/ConKayWidgetLayer').then((m) => ({ default: m.ConKayWidgetLayer })),
  { ssr: false }
);

// These four are additionally GATED — not just code-split but never even
// mounted — until the state that governs their visibility first goes true
// (a session-sidebar toggle, a quick-capture shortcut, the onboarding tour,
// or the user actually starting music playback). Each stays mounted for the
// rest of the session once first needed (see `useEverTrue` below) so their
// own internal state (search query, draft text, exit animations) behaves
// exactly as it did when they were always-mounted.
const SessionSidebar = dynamic(
  () => import('@/components/chat/SessionSidebar').then((m) => ({ default: m.SessionSidebar })),
  { ssr: false }
);
const QuickCapture = dynamic(
  () => import('@/components/capture/QuickCapture').then((m) => ({ default: m.QuickCapture })),
  { ssr: false }
);
const OnboardingWizard = dynamic(
  () => import('@/components/onboarding/OnboardingWizard').then((m) => ({ default: m.OnboardingWizard })),
  { ssr: false }
);
const NowPlayingBar = dynamic(
  () => import('@/components/music/NowPlayingBar').then((m) => ({ default: m.NowPlayingBar })),
  { ssr: false }
);

/** Routes that render their own chrome and should skip the AppShell layout. */
// '/welding-portal/' is the public, no-account customer portal (view/approve
// a welding estimate or invoice via an emailed token link) — it must not
// show Concord's app sidebar/nav to a visitor who was never asked to sign up.
// '/share/animation/' is the public, no-account animation share viewer (view
// a shared animation via a token link) — same reasoning: a logged-out
// visitor should never see Concord's authenticated app chrome.
// '/onboarding' (bare page + every /onboarding/* step — brain-mode,
// character, location, confirm-age) is a brand-new account's very first
// screen. Rendering it inside the full AppShell exposed the entire
// 60+-destination sidebar, topbar, NotificationBell, SystemGuidePanel, and
// FirstWinWizard around a single yes/no onboarding question — overwhelming
// for a first-time visitor (real feedback: "regular apps are simple," this
// one required dodging unrelated UI to find the actual next step) and, on
// the resilience side, those chrome widgets each fire their own fetch
// (guidance/first-win, guidance/suggestions, tutorial/first-cycle,
// events/paginated, NotificationBell's poll) the instant they mount — a
// burst of ~6 simultaneous calls on top of onboarding's own auth/wizard
// checks, at exactly the moment a fresh signup's session is most fragile.
// Standalone here stops all of that chrome (and its fetch burst) from
// mounting during onboarding; the onboarding pages' own hooks (useOnboarding,
// the confirm-age redirect effect) still run identically either way, since
// hooks execute regardless of which JSX branch AppShell returns.
// /register + /login (2026-08-24, found live during a concurrent real-browser
// load test): these are pre-auth pages — the visitor has no session yet, so
// the full authenticated-app <Sidebar/> (links to all ~260 lenses) was
// rendering there anyway and Next.js eagerly prefetches every visible Link,
// firing dozens of `_rsc` GETs that each redirect through /login?from=... on
// the unauthenticated request. Under concurrent load (several real signups
// sharing one page-load burst) that prefetch storm measurably delayed the
// actual register/login POST — up to several seconds before it even left
// the browser, well past what reads as "the button works" to a real user.
// Same fix, same reasoning as the /onboarding entry above: standalone here
// stops that chrome (and its fetch/prefetch burst) from mounting at exactly
// the moment the page has the least reason to show it.
const STANDALONE_PREFIXES = ['/legal/', '/welding-portal/', '/share/animation/', '/onboarding', '/register', '/login', '/explore'];

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  // Central event-router — subscribes to every namespaced CustomEvent
  // dispatched across the app and routes it to the right macro /
  // navigation / toast. See lib/event-router.ts for the table.
  useEventRouter();

  // Phase 11 (Item 4) — pan-social notification toasts. Subscribes
  // to the social:notification socket event so reactions / comments /
  // follows / shares / mentions / DMs surface within ~500ms instead
  // of waiting on the NotificationBell 60s poll.
  useSocialNotificationToast();

  // DET-C batch 10 — Telegram/Discord/email inbound-webhook bridge
  // (server/routes/channels.js) toast; see the hook's own header for the
  // full "this had zero frontend consumer" history.
  useChannelInboundToast();

  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed);
  const commandPaletteOpen = useUIStore((s) => s.commandPaletteOpen);
  const setCommandPaletteOpen = useUIStore((s) => s.setCommandPaletteOpen);
  const fullPageMode = useUIStore((s) => s.fullPageMode);
  const pathname = usePathname();
  // Lens-as-Station: a lens opened inside the in-world station frame (?diegetic=1)
  // renders without the global sidebar/topbar chrome.
  const diegetic = useDiegetic();
  // World Lens's manual "hide HUD" toggle (H key) — see the hook doc
  // comment. No effect on any lens other than World.
  const worldHudHidden = useWorldHudHidden();
  const [mounted, setMounted] = useState(false);
  const [sessionSidebarOpen, setSessionSidebarOpen] = useState(false);
  const quickCapture = useQuickCapture();
  const router = useRouter();
  const {
    isOpen: onboardingOpen,
    complete: completeOnboarding,
    close: dismissOnboarding,
  } = useOnboarding();
  const activeSessionTitle = useSessionStore((s) => {
    const active = s.sessions.find((sess) => sess.id === s.activeSessionId);
    return active?.title || null;
  });

  // Gate the four lazily-mounted overlays (see useEverTrue above) on the
  // same conditions that already governed whether they rendered anything.
  const sessionSidebarEverOpened = useEverTrue(sessionSidebarOpen);
  const quickCaptureEverOpened = useEverTrue(quickCapture.isOpen);
  const onboardingEverNeeded = useEverTrue(onboardingOpen && pathname !== '/lenses/world');
  // NowPlayingBar renders null until a track is loaded — gate its mount the
  // same way so non-music sessions never pay for lucide icons + the
  // waveform/canvas visualizer code.
  const hasNowPlayingTrack = useMusicStore((s) => !!s.nowPlaying.track);
  const nowPlayingEverActive = useEverTrue(hasNowPlayingTrack);

  useEffect(() => {
    setMounted(true);

    // WebSocket is connected in Providers.tsx — no duplicate connectSocket() here.

    // Register service worker for PWA support
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // SW registration failed — offline caching won't work
      });
    }

    // Start auto-flush for offline queue
    import('@/lib/offline/offline-queue').then(({ startAutoFlush }) => {
      startAutoFlush();
    });

    // Initialize session store from IndexedDB
    useSessionStore.getState().init();
  }, []);

  // Warm the CommandPalette chunk once the browser is idle so Cmd/Ctrl+K
  // still feels instant even though it's now code-split out of the initial
  // bundle. requestIdleCallback runs after first paint/interaction settle;
  // the setTimeout fallback covers Safari (no rIC support as of writing).
  useEffect(() => {
    const warm = () => { import('@/components/common/CommandPalette'); };
    const w = window as unknown as {
      requestIdleCallback?: (cb: () => void) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(warm);
      return () => w.cancelIdleCallback?.(id);
    }
    const id = window.setTimeout(warm, 2000);
    return () => window.clearTimeout(id);
  }, []);

  // Post-OAuth age gate (18+). OAuth sign-ups land with no date of birth and
  // the callback redirects them to /onboarding/confirm-age, but a DOB-less user
  // who navigates straight to the app shell must still be sent back. One cheap
  // status check per shell mount: if the signed-in account owes a DOB, route to
  // the confirm step. Silent on 401 (unauthenticated) — that's the login flow's job.
  useEffect(() => {
    if (pathname?.startsWith('/onboarding/confirm-age')) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get('/api/auth/age-status');
        if (!cancelled && res.data?.ok && res.data?.needsDob) {
          router.push('/onboarding/confirm-age');
        }
      } catch {
        // 401 (not signed in) or network error — nothing to gate.
      }
    })();
    return () => { cancelled = true; };
  }, [pathname, router]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Mod+K is NOT handled here — CommandPalette.tsx owns that binding
      // (its own document-level listener toggles the same store value).
      // A second toggle handler racing on the same keydown event over a
      // shared external store can flip-then-flip-back within one keypress
      // (each handler reads a stale pre-render snapshot of `commandPaletteOpen`
      // while React's useSyncExternalStore forces a synchronous re-render
      // between them) — net result: the palette silently fails to open.
      if (e.key === 'Escape' && commandPaletteOpen) {
        setCommandPaletteOpen(false);
      }
      // Ctrl/Cmd+Shift+S: toggle session sidebar
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'S') {
        e.preventDefault();
        setSessionSidebarOpen((prev) => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [commandPaletteOpen, setCommandPaletteOpen]);

  if (!mounted) {
    // Keep children in the tree during hydration so first paint is the
    // page (not an empty main). Chrome waits until mounted.
    return (
      <div className="flex h-screen overflow-hidden bg-lattice-void">
        <main id="main-content" role="main" className="flex-1">{children}</main>
      </div>
    );
  }

  // Full page mode OR standalone route OR diegetic (in-world station) frame:
  // render children without shell chrome.
  const isStandalone = STANDALONE_PREFIXES.some((p) => pathname.startsWith(p));
  if (fullPageMode || isStandalone || diegetic) {
    return <>{children}</>;
  }

  return (
    <div className="flex h-screen overflow-hidden bg-lattice-void">
      <ConnectionStatus />
      {/*
        FE-013: Skip-to-content link for keyboard navigation.
        `focus:z-[100]` corresponds to Z_INDEX.SKIP_LINK in lib/ui/z-index.ts —
        the single documented stacking-order scale for every globally-mounted
        fixed-position component below (see that file for the full pair-by-
        pair collision writeup). Kept as a literal Tailwind class here (not an
        inline style) because it only applies on `:focus`, which inline styles
        can't express without a synthetic focus handler.
      */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-[100] focus:top-4 focus:left-4 focus:px-4 focus:py-2 focus:bg-neon-blue focus:text-white focus:rounded-lg focus:outline-none"
      >
        Skip to main content
      </a>

      <Sidebar />
      {sessionSidebarEverOpened && (
        <SessionSidebar isOpen={sessionSidebarOpen} onClose={() => setSessionSidebarOpen(false)} />
      )}

      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center">
          <Topbar />
          {/* Session toggle in topbar row */}
          <ThemeToggle />
          <button
            onClick={() => setSessionSidebarOpen(!sessionSidebarOpen)}
            className="flex-shrink-0 flex items-center gap-2 px-3 py-2 mr-2 rounded hover:bg-white/5 text-sm text-white/50 hover:text-white/80 transition-colors border-l border-white/10"
            title="Open sessions (Ctrl+Shift+S)"
          >
            <span className="text-xs leading-none">&#9776;</span>
            {activeSessionTitle && (
              <span className="hidden sm:inline truncate max-w-[160px] text-xs">
                {activeSessionTitle}
              </span>
            )}
          </button>
        </div>
        <OperatorErrorBanner />

        <main
          id="main-content"
          role="main"
          tabIndex={-1}
          className={`flex-1 overflow-auto transition-all duration-300 pb-16 md:pb-0 ${
            sidebarCollapsed ? 'lg:ml-16' : 'lg:ml-64'
          }`}
        >
          <LensErrorBoundary name="Main Content">{children}</LensErrorBoundary>
          {/* Phase P — shared legal footer. Lives outside the world
              lens (whose pathname-based exclusion happens above) and
              shows Terms / Privacy / DMCA. */}
          {pathname !== '/lenses/world' && <LegalFooter />}
        </main>
      </div>

      <CommandPalette />
      <Toasts />
      {!worldHudHidden && <SystemStatus />}
      <SystemGuidePanel />
      <FirstWinWizard />
      <HelpButton />
      {/* CK1 — ambient ConKay widget, top-right (the one corner not already
          claimed by SystemStatus/FirstWinWizard/CookieConsent bottom-left or
          HelpButton/SyncIndicator/InstallPrompt/ConKayOverlay's own summon
          button bottom-right — see ConKayWidgetLayer.tsx's position note). */}
      <ConKayWidgetLayer />
      {onboardingEverNeeded && (
        <OnboardingWizard
          // Don't hijack the world lens with the abstract platform tour — a new
          // player who just built their character landed here to PLAY. The
          // game's own FirstWinWizard (Cook → Eat → Fight → Commune) is the right
          // first-run surface in-world; the platform tour still appears the moment
          // they visit the dashboard or a workspace lens.
          isOpen={onboardingOpen && pathname !== '/lenses/world'}
          onClose={dismissOnboarding}
          onComplete={completeOnboarding}
          onAction={(action) => {
            const routes: Record<string, string> = {
              openChat: '/lenses/chat',
              openBoard: '/lenses/board',
              openGraph: '/lenses/graph',
              openCode: '/lenses/code',
              openStudio: '/lenses/studio',
            };
            if (routes[action]) router.push(routes[action]);
          }}
        />
      )}
      <OfflineBanner />
      <InstallPrompt />
      <SyncIndicator />
      <CookieConsent />
      {quickCaptureEverOpened && (
        <QuickCapture isOpen={quickCapture.isOpen} onClose={quickCapture.close} />
      )}
      {nowPlayingEverActive && <NowPlayingBar />}
      <MobileNav />
    </div>
  );
}
