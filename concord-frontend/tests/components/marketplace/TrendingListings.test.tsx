import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

vi.mock('@/components/dtu/SaveAsDtuButton', () => ({
  SaveAsDtuButton: ({ title }: { title: string }) =>
    React.createElement('button', { 'data-testid': 'save-dtu' }, title),
}));

import { TrendingListings } from '@/components/marketplace/TrendingListings';

const ITEMS = [
  { id: 't1', title: 'Frost Pack', kind: 'music_track', citation_count: 12, creator_id: 'creator-abcdef12', tags: ['frost', 'combat'] },
  { id: 't2', title: 'Twilight', kind: 'preset', citation_count: 4, tags: [] },
];

function renderWithClient(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe('TrendingListings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lensRun.mockResolvedValue({ data: { ok: true, result: [] } });
  });

  it('renders the header and empty state', async () => {
    renderWithClient(<TrendingListings />);
    expect(screen.getByText('Trending in marketplace')).toBeInTheDocument();
    expect(await screen.findByText(/No trending in this window/)).toBeInTheDocument();
  });

  it('renders trending items and computes total citations', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: ITEMS } });
    renderWithClient(<TrendingListings />);
    expect(await screen.findByText('Frost Pack')).toBeInTheDocument();
    expect(screen.getByText('Twilight')).toBeInTheDocument();
    expect(screen.getByText('12 cites')).toBeInTheDocument();
    // total citations 16
    expect(screen.getByText('16')).toBeInTheDocument();
    expect(screen.getByTestId('save-dtu')).toBeInTheDocument();
    // creator chip truncates
    expect(screen.getByText(/by creator-/)).toBeInTheDocument();
  });

  it('handles result wrapped in an items object', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { items: ITEMS } } });
    renderWithClient(<TrendingListings />);
    expect(await screen.findByText('Frost Pack')).toBeInTheDocument();
  });

  it('changes the time window and re-fetches', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: ITEMS } });
    renderWithClient(<TrendingListings />);
    await screen.findByText('Frost Pack');
    lensRun.mockClear();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '24' } });
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'trending', input: expect.objectContaining({ windowHours: 24 }) }),
      ),
    );
  });

  it('shows the error banner when the query fails', async () => {
    lensRun.mockRejectedValue(new Error('discovery down'));
    renderWithClient(<TrendingListings />);
    expect(await screen.findByText(/discovery.trending unreachable/)).toBeInTheDocument();
  });
});
