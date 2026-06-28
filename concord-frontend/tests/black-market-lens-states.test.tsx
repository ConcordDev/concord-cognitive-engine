/**
 * /lenses/black-market — four-UX-state contract.
 *
 * Pins that the Black Market lens (Sael's stall) renders genuine
 * loading / error (role=alert + a working Retry) / empty / populated states
 * against the real REST surface (GET /api/black-market + /reputation,
 * POST /api/black-market/:id/purchase), plus a11y (loading is role=status,
 * load-error is role=alert, the encryption-tier sort control carries an
 * accessible name).
 *
 * No fabricated data: every state is driven by a mocked `fetch` standing in
 * for the real backend, exactly the shape server/lib/black-market.js +
 * server/routes/black-market.js return. The headless LensShell and the
 * cross-lens substrate children (SaelStall / UndergroundExchange / artifact
 * recents) are render-only stubs so the test stays on the page's own
 * fetch-driven state machine.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, act, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

// ── headless shell + lens substrate: render-only stubs ──────────────────────
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'lens-shell' }, children),
}));
vi.mock('@/components/lens/RecentMineCard', () => ({ RecentMineCard: () => null }));
vi.mock('@/components/lens/AutoActionStrip', () => ({ AutoActionStrip: () => null }));
vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/components/lens/FirstRunTour', () => ({ FirstRunTour: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/LensVerticalHero', () => ({ LensVerticalHero: () => null }));
vi.mock('@/components/lens/ManifestActionBar', () => ({ ManifestActionBar: () => null }));
vi.mock('@/components/black-market/SaelStall', () => ({ SaelStall: () => null }));
vi.mock('@/components/black-market/UndergroundExchange', () => ({ UndergroundExchange: () => null }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/lib/hooks/use-lens-artifacts', () => ({
  useArtifacts: () => ({ data: [], isLoading: false }),
  useCreateArtifact: () => ({ mutate: () => {} }),
}));

// Import AFTER mocks are registered.
import BlackMarketPage from '@/app/lenses/black-market/page';

function jsonOk(body: Record<string, unknown>) {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
}

const LISTING = {
  id: 'bml_abc123',
  message_id: 'msg_1',
  fence_npc_id: 'broker_sael',
  price_sparks: 180,
  encryption_level: 'high' as const,
  redacted_preview: '[42 chars · high-encryption · ··········…]',
  created_at: Math.floor(Date.now() / 1000),
  expires_at: Math.floor(Date.now() / 1000) + 86400,
};

const REP = {
  fence_npc_id: 'broker_sael',
  buyer_rep: 12,
  purchases: 3,
  last_trade_at: Math.floor(Date.now() / 1000),
};

// Route a fetch URL to the right canned reply.
function routeFetch(handlers: {
  listings?: () => Promise<unknown>;
  reputation?: () => Promise<unknown>;
  purchase?: () => Promise<unknown>;
}) {
  return vi.fn((url: string, opts?: { method?: string }) => {
    if (opts?.method === 'POST' || /\/purchase$/.test(url)) {
      return (handlers.purchase ?? (() => jsonOk({ ok: false, error: 'no purchase' })))();
    }
    if (/\/reputation$/.test(url)) {
      return (handlers.reputation ?? (() => jsonOk({ ok: true, reputation: [] })))();
    }
    return (handlers.listings ?? (() => jsonOk({ ok: true, listings: [] })))();
  });
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('black-market lens — four UX states', () => {
  it('LOADING: shows a role=status indicator while listings are in flight', async () => {
    // Listings never resolves → page stays in the loading state.
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    const { container } = render(<BlackMarketPage />);
    await waitFor(() => expect(container.querySelector('[role="status"]')).toBeTruthy());
    expect(container.querySelector('[role="status"]')?.textContent).toMatch(/loading/i);
  });

  it('ERROR: a failed market load shows role=alert + a working Retry that re-fetches', async () => {
    let fail = true;
    const fetchMock = vi.fn((url: string) => {
      if (/\/reputation$/.test(url)) return jsonOk({ ok: true, reputation: [] });
      if (fail) return Promise.reject(new Error('market unreachable'));
      return jsonOk({ ok: true, listings: [LISTING] });
    });
    vi.stubGlobal('fetch', fetchMock);
    const { container, getByText } = render(<BlackMarketPage />);

    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/unreachable/i);

    const listingsCallsBefore = fetchMock.mock.calls.filter(
      (c) => !/\/reputation$/.test(String(c[0])),
    ).length;
    fail = false;
    await act(async () => { fireEvent.click(getByText('Retry')); });
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.filter((c) => !/\/reputation$/.test(String(c[0]))).length,
      ).toBeGreaterThan(listingsCallsBefore));
    // recovers to the populated state
    await waitFor(() => expect(getByText(/Buy for 180 sparks/)).toBeInTheDocument());
  });

  it('ERROR: an ok:false market response is treated as an honest load failure (no fake listings)', async () => {
    vi.stubGlobal('fetch', routeFetch({
      listings: () => jsonOk({ ok: false, error: 'An unexpected error occurred' }),
    }));
    const { container } = render(<BlackMarketPage />);
    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    // Empty-state CTA must NOT show when the load actually errored.
    expect(container.textContent).not.toMatch(/No intercepted messages on the market/i);
  });

  it('EMPTY: shows the honest "no intercepted messages" CTA when the market is empty', async () => {
    vi.stubGlobal('fetch', routeFetch({ listings: () => jsonOk({ ok: true, listings: [] }) }));
    const { getByText } = render(<BlackMarketPage />);
    await waitFor(() =>
      expect(getByText(/No intercepted messages on the market/i)).toBeInTheDocument());
  });

  it('POPULATED: renders a real listing with its sparks price + redacted preview and a buy CTA', async () => {
    vi.stubGlobal('fetch', routeFetch({
      listings: () => jsonOk({ ok: true, listings: [LISTING] }),
      reputation: () => jsonOk({ ok: true, reputation: [REP] }),
    }));
    const { getByText, container } = render(<BlackMarketPage />);
    await waitFor(() => expect(getByText(/Buy for 180 sparks/)).toBeInTheDocument());

    // price + preview come straight from the (mocked) backend row — not fabricated
    expect(getByText(LISTING.redacted_preview)).toBeInTheDocument();
    expect(container.textContent).toMatch(/broker_sael/);
    // reputation panel renders the real standing
    expect(container.textContent).toMatch(/rep \+12 · 3 buys/);
    // no loading / error states linger once populated
    expect(container.querySelector('[role="status"]')).toBeFalsy();
    expect(container.querySelector('[role="alert"]')).toBeFalsy();
  });

  it('POPULATED → BUY: a purchase round-trip reveals the payload and re-fetches the market', async () => {
    const reveal = {
      id: 'msg_1',
      payload: 'Vault Seventeen manifest: the real plaintext',
      encryption_level: 'high',
      source_world: 'concordia',
      dest_world: 'fantasy',
      sent_at: 1,
    };
    let bought = false;
    const fetchMock = vi.fn((url: string, opts?: { method?: string }) => {
      if (opts?.method === 'POST' || /\/purchase$/.test(url)) {
        bought = true;
        return jsonOk({ ok: true, sparksSpent: 158, message: reveal });
      }
      if (/\/reputation$/.test(url)) return jsonOk({ ok: true, reputation: [REP] });
      // after a buy the listing is sold → market goes empty
      return jsonOk({ ok: true, listings: bought ? [] : [LISTING] });
    });
    vi.stubGlobal('fetch', fetchMock);
    const { getByText, container } = render(<BlackMarketPage />);
    await waitFor(() => expect(getByText(/Buy for 180 sparks/)).toBeInTheDocument());

    await act(async () => { fireEvent.click(getByText(/Buy for 180 sparks/)); });

    // the revealed plaintext surfaces (proves the payload came back from the buy)
    await waitFor(() => expect(getByText(reveal.payload)).toBeInTheDocument());
    expect(fetchMock.mock.calls.some((c) => /\/purchase$/.test(String(c[0])))).toBe(true);
    expect(container.textContent).toMatch(/concordia → fantasy/);
  });

  it('BUY → insufficient sparks: surfaces the honest price/have error (role=alert), no reveal', async () => {
    const fetchMock = vi.fn((url: string, opts?: { method?: string }) => {
      if (opts?.method === 'POST' || /\/purchase$/.test(url)) {
        return Promise.resolve({
          ok: false,
          status: 402,
          json: () => Promise.resolve({ ok: false, reason: 'insufficient_sparks', price: 158, have: 40 }),
        });
      }
      if (/\/reputation$/.test(url)) return jsonOk({ ok: true, reputation: [] });
      return jsonOk({ ok: true, listings: [LISTING] });
    });
    vi.stubGlobal('fetch', fetchMock);
    const { getByText, container } = render(<BlackMarketPage />);
    await waitFor(() => expect(getByText(/Buy for 180 sparks/)).toBeInTheDocument());

    await act(async () => { fireEvent.click(getByText(/Buy for 180 sparks/)); });
    await waitFor(() => expect(getByText(/Need 158 sparks; you have 40\./)).toBeInTheDocument());
    // the failed buy must not reveal a payload
    expect(container.textContent).not.toMatch(/Revealed/);
  });

  it('a11y: the sort control carries an accessible name', async () => {
    vi.stubGlobal('fetch', routeFetch({ listings: () => jsonOk({ ok: true, listings: [LISTING] }) }));
    const { getByTitle } = render(<BlackMarketPage />);
    await waitFor(() => expect(getByTitle('Sort listings')).toBeInTheDocument());
  });
});
