import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

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

// Mock the api client
vi.mock('@/lib/api/client', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
  apiHelpers: {
    economy: {
      connectStatus: vi.fn(),
      connectStripe: vi.fn(),
    },
  },
}));

// Mock design-system
vi.mock('@/lib/design-system', () => ({
  ds: {
    heading2: 'heading2-class',
    heading3: 'heading3-class',
    textMuted: 'text-muted-class',
    label: 'label-class',
    input: 'input-class',
    btnPrimary: 'btn-primary-class',
    btnSecondary: 'btn-secondary-class',
    btnBase: 'btn-base-class',
  },
}));

import { WithdrawFlow } from '@/components/wallet/WithdrawFlow';
import { api, apiHelpers } from '@/lib/api/client';

const mockedApi = api as unknown as {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
};

const mockedApiHelpers = apiHelpers as unknown as {
  economy: {
    connectStatus: ReturnType<typeof vi.fn>;
    connectStripe: ReturnType<typeof vi.fn>;
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
      children
    );
  };
}

describe('WithdrawFlow', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Connected user with completed onboarding
    mockedApiHelpers.economy.connectStatus.mockResolvedValue({
      data: { connected: true, stripeAccountId: 'acct_123', onboardingComplete: true },
    });

    // Balance
    mockedApi.get.mockImplementation((url: string) => {
      if (url.includes('balance')) {
        return Promise.resolve({ data: { balance: 1000 } });
      }
      if (url.includes('withdrawals')) {
        return Promise.resolve({ data: { withdrawals: [] } });
      }
      return Promise.resolve({ data: {} });
    });

    mockedApi.post.mockResolvedValue({ data: { ok: true } });
  });

  it('shows input step for connected users', async () => {
    render(<WithdrawFlow mode="inline" balance={1000} />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText(/withdraw cc/i)).toBeDefined();
    });
  });

  it('shows onboarding check for unconnected users', async () => {
    mockedApiHelpers.economy.connectStatus.mockResolvedValue({
      data: { connected: false, onboardingComplete: false },
    });

    render(<WithdrawFlow mode="inline" balance={1000} />, { wrapper: createWrapper() });

    await waitFor(() => {
      // The heading "Set Up Payouts" appears on the onboard step
      const matches = screen.getAllByText(/set up payouts/i);
      expect(matches.length).toBeGreaterThan(0);
    });
  });

  it('amount input with max button works', async () => {
    render(<WithdrawFlow mode="inline" balance={1000} />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText(/withdraw cc/i)).toBeDefined();
    });

    const maxButton = screen.getByRole('button', { name: /^MAX$/i });
    fireEvent.click(maxButton);

    const input = screen.getByPlaceholderText(/min/i) as HTMLInputElement;
    expect(parseInt(input.value)).toBeGreaterThan(0);
  });

  it('amount input only accepts digits', async () => {
    render(<WithdrawFlow mode="inline" balance={1000} />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText(/withdraw cc/i)).toBeDefined();
    });

    const input = screen.getByPlaceholderText(/min/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'abc123' } });
    expect(input.value).toBe('123');
  });

  it('fee preview calculation shows correctly', async () => {
    render(<WithdrawFlow mode="inline" balance={1000} />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText(/withdraw cc/i)).toBeDefined();
    });

    const input = screen.getByPlaceholderText(/min/i);
    fireEvent.change(input, { target: { value: '100' } });

    await waitFor(() => {
      // PLATFORM_FEE_PERCENT = 1.46 (matches the TOKEN_PURCHASE_FEE 0.0146
      // constitutional invariant) on 100 CC = 1.46 CC fee, net $98.54.
      // "1.46" appears twice (the fee % and the fee amount), so use
      // getAllByText rather than getByText to avoid a multiple-match throw.
      expect(screen.getByText(/platform fee/i)).toBeDefined();
      expect(screen.getAllByText(/1\.46/).length).toBeGreaterThanOrEqual(2);
      expect(screen.getByText(/98\.54/)).toBeDefined();
    });
  });

  it('confirmation step shows before submission', async () => {
    render(<WithdrawFlow mode="inline" balance={1000} />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText(/withdraw cc/i)).toBeDefined();
    });

    const input = screen.getByPlaceholderText(/min/i);
    fireEvent.change(input, { target: { value: '100' } });

    await waitFor(() => {
      const continueBtn = screen.getByText(/withdraw 100/i);
      fireEvent.click(continueBtn);
    });

    await waitFor(() => {
      // Both the heading and button contain "Confirm Withdrawal"
      const matches = screen.getAllByText(/confirm withdrawal/i);
      expect(matches.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('submit calls withdrawal API', async () => {
    render(<WithdrawFlow mode="inline" balance={1000} />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText(/withdraw cc/i)).toBeDefined();
    });

    const input = screen.getByPlaceholderText(/min/i);
    fireEvent.change(input, { target: { value: '100' } });

    await waitFor(() => {
      const continueBtn = screen.getByText(/withdraw 100/i);
      fireEvent.click(continueBtn);
    });

    await waitFor(() => {
      // Target the confirm button specifically (not the heading)
      const confirmBtn = screen.getByRole('button', { name: /confirm withdrawal/i });
      fireEvent.click(confirmBtn);
    });

    await waitFor(() => {
      expect(mockedApi.post).toHaveBeenCalledWith('/api/economy/withdraw', {
        amount: 100,
      });
    });
  });

  it('shows error on API failure', async () => {
    mockedApi.post.mockRejectedValue(new Error('Withdrawal failed'));

    render(<WithdrawFlow mode="inline" balance={1000} />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText(/withdraw cc/i)).toBeDefined();
    });

    const input = screen.getByPlaceholderText(/min/i);
    fireEvent.change(input, { target: { value: '100' } });

    await waitFor(() => {
      fireEvent.click(screen.getByText(/withdraw 100/i));
    });

    await waitFor(() => {
      // Target the confirm button specifically (not the heading)
      const confirmBtn = screen.getByRole('button', { name: /confirm withdrawal/i });
      fireEvent.click(confirmBtn);
    });

    await waitFor(() => {
      expect(screen.getByText('Withdrawal Failed')).toBeDefined();
    });
  });

  it('shows minimum withdrawal validation message', async () => {
    render(<WithdrawFlow mode="inline" balance={1000} />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText(/withdraw cc/i)).toBeDefined();
    });

    const input = screen.getByPlaceholderText(/min/i);
    fireEvent.change(input, { target: { value: '5' } });

    await waitFor(() => {
      expect(screen.getByText(/minimum withdrawal/i)).toBeDefined();
    });
  });

  it('displays available balance', async () => {
    render(<WithdrawFlow mode="inline" balance={1000} />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText(/1,000|1000/)).toBeDefined();
    });
  });

  it('shows connect onboarding button for unconnected users', async () => {
    mockedApiHelpers.economy.connectStatus.mockResolvedValue({
      data: { connected: false, onboardingComplete: false },
    });

    render(<WithdrawFlow mode="inline" balance={1000} />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText(/set up payouts with stripe/i)).toBeDefined();
    });
  });
});
