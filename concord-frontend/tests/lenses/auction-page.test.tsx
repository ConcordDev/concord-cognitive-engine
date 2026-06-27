// Auction lens — four-UX-states test.
//
// Mounts the real page (app/lenses/auction/page.tsx) with a mocked global
// fetch and asserts each of the product-gate UX states renders honestly:
//   1. loading   — skeletons while the first fetch is in flight
//   2. empty      — "No active auctions" once a successful empty fetch resolves
//   3. populated  — a real auction card from a successful non-empty fetch
//   4. error      — a retry banner when the fetch fails (network / 5xx)
//
// No fake data is injected into the component — every row it shows comes from
// the mocked backend response, exactly as production would receive it.
//
// (Lives under tests/ to match vitest.config.ts `include`; the page it mounts
// is the real lens page two levels up.)

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import AuctionLensPage from '../../app/lenses/auction/page';

const EMPTY = { ok: true, auctions: [], buyOrders: [] };

function jsonResponse(body: unknown, ok = true, status = 200) {
  return Promise.resolve({
    ok,
    status,
    json: () => Promise.resolve(body),
  } as Response);
}

/** Route a fetch URL to the right canned payload. */
function makeFetch(handler: (url: string) => Promise<Response>) {
  return vi.fn((input: RequestInfo | URL) => handler(String(input)));
}

describe('AuctionLensPage — four UX states', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('LOADING: shows skeletons before the first fetch resolves', () => {
    // A fetch that never resolves keeps the page in its loading state.
    vi.stubGlobal('fetch', makeFetch(() => new Promise<Response>(() => {})));
    const { container } = render(<AuctionLensPage />);
    // Skeleton placeholders use animate-pulse; at least one is present pre-resolve.
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });

  it('EMPTY: shows the honest empty state when the backend returns no auctions', async () => {
    vi.stubGlobal('fetch', makeFetch((url) => {
      if (url.includes('/api/auctions/active')) return jsonResponse({ ok: true, auctions: [] });
      if (url.includes('/api/auctions/buy-orders')) return jsonResponse({ ok: true, buyOrders: [] });
      return jsonResponse(EMPTY);
    }));
    render(<AuctionLensPage />);
    expect(await screen.findByText(/no active auctions/i)).toBeInTheDocument();
    expect(screen.getByText(/no open buy orders/i)).toBeInTheDocument();
  });

  it('POPULATED: renders a real auction card from backend data', async () => {
    const auction = {
      id: 'auc_test1', sellerUserId: 'seller', title: 'Rare Scroll',
      itemKind: 'dtu', itemId: 'dtu_42', startCc: 100, currentBidCc: 250,
      buyoutCc: 900, bidCount: 3, leadingBidderUserId: 'b1',
      endsAt: Math.floor(Date.now() / 1000) + 3600,
    };
    vi.stubGlobal('fetch', makeFetch((url) => {
      if (url.includes('/api/auctions/active')) return jsonResponse({ ok: true, auctions: [auction] });
      if (url.includes('/api/auctions/buy-orders')) return jsonResponse({ ok: true, buyOrders: [] });
      return jsonResponse(EMPTY);
    }));
    render(<AuctionLensPage />);
    expect(await screen.findByText('Rare Scroll')).toBeInTheDocument();
    // Computed current bid is shown.
    expect(screen.getByText('250')).toBeInTheDocument();
    // The bid CTA carries an accessible label (a11y) and the buyout button too.
    expect(screen.getByLabelText(/bid on rare scroll/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/buy out rare scroll for 900 cc/i)).toBeInTheDocument();
  });

  it('ERROR: shows a retry banner when the fetch fails, and retry re-fetches', async () => {
    let attempt = 0;
    vi.stubGlobal('fetch', makeFetch((url) => {
      attempt += 1;
      // First round (both endpoints) 500; after retry, succeed empty.
      const failing = attempt <= 2;
      if (failing) return jsonResponse({ ok: false, error: 'boom' }, false, 500);
      if (url.includes('/api/auctions/active')) return jsonResponse({ ok: true, auctions: [] });
      return jsonResponse({ ok: true, buyOrders: [] });
    }));
    render(<AuctionLensPage />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/could not reach the auction house/i);

    const retry = screen.getByLabelText(/retry loading auctions/i);
    fireEvent.click(retry);

    // After a successful retry, the error banner clears and the empty state shows.
    await waitFor(() => {
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
    expect(screen.getByText(/no active auctions/i)).toBeInTheDocument();
  });
});
