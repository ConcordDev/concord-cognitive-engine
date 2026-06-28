/// <reference types="@testing-library/jest-dom/vitest" />
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// Mock the axios-shaped api client. GET for active + price-history, POST for bid.
const get = vi.fn();
const post = vi.fn();
vi.mock('@/lib/api/client', () => ({
  api: {
    get: (...a: unknown[]) => get(...a),
    post: (...a: unknown[]) => post(...a),
  },
}));

import { AuctionBrowsePanel } from './AuctionBrowsePanel';

const NOW = Date.now();
const secs = (offsetMs: number) => Math.floor((NOW + offsetMs) / 1000);

function activeResponse(auctions: unknown[]) {
  return { data: { ok: true, auctions } };
}
function priceHistoryResponse(points: unknown[], stats: unknown) {
  return { data: { ok: true, points, stats } };
}

function routeGet(activeRes: unknown, historyRes?: unknown) {
  get.mockImplementation((url: string) => {
    if (url.includes('/api/auctions/active')) return Promise.resolve(activeRes);
    if (url.includes('/price-history')) return Promise.resolve(historyRes ?? priceHistoryResponse([], null));
    return Promise.reject(new Error(`unexpected url ${url}`));
  });
}

const SAMPLE = {
  id: 'auc-1',
  sellerUserId: 'u-seller',
  worldId: 'tunya',
  itemKind: 'recipe',
  itemId: 'item-frost',
  title: 'Frostbrand Recipe',
  startCc: 100,
  currentBidCc: 250,
  bidCount: 3,
  endsAt: secs(2 * 60 * 60_000), // ends in 2h
};

describe('AuctionBrowsePanel', () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
    post.mockResolvedValue({ data: { ok: true, bid: 300 } });
  });

  it('lists active auctions filtered to the world with bid + time-left', async () => {
    routeGet(activeResponse([
      SAMPLE,
      { id: 'auc-2', worldId: 'cyber', title: 'Other World Item', currentBidCc: 10, endsAt: secs(60_000) },
    ]));

    render(<AuctionBrowsePanel worldId="tunya" />);

    await waitFor(() => expect(screen.getByText('Frostbrand Recipe')).toBeInTheDocument());
    // Other-world auction is filtered out.
    expect(screen.queryByText('Other World Item')).not.toBeInTheDocument();
    expect(screen.getByText('250 CC')).toBeInTheDocument();
    expect(screen.getByText(/2h left/)).toBeInTheDocument();
  });

  it('calls the active endpoint and renders an honest empty state', async () => {
    routeGet(activeResponse([]));
    render(<AuctionBrowsePanel worldId="tunya" />);

    await waitFor(() =>
      expect(screen.getByText(/No active auctions in this world/)).toBeInTheDocument(),
    );
    expect(get).toHaveBeenCalledWith('/api/auctions/active', { params: { limit: 100 } });
  });

  it('shows an honest error state on fetch failure', async () => {
    get.mockRejectedValue(new Error('network down'));
    render(<AuctionBrowsePanel worldId="tunya" />);

    await waitFor(() =>
      expect(screen.getByText(/Could not load active auctions/)).toBeInTheDocument(),
    );
    expect(screen.getByText('Retry')).toBeInTheDocument();
  });

  it('opens detail, fetches real price history, and shows total-cost confirm', async () => {
    routeGet(
      activeResponse([SAMPLE]),
      priceHistoryResponse(
        [{ cc: 200, at: secs(-3 * 86_400_000) }, { cc: 240, at: secs(-86_400_000) }],
        { count: 2, min: 200, max: 240, avg: 220, last: 240, changePct: 20 },
      ),
    );

    render(<AuctionBrowsePanel worldId="tunya" />);
    await waitFor(() => expect(screen.getByText('Frostbrand Recipe')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Frostbrand Recipe'));

    // Price-history endpoint called for the item.
    await waitFor(() =>
      expect(get).toHaveBeenCalledWith(
        '/api/auctions/item/item-frost/price-history',
        { params: { limit: 100 } },
      ),
    );
    // Stats surface.
    await waitFor(() => expect(screen.getByText(/Last:/)).toBeInTheDocument());
    expect(screen.getByText('240 CC')).toBeInTheDocument();
    // Min next bid = current (250) + 1 = 251; total-cost confirm reflects it.
    expect(screen.getByText(/You will be charged/)).toBeInTheDocument();
    expect(screen.getByText('251 CC')).toBeInTheDocument();
  });

  it('places a bid against the real endpoint with amountCc', async () => {
    routeGet(activeResponse([SAMPLE]));
    render(<AuctionBrowsePanel worldId="tunya" />);
    await waitFor(() => expect(screen.getByText('Frostbrand Recipe')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Frostbrand Recipe'));
    await waitFor(() => expect(screen.getByLabelText('Bid amount in CC')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('Bid amount in CC'), { target: { value: '300' } });
    fireEvent.click(screen.getByText('Bid 300 CC'));

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/api/auctions/auc-1/bid', { amountCc: 300 }),
    );
    await waitFor(() => expect(screen.getByText(/Bid placed: 300 CC/)).toBeInTheDocument());
  });

  it('surfaces a server-side bid rejection verbatim without faking success', async () => {
    routeGet(activeResponse([SAMPLE]));
    post.mockResolvedValue({ data: { ok: false, error: 'must_exceed_current' } });

    render(<AuctionBrowsePanel worldId="tunya" />);
    await waitFor(() => expect(screen.getByText('Frostbrand Recipe')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Frostbrand Recipe'));
    await waitFor(() => expect(screen.getByLabelText('Bid amount in CC')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Bid amount in CC'), { target: { value: '251' } });
    fireEvent.click(screen.getByText('Bid 251 CC'));

    await waitFor(() =>
      expect(screen.getByText(/Bid rejected: must_exceed_current/)).toBeInTheDocument(),
    );
  });
});
