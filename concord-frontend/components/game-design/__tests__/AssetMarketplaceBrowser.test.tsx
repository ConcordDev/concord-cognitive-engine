/**
 * AssetMarketplaceBrowser — pins the "buy someone's asset" half of the
 * Asset Studio economic surface:
 *  - browses real listings via GET /api/creative-marketplace/artifacts
 *    (type=blueprint, status=active) and renders an honest empty/loading
 *    state, never a fabricated placeholder row;
 *  - the signed-in user's own listings are excluded from the buy list;
 *  - Buy calls POST /api/creative-marketplace/artifacts/:id/purchase with
 *    the EXACT { buyerId, requestId } shape and renders exactly the
 *    price/creatorEarnings/cascade figures the backend returned — never
 *    invented client-side;
 *  - an honest backend purchase failure (e.g. insufficient_balance,
 *    already_licensed) renders the real reason, never a silent success.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const apiGetMock = vi.fn();
const apiPostMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  api: {
    get: (...args: unknown[]) => apiGetMock(...args),
    post: (...args: unknown[]) => apiPostMock(...args),
  },
}));

const useAuthMock = vi.fn();
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => useAuthMock(),
}));

// Import AFTER the mocks are registered.
import { AssetMarketplaceBrowser } from '@/components/game-design/AssetMarketplaceBrowser';

function listingsResponse(items: Array<Record<string, unknown>>) {
  return Promise.resolve({ data: { items, total: items.length, limit: 25, offset: 0 } });
}

beforeEach(() => {
  apiGetMock.mockReset();
  apiPostMock.mockReset();
  useAuthMock.mockReset();
  useAuthMock.mockReturnValue({ user: { id: 'user-1' }, isAuthenticated: true, isLoading: false });
  vi.stubGlobal('crypto', { ...globalThis.crypto, randomUUID: () => 'req-fixed-1' });
});
afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });

describe('AssetMarketplaceBrowser — browsing', () => {
  it('shows the real honest empty state when nobody else has listed anything', async () => {
    apiGetMock.mockReturnValue(listingsResponse([]));
    const { findByText } = render(<AssetMarketplaceBrowser />);
    expect(await findByText(/No other creators have listed a building yet/i)).toBeInTheDocument();
    expect(apiGetMock).toHaveBeenCalledWith('/api/creative-marketplace/artifacts', {
      params: { type: 'blueprint', status: 'active', sortBy: 'newest', limit: 25 },
    });
  });

  it('excludes the signed-in user\'s own listings from the buy list', async () => {
    apiGetMock.mockReturnValue(listingsResponse([
      { id: 'ca-mine', creatorId: 'user-1', title: 'My Own Tower', price: 40 },
      { id: 'ca-theirs', creatorId: 'user-2', title: 'Riverside Inn', price: 25 },
    ]));
    const { findByText, queryByText } = render(<AssetMarketplaceBrowser />);
    expect(await findByText('Riverside Inn')).toBeInTheDocument();
    expect(queryByText('My Own Tower')).toBeNull();
  });

  it('renders the real reason when loading listings fails', async () => {
    apiGetMock.mockRejectedValue(new Error('network down'));
    const { findByText } = render(<AssetMarketplaceBrowser />);
    expect(await findByText(/network down/i)).toBeInTheDocument();
  });

  it('prompts sign-in instead of enabling Buy for an unauthenticated visitor', async () => {
    useAuthMock.mockReturnValue({ user: null, isAuthenticated: false, isLoading: false });
    apiGetMock.mockReturnValue(listingsResponse([
      { id: 'ca-theirs', creatorId: 'user-2', title: 'Riverside Inn', price: 25 },
    ]));
    const { findByText, getByText } = render(<AssetMarketplaceBrowser />);
    expect(await findByText(/Sign in to buy/i)).toBeInTheDocument();
    expect(getByText('Buy').closest('button')).toBeDisabled();
  });
});

describe('AssetMarketplaceBrowser — Buy calls the exact purchase shape and renders real results', () => {
  it('sends { buyerId, requestId } and shows the real price/creatorEarnings/cascade the backend returned', async () => {
    apiGetMock.mockReturnValue(listingsResponse([
      { id: 'ca-theirs', creatorId: 'user-2', title: 'Riverside Inn', price: 25 },
    ]));
    apiPostMock.mockResolvedValue({
      data: {
        ok: true, purchaseId: 'cap-1', artifactId: 'ca-theirs', buyerId: 'user-1', sellerId: 'user-2',
        price: 25, fees: 1.37, creatorEarnings: 21.13,
        cascade: { total: 2.5, payments: [{ recipientId: 'user-3', amount: 2.5, generation: 1 }] },
      },
    });
    const { findByText, getByText } = render(<AssetMarketplaceBrowser />);
    await findByText('Riverside Inn');

    fireEvent.click(getByText('Buy'));

    await waitFor(() => expect(apiPostMock).toHaveBeenCalledWith(
      '/api/creative-marketplace/artifacts/ca-theirs/purchase',
      { buyerId: 'user-1', requestId: 'req-fixed-1' },
    ));

    expect(await findByText(/Bought for 25 CC — 21.13 CC to the creator/i)).toBeInTheDocument();
    expect(await findByText(/2.5 CC to 1 remix-ancestor royalty payment/i)).toBeInTheDocument();
  });

  it('renders the real honest failure reason on a rejected purchase, never a fabricated success', async () => {
    apiGetMock.mockReturnValue(listingsResponse([
      { id: 'ca-theirs', creatorId: 'user-2', title: 'Riverside Inn', price: 25 },
    ]));
    apiPostMock.mockResolvedValue({ data: { ok: false, error: 'insufficient_balance' } });
    const { findByText, getByText, queryByText } = render(<AssetMarketplaceBrowser />);
    await findByText('Riverside Inn');

    fireEvent.click(getByText('Buy'));

    expect(await findByText(/insufficient_balance/i)).toBeInTheDocument();
    expect(queryByText(/Bought for/i)).toBeNull();
  });
});
