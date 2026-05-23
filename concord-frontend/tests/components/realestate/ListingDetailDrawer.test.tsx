import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { ListingDetailDrawer } from '@/components/realestate/ListingDetailDrawer';

const LISTING = {
  id: 'L1', address: '5 Pine Rd', city: 'Austin', state: 'TX', zip: '78704',
  price: 500000, beds: 3, baths: 2, sqft: 2000, yearBuilt: 2010,
  kind: 'single_family' as const, status: 'for_sale' as const, daysOnMarket: 3,
};
const FULL = {
  ...LISTING, lat: 30.1, lng: -97.7, description: 'A lovely home', lotSqft: 8000,
  priceHistory: [
    { date: '2026-01-01', price: 480000, kind: 'listed' },
    { date: '2026-03-01', price: 500000, kind: 'price_change' },
  ],
};

function route(impl: (action: string) => unknown) {
  lensRun.mockImplementation((spec: { action: string }) => Promise.resolve(impl(spec.action)));
}

describe('ListingDetailDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lensRun.mockResolvedValue({ data: { ok: true, result: {} } });
  });

  it('renders nothing when listing is null', () => {
    const { container } = render(<ListingDetailDrawer listing={null} onClose={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders detail with description, price history and a hot badge', async () => {
    route((action) => {
      if (action === 'listings-get') return { data: { ok: true, result: { listing: FULL } } };
      if (action === 'hot-score') return { data: { ok: true, result: { score: 80, tag: 'Hot', daysOnMarket: 3, tourCount: 5 } } };
      if (action === 'favourites-list') return { data: { ok: true, result: { ids: ['L1'] } } };
      return { data: { ok: true } };
    });
    render(<ListingDetailDrawer listing={LISTING} onClose={() => {}} />);
    expect(await screen.findByText('A lovely home')).toBeInTheDocument();
    expect(screen.getByText('Price history')).toBeInTheDocument();
    expect(screen.getByText(/Hot · 80/)).toBeInTheDocument();
    expect(screen.getByText('Saved')).toBeInTheDocument();
    expect(screen.getByText(/5 tours requested/)).toBeInTheDocument();
  });

  it('renders without a hot badge for low score and singular tour text', async () => {
    route((action) => {
      if (action === 'listings-get') return { data: { ok: true, result: { listing: FULL } } };
      if (action === 'hot-score') return { data: { ok: true, result: { score: 40, tag: 'Cool', daysOnMarket: 30, tourCount: 1 } } };
      if (action === 'favourites-list') return { data: { ok: true, result: { ids: [] } } };
      return { data: { ok: true } };
    });
    render(<ListingDetailDrawer listing={LISTING} onClose={() => {}} />);
    expect(await screen.findByText('Save home')).toBeInTheDocument();
    expect(screen.queryByText(/Cool · 40/)).not.toBeInTheDocument();
    expect(screen.getByText(/1 tour requested/)).toBeInTheDocument();
  });

  it('falls back to the passed listing when the full fetch returns nothing', async () => {
    route((action) => {
      if (action === 'listings-get') return { data: { ok: true, result: {} } };
      if (action === 'hot-score') return { data: { ok: true, result: null } };
      if (action === 'favourites-list') return { data: { ok: true, result: {} } };
      return { data: { ok: true } };
    });
    render(<ListingDetailDrawer listing={LISTING} onClose={() => {}} />);
    expect(await screen.findByText('5 Pine Rd')).toBeInTheDocument();
    expect(screen.queryByText('Price history')).not.toBeInTheDocument();
  });

  it('calls onClose when the overlay and the X are clicked', async () => {
    const onClose = vi.fn();
    route(() => ({ data: { ok: true, result: {} } }));
    const { container } = render(<ListingDetailDrawer listing={LISTING} onClose={onClose} />);
    await screen.findByText('5 Pine Rd');
    fireEvent.click(container.firstChild as Element);
    expect(onClose).toHaveBeenCalledTimes(1);
    const closeBtn = container.querySelector('header button')!;
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('does not close when clicking inside the aside', async () => {
    const onClose = vi.fn();
    route(() => ({ data: { ok: true, result: {} } }));
    render(<ListingDetailDrawer listing={LISTING} onClose={onClose} />);
    fireEvent.click(await screen.findByText('5 Pine Rd'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('toggles favourite and fires onRequestTour', async () => {
    const onRequestTour = vi.fn();
    route((action) => {
      if (action === 'listings-get') return { data: { ok: true, result: { listing: FULL } } };
      if (action === 'hot-score') return { data: { ok: true, result: { score: 50, tag: 'Mid', daysOnMarket: 10, tourCount: 2 } } };
      if (action === 'favourites-list') return { data: { ok: true, result: { ids: [] } } };
      if (action === 'favourites-toggle') return { data: { ok: true, result: { favourited: true } } };
      return { data: { ok: true } };
    });
    render(<ListingDetailDrawer listing={LISTING} onClose={() => {}} onRequestTour={onRequestTour} />);
    await screen.findByText('Save home');
    fireEvent.click(screen.getByText('Save home'));
    expect(await screen.findByText('Saved')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Tour this home'));
    expect(onRequestTour).toHaveBeenCalledWith('L1');
  });

  it('tolerates a rejected load', async () => {
    lensRun.mockRejectedValue(new Error('down'));
    render(<ListingDetailDrawer listing={LISTING} onClose={() => {}} />);
    expect(await screen.findByText('5 Pine Rd')).toBeInTheDocument();
  });

  it('tolerates a rejected favourite toggle', async () => {
    route((action) => {
      if (action === 'favourites-toggle') return Promise.reject(new Error('x'));
      if (action === 'listings-get') return { data: { ok: true, result: { listing: FULL } } };
      if (action === 'hot-score') return { data: { ok: true, result: null } };
      return { data: { ok: true, result: { ids: [] } } };
    });
    render(<ListingDetailDrawer listing={LISTING} onClose={() => {}} />);
    fireEvent.click(await screen.findByText('Save home'));
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith(expect.objectContaining({ action: 'favourites-toggle' })));
  });
});
