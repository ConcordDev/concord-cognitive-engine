'use client';

import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { CommandPalette } from '@/components/common/CommandPalette';
import { useUIStore } from '@/store/ui';
import { Toasts } from '@/components/common/Toasts';
import { OperatorErrorBanner } from '@/components/common/OperatorErrorBanner';
import { SystemStatus } from '@/components/common/SystemStatus';
import { SystemGuidePanel } from '@/components/guidance/SystemGuidePanel';
import { FirstWinWizard } from '@/components/guidance/FirstWinWizard';
import { LensErrorBoundary } from '@/components/common/LensErrorBoundary';
import { InstallPrompt } from '@/components/pwa/InstallPrompt';
import { CookieConsent } from '@/components/common/CookieConsent';
import { ThemeToggle } from '@/components/common/ThemeToggle';
import { OfflineFallback } from '@/components/pwa/OfflineFallback';
import SyncIndicator from '@/components/pwa/SyncIndicator';
import { ConnectionStatus } from '@/components/common/ConnectionStatus';
import { QuickCapture, useQuickCapture } from '@/components/capture/QuickCapture';
import { NowPlayingBar } from '@/components/music/NowPlayingBar';
import { MobileNav } from '@/components/shell/MobileNav';
import { SessionSidebar } from '@/components/chat/SessionSidebar';
import { OnboardingWizard, useOnboarding } from '@/components/onboarding/OnboardingWizard';
import { useRouter } from 'next/navigation';
import { useSessionStore } from '@/store/sessions';

/** Routes that render their own chrome and should skip the AppShell layout. */
const STANDALONE_PREFIXES = ['/legal/'];

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed);
  const commandPaletteOpen = useUIStore((s) => s.commandPaletteOpen);
  const setCommandPaletteOpen = useUIStore((s) => s.setCommandPaletteOpen);
  const fullPageMode = useUIStore((s) => s.fullPageMode);
  const pathname = usePathname();
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

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setCommandPaletteOpen(!commandPaletteOpen);
      }
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
    // Minimal shell during hydration to prevent CLS flash
    return (
      <div className="flex h-screen overflow-hidden bg-lattice-void">
        <main id="main-content" role="main" className="flex-1" />
      </div>
    );
  }

  // Full page mode OR standalone route: render children without shell chrome.
  const isStandalone = STANDALONE_PREFIXES.some((p) => pathname.startsWith(p));
  if (fullPageMode || isStandalone) {
    return <>{children}</>;
  }

  return (
    <div className="flex h-screen overflow-hidden bg-lattice-void">
      <ConnectionStatus />
      {/* FE-013: Skip-to-content link for keyboard navigation */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-[100] focus:top-4 focus:left-4 focus:px-4 focus:py-2 focus:bg-neon-blue focus:text-white focus:rounded-lg focus:outline-none"
      >
        Skip to main content
      </a>

      <Sidebar />
      <SessionSidebar isOpen={sessionSidebarOpen} onClose={() => setSessionSidebarOpen(false)} />

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
        </main>
      </div>

      <CommandPalette />
      <Toasts />
      <SystemStatus />
      <SystemGuidePanel />
      <FirstWinWizard />
      <OnboardingWizard
        isOpen={onboardingOpen}
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
      <OfflineFallback />
      <InstallPrompt />
      <SyncIndicator />
      <CookieConsent />
      <QuickCapture isOpen={quickCapture.isOpen} onClose={quickCapture.close} />
      <NowPlayingBar />
      <MobileNav />
    </div>
  );
}
