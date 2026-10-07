import { beforeEach, describe, expect, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

const lensDataState: {
  items: unknown[];
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
} = { items: [], isLoading: false, isError: false, error: null };
const lensRun = vi.fn();
const persist = vi.fn();
const refetch = vi.fn();
const refetchQueries = vi.fn();
const useRunArtifactSpy = vi.fn();
let restoredState: Record<string, unknown> | null = null;

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useQueryClient: () => ({ refetchQueries }),
    useQuery: ({ queryFn }: { queryFn: () => Promise<unknown> }) => {
      void queryFn();
      return { data: [], refetch: queryFn };
    },
  };
});
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
}));
vi.mock('@/lib/lens-state-persistence', () => ({
  useLensStatePersistence: () => ({ restore: () => restoredState, persist, clear: vi.fn() }),
}));
vi.mock('@/lib/hooks/use-lens-data', () => ({
  useLensData: () => ({
    items: lensDataState.items,
    total: lensDataState.items.length,
    isLoading: lensDataState.isLoading,
    isError: lensDataState.isError,
    error: lensDataState.error,
    isSeeding: false,
    refetch,
    create: vi.fn(() => Promise.resolve({})),
    update: vi.fn(() => Promise.resolve({})),
    remove: vi.fn(() => Promise.resolve({})),
    createMut: { isPending: false },
    updateMut: { isPending: false },
    deleteMut: { isPending: false },
  }),
}));
vi.mock('@/lib/hooks/use-lens-artifacts', () => ({
  useRunArtifact: (domain: string) => {
    useRunArtifactSpy(domain);
    return { mutateAsync: vi.fn(), isPending: false };
  },
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { username: 'ramaj' } }) }));
vi.mock('@/hooks/useRealtimeLens', () => ({
  useRealtimeLens: () => ({ latestData: { event: 'consulting:update' }, isLive: true, lastUpdated: 1, insights: [] }),
}));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useLensIdentity', () => ({ useLensIdentity: () => {} }));
vi.mock('@/store/ui', () => ({ useUIStore: { getState: () => ({ addToast: vi.fn() }) } }));

vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/lens/LiveIndicator', () => ({ LiveIndicator: () => <div data-testid="live-indicator" /> }));
vi.mock('@/components/lens/DTUExportButton', () => ({ DTUExportButton: () => <button>Export DTU</button> }));
vi.mock('@/components/lens/RealtimeDataPanel', () => ({ RealtimeDataPanel: () => <div data-testid="realtime-panel" /> }));
vi.mock('@/components/lens/LensPageShell', () => ({
  LensPageShell: ({ children, isLoading, isError, error, onRetry }: {
    children: React.ReactNode;
    isLoading?: boolean;
    isError?: boolean;
    error?: { message?: string } | null;
    onRetry?: () => void;
  }) => {
    if (isLoading) return <div role="status" aria-busy="true">Loading consulting data...</div>;
    if (isError) return <div role="alert"><span>{error?.message || 'error'}</span><button onClick={onRetry}>Try again</button></div>;
    return <div>{children}</div>;
  },
}));

vi.mock('@/components/consulting/EngagementTracker', () => ({ EngagementTracker: () => <div data-testid="engagements-panel" /> }));
vi.mock('@/components/consulting/LiveTimer', () => ({ LiveTimer: () => <div data-testid="timer-panel" /> }));
vi.mock('@/components/consulting/InvoiceManager', () => ({ InvoiceManager: () => <div data-testid="invoices-panel" /> }));
vi.mock('@/components/consulting/ProposalBuilder', () => ({ ProposalBuilder: () => <div data-testid="proposals-panel" /> }));
vi.mock('@/components/consulting/StaffingPlanner', () => ({ StaffingPlanner: () => <div data-testid="staffing-panel" /> }));
vi.mock('@/components/consulting/ExpenseTracker', () => ({ ExpenseTracker: () => <div data-testid="expenses-panel" /> }));
vi.mock('@/components/consulting/RetainerManager', () => ({ RetainerManager: () => <div data-testid="retainers-panel" /> }));
vi.mock('@/components/consulting/ProfitabilityReport', () => ({ ProfitabilityReport: () => <div data-testid="profitability-panel" /> }));
vi.mock('@/components/consulting/ClientPortal', () => ({ ClientPortal: () => <div data-testid="portal-panel" /> }));
vi.mock('@/components/consulting/ConsultingCalculators', () => ({
  ConsultingCalculators: ({ tool }: { tool: string }) => <div data-testid={`calculator-${tool}`} />,
}));
vi.mock('@/components/consulting/ConsultingFirmReference', () => ({ ConsultingFirmReference: () => <div data-testid="firms-panel" /> }));

