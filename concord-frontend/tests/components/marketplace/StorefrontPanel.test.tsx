import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { StorefrontPanel } from '@/components/marketplace/StorefrontPanel';

const LISTINGS = [
  {
    listingId: 'l1', sellerId: 's1', shopName: 'Aria Goods', number: 'L-1',
    title: 'Brass Ring', kind: 'physical_good', priceUsd: 12, currency: 'USD',
    description: 'Nice ring', tags: ['boho'], images: ['http://img/1.png'],
    stockQty: 5, shippingCostUsd: 2, avgRating: 4.5, reviewCount: 3,
    salesCount: 10, publishedAt: '2026-05-01',
  },
  {
    listingId: 'l2', sellerId: 's2', shopName: 'Bob Shop', number: 'L-2',
    title: 'Sticker Pack', kind: 'digital_download', priceUsd: 4, currency: 'USD',
    description: '', tags: [], images: [], stockQty: 0, shippingCostUsd: 0,
    avgRating: null, reviewCount: 0, salesCount: 0, publishedAt: null,
  },
];

const CART = {
  shops: [
    {
      sellerId: 's1', shopName: 'Aria Goods', subtotalUsd: 12, shippingUsd: 2,
      lines: [
        {
          id: 'cl1', listingId: 'l1', listingTitle: 'Brass Ring', listingKind: 'physical_good',
          variationId: '', variationLabel: 'Size L', qty: 1, unitPriceUsd: 12,
          shippingCostUsd: 2, image: '',
        },
      ],
    },
  ],
  itemCount: 1,
  grandTotalUsd: 14,
};

function browseMock(extra?: (action: string) => unknown) {
  lensRun.mockImplementation((d: string, a: string) => {
    if (a === 'storefront-browse')
      return Promise.resolve({
        data: { ok: true, result: { listings: LISTINGS, categories: ['physical_good', 'digital_download'] } },
      });
    if (a === 'cart-get')
      return Promise.resolve({ data: { ok: true, result: { shops: [], itemCount: 0, grandTotalUsd: 0 } } });
    const e = extra?.(a);
    if (e !== undefined) return Promise.resolve(e);
    return Promise.resolve({ data: { ok: true, result: {} } });
  });
}

