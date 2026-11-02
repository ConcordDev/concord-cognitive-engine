import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

// AppShell with the heavy chrome stubbed: this test is only about WHEN the member chrome is
// withheld. A signed-out visitor on Music/Market (middleware flag -> AnonBrowseProvider) gets the
// children alone, exactly like /explore; a member (no flag) on the same path keeps the full shell.
const { stub } = vi.hoisted(() => ({ stub: (id: string) => () => <div data-testid={id} /> }));
vi.mock('next/navigation', () => ({ usePathname: () => '/lenses/music', useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock('next/dynamic', () => ({ default: () => () => null }));
vi.mock('lucide-react', () => ({ PanelRight: () => null }));
vi.mock('@/lib/full-height-lenses', () => ({ isFullHeightLens: () => false }));
vi.mock('@/components/shell/RailAccount', () => ({ TOGGLE_SESSIONS_EVENT: 'toggle-sessions' }));
vi.mock('@/components/shell/Sidebar', () => ({ Sidebar: stub('member-sidebar') }));
vi.mock('@/components/shell/Topbar', () => ({ Topbar: stub('member-topbar') }));
vi.mock('@/components/shell/MobileNav', () => ({ MobileNav: stub('mobile-nav') }));
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

afterEach(cleanup);

describe('AppShell and the signed-out visitor flag', () => {
  it('visitor on a browsable lens: children only, no member sidebar/topbar', () => {
    render(<AnonBrowseProvider value><AppShell><div data-testid="page">visitor page</div></AppShell></AnonBrowseProvider>);
    expect(screen.getByTestId('page')).toBeTruthy();
    expect(screen.queryByTestId('member-sidebar')).toBeNull();
    expect(screen.queryByTestId('member-topbar')).toBeNull();
  });

  it('a member on the very same path keeps the full shell (no flag)', () => {
    render(<AnonBrowseProvider value={false}><AppShell><div data-testid="page">member page</div></AppShell></AnonBrowseProvider>);
    expect(screen.getByTestId('page')).toBeTruthy();
    expect(screen.getByTestId('member-sidebar')).toBeTruthy();
  });

  it('without any provider the default is member chrome (fail closed to today\'s behaviour)', () => {
    render(<AppShell><div data-testid="page" /></AppShell>);
    expect(screen.getByTestId('member-sidebar')).toBeTruthy();
  });
});
