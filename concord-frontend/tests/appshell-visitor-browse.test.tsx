import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

// AppShell with the heavy chrome stubbed: this test is about what chrome a signed-out visitor gets.
// GB-1536 "Enter means Enter" (founder, 2026-11-14) retired the old chrome-free visitor frame: a
// guest (middleware x-concord-guest -> GuestProvider) now renders the NORMAL shell plus the guest
// banner, with the Topbar (Log in / Sign up) visible at every width. Read-only is enforced at the
// action layer (GuestGate / API backstop / server auth), not by hiding chrome. A member gets no
// banner, and the anon-browse flag alone no longer strips the shell.
const { stub } = vi.hoisted(() => ({ stub: (id: string) => () => <div data-testid={id} /> }));
vi.mock('next/navigation', () => ({ usePathname: () => '/lenses/music', useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock('next/dynamic', () => ({ default: () => () => null }));
vi.mock('lucide-react', () => ({ PanelRight: () => null }));
vi.mock('@/lib/full-height-lenses', () => ({ isFullHeightLens: () => false }));
vi.mock('@/components/shell/RailAccount', () => ({ TOGGLE_SESSIONS_EVENT: 'toggle-sessions' }));
vi.mock('@/components/shell/Sidebar', () => ({ Sidebar: stub('member-sidebar') }));
vi.mock('@/components/shell/Topbar', () => ({ Topbar: stub('member-topbar') }));
vi.mock('@/components/shell/MobileNav', () => ({ MobileNav: stub('mobile-nav') }));
vi.mock('@/components/shell/GuestBanner', () => ({ GuestBanner: stub('guest-banner') }));
vi.mock('@/components/common/Toasts', () => ({ Toasts: () => null }));
vi.mock('@/components/common/OperatorErrorBanner', () => ({ OperatorErrorBanner: () => null }));
vi.mock('@/components/common/SystemStatus', () => ({ SystemStatus: () => null }));
vi.mock('@/components/common/LensErrorBoundary', () => ({ LensErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/components/pwa/InstallPrompt', () => ({ InstallPrompt: () => null }));
vi.mock('@/lib/pwa/registration', () => ({ PWA_SERVICE_WORKER_SCOPE: '/', PWA_SERVICE_WORKER_URL: '/sw.js' }));
vi.mock('@/components/common/CookieConsent', () => ({ CookieConsent: () => null }));
vi.mock('@/components/common/ThemeToggle', () => ({ ThemeToggle: () => null }));
vi.mock('@/components/ui/OfflineBanner', () => ({ OfflineBanner: () => null }));
vi.mock('@/components/pwa/SyncIndicator', () => ({ default: () => null }));
vi.mock('@/components/common/ConnectionStatus', () => ({ ConnectionStatus: () => null }));
vi.mock('@/components/capture/useQuickCapture', () => ({ useQuickCapture: () => ({ open: false, setOpen: vi.fn() }) }));
vi.mock('@/hooks/useEverTrue', () => ({ useEverTrue: (v: boolean) => v }));
vi.mock('@/hooks/useDiegetic', () => ({ useDiegetic: () => false }));
vi.mock('@/hooks/useWorldHudHidden', () => ({ useWorldHudHidden: () => false }));
vi.mock('@/store/sessions', () => ({ useSessionStore: Object.assign(() => null, { getState: () => ({ init: vi.fn(), sessions: [] }) }) }));
vi.mock('@/lib/music/store', () => ({ useMusicStore: Object.assign(() => null, { getState: () => ({ currentTrack: null }), subscribe: () => () => {} }) }));
vi.mock('@/lib/event-router', () => ({ useEventRouter: () => {} }));
vi.mock('@/hooks/useSocialNotificationToast', () => ({ useSocialNotificationToast: () => {} }));
vi.mock('@/hooks/useChannelInboundToast', () => ({ useChannelInboundToast: () => {} }));
vi.mock('@/lib/api/client', () => ({ api: { get: vi.fn(async () => ({ data: {} })), post: vi.fn(async () => ({ data: {} })) } }));
vi.mock('@/store/ui', () => {
  const state = { sidebarCollapsed: false, commandPaletteOpen: false, setCommandPaletteOpen: vi.fn(), fullPageMode: false, installBannerFootprint: 0 };
  const useUIStore = Object.assign((sel: (s: typeof state) => unknown) => sel(state), { getState: () => state });
  return { useUIStore };
});

import { AppShell } from '@/components/shell/AppShell';
import { AnonBrowseProvider } from '@/lib/anon-browse';
import { GuestProvider } from '@/lib/guest';
import { isGuestMode } from '@/lib/guest-bridge';

afterEach(cleanup);

const topbarWrapperClass = () => screen.getByTestId('member-topbar').parentElement?.className ?? '';

describe('AppShell and the signed-out visitor flag', () => {
  it('guest on a browsable lens: normal shell + guest banner, Topbar at every width', () => {
    render(<GuestProvider value><AnonBrowseProvider value><AppShell><div data-testid="page">visitor page</div></AppShell></AnonBrowseProvider></GuestProvider>);
    expect(screen.getByTestId('page')).toBeTruthy();
    expect(screen.getByTestId('guest-banner')).toBeTruthy();
    expect(screen.getByTestId('member-sidebar')).toBeTruthy();
    expect(topbarWrapperClass()).not.toContain('lg:hidden');
    // The provider arms the API-layer guest backstop (read-only enforcement).
    expect(isGuestMode()).toBe(true);
  });

  it('a member on the very same path keeps the full shell with no guest banner', () => {
    render(<GuestProvider value={false}><AnonBrowseProvider value={false}><AppShell><div data-testid="page">member page</div></AppShell></AnonBrowseProvider></GuestProvider>);
    expect(screen.getByTestId('page')).toBeTruthy();
    expect(screen.getByTestId('member-sidebar')).toBeTruthy();
    expect(screen.queryByTestId('guest-banner')).toBeNull();
    expect(topbarWrapperClass()).toContain('lg:hidden');
    expect(isGuestMode()).toBe(false);
  });

  it('the anon-browse flag alone (no guest flag) neither strips the shell nor shows the guest banner', () => {
    render(<AnonBrowseProvider value><AppShell><div data-testid="page" /></AppShell></AnonBrowseProvider>);
    expect(screen.getByTestId('member-sidebar')).toBeTruthy();
    expect(screen.queryByTestId('guest-banner')).toBeNull();
  });

  it('without any provider the default is member chrome, no guest banner (fail closed)', () => {
    render(<AppShell><div data-testid="page" /></AppShell>);
    expect(screen.getByTestId('member-sidebar')).toBeTruthy();
    expect(screen.queryByTestId('guest-banner')).toBeNull();
  });
});
