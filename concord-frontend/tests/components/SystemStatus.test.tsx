import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Mock lucide-react
vi.mock('lucide-react', () => ({
  Wifi: ({ className }: { className?: string }) => <span data-testid="wifi-icon" className={className} />,
  WifiOff: ({ className }: { className?: string }) => <span data-testid="wifi-off-icon" className={className} />,
  Shield: ({ className }: { className?: string }) => <span data-testid="shield-icon" className={className} />,
  AlertTriangle: ({ className }: { className?: string }) => <span data-testid="alert-icon" className={className} />,
  ChevronDown: ({ className }: { className?: string }) => <span data-testid="chevron-down" className={className} />,
  ChevronUp: ({ className }: { className?: string }) => <span data-testid="chevron-up" className={className} />,
}));

vi.mock('@/lib/utils', () => ({
  cn: (...args: (string | boolean | undefined | null)[]) => args.filter(Boolean).join(' '),
}));

// Mock API client
vi.mock('@/lib/api/client', () => ({
  api: {
    get: vi.fn().mockResolvedValue({ data: { ok: true, version: '5.0.0' } }),
  },
}));

// Control useQuery return value
const mockQueryReturn = {
  data: { ok: true, version: '5.0.0', infrastructure: { auth: { mode: 'jwt' } } } as Record<string, unknown>,
  isError: false,
  error: null as unknown,
};

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => mockQueryReturn,
}));

// Mock UI store
const mockClearRequestErrors = vi.fn();
const mockUIStoreState = {
  requestErrors: [] as unknown[],
  clearRequestErrors: mockClearRequestErrors,
  authPosture: { mode: 'jwt', usesJwt: true, usesApiKey: false },
};

vi.mock('@/store/ui', () => ({
  useUIStore: (selector: (s: Record<string, unknown>) => unknown) => selector(mockUIStoreState as unknown as Record<string, unknown>),
}));

// SystemStatus now reads its refetch cadence from useClientConfig() (shell-
// diet: server-tunable poll interval, /api/config/client). Mocked to the
// hook's own baked defaults per the tests/link-shell.test.tsx precedent, so
// this suite doesn't also exercise the hook's own async config fetch.
vi.mock('@/hooks/useClientConfig', () => ({
  useClientConfig: () => ({ poll: { systemStatusMs: 30000, connectionStatusMs: 20000 } }),
}));

import { SystemStatus } from '@/components/common/SystemStatus';

describe('SystemStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUIStoreState.requestErrors = [];
    mockQueryReturn.data = { ok: true, version: '5.0.0', infrastructure: { auth: { mode: 'jwt' } } };
    mockQueryReturn.isError = false;
    mockQueryReturn.error = null;
  });

  it('renders the "System OK" button when healthy and no errors', () => {
    render(<SystemStatus />);
    expect(screen.getByText('System OK')).toBeInTheDocument();
  });

  it('expands on click of System OK button', () => {
    render(<SystemStatus />);

    const okButton = screen.getByText('System OK');
    fireEvent.click(okButton);

    expect(screen.getByText('System Status')).toBeInTheDocument();
  });

  it('shows expanded panel with auth mode info', () => {
    render(<SystemStatus />);

    // Click to expand
    fireEvent.click(screen.getByText('System OK'));

    // Should show auth mode
    expect(screen.getByText('Auth Mode:')).toBeInTheDocument();
    expect(screen.getByText('jwt')).toBeInTheDocument();
  });

  it('shows version in expanded view', () => {
    render(<SystemStatus />);

    fireEvent.click(screen.getByText('System OK'));

    expect(screen.getByText('Version:')).toBeInTheDocument();
    expect(screen.getByText('5.0.0')).toBeInTheDocument();
  });

  it('shows backend connected in expanded view', () => {
    render(<SystemStatus />);

    fireEvent.click(screen.getByText('System OK'));

    expect(screen.getByText('Backend:')).toBeInTheDocument();
    expect(screen.getByText('Connected')).toBeInTheDocument();
  });

  it('shows "Backend Unreachable" when backend is down', () => {
    mockQueryReturn.data = null as unknown;
    mockQueryReturn.isError = true;
    mockQueryReturn.error = new Error('Network error');

    render(<SystemStatus />);

    expect(screen.getByText('Backend Unreachable')).toBeInTheDocument();
  });

  it('shows error count badge when there are errors', () => {
    mockUIStoreState.requestErrors = [
      { id: 'err-1', at: new Date().toISOString(), message: 'Error 1', status: 500, method: 'GET', path: '/api/test', reason: 'Server error' },
    ];

    render(<SystemStatus />);

    // With errors the full panel should show, and the badge count
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('shows recent errors in expanded view', () => {
    mockUIStoreState.requestErrors = [
      { id: 'err-1', at: new Date().toISOString(), message: 'Bad request', status: 400, method: 'POST', path: '/api/dtus', reason: 'Invalid payload' },
    ];

    render(<SystemStatus />);

    // Click to expand
    const header = screen.getByText('System Status');
    fireEvent.click(header.closest('button')!);

    expect(screen.getByText('Recent Errors')).toBeInTheDocument();
    expect(screen.getByText('400')).toBeInTheDocument();
    expect(screen.getByText('Invalid payload')).toBeInTheDocument();
  });

  it('clears errors when Clear button is clicked', () => {
    mockUIStoreState.requestErrors = [
      { id: 'err-1', at: new Date().toISOString(), message: 'Error', status: 500, method: 'GET', path: '/test', reason: 'fail' },
    ];

    render(<SystemStatus />);

    // Expand
    const header = screen.getByText('System Status');
    fireEvent.click(header.closest('button')!);

    const clearBtn = screen.getByText('Clear');
    fireEvent.click(clearBtn);

    expect(mockClearRequestErrors).toHaveBeenCalled();
  });

  it('collapses when Collapse button is clicked', () => {
    render(<SystemStatus />);

    // Expand first
    fireEvent.click(screen.getByText('System OK'));
    expect(screen.getByText('Collapse')).toBeInTheDocument();

    // Collapse
    fireEvent.click(screen.getByText('Collapse'));
    expect(screen.queryByText('Collapse')).not.toBeInTheDocument();
  });

  it('shows error message when backend is unreachable and expanded', () => {
    mockQueryReturn.data = null as unknown;
    mockQueryReturn.isError = true;
    mockQueryReturn.error = new Error('Connection refused');

    render(<SystemStatus />);

    // Click to expand
    const header = screen.getByText('Backend Unreachable');
    fireEvent.click(header.closest('button')!);

    expect(screen.getByText('Connection refused')).toBeInTheDocument();
  });
});
