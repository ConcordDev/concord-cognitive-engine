/**
 * StorefrontPanel — public cross-seller browse (the Etsy-shape marketplace's
 * buyer-facing catalog).
 *
 * `server/domains/marketplace.js`'s `storefront-browse` macro aggregates
 * every seller's PUBLISHED listings into one public catalog (see the macro's
 * own contract tests in `server/tests/marketplace-domain-parity.test.js` and
 * `server/tests/depth/marketplace-behavior.test.js`, and the wiring writeup
 * in `docs/lens-specs/marketplace-wave3-audit.md`). This file pins the
 * frontend half of that contract: `StorefrontPanel` renders listings from
 * MULTIPLE distinct sellers returned by a single `storefront-browse` call —
 * i.e. the Browse surface genuinely shows cross-seller inventory, not just
 * the signed-in user's own shop.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';

const lensRunMock = vi.fn();

vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

import { StorefrontPanel } from '@/components/marketplace/StorefrontPanel';

const CROSS_SELLER_CATALOG = [
  {
    listingId: 'lst_alice_1', sellerId: 'seller_alice', shopName: "Alice's Clay Studio",
    number: 'L-00001', title: 'Handthrown Mug', kind: 'physical_good',
    priceUsd: 18, currency: 'USD', description: 'Stoneware mug', tags: ['ceramics'],
    images: [], stockQty: 4, shippingCostUsd: 3, avgRating: 4.5, reviewCount: 2,
    salesCount: 6, publishedAt: '2026-07-01T00:00:00.000Z',
  },
  {
    listingId: 'lst_bob_1', sellerId: 'seller_bob', shopName: "Bob's Print Shop",
    number: 'L-00002', title: 'Riso Print — Coastline', kind: 'merch_print',
    priceUsd: 40, currency: 'USD', description: 'Limited run riso print', tags: ['art'],
    images: [], stockQty: null, shippingCostUsd: 5, avgRating: null, reviewCount: 0,
    salesCount: 1, publishedAt: '2026-07-02T00:00:00.000Z',
  },
];

describe('StorefrontPanel — cross-seller browse', () => {
  beforeEach(() => {
    lensRunMock.mockReset();
    lensRunMock.mockImplementation((domain: string, action: string) => {
      if (domain === 'marketplace' && action === 'storefront-browse') {
        return Promise.resolve({
          data: { ok: true, result: { listings: CROSS_SELLER_CATALOG, total: 2, categories: ['physical_good', 'merch_print'] }, error: null },
        });
      }
      if (domain === 'marketplace' && action === 'cart-get') {
        return Promise.resolve({ data: { ok: true, result: { shops: [], itemCount: 0, grandTotalUsd: 0 }, error: null } });
      }
      return Promise.resolve({ data: { ok: true, result: {}, error: null } });
    });
  });

  it('renders listings from multiple distinct sellers off a single storefront-browse call', async () => {
    render(<StorefrontPanel />);

    // Both sellers' published listings render — proves the catalog is
    // aggregated across sellers, not scoped to the viewer's own shop.
    await waitFor(() => expect(screen.getByText('Handthrown Mug')).toBeTruthy());
    expect(screen.getByText('Riso Print — Coastline')).toBeTruthy();
    expect(screen.getByText("Alice's Clay Studio")).toBeTruthy();
    expect(screen.getByText("Bob's Print Shop")).toBeTruthy();

    // Exactly one storefront-browse call was made to render both sellers'
    // items — not a per-seller fetch loop.
    const browseCalls = lensRunMock.mock.calls.filter((c) => c[0] === 'marketplace' && c[1] === 'storefront-browse');
    expect(browseCalls.length).toBe(1);
  });

  it('passes search/category/price filters through to storefront-browse untouched', async () => {
    render(<StorefrontPanel />);
    await waitFor(() => expect(screen.getByText('Handthrown Mug')).toBeTruthy());

    lensRunMock.mockClear();
    lensRunMock.mockImplementation((domain: string, action: string) => {
      if (domain === 'marketplace' && action === 'storefront-browse') {
        return Promise.resolve({ data: { ok: true, result: { listings: [CROSS_SELLER_CATALOG[1]], total: 1, categories: ['merch_print'] }, error: null } });
      }
      return Promise.resolve({ data: { ok: true, result: {}, error: null } });
    });

    const search = screen.getByPlaceholderText('Search listings…');
    fireEvent.change(search, { target: { value: 'print' } });

    await waitFor(() => {
      const call = lensRunMock.mock.calls.find((c) => c[0] === 'marketplace' && c[1] === 'storefront-browse');
      expect(call).toBeTruthy();
      expect((call as unknown[])[2]).toMatchObject({ search: 'print' });
    });
  });

  it('shows an honest empty state when no seller has a published listing', async () => {
    lensRunMock.mockImplementation((domain: string, action: string) => {
      if (domain === 'marketplace' && action === 'storefront-browse') {
        return Promise.resolve({ data: { ok: true, result: { listings: [], total: 0, categories: [] }, error: null } });
      }
      return Promise.resolve({ data: { ok: true, result: {}, error: null } });
    });
    render(<StorefrontPanel />);
    await waitFor(() => expect(screen.getByText('No published listings yet.')).toBeTruthy());
  });
});
