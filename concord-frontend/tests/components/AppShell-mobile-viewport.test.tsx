import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- next/navigation -------------------------------------------------------
const mockPush = vi.fn();
let mockPathname = '/lenses/chat';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  usePathname: () => mockPathname,
}));

// --- api client ------------------------------------------------------------
const mockApiGet = vi.fn();
vi.mock('@/lib/api/client', () => ({
  api: { get: (...args: unknown[]) => mockApiGet(...args) },
  default: { get: (...args: unknown[]) => mockApiGet(...args) },
}));

// --- offline queue (dynamic import in the mount effect) --------------------
const mockStartAutoFlush = vi.fn();
vi.mock('@/lib/offline/offline-queue', () => ({
  startAutoFlush: () => mockStartAutoFlush(),
}));

// --- hooks / event router --------------------------------------------------
const mockUseEventRouter = vi.fn();
vi.mock('@/lib/event-router', () => ({
  useEventRouter: () => mockUseEventRouter(),
}));

const mockUseSocialToast = vi.fn();
vi.mock('@/hooks/useSocialNotificationToast', () => ({
  useSocialNotificationToast: () => mockUseSocialToast(),
}));

const mockUseChannelInboundToast = vi.fn();
vi.mock('@/hooks/useChannelInboundToast', () => ({
  useChannelInboundToast: () => mockUseChannelInboundToast(),
}));

const mockUseDiegetic = vi.fn(() => false);
vi.mock('@/hooks/useDiegetic', () => ({
  useDiegetic: () => mockUseDiegetic(),
}));

const mockUseWorldHudHidden = vi.fn(() => false);
vi.mock('@/hooks/useWorldHudHidden', () => ({
  useWorldHudHidden: () => mockUseWorldHudHidden(),
}));

// --- ui store (selector-aware) --------------------------------------------
let mockUiState: Record<string, unknown>;
const setCommandPaletteOpen = vi.fn();
function resetUiState() {
  mockUiState = {
    sidebarCollapsed: false,
    commandPaletteOpen: false,
    setCommandPaletteOpen,
    fullPageMode: false,
  };
}
resetUiState();
vi.mock('@/store/ui', () => ({
  useUIStore: Object.assign(
    (selector?: (s: typeof mockUiState) => unknown) =>
      typeof selector === 'function' ? selector(mockUiState) : mockUiState,
    { getState: () => mockUiState, setState: vi.fn(), subscribe: vi.fn() }
  ),
}));

// --- session store (selector-aware + getState().init) ----------------------
const mockSessionInit = vi.fn();
const mockSessionState = {
  sessions: [{ id: 's1', title: 'My Session' }],
  activeSessionId: 's1',
  init: mockSessionInit,
};
vi.mock('@/store/sessions', () => ({
  useSessionStore: Object.assign(
    (selector?: (s: typeof mockSessionState) => unknown) =>
      typeof selector === 'function' ? selector(mockSessionState) : mockSessionState,
    { getState: () => mockSessionState, setState: vi.fn(), subscribe: vi.fn() }
  ),
}));

// --- onboarding / quick-capture ---------------------------------------------
const mockOnboarding = { isOpen: false, complete: vi.fn(), close: vi.fn() };
vi.mock('@/components/onboarding/useOnboarding', () => ({
  useOnboarding: () => mockOnboarding,
}));
vi.mock('@/components/onboarding/OnboardingWizard', () => ({
  OnboardingWizard: () => <div data-testid="onboarding-wizard" />,
}));

const mockQuickCapture = { isOpen: false, close: vi.fn() };
vi.mock('@/components/capture/useQuickCapture', () => ({
  useQuickCapture: () => mockQuickCapture,
}));
vi.mock('@/components/capture/QuickCapture', () => ({
  QuickCapture: () => <div data-testid="quick-capture" />,
}));

// --- music store ------------------------------------------------------------
vi.mock('@/lib/music/store', () => ({
  useMusicStore: (selector?: (s: { nowPlaying: { track: null } }) => unknown) => {
    const state = { nowPlaying: { track: null } };
    return typeof selector === 'function' ? selector(state) : state;
  },
}));