describe('StorefrontPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lensRun.mockResolvedValue({ data: { ok: true, result: { listings: [], shops: [], itemCount: 0, grandTotalUsd: 0 } } });
  });

  it('shows empty catalog state', async () => {
    render(<StorefrontPanel />);
    expect(await screen.findByText('No published listings yet.')).toBeInTheDocument();
  });

  it('renders the catalog grid with ratings and sold-out branch', async () => {
    browseMock();
    render(<StorefrontPanel />);
    expect(await screen.findByText('Brass Ring')).toBeInTheDocument();
    expect(screen.getByText('Sticker Pack')).toBeInTheDocument();
    expect(screen.getByText(/★ 4.5/)).toBeInTheDocument();
    expect(screen.getByText('No reviews')).toBeInTheDocument();
    expect(screen.getByText('Sold out')).toBeInTheDocument();
    expect(screen.getByText(/10 sold/)).toBeInTheDocument();
  });

  it('changes search and re-fetches with the search input', async () => {
    browseMock();
    render(<StorefrontPanel />);
    await screen.findByText('Brass Ring');
    lensRun.mockClear();
    browseMock();
    fireEvent.change(screen.getByPlaceholderText('Search listings…'), {
      target: { value: 'ring' },
    });
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        'marketplace', 'storefront-browse', expect.objectContaining({ search: 'ring' }),
      ),
    );
  });

  it('changes category, sort and price filters', async () => {
    browseMock();
    render(<StorefrontPanel />);
    await screen.findByText('Brass Ring');
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'physical_good' } });
    fireEvent.change(screen.getAllByRole('combobox')[1], { target: { value: 'price_asc' } });
    fireEvent.change(screen.getByPlaceholderText('Min $'), { target: { value: '5' } });
    fireEvent.change(screen.getByPlaceholderText('Max $'), { target: { value: '50' } });
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        'marketplace', 'storefront-browse',
        expect.objectContaining({ sort: 'price_asc', minPrice: 5, maxPrice: 50 }),
      ),
    );
  });

  it('adds an item to cart', async () => {
    browseMock();
    render(<StorefrontPanel />);
    await screen.findByText('Brass Ring');
    fireEvent.click(screen.getByText('Add'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        'marketplace', 'cart-add',
        expect.objectContaining({ sellerId: 's1', listingId: 'l1', qty: 1 }),
      ),
    );
  });

  it('shows an error when cart-add returns ok:false', async () => {
    browseMock((a) =>
      a === 'cart-add' ? { data: { ok: false, error: 'out of stock' } } : undefined,
    );
    render(<StorefrontPanel />);
    await screen.findByText('Brass Ring');
    fireEvent.click(screen.getByText('Add'));
    expect(await screen.findByText('out of stock')).toBeInTheDocument();
  });

  it('opens the cart drawer and shows the empty cart', async () => {
    browseMock();
    render(<StorefrontPanel />);
    await screen.findByText('Brass Ring');
    fireEvent.click(screen.getByRole('button', { name: /Cart/ }));
    expect(await screen.findByText('Your cart is empty.')).toBeInTheDocument();
  });

  it('renders cart lines and updates / removes a line', async () => {
    lensRun.mockImplementation((d: string, a: string) => {
      if (a === 'storefront-browse')
        return Promise.resolve({ data: { ok: true, result: { listings: LISTINGS, categories: [] } } });
      if (a === 'cart-get')
        return Promise.resolve({ data: { ok: true, result: CART } });
      return Promise.resolve({ data: { ok: true, result: {} } });
    });
    render(<StorefrontPanel />);
    await screen.findByText('Brass Ring');
    fireEvent.click(screen.getByRole('button', { name: /Cart/ }));
    expect(await screen.findByText('Size L')).toBeInTheDocument();
    fireEvent.change(screen.getByDisplayValue('1'), { target: { value: '3' } });
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        'marketplace', 'cart-update', expect.objectContaining({ qty: 3 }),
      ),
    );
    fireEvent.click(screen.getByLabelText('Remove line'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        'marketplace', 'cart-update', expect.objectContaining({ remove: true }),
      ),
    );
  });

  it('places an order and shows the checkout confirmation', async () => {
    lensRun.mockImplementation((d: string, a: string) => {
      if (a === 'storefront-browse')
        return Promise.resolve({ data: { ok: true, result: { listings: LISTINGS, categories: [] } } });
      if (a === 'cart-get')
        return Promise.resolve({ data: { ok: true, result: CART } });
      if (a === 'checkout-create')
        return Promise.resolve({
          data: {
            ok: true,
            result: {
              number: 'CHK-1', grandTotalUsd: 14,
              orders: [{ orderId: 'o1', number: 'ORD-1', sellerId: 's1', totalUsd: 14 }],
            },
          },
        });
      return Promise.resolve({ data: { ok: true, result: {} } });
    });
    render(<StorefrontPanel />);
    await screen.findByText('Brass Ring');
    fireEvent.click(screen.getByRole('button', { name: /Cart/ }));
    await screen.findByText('Size L');
    fireEvent.change(screen.getByPlaceholderText('Your name'), { target: { value: 'Carol' } });
    fireEvent.click(screen.getByText('Place order'));
    expect(await screen.findByText(/Order CHK-1 placed/)).toBeInTheDocument();
    // continue shopping resets
    fireEvent.click(screen.getByText('Continue shopping'));
    await waitFor(() => expect(screen.queryByText(/Order CHK-1 placed/)).not.toBeInTheDocument());
  });

  it('shows an error when checkout returns ok:false', async () => {
    lensRun.mockImplementation((d: string, a: string) => {
      if (a === 'storefront-browse')
        return Promise.resolve({ data: { ok: true, result: { listings: LISTINGS, categories: [] } } });
      if (a === 'cart-get')
        return Promise.resolve({ data: { ok: true, result: CART } });
      if (a === 'checkout-create')
        return Promise.resolve({ data: { ok: false, error: 'payment failed' } });
      return Promise.resolve({ data: { ok: true, result: {} } });
    });
    render(<StorefrontPanel />);
    await screen.findByText('Brass Ring');
    fireEvent.click(screen.getByRole('button', { name: /Cart/ }));
    await screen.findByText('Size L');
    fireEvent.click(screen.getByText('Place order'));
    await waitFor(() =>
      expect(screen.getAllByText('payment failed').length).toBeGreaterThan(0),
    );
  });

  it('closes the cart drawer via the close button', async () => {
    browseMock();
    render(<StorefrontPanel />);
    await screen.findByText('Brass Ring');
    fireEvent.click(screen.getByRole('button', { name: /Cart/ }));
    await screen.findByText('Your cart is empty.');
    fireEvent.click(screen.getByLabelText('Close cart'));
    await waitFor(() => expect(screen.queryByText('Your cart is empty.')).not.toBeInTheDocument());
  });

  it('tolerates a browse rejection', async () => {
    lensRun.mockRejectedValue(new Error('down'));
    render(<StorefrontPanel />);
    expect(await screen.findByText('No published listings yet.')).toBeInTheDocument();
  });
});
