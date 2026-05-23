import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { ListingsBrowser } from '@/components/realestate/ListingsBrowser';

const LISTINGS = [
  { id: 'l1', address: '1 Pine St', city: 'Austin', state: 'TX', zip: '78701', price: 450000, beds: 3, baths: 2, sqft: 1800, yearBuilt: 2010, kind: 'single_family', status: 'for_sale', daysOnMarket: 3 },
  { id: 'l2', address: '2 Oak Ave', city: 'Dallas', state: 'TX', zip: '75201', price: 700000, beds: 4, baths: 3, sqft: 2600, yearBuilt: 2005, kind: 'condo', status: 'pending', daysOnMarket: 40 },
];

function route(impl: (action: string) => unknown) {
  lensRun.mockImplementation((spec: { action: string }) => Promise.resolve(impl(spec.action)));
}

describe('ListingsBrowser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lensRun.mockResolvedValue({ data: { ok: true, result: { listings: [], ids: [] } } });
  });

  it('shows the empty state when no listings', async () => {
    render(<ListingsBrowser />);
    expect(await screen.findByText(/No listings/)).toBeInTheDocument();
  });

  it('renders listings with prices and days-on-market badge', async () => {
    route((action) => {
      if (action === 'favourites-list') return { data: { ok: true, result: { ids: ['l1'] } } };
      return { data: { ok: true, result: { listings: LISTINGS } } };
    });
    render(<ListingsBrowser />);
    expect(await screen.findByText('$450,000')).toBeInTheDocument();
    expect(screen.getByText('$700,000')).toBeInTheDocument();
    expect(screen.getByText('3d on mkt')).toBeInTheDocument();
    expect(screen.getByText('2 results')).toBeInTheDocument();
  });

  it('changes the sort order and re-fetches', async () => {
    route(() => ({ data: { ok: true, result: { listings: LISTINGS, ids: [] } } }));
    render(<ListingsBrowser />);
    await screen.findByText('$450,000');
    lensRun.mockClear();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'price_asc' } });
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'listings-list', input: { sortBy: 'price_asc' } }),
      ),
    );
  });

  it('opens filters, applies a min price, and switches to search', async () => {
    route((action) => {
      if (action === 'favourites-list') return { data: { ok: true, result: { ids: [] } } };
      return { data: { ok: true, result: { matches: LISTINGS } } };
    });
    render(<ListingsBrowser />);
    await screen.findByText('$450,000');
    fireEvent.click(screen.getByTitle('Filters'));
    fireEvent.change(screen.getByPlaceholderText('Min $'), { target: { value: '300000' } });
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'listings-search', input: { filters: { minPrice: 300000 } } }),
      ),
    );
    expect(screen.getByText('1')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Clear filters'));
  });

  it('opens the create form and adds a listing', async () => {
    route((action) => {
      if (action === 'listings-list' || action === 'listings-search') return { data: { ok: true, result: { listings: [] } } };
      if (action === 'favourites-list') return { data: { ok: true, result: { ids: [] } } };
      return { data: { ok: true } };
    });
    render(<ListingsBrowser />);
    await screen.findByText(/No listings/);
    fireEvent.click(screen.getByTitle('Add listing'));
    fireEvent.change(screen.getByPlaceholderText('Address'), { target: { value: '9 New Rd' } });
    fireEvent.change(screen.getByPlaceholderText('Price'), { target: { value: '525000' } });
    fireEvent.click(screen.getByText('Add'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'listings-add', input: expect.objectContaining({ address: '9 New Rd', price: 525000 }) }),
      ),
    );
  });

  it('does not add a listing without an address', async () => {
    render(<ListingsBrowser />);
    await screen.findByText(/No listings/);
    fireEvent.click(screen.getByTitle('Add listing'));
    lensRun.mockClear();
    fireEvent.click(screen.getByText('Add'));
    await waitFor(() => {
      expect(lensRun).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'listings-add' }));
    });
  });

  it('toggles a favourite and selects a listing', async () => {
    const onSelect = vi.fn();
    route((action) => {
      if (action === 'favourites-list') return { data: { ok: true, result: { ids: [] } } };
      if (action === 'favourites-toggle') return { data: { ok: true } };
      return { data: { ok: true, result: { listings: LISTINGS } } };
    });
    render(<ListingsBrowser onSelect={onSelect} />);
    await screen.findByText('$450,000');
    fireEvent.click(screen.getAllByLabelText('Favourite')[0]);
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(expect.objectContaining({ action: 'favourites-toggle', input: { id: 'l1' } })),
    );
    fireEvent.click(screen.getByText('1 Pine St'));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'l1' }));
  });

  it('removes a listing optimistically', async () => {
    route(() => ({ data: { ok: true, result: { listings: LISTINGS, ids: [] } } }));
    render(<ListingsBrowser />);
    await screen.findByText('1 Pine St');
    const rows = document.querySelectorAll('li');
    const delBtn = rows[0].querySelectorAll('button');
    fireEvent.click(delBtn[delBtn.length - 1]);
    await waitFor(() => expect(screen.queryByText('1 Pine St')).not.toBeInTheDocument());
  });

  it('renders compare picks and fires onPickForCompare', async () => {
    const onPick = vi.fn();
    route(() => ({ data: { ok: true, result: { listings: LISTINGS, ids: [] } } }));
    render(<ListingsBrowser onPickForCompare={onPick} comparePicks={['l2']} />);
    await screen.findByText('1 Pine St');
    expect(screen.getByText('✓')).toBeInTheDocument();
    fireEvent.click(screen.getAllByText('Compare')[0]);
    expect(onPick).toHaveBeenCalledWith('l1');
  });

  it('tolerates a fetch rejection', async () => {
    lensRun.mockRejectedValue(new Error('down'));
    render(<ListingsBrowser />);
    expect(await screen.findByText(/No listings/)).toBeInTheDocument();
  });
});
