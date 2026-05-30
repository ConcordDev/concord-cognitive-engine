import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';

// Mock modules
const mockConnectSocket = vi.fn();
const mockDisconnectSocket = vi.fn();
vi.mock('@/lib/realtime/socket', () => ({
  connectSocket: () => mockConnectSocket(),
  disconnectSocket: () => mockDisconnectSocket(),
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

// AccessibilityDOMApplier mounts the OS prefers-reduced-motion watcher,
// which reads setOsReducedMotion off the real store. Providers' own
// behavior (socket/auth) is what's under test here, so stub it like the
// other heavy children above.
vi.mock('@/components/accessibility/AccessibilityDOMApplier', () => ({
  default: () => null,
}));

vi.mock('@/store/ui', () => ({
  useUIStore: Object.assign(
    () => ({ addToast: vi.fn() }),
    { getState: () => ({ addToast: vi.fn() }) }
  ),
}));

import { Providers } from '@/components/Providers';

describe('Providers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
