import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';

// Providers now reads the route (shell-diet: gates the world-lens-only
// providers on it) — default to a non-world route so the world-lens-only
// dynamic() providers (SoundSystem/AdaptiveComplexity/HiddenAssistance/
// SecretsDiscovery) never even attempt to mount in this suite, matching
// their pre-existing "not exercised by this test file" scope.
let mockPathname = '/dashboard';
vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}));

// Mock modules
const mockConnectSocket = vi.fn();
const mockDisconnectSocket = vi.fn();
const mockReconnectSocket = vi.fn();
const mockSubscribe = vi.fn(() => () => {});
vi.mock('@/lib/realtime/socket', () => ({
  connectSocket: () => mockConnectSocket(),
  disconnectSocket: () => mockDisconnectSocket(),
  reconnectSocket: () => mockReconnectSocket(),
  subscribe: (...args: unknown[]) => mockSubscribe(...args),
}));

const mockApiGet = vi.fn();
vi.mock('@/lib/api/client', () => ({
  api: { get: (...args: unknown[]) => mockApiGet(...args) },
  default: { get: (...args: unknown[]) => mockApiGet(...args) },
}));

vi.mock('@/lib/perf', () => ({
  observeWebVitals: vi.fn(),
}));

vi.mock('@/components/shell/AppShell', () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div data-testid="app-shell">{children}</div>,
}));

vi.mock('@/components/common/PermissionGate', () => ({
  PermissionProvider: ({ children }: { children: React.ReactNode; scopes: string[] }) => (
    <div data-testid="permission-provider">{children}</div>
  ),
}));

vi.mock('@/components/common/ErrorBoundary', () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/providers/I18nProvider', () => ({
  I18nProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/media/GlobalMediaController', () => ({
  GlobalMediaController: () => null,
}));

// Selector-aware useUIStore mock. The real store composes the accessibility
// slice (setOsReducedMotion etc.); the prior mock ignored the selector arg and
// returned a flat { addToast }, so useAccessibilityWatcher's
// `useUIStore((s) => s.setOsReducedMotion)` got the whole object → "not a
// function". Apply the selector against a complete-enough state.
const mockSetUserRole = vi.fn();
const mockUiState = {
  addToast: vi.fn(),
  accessibility: { reducedMotion: false },
  osReducedMotion: false,
  setOsReducedMotion: vi.fn(),
  setAccessibility: vi.fn(),
  setAllAccessibility: vi.fn(),
  resetAccessibility: vi.fn(),
  userRole: 'user',
  setUserRole: mockSetUserRole,
};
vi.mock('@/store/ui', () => ({
  useUIStore: Object.assign(
    (selector?: (s: typeof mockUiState) => unknown) =>
      typeof selector === 'function' ? selector(mockUiState) : mockUiState,
    { getState: () => mockUiState, setState: vi.fn(), subscribe: vi.fn() }
  ),
}));

import { Providers } from '@/components/Providers';

