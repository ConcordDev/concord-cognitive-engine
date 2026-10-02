import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

// Mock next/navigation — the title derives from the pathname.
const mockPush = vi.fn();
const nav = vi.hoisted(() => ({ pathname: '/lenses/chat' }));
vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({
    push: mockPush,
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

// Mock lucide-react — use importOriginal to get all exports, then override with simple components
vi.mock('lucide-react', async (importOriginal) => {
  const React = await import('react');
  const actual = await importOriginal<Record<string, unknown>>();
  const makeMockIcon = (name: string) => {
    const Icon = React.forwardRef<SVGSVGElement, Record<string, unknown>>((props, ref) =>
      React.createElement('span', { 'data-testid': `icon-${name}`, ref, ...props })
    );
    Icon.displayName = name;
    return Icon;
  };
  const overrides: Record<string, unknown> = {};
  for (const key of Object.keys(actual)) {
    if (key[0] >= 'A' && key[0] <= 'Z' && key !== 'createLucideIcon' && key !== 'default') {
      overrides[key] = makeMockIcon(key);
    }
  }
  return { ...actual, ...overrides };
});

// Mock API client
vi.mock('@/lib/api/client', () => ({
  api: {
    get: vi.fn().mockResolvedValue({ data: {} }),
    post: vi.fn().mockResolvedValue({}),
  },
}));

// Mock socket
vi.mock('@/lib/realtime/socket', () => ({
  disconnectSocket: vi.fn(),
  connectSocket: vi.fn(),
  subscribe: vi.fn(() => vi.fn()),
}));

// Mock lens-registry
const MockLensIcon = ({ className }: { className?: string }) => <span data-testid="lens-icon" className={className}>L</span>;
vi.mock('@/lib/lens-registry', () => ({
  getLensById: (id: string) => {
    if (id === 'chat') return { name: 'Chat', icon: MockLensIcon };
    return null;
  },
}));

// Mock OfflineIndicator components
vi.mock('@/components/common/OfflineIndicator', () => ({
  SyncStatusDot: ({ status }: { status: string }) => <span data-testid="sync-dot">{status}</span>,
  useOnlineStatus: () => ({ isOnline: true, wasOffline: false }),
}));

// Mock UI store
const mockSetCommandPaletteOpen = vi.fn();
const mockSetSidebarOpen = vi.fn();
const mockUIStoreState: Record<string, unknown> = {
  sidebarCollapsed: false,
  setCommandPaletteOpen: mockSetCommandPaletteOpen,
  activeLens: 'chat',
  setSidebarOpen: mockSetSidebarOpen,
};

vi.mock('@/store/ui', () => ({
  useUIStore: (selector?: (s: Record<string, unknown>) => unknown) => {
    if (typeof selector === 'function') return selector(mockUIStoreState);
    return mockUIStoreState;
  },
}));

import { Topbar } from '@/components/shell/Topbar';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  Wrapper.displayName = 'TestWrapper';
  return Wrapper;
}

describe('Topbar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUIStoreState.sidebarCollapsed = false;
    mockUIStoreState.activeLens = 'chat';
    nav.pathname = '/lenses/chat';
  });

  it('renders the topbar with banner role', () => {
    render(<Topbar />, { wrapper: createWrapper() });
    expect(screen.getByRole('banner')).toBeInTheDocument();
  });

  it('displays the lens name from the registry for /lenses/<id>', () => {
    render(<Topbar />, { wrapper: createWrapper() });
    expect(screen.getByText('Chat')).toBeInTheDocument();
  });

  it('falls back to the capitalized slug when the lens is not in the registry', () => {
    nav.pathname = '/lenses/custom';
    render(<Topbar />, { wrapper: createWrapper() });
    expect(screen.getByText('Custom')).toBeInTheDocument();
  });

  it('shows "Dashboard" at the root', () => {
    nav.pathname = '/';
    render(<Topbar />, { wrapper: createWrapper() });
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
  });

  it('does not keep the last lens title on a non-lens page', () => {
    mockUIStoreState.activeLens = 'agriculture'; // stale store value
    nav.pathname = '/hub';
    render(<Topbar />, { wrapper: createWrapper() });
    expect(screen.getByText('Hub')).toBeInTheDocument();
    expect(screen.queryByText('Agriculture')).not.toBeInTheDocument();
  });

  it('opens command palette when search button is clicked', () => {
    render(<Topbar />, { wrapper: createWrapper() });
    const searchBtn = screen.getByLabelText('Open command palette');
    fireEvent.click(searchBtn);
    expect(mockSetCommandPaletteOpen).toHaveBeenCalledWith(true);
  });

  it('renders mobile menu button', () => {
    render(<Topbar />, { wrapper: createWrapper() });
    const menuBtn = screen.getByLabelText('Open navigation menu');
    expect(menuBtn).toBeInTheDocument();

    fireEvent.click(menuBtn);
    expect(mockSetSidebarOpen).toHaveBeenCalledWith(true);
  });

  it('renders user menu button', () => {
    render(<Topbar />, { wrapper: createWrapper() });
    const userMenuBtn = screen.getByLabelText('User menu');
    expect(userMenuBtn).toBeInTheDocument();
  });

  it('toggles user menu on click', () => {
    render(<Topbar />, { wrapper: createWrapper() });
    const userMenuBtn = screen.getByLabelText('User menu');

    fireEvent.click(userMenuBtn);
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getByText('System Health')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
    expect(screen.getByText('Sign Out')).toBeInTheDocument();
  });

  it('navigates to system health from user menu', () => {
    render(<Topbar />, { wrapper: createWrapper() });

    fireEvent.click(screen.getByLabelText('User menu'));
    fireEvent.click(screen.getByText('System Health'));

    expect(mockPush).toHaveBeenCalledWith('/lenses/resonance');
  });

  it('shows online status on the avatar indicator', () => {
    render(<Topbar />, { wrapper: createWrapper() });
    expect(screen.getByTitle('Online')).toBeInTheDocument();
  });

  it('renders trailing controls inside the header', () => {
    render(<Topbar trailing={<button>extra-control</button>} />, { wrapper: createWrapper() });
    expect(screen.getByRole('banner')).toContainElement(screen.getByText('extra-control'));
  });

  it('renders notification bell', () => {
    render(<Topbar />, { wrapper: createWrapper() });
    expect(screen.getByTestId('icon-Bell')).toBeInTheDocument();
  });

  it('closes user menu on Escape key', () => {
    render(<Topbar />, { wrapper: createWrapper() });

    fireEvent.click(screen.getByLabelText('User menu'));
    expect(screen.getByRole('menu')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('closes user menu on outside click', () => {
    render(<Topbar />, { wrapper: createWrapper() });

    fireEvent.click(screen.getByLabelText('User menu'));
    expect(screen.getByRole('menu')).toBeInTheDocument();

    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
