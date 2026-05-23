import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const runDomain = vi.fn();
vi.mock('@/lib/api/client', () => ({
  apiHelpers: { lens: { runDomain: (...a: unknown[]) => runDomain(...a) } },
}));

vi.mock('framer-motion', () => ({
  motion: {
    div: React.forwardRef(({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>, ref: React.Ref<HTMLDivElement>) =>
      React.createElement('div', { ...props, ref }, children)),
  },
}));

vi.mock('@/components/dtu/SaveAsDtuButton', () => ({
  SaveAsDtuButton: () => React.createElement('div', { 'data-testid': 'save-dtu' }),
}));

import { BillsList } from '@/components/government/BillsList';

const BILLS = [
  {
    billId: 'b1', congress: 119, type: 'HR', number: 1, title: 'Some Bill',
    introducedDate: '2026-01-01', latestAction: 'Referred', latestActionDate: '2026-02-01',
    originChamber: 'House', url: 'https://congress.gov/b1',
  },
  {
    billId: 'b2', type: 'S', number: 2, title: 'Another Bill',
  },
];

function wrap(node: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

describe('BillsList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the header and form', () => {
    wrap(<BillsList />);
    expect(screen.getByText('Congress.gov Bills')).toBeInTheDocument();
    expect(screen.getByText('Load recent bills')).toBeInTheDocument();
  });

  it('loads and renders bills on submit', async () => {
    runDomain.mockResolvedValue({ data: { ok: true, result: { bills: BILLS } } });
    wrap(<BillsList />);
    fireEvent.submit(screen.getByText('Load recent bills').closest('form')!);
    expect(await screen.findByText('Some Bill')).toBeInTheDocument();
    expect(screen.getByText('Another Bill')).toBeInTheDocument();
    expect(screen.getByText('HR1')).toBeInTheDocument();
    expect(screen.getByText(/Introduced 2026-01-01/)).toBeInTheDocument();
  });

  it('passes the topic filter to the macro', async () => {
    runDomain.mockResolvedValue({ data: { ok: true, result: { bills: [] } } });
    wrap(<BillsList />);
    fireEvent.change(screen.getByPlaceholderText('Topic filter (optional)'), { target: { value: 'energy' } });
    fireEvent.submit(screen.getByText('Load recent bills').closest('form')!);
    await waitFor(() =>
      expect(runDomain).toHaveBeenCalledWith('government', 'bills-list', { input: { topic: 'energy', limit: 25 } }),
    );
  });

  it('shows an error when the macro fails', async () => {
    runDomain.mockResolvedValue({ data: { ok: false, error: 'congress api down' } });
    wrap(<BillsList />);
    fireEvent.submit(screen.getByText('Load recent bills').closest('form')!);
    expect(await screen.findByText('congress api down')).toBeInTheDocument();
  });

  it('handles an empty response envelope', async () => {
    runDomain.mockResolvedValue({});
    wrap(<BillsList />);
    fireEvent.submit(screen.getByText('Load recent bills').closest('form')!);
    expect(await screen.findByText('empty response')).toBeInTheDocument();
  });

  it('unwraps a nested macro envelope', async () => {
    runDomain.mockResolvedValue({
      data: { ok: true, result: { ok: true, result: { bills: BILLS } } },
    });
    wrap(<BillsList />);
    fireEvent.submit(screen.getByText('Load recent bills').closest('form')!);
    expect(await screen.findByText('Some Bill')).toBeInTheDocument();
  });
});
