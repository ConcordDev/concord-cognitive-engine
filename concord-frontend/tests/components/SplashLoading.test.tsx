import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import SplashScreen from '@/components/SplashScreen';
import LoadingScreen from '@/components/LoadingScreen';

// Mocks below match the convention already established in
// tests/components/Providers.test.tsx — reused here to render the real
// <Providers> tree for the storage-resilience regression test at the bottom
// of this file (the splash-hide effect lives in Providers, not SplashScreen
// itself, so proving the fix requires exercising Providers).
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

const mockUiState = {
  addToast: vi.fn(),
  accessibility: { reducedMotion: false },
  osReducedMotion: false,
  setOsReducedMotion: vi.fn(),
  setAccessibility: vi.fn(),
  setAllAccessibility: vi.fn(),
  resetAccessibility: vi.fn(),
};
vi.mock('@/store/ui', () => ({
  useUIStore: Object.assign(
    (selector?: (s: typeof mockUiState) => unknown) =>
      typeof selector === 'function' ? selector(mockUiState) : mockUiState,
    { getState: () => mockUiState, setState: vi.fn(), subscribe: vi.fn() }
  ),
}));

import { Providers } from '@/components/Providers';

describe('SplashScreen', () => {
  it('renders nothing when not visible (after fade-out completes)', () => {
    const { container } = render(<SplashScreen visible={false} />);
    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it('renders the wordmark when visible', () => {
    render(<SplashScreen visible />);
    expect(screen.getByText('CONCORD')).toBeTruthy();
  });

  it('renders custom tagline', () => {
    render(<SplashScreen visible tagline="Custom system" />);
    expect(screen.getByText('Custom system')).toBeTruthy();
  });

  it('omits logo when showLogo=false', () => {
    const { container } = render(<SplashScreen visible showLogo={false} />);
    // Wordmark stays; mark <svg> gone.
    expect(container.querySelector('svg')).toBeNull();
    expect(screen.getByText('CONCORD')).toBeTruthy();
  });

  it('uses role="status" with aria-label', () => {
    render(<SplashScreen visible />);
    const node = screen.getByRole('status', { name: 'Loading Concord' });
    expect(node).toBeTruthy();
  });
});

describe('LoadingScreen', () => {
  it('renders nothing when not visible (after fade-out)', () => {
    const { container } = render(<LoadingScreen visible={false} />);
    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it('renders the label when visible', () => {
    render(<LoadingScreen visible label="World hydrating" />);
    expect(screen.getByText('World hydrating')).toBeTruthy();
  });

  it('renders detail line', () => {
    render(<LoadingScreen visible label="Loading" detail="terrain.json" />);
    expect(screen.getByText('terrain.json')).toBeTruthy();
  });

  it('indeterminate progress = -1 still renders bar', () => {
    const { container } = render(<LoadingScreen visible progress={-1} />);
    expect(container.querySelectorAll('div').length).toBeGreaterThan(2);
  });

  it('inline mode does not occupy fixed position overlay', () => {
    const { container } = render(<LoadingScreen visible inline />);
    const root = container.querySelector('[role="status"]') as HTMLElement | null;
    expect(root).not.toBeNull();
    if (root) {
      expect(root.style.position).not.toBe('fixed');
    }
  });

  it('clamps progress > 1 to indeterminate sweep', () => {
    // No assertion error — just verifies it doesn't crash.
    render(<LoadingScreen visible progress={5} />);
    expect(true).toBe(true);
  });
});

// Regression test for a real production bug: Providers.tsx used to call
// `sessionStorage.getItem('concord_splash_seen')` unguarded inside a
// useEffect. Safari private-mode / storage-blocking browser policies throw
// SecurityError on that access instead of returning null. The throw
// happened before setSplashVisible(false) could ever run or the hide
// setTimeout could be scheduled, and nothing catches it — <ErrorBoundary>
// in Providers.tsx only wraps the returned JSX, not Providers' own effects,
// so the branded splash screen stayed on screen forever. The fix routes
// storage access through lib/safe-storage.ts's safeGetItem/safeSetItem.
describe('Providers splash-visibility resilience (storage failure regression)', () => {
  let getItemSpy: ReturnType<typeof vi.spyOn> | undefined;
  let setItemSpy: ReturnType<typeof vi.spyOn> | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    mockApiGet.mockResolvedValue({ data: { scopes: [] } });
    vi.useFakeTimers();
  });

  afterEach(() => {
    act(() => {
      vi.runOnlyPendingTimers();
    });
    vi.useRealTimers();
    // Restore ONLY the two sessionStorage spies (not vi.restoreAllMocks() —
    // that would also mockRestore() the plain vi.fn() matchMedia mock set up
    // in tests/setup.ts, which has no "original" to restore to and would
    // wipe its implementation for every subsequent test in this file).
    getItemSpy?.mockRestore();
    setItemSpy?.mockRestore();
    getItemSpy = undefined;
    setItemSpy = undefined;
    window.localStorage.clear();
  });

  it('still hides the splash screen after the timeout when sessionStorage.getItem throws', () => {
    getItemSpy = vi.spyOn(window.sessionStorage, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    setItemSpy = vi.spyOn(window.sessionStorage, 'setItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });

    render(
      <Providers>
        <div>App content</div>
      </Providers>
    );

    // Splash is up immediately on mount.
    expect(screen.getByRole('status', { name: 'Loading Concord' })).toBeTruthy();

    // Advance past the 1400ms auto-hide delay first, in its own act() so
    // React commits the resulting setSplashVisible(false) and SplashScreen's
    // own effect (which reacts to the now-false `visible` prop by scheduling
    // its 620ms fade-out-then-unmount timer) actually runs before the next
    // advance — a single combined advanceTimersByTime call can fire both
    // timers before React gets a chance to render between them, so the
    // second (dependent) timer never gets scheduled in time. No real-timer
    // `waitFor` polling here either — that hangs forever under fake timers
    // since testing-library's poll interval is itself faked and never ticks
    // on its own.
    //
    // Pre-fix, the sessionStorage throw happened synchronously in the
    // effect body — splashVisible would never flip to false, and the splash
    // would still be present here forever.
    act(() => {
      vi.advanceTimersByTime(1450);
    });
    act(() => {
      vi.advanceTimersByTime(700);
    });

    expect(screen.queryByRole('status', { name: 'Loading Concord' })).toBeNull();
  });

  it('hides the splash screen normally when storage access succeeds (happy path unaffected)', () => {
    render(
      <Providers>
        <div>App content</div>
      </Providers>
    );

    expect(screen.getByRole('status', { name: 'Loading Concord' })).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(1450);
    });
    act(() => {
      vi.advanceTimersByTime(700);
    });

    expect(screen.queryByRole('status', { name: 'Loading Concord' })).toBeNull();
  });
});