describe('Providers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPathname = '/dashboard';
    mockApiGet.mockResolvedValue({ data: { scopes: ['read', 'write'] } });
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it('renders children inside provider tree', () => {
    const { getByText } = render(
      <Providers>
        <div>Test Child</div>
      </Providers>
    );
    expect(getByText('Test Child')).toBeInTheDocument();
  });

  it('wraps children in AppShell', () => {
    const { getByTestId } = render(
      <Providers>
        <div>Content</div>
      </Providers>
    );
    expect(getByTestId('app-shell')).toBeInTheDocument();
  });

  it('wraps children in PermissionProvider', () => {
    const { getByTestId } = render(
      <Providers>
        <div>Content</div>
      </Providers>
    );
    expect(getByTestId('permission-provider')).toBeInTheDocument();
  });

  it('connects socket when user is authenticated', async () => {
    (window.localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue('true');

    render(
      <Providers>
        <div>Content</div>
      </Providers>
    );

    await waitFor(() => {
      expect(mockConnectSocket).toHaveBeenCalled();
    });
  });

  it('does NOT connect socket when user is not authenticated', () => {
    (window.localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue(null);

    render(
      <Providers>
        <div>Content</div>
      </Providers>
    );

    expect(mockConnectSocket).not.toHaveBeenCalled();
  });

  it('fetches user scopes on mount when authenticated', async () => {
    (window.localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue('true');

    render(
      <Providers>
        <div>Content</div>
      </Providers>
    );

    await waitFor(() => {
      expect(mockApiGet).toHaveBeenCalledWith('/api/auth/me');
    });
  });

  // Stability audit (2026-07-20) — "make sure no one sees the sovereign
  // lenses" fix. The real `/api/auth/me` response shape
  // (server/routes/auth.js) is `{ ok, user: { id, role, scopes, ... } }`.
  // Reading `res.data?.scopes` (no `.user`) was a stale wrong-path bug
  // that always fell through to `[]`; separately, `useUIStore`'s
  // `userRole` had no real producer anywhere in the app. Both are fixed
  // in the same effect: real `scopes` now resolve from `user.scopes`, and
  // `setUserRole` is called with the real role for the first time.
  it('syncs the real role from /api/auth/me\'s user.role into useUIStore', async () => {
    (window.localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue('true');
    mockApiGet.mockResolvedValue({
      data: { ok: true, user: { id: 'u1', username: 'alice', role: 'admin', scopes: ['read'] } },
    });

    render(
      <Providers>
        <div>Content</div>
      </Providers>
    );

    await waitFor(() => {
      expect(mockSetUserRole).toHaveBeenCalledWith('admin');
    });
  });

  it('does not call setUserRole when auth/me has no user (unauthenticated shape)', async () => {
    (window.localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue('true');
    mockApiGet.mockResolvedValue({ data: { scopes: ['read', 'write'] } });

    render(
      <Providers>
        <div>Content</div>
      </Providers>
    );

    await waitFor(() => {
      expect(mockApiGet).toHaveBeenCalledWith('/api/auth/me');
    });
    expect(mockSetUserRole).not.toHaveBeenCalled();
  });

  it('does not call setUserRole when the auth/me request fails', async () => {
    (window.localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue('true');
    mockApiGet.mockRejectedValue(new Error('Unauthorized'));

    render(
      <Providers>
        <div>Content</div>
      </Providers>
    );

    await waitFor(() => {
      expect(mockApiGet).toHaveBeenCalledWith('/api/auth/me');
    });
    expect(mockSetUserRole).not.toHaveBeenCalled();
  });

  it('disconnects socket on unmount', async () => {
    (window.localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue('true');

    const { unmount } = render(
      <Providers>
        <div>Content</div>
      </Providers>
    );

    unmount();
    expect(mockDisconnectSocket).toHaveBeenCalled();
  });

  it('subscribes to system:reconnect and calls reconnectSocket when it fires (DET-C batch 8)', async () => {
    (window.localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue('true');

    render(
      <Providers>
        <div>Content</div>
      </Providers>
    );

    await waitFor(() => {
      expect(mockSubscribe).toHaveBeenCalledWith('system:reconnect', expect.any(Function));
    });

    const [, handler] = mockSubscribe.mock.calls.find((c) => c[0] === 'system:reconnect')!;
    (handler as () => void)();
    expect(mockReconnectSocket).toHaveBeenCalled();
  });

  it('unsubscribes from system:reconnect on unmount', async () => {
    (window.localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue('true');
    const offSpy = vi.fn();
    mockSubscribe.mockReturnValueOnce(offSpy);

    const { unmount } = render(
      <Providers>
        <div>Content</div>
      </Providers>
    );

    await waitFor(() => {
      expect(mockSubscribe).toHaveBeenCalledWith('system:reconnect', expect.any(Function));
    });

    unmount();
    expect(offSpy).toHaveBeenCalled();
  });

  it('handles failed auth/me gracefully', async () => {
    (window.localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue('true');
    mockApiGet.mockRejectedValue(new Error('Unauthorized'));

    // Should not throw
    render(
      <Providers>
        <div>Content</div>
      </Providers>
    );

    await waitFor(() => {
      expect(mockApiGet).toHaveBeenCalledWith('/api/auth/me');
    });
  });
});