// --- trivial child-component stubs ----------------------------------------
vi.mock('./Sidebar', () => ({ Sidebar: () => <div data-testid="sidebar" /> }));
vi.mock('@/components/shell/Sidebar', () => ({ Sidebar: () => <div data-testid="sidebar" /> }));
vi.mock('./Topbar', () => ({ Topbar: ({ trailing }: { trailing?: React.ReactNode }) => <div data-testid="topbar">{trailing}</div> }));
vi.mock('@/components/shell/Topbar', () => ({ Topbar: ({ trailing }: { trailing?: React.ReactNode }) => <div data-testid="topbar">{trailing}</div> }));
vi.mock('@/components/common/CommandPalette', () => ({
  CommandPalette: () => <div data-testid="command-palette" />,
}));
vi.mock('@/components/common/Toasts', () => ({ Toasts: () => <div data-testid="toasts" /> }));
vi.mock('@/components/common/OperatorErrorBanner', () => ({
  OperatorErrorBanner: () => <div data-testid="operator-error-banner" />,
}));
vi.mock('@/components/common/SystemStatus', () => ({ SystemStatus: () => <div data-testid="system-status" /> }));
vi.mock('@/components/guidance/SystemGuidePanel', () => ({ SystemGuidePanel: () => <div /> }));
vi.mock('@/components/guidance/FirstWinWizard', () => ({ FirstWinWizard: () => <div /> }));
vi.mock('@/components/help/HelpButton', () => ({ HelpButton: () => <div /> }));
vi.mock('@/components/common/LensErrorBoundary', () => ({
  LensErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/pwa/InstallPrompt', () => ({ InstallPrompt: () => <div /> }));
vi.mock('@/components/common/CookieConsent', () => ({ CookieConsent: () => <div /> }));
vi.mock('@/components/common/ThemeToggle', () => ({ ThemeToggle: () => <div data-testid="theme-toggle" /> }));
vi.mock('@/components/pwa/OfflineFallback', () => ({ OfflineFallback: () => <div /> }));
vi.mock('@/components/pwa/SyncIndicator', () => ({ default: () => <div /> }));
vi.mock('@/components/common/ConnectionStatus', () => ({ ConnectionStatus: () => <div data-testid="connection-status" /> }));
vi.mock('@/components/music/NowPlayingBar', () => ({ NowPlayingBar: () => <div /> }));
vi.mock('@/components/shell/MobileNav', () => ({ MobileNav: () => <div data-testid="mobile-nav" /> }));
vi.mock('@/components/chat/SessionSidebar', () => ({
  SessionSidebar: ({ isOpen }: { isOpen: boolean }) => (
    <div data-testid="session-sidebar" data-open={isOpen ? 'true' : 'false'} />
  ),
}));
vi.mock('@/components/legal/LegalFooter', () => ({ LegalFooter: () => <div data-testid="legal-footer" /> }));
vi.mock('@/components/conkay/widget/ConKayWidgetLayer', () => ({ ConKayWidgetLayer: () => <div /> }));

import { AppShell } from '@/components/shell/AppShell';

describe('AppShell mobile viewport (INC-129)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPathname = '/lenses/chat';
    resetUiState();
    mockOnboarding.isOpen = false;
    mockApiGet.mockResolvedValue({ data: { ok: true, needsDob: false } });
  });

  it('uses app-viewport-h and not h-screen on the shell root', async () => {
    const { container } = render(
      <AppShell>
        <div>Chat body</div>
      </AppShell>
    );
    await waitFor(() => expect(container.querySelector('[data-testid="sidebar"]')).toBeInTheDocument());

    const root = container.firstElementChild as HTMLElement;
    expect(root.classList.contains('app-viewport-h')).toBe(true);
    expect(root.classList.contains('h-screen')).toBe(false);
  });

  it('uses mobile-nav-pad and not pb-16 on main#main-content', async () => {
    const { container } = render(
      <AppShell>
        <div>Chat body</div>
      </AppShell>
    );
    await waitFor(() => expect(container.querySelector('[data-testid="sidebar"]')).toBeInTheDocument());

    const main = container.querySelector('main#main-content') as HTMLElement;
    expect(main).toBeTruthy();
    expect(main.classList.contains('mobile-nav-pad')).toBe(true);
    expect(main.classList.contains('pb-16')).toBe(false);
  });

  it('globals.css defines .app-viewport-h with 100dvh and .mobile-nav-pad with safe-area inset', () => {
    const css = readFileSync(resolve(__dirname, '../../app/globals.css'), 'utf8');
    expect(css).toMatch(/\.app-viewport-h\s*\{[^}]*100dvh/s);
    expect(css).toMatch(/\.mobile-nav-pad\s*\{[^}]*env\(\s*safe-area-inset-bottom/s);
  });

  it('layout.tsx viewport sets interactiveWidget to resizes-content', () => {
    const source = readFileSync(resolve(__dirname, '../../app/layout.tsx'), 'utf8');
    expect(source).toContain("interactiveWidget: 'resizes-content'");
  });
});
