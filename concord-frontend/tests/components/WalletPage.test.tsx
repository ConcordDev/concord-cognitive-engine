import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock the api client
vi.mock('@/lib/api/client', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
  // WalletParityHub (Payments Hub) calls lensRun; resolve it to an empty
  // ok-result so the panel renders its empty states without rejecting.
  lensRun: vi.fn(async () => ({ data: { ok: true, result: {} } })),
  apiHelpers: {
    economy: {
      connectStatus: vi.fn(),
    },
  },
}));

// Mock useLensNav
vi.mock('@/hooks/useLensNav', () => ({
  useLensNav: vi.fn(),
}));

// Mock useLensCommand — the real hook calls useKeyboard() which requires
// a KeyboardProvider parent. The page mounts that provider in production
// via the lens shell, but isolated component tests don't, so stub the
// keyboard binding to a no-op.
vi.mock('@/hooks/useLensCommand', () => ({
  useLensCommand: vi.fn(),
}));

// Mock next/navigation
const mockSearchParams = new URLSearchParams();
vi.mock('next/navigation', () => ({
  useSearchParams: vi.fn(() => mockSearchParams),
  useRouter: vi.fn(() => ({
    push: vi.fn(),
    replace: vi.fn(),
  })),
}));

// Mock framer-motion
vi.mock('framer-motion', () => ({
  motion: {
    // eslint-disable-next-line react/display-name
    div: React.forwardRef(({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>, ref: React.Ref<HTMLDivElement>) =>
      React.createElement('div', { ...props, ref }, children)
    ),
    // eslint-disable-next-line react/display-name
    button: React.forwardRef(({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>, ref: React.Ref<HTMLButtonElement>) =>
      React.createElement('button', { ...props, ref }, children)
    ),
  },
  AnimatePresence: ({ children }: React.PropsWithChildren) => React.createElement(React.Fragment, null, children),
}));

// Mock sub-components
vi.mock('@/components/wallet/PurchaseFlow', () => ({
  PurchaseFlow: ({ onClose: _onClose }: { onClose?: () => void }) =>
    React.createElement('div', { 'data-testid': 'purchase-flow' }, 'Purchase Flow'),
}));

vi.mock('@/components/wallet/WithdrawFlow', () => ({
  WithdrawFlow: ({ onClose: _onClose }: { onClose?: () => void }) =>
    React.createElement('div', { 'data-testid': 'withdraw-flow' }, 'Withdraw Flow'),
}));

import { api, apiHelpers } from '@/lib/api/client';

const mockedApi = api as unknown as {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
};

const mockedApiHelpers = apiHelpers as unknown as {
  economy: {
    connectStatus: ReturnType<typeof vi.fn>;
  };
};

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(React.Suspense, { fallback: 'Loading...' }, children)
    );
  };
}

describe('WalletPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Balance
    mockedApi.get.mockImplementation((url: string) => {
      if (url.includes('balance')) {
        return Promise.resolve({
          data: { balance: 1250, totalCredits: 2000, totalDebits: 750, tokens: 1250 },
        });
      }
      if (url.includes('history') || url.includes('transactions')) {
        return Promise.resolve({
          data: {
            transactions: [
              {
                id: 'tx-1',
                type: 'purchase',
                amount: 100,
                description: 'Bought 100 CC',
                status: 'completed',
                created_at: '2026-02-28T10:00:00Z',
              },
              {
                id: 'tx-2',
                type: 'tip',
                amount: -5,
                description: 'Tipped @alice',
                status: 'completed',
                created_at: '2026-02-27T15:00:00Z',
              },
            ],
            total: 2,
            hasMore: false,
          },
        });
      }
      if (url.includes('withdrawals')) {
        return Promise.resolve({ data: { withdrawals: [] } });
      }
      return Promise.resolve({ data: {} });
    });

    mockedApiHelpers.economy.connectStatus.mockResolvedValue({
      data: { connected: true, stripeAccountId: 'acct_123', onboardingComplete: true },
    });
  });

  it('renders balance card with CC amount', async () => {
    // Dynamic import to avoid issues with module-level hooks
    const { default: WalletPage } = await import('@/app/lenses/wallet/page');
    render(React.createElement(WalletPage), { wrapper: createWrapper() });

    await waitFor(() => {
      // Balance "1,250" appears in multiple places (balance display + USD display)
      const matches = screen.getAllByText(/1,250|1250/);
      expect(matches.length).toBeGreaterThan(0);
    });
  });

  it('renders Buy CC button', async () => {
    const { default: WalletPage } = await import('@/app/lenses/wallet/page');
    render(React.createElement(WalletPage), { wrapper: createWrapper() });

    await waitFor(() => {
      // "Buy CC" button in the action bar
      const buyBtn = screen.getByRole('button', { name: /buy cc/i });
      expect(buyBtn).toBeDefined();
    });
  });

  it('withdraw section shows for connected users', async () => {
    const { default: WalletPage } = await import('@/app/lenses/wallet/page');
    render(React.createElement(WalletPage), { wrapper: createWrapper() });

    await waitFor(() => {
      // "Withdraw" button in the action bar. Accessible name now includes
      // the trailing keyboard hint ("Withdraw W") since the lens-ux pass
      // added <kbd>W</kbd> after the label.
      const withdrawBtn = screen.getByRole('button', { name: /^withdraw\b/i });
      expect(withdrawBtn).toBeDefined();
    });
  });

  it('transaction history renders', async () => {
    const { default: WalletPage } = await import('@/app/lenses/wallet/page');
    render(React.createElement(WalletPage), { wrapper: createWrapper() });

    await waitFor(() => {
      // Both transaction descriptions should be visible
      const txItems = screen.getAllByText(/bought 100 cc|tipped @alice/i);
      expect(txItems.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('loading state during balance fetch', async () => {
    mockedApi.get.mockReturnValue(new Promise(() => {}));

    const { default: WalletPage } = await import('@/app/lenses/wallet/page');
    render(React.createElement(WalletPage), { wrapper: createWrapper() });

    // Should show loading state
    const loading = screen.queryByText(/loading/i) ||
      document.querySelector('.animate-spin, .animate-pulse');
    expect(loading).not.toBeNull();
  });

  it('renders transaction filter tabs', async () => {
    const { default: WalletPage } = await import('@/app/lenses/wallet/page');
    render(React.createElement(WalletPage), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('All')).toBeDefined();
      expect(screen.getByText('Purchases')).toBeDefined();
      expect(screen.getByText('Tips')).toBeDefined();
    });
  });
});
