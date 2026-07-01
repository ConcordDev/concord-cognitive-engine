/**
 * /lenses/auction — four-UX-state contract.
 *
 * Pins that the auction lens renders genuine loading (aria-busy skeletons) /
 * error (role=alert + a working Retry) / empty / populated states against the
 * real /api/auctions REST surface (driven by a mocked global.fetch standing in
 * for the auction-house routes), plus a11y (the refresh / bid / retry buttons
 * carry accessible names).
 *
 * No fabricated data: every state is driven by the exact response shapes the
 * auction routes return ({ ok, auctions } / { ok, buyOrders } / a network
 * failure). The ERROR pillar additionally surfaces a flash toast on failure.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, act, fireEvent, waitFor } from '@testing-library/react';

// LensShell + ManifestActionBar are presentational/plumbing wrappers — stub
// them to keep the render focused on the auction lens's own states.
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/lens/ManifestActionBar', () => ({
  ManifestActionBar: () => <div data-testid="manifest-action-bar" />,
}));

import AuctionLensPage from '@/app/lenses/auction/page';

const AUCTIONS = [
  {
    id: 'auc_1',
    sellerUserId: 'u_1',
    title: 'Dragonbone Greatsword',
    itemKind: 'inventory' as const,
    itemId: 'item_dragonbone',
    startCc: 100,
    currentBidCc: 250,
    buyoutCc: 1000,
    bidCount: 3,
    leadingBidderUserId: 'u_2',
    endsAt: Math.floor(Date.now() / 1000) + 7200,
  },
];

function okJson(body: Record<string, unknown>) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
}

beforeEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('auction lens — four UX states', () => {
  it('LOADING: renders aria-busy skeletons while the auction board is in flight', async () => {
    // fetch never resolves → stuck loading.
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<AuctionLensPage />); });
    const grid = view!.getByTestId('auction-grid');
    expect(grid).toBeInTheDocument();
    expect(grid).toHaveAttribute('aria-busy', 'true');
    expect(view!.getAllByTestId('auction-loading').length).toBeGreaterThan(0);
  });

  it('EMPTY: shows an honest empty state once the board loads with no auctions', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (String(url).includes('/active')) return okJson({ ok: true, auctions: [] });
      return okJson({ ok: true, buyOrders: [] });
    }));
    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<AuctionLensPage />); });
    await waitFor(() => expect(view!.getByTestId('auction-empty')).toBeInTheDocument());
    expect(view!.getByTestId('auction-empty').textContent).toMatch(/no active auctions/i);
    // a11y: the chrome buttons carry accessible names.
    expect(view!.getByLabelText('Refresh')).toBeInTheDocument();
  });

  it('POPULATED: renders a real auction card with bid + buyout controls', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (String(url).includes('/active')) return okJson({ ok: true, auctions: AUCTIONS });
      return okJson({ ok: true, buyOrders: [] });
    }));
    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<AuctionLensPage />); });
    await waitFor(() => expect(view!.getByText('Dragonbone Greatsword')).toBeInTheDocument());
    // The bid + buyout buttons carry accessible names derived from the row.
    expect(view!.getByLabelText(/Bid on Dragonbone Greatsword/)).toBeInTheDocument();
    expect(view!.getByLabelText(/Buy out Dragonbone Greatsword for 1000 CC/)).toBeInTheDocument();
    // empty + error states are absent when populated.
    expect(view!.queryByTestId('auction-empty')).not.toBeInTheDocument();
    expect(view!.queryByTestId('auction-error')).not.toBeInTheDocument();
  });

  it('ERROR: shows role=alert + a Retry that re-issues the fetch', async () => {
    // First load fails (network throw) → error banner. Retry succeeds.
    let attempts = 0;
    const fetchMock = vi.fn((url: string) => {
      if (String(url).includes('/active')) {
        attempts += 1;
        if (attempts === 1) return Promise.reject(new Error('network down'));
        return okJson({ ok: true, auctions: AUCTIONS });
      }
      return okJson({ ok: true, buyOrders: [] });
    });
    vi.stubGlobal('fetch', fetchMock);

    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<AuctionLensPage />); });

    await waitFor(() => expect(view!.getByTestId('auction-error')).toBeInTheDocument());
    const alert = view!.getByTestId('auction-error');
    expect(alert).toHaveAttribute('role', 'alert');
    expect(alert.textContent).toMatch(/could not reach the auction house/i);

    const activeCallsBefore = fetchMock.mock.calls.filter((c) => String(c[0]).includes('/active')).length;
    await act(async () => { fireEvent.click(view!.getByLabelText('Retry loading auctions')); });
    const activeCallsAfter = fetchMock.mock.calls.filter((c) => String(c[0]).includes('/active')).length;
    expect(activeCallsAfter).toBeGreaterThan(activeCallsBefore);

    // After the retry succeeds the error clears and the auction renders.
    await waitFor(() => expect(view!.queryByTestId('auction-error')).not.toBeInTheDocument());
    expect(view!.getByText('Dragonbone Greatsword')).toBeInTheDocument();
  });

  it('ERROR: a non-ok HTTP response also surfaces the alert', async () => {
    vi.stubGlobal('fetch', vi.fn(() =>
      Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({ ok: false, error: 'boom' }) }),
    ));
    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<AuctionLensPage />); });
    await waitFor(() => expect(view!.getByTestId('auction-error')).toBeInTheDocument());
    expect(view!.getByLabelText('Retry loading auctions')).toBeInTheDocument();
  });

  it('BID MODAL: opens, places a bid through the auction route, and shows the flash', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes('/bid')) return okJson({ ok: true, settled: false });
      if (u.includes('/active')) return okJson({ ok: true, auctions: AUCTIONS });
      if (init?.method === 'POST') return okJson({ ok: true });
      return okJson({ ok: true, buyOrders: [] });
    }));
    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<AuctionLensPage />); });
    await waitFor(() => expect(view!.getByText('Dragonbone Greatsword')).toBeInTheDocument());

    await act(async () => { fireEvent.click(view!.getByLabelText(/Bid on Dragonbone Greatsword/)); });
    // Modal is open: the dialog + Place bid button render.
    await waitFor(() => expect(view!.getByText('Place bid')).toBeInTheDocument());
    await act(async () => { fireEvent.click(view!.getByText('Place bid')); });
    await waitFor(() => expect(view!.getByText(/Bid placed at/i)).toBeInTheDocument());
  });

  it('BUYOUT: clicking buy-out posts the buyout bid and reports settlement', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      const u = String(url);
      if (u.includes('/bid')) return okJson({ ok: true, settled: true });
      if (u.includes('/active')) return okJson({ ok: true, auctions: AUCTIONS });
      return okJson({ ok: true, buyOrders: [] });
    }));
    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<AuctionLensPage />); });
    await waitFor(() => expect(view!.getByText('Dragonbone Greatsword')).toBeInTheDocument());
    await act(async () => { fireEvent.click(view!.getByLabelText(/Buy out Dragonbone Greatsword for 1000 CC/)); });
    await waitFor(() => expect(view!.getByText(/Bought out/i)).toBeInTheDocument());
  });

  it('CREATE: lists an item through the create modal', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      const u = String(url);
      if (u === '/api/auctions' && init?.method === 'POST') return okJson({ ok: true, auctionId: 'auc_new' });
      if (u.includes('/active')) return okJson({ ok: true, auctions: [] });
      return okJson({ ok: true, buyOrders: [] });
    }));
    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<AuctionLensPage />); });
    await waitFor(() => expect(view!.getByText('List item')).toBeInTheDocument());
    await act(async () => { fireEvent.click(view!.getByText('List item')); });
    await waitFor(() => expect(view!.getByText('Post auction')).toBeInTheDocument());

    // Item id is required for the post button to enable.
    const dialog = view!.getByRole('dialog');
    const idInput = dialog.querySelectorAll('input')[0] as HTMLInputElement;
    await act(async () => { fireEvent.change(idInput, { target: { value: 'item_xyz' } }); });
    await act(async () => { fireEvent.click(view!.getByText('Post auction')); });
    await waitFor(() => expect(view!.getByText(/Auction posted/i)).toBeInTheDocument());
  });

  it('BUY ORDERS: renders open orders and supports fill + cancel + post', async () => {
    const BUY_ORDERS = [
      {
        id: 'bo_1', buyer_user_id: 'u_3', world_id: 'concordia-hub',
        item_kind: 'inventory' as const, item_descriptor: 'rare_herb',
        unit_price_cc: 5, quantity_wanted: 10, quantity_filled: 2,
        total_escrow_cc: 50, status: 'open', posted_at: 0, expires_at: 0,
      },
    ];
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes('/fill')) return okJson({ ok: true, fillQty: 8, payment: 40 });
      if (u.includes('/cancel')) return okJson({ ok: true, refundCc: 10 });
      if (u === '/api/auctions/buy-orders' && init?.method === 'POST') return okJson({ ok: true, escrowCc: 30 });
      if (u.includes('buy-orders')) return okJson({ ok: true, buyOrders: BUY_ORDERS });
      return okJson({ ok: true, auctions: [] });
    }));
    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<AuctionLensPage />); });
    await waitFor(() => expect(view!.getByText('rare_herb')).toBeInTheDocument());

    // Fill the remaining 8.
    await act(async () => { fireEvent.click(view!.getByText('Fill 8')); });
    await waitFor(() => expect(view!.getByText(/Sold 8 for 40 CC/i)).toBeInTheDocument());

    // Cancel.
    await act(async () => { fireEvent.click(view!.getByText('Cancel')); });
    await waitFor(() => expect(view!.getByText(/Cancelled/i)).toBeInTheDocument());

    // Post a new buy order.
    const descInput = view!.getByPlaceholderText('rare_herb / dtu_id') as HTMLInputElement;
    await act(async () => { fireEvent.change(descInput, { target: { value: 'mithril_ore' } }); });
    await act(async () => { fireEvent.click(view!.getByText('Post buy order')); });
    await waitFor(() => expect(view!.getByText(/Buy order placed/i)).toBeInTheDocument());
  });
});
