import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, fireEvent } from '@testing-library/react';

// --- next/navigation -------------------------------------------------------
const mockPush = vi.fn();
let mockPathname = '/lenses/dashboard';
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

// --- onboarding / quick-capture hooks (co-exported with components) --------
const mockOnboarding = { isOpen: false, complete: vi.fn(), close: vi.fn() };
vi.mock('@/components/onboarding/OnboardingWizard', () => ({
  OnboardingWizard: () => <div data-testid="onboarding-wizard" />,
  useOnboarding: () => mockOnboarding,
}));

const mockQuickCapture = { isOpen: false, close: vi.fn() };
vi.mock('@/components/capture/QuickCapture', () => ({
  QuickCapture: () => <div data-testid="quick-capture" />,
  useQuickCapture: () => mockQuickCapture,
}));

// --- trivial child-component stubs ----------------------------------------
vi.mock('./Sidebar', () => ({ Sidebar: () => <div data-testid="sidebar" /> }));
vi.mock('@/components/shell/Sidebar', () => ({ Sidebar: () => <div data-testid="sidebar" /> }));
vi.mock('./Topbar', () => ({ Topbar: () => <div data-testid="topbar" /> }));
vi.mock('@/components/shell/Topbar', () => ({ Topbar: () => <div data-testid="topbar" /> }));
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

import { AppShell } from '@/components/shell/AppShell';

describe('AppShell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPathname = '/lenses/dashboard';
    resetUiState();
    mockOnboarding.isOpen = false;
    mockApiGet.mockResolvedValue({ data: { ok: true, needsDob: false } });
  });

  it('renders full chrome once mounted', async () => {
    const { getByTestId, getByText } = render(<AppShell><div>Body</div></AppShell>);
    await waitFor(() => expect(getByTestId('sidebar')).toBeInTheDocument());
    expect(getByTestId('topbar')).toBeInTheDocument();
    expect(getByTestId('command-palette')).toBeInTheDocument();
    expect(getByTestId('connection-status')).toBeInTheDocument();
    expect(getByTestId('mobile-nav')).toBeInTheDocument();
    expect(getByText('Body')).toBeInTheDocument();
    // mount-effect side effects fired
    await waitFor(() => expect(mockSessionInit).toHaveBeenCalled());
    await waitFor(() => expect(mockStartAutoFlush).toHaveBeenCalled());
    expect(mockUseEventRouter).toHaveBeenCalled();
    expect(mockUseSocialToast).toHaveBeenCalled();
  });

  it('shows active session title in the session toggle', async () => {
    const { getByText } = render(<AppShell><div>Body</div></AppShell>);
    await waitFor(() => expect(getByText('My Session')).toBeInTheDocument());
  });

  it('age guard redirects when account owes a DOB', async () => {
    mockApiGet.mockResolvedValue({ data: { ok: true, needsDob: true } });
    render(<AppShell><div>Body</div></AppShell>);
    await waitFor(() => expect(mockApiGet).toHaveBeenCalledWith('/api/auth/age-status'));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/onboarding/confirm-age'));
  });

  it('age guard does NOT redirect when DOB already present', async () => {
    mockApiGet.mockResolvedValue({ data: { ok: true, needsDob: false } });
    render(<AppShell><div>Body</div></AppShell>);
    await waitFor(() => expect(mockApiGet).toHaveBeenCalledWith('/api/auth/age-status'));
    expect(mockPush).not.toHaveBeenCalledWith('/onboarding/confirm-age');
  });

  it('age guard is silent on api failure', async () => {
    mockApiGet.mockRejectedValue(new Error('401'));
    render(<AppShell><div>Body</div></AppShell>);
    await waitFor(() => expect(mockApiGet).toHaveBeenCalledWith('/api/auth/age-status'));
    expect(mockPush).not.toHaveBeenCalledWith('/onboarding/confirm-age');
  });

  it('skips the age check on the confirm-age route itself', async () => {
    mockPathname = '/onboarding/confirm-age';
    render(<AppShell><div>Body</div></AppShell>);
    // give effects a tick
    await waitFor(() => {});
    expect(mockApiGet).not.toHaveBeenCalledWith('/api/auth/age-status');
  });

  it('renders children only for standalone /legal routes', async () => {
    mockPathname = '/legal/terms';
    const { getByText, queryByTestId } = render(<AppShell><div>Legal Body</div></AppShell>);
    await waitFor(() => expect(getByText('Legal Body')).toBeInTheDocument());
    expect(queryByTestId('sidebar')).toBeNull();
    expect(queryByTestId('command-palette')).toBeNull();
  });

  it('renders children only in fullPageMode', async () => {
    mockUiState.fullPageMode = true;
    const { getByText, queryByTestId } = render(<AppShell><div>Full Body</div></AppShell>);
    await waitFor(() => expect(getByText('Full Body')).toBeInTheDocument());
    expect(queryByTestId('sidebar')).toBeNull();
  });

  it('omits the legal footer on the world lens', async () => {
    mockPathname = '/lenses/world';
    const { queryByTestId } = render(<AppShell><div>World</div></AppShell>);
    await waitFor(() => expect(queryByTestId('sidebar')).toBeInTheDocument());
    expect(queryByTestId('legal-footer')).toBeNull();
  });

  it('toggles the command palette on Cmd/Ctrl+K', async () => {
    const { getByTestId } = render(<AppShell><div>Body</div></AppShell>);
    await waitFor(() => expect(getByTestId('sidebar')).toBeInTheDocument());
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(setCommandPaletteOpen).toHaveBeenCalledWith(true);
  });

  it('closes the command palette on Escape when open', async () => {
    mockUiState.commandPaletteOpen = true;
    const { getByTestId } = render(<AppShell><div>Body</div></AppShell>);
    await waitFor(() => expect(getByTestId('sidebar')).toBeInTheDocument());
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(setCommandPaletteOpen).toHaveBeenCalledWith(false);
  });

  it('toggles the session sidebar via the topbar button', async () => {
    const { getByTitle, getByTestId } = render(<AppShell><div>Body</div></AppShell>);
    await waitFor(() => expect(getByTestId('sidebar')).toBeInTheDocument());
    expect(getByTestId('session-sidebar').getAttribute('data-open')).toBe('false');
    fireEvent.click(getByTitle('Open sessions (Ctrl+Shift+S)'));
    expect(getByTestId('session-sidebar').getAttribute('data-open')).toBe('true');
  });
});