vi.mock('framer-motion', () => ({
  motion: new Proxy({}, { get: () => ({ children, ...props }: Record<string, unknown>) => <div {...props}>{children as React.ReactNode}</div> }),
  useReducedMotion: () => false,
}));
vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const make = (name: string) => {
    const Icon = (props: Record<string, unknown>) => <span data-testid={`icon-${name}`} {...props} />;
    return Icon;
  };
  return new Proxy(actual, {
    get: (target, prop: string) => (prop in target ? make(prop) : (target as Record<string, unknown>)[prop]),
  });
});

import ConsultingLens from '@/app/lenses/consulting/page';

const ENGAGEMENT_RECORD = {
  id: 'art_1',
  title: 'Strategy Refresh',
  data: { name: 'Strategy Refresh', type: 'Engagement', status: 'active', client: 'Acme' },
  meta: { tags: [], status: 'active', visibility: 'private' },
  createdAt: '2026-10-07',
  updatedAt: '2026-10-07',
  version: 1,
};

beforeEach(() => {
  restoredState = null;
  lensDataState.items = [];
  lensDataState.isLoading = false;
  lensDataState.isError = false;
  lensDataState.error = null;
  lensRun.mockReset();
  lensRun.mockResolvedValue({ data: { ok: true, result: { engagements: [] } } });
  persist.mockReset();
  refetch.mockReset();
  refetchQueries.mockReset();
  useRunArtifactSpy.mockReset();
});

describe('consulting lens — one Bonsai-style practice workspace', () => {
  it('opens on operational engagements with one grouped navigation rail', async () => {
    render(<ConsultingLens />);
    expect(screen.getByRole('heading', { name: 'Run the client work, Ramaj' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Consulting tools' })).toBeInTheDocument();
    expect(screen.getByTestId('engagements-panel')).toBeInTheDocument();
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('consulting', 'engagement-list', {}));
  });

  it('persists one selected tool and keeps realtime data in the explicit live feed', () => {
    render(<ConsultingLens />);
    fireEvent.click(screen.getByRole('button', { name: /Invoices/ }));
    expect(persist).toHaveBeenCalledWith({ tool: 'invoices' });
    expect(screen.getByTestId('invoices-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('realtime-panel')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Live feed/ }));
    expect(persist).toHaveBeenCalledWith({ tool: 'live' });
    expect(screen.getByText(/not a client activity collector/i)).toBeInTheDocument();
    expect(screen.getByTestId('realtime-panel')).toBeInTheDocument();
  });

  it('restores exactly one persisted tool after reload', () => {
    restoredState = { tool: 'staffing' };
    render(<ConsultingLens />);
    expect(screen.getByTestId('staffing-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('engagements-panel')).not.toBeInTheDocument();
  });

  it('keeps the real calculator macros and DTU record channel reachable once', () => {
    render(<ConsultingLens />);
    fireEvent.click(screen.getByRole('button', { name: /Fee & scope/ }));
    expect(screen.getByTestId('calculator-scope')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Engagement notes/ }));
    expect(useRunArtifactSpy).toHaveBeenCalledWith('consulting');
  });
});

describe('consulting DTU records — honest backend states', () => {
  function openRecords() {
    fireEvent.click(screen.getByRole('button', { name: /Engagement notes/ }));
  }

  it('shows loading while the record list is in flight', () => {
    lensDataState.isLoading = true;
    render(<ConsultingLens />);
    openRecords();
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
  });

  it('shows a retryable error instead of an empty success state', async () => {
    lensDataState.isError = true;
    lensDataState.error = new Error('practice records offline');
    render(<ConsultingLens />);
    openRecords();
    expect(screen.getByRole('alert')).toHaveTextContent('practice records offline');
    await act(async () => { fireEvent.click(screen.getByText('Try again')); });
    await waitFor(() => expect(refetch).toHaveBeenCalled());
  });

  it('renders the record returned by the real artifact channel', () => {
    lensDataState.items = [ENGAGEMENT_RECORD];
    render(<ConsultingLens />);
    openRecords();
    expect(screen.getAllByText('Strategy Refresh').length).toBeGreaterThan(0);
  });
});
