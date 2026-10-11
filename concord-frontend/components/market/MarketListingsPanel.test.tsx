/// <reference types="@testing-library/jest-dom/vitest" />
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const listings = vi.fn();
vi.mock('@/lib/api/client', () => ({
  apiHelpers: {
    marketplace: {
      listings: (...args: unknown[]) => listings(...args),
      submit: vi.fn(() => Promise.resolve({ data: { ok: true } })),
    },
    economy: {
      balance: () => Promise.resolve({ data: { balance: 0 } }),
    },
    durableMarketplace: {
      purchase: vi.fn(),
    },
  },
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));

import { MarketListingsPanel } from './MarketListingsPanel';

function renderPanel() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MarketListingsPanel />
    </QueryClientProvider>,
  );
}

describe('MarketListingsPanel empty state', () => {
  beforeEach(() => {
    listings.mockReset();
  });

  it('shows an honest empty state with one List a DTU call to action', async () => {
    listings.mockResolvedValue({ data: { listings: [] } });
    renderPanel();

    expect(await screen.findByText('No listings yet. List a DTU')).toBeInTheDocument();
    const ctas = screen.getAllByRole('button', { name: 'List a DTU' });
    expect(ctas).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /Create Listing/i })).not.toBeInTheDocument();
    expect(screen.queryByText('Anonymous')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Purchase' })).not.toBeInTheDocument();

    fireEvent.click(ctas[0]);
    expect(await screen.findByPlaceholderText('Title')).toBeInTheDocument();
  });

  it('treats a payload of only system listings as empty, not as Anonymous items for sale', async () => {
    listings.mockResolvedValue({
      data: {
        listings: [
          {
            id: 'seed-1',
            userId: 'system',
            title: 'DTU Validator Pro',
            description: 'Enterprise-grade DTU validation service',
            price: 29,
          },
        ],
      },
    });
    renderPanel();

    expect(await screen.findByText('No listings yet. List a DTU')).toBeInTheDocument();
    expect(screen.queryByText('DTU Validator Pro')).not.toBeInTheDocument();
    expect(screen.queryByText('Anonymous')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'List a DTU' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Purchase' })).not.toBeInTheDocument();
  });

  it('renders a real listing and keeps purchase available', async () => {
    listings.mockResolvedValue({
      data: {
        listings: [
          { id: 'real-1', userId: 'ada', seller: 'ada', title: 'Ada DTU', price: 4 },
        ],
      },
    });
    renderPanel();

    expect(await screen.findByText('Ada DTU')).toBeInTheDocument();
    expect(screen.getByText('ada')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Purchase' })).toBeInTheDocument();
    expect(screen.queryByText('No listings yet. List a DTU')).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Create Listing/i })).toBeInTheDocument();
    });
  });
});
