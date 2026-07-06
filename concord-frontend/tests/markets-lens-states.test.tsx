/**
 * /lenses/markets — envelope-unwrap contract for the spectator-betting lens
 * (finding 15).
 *
 * POST /api/lens/run ALWAYS answers `{ ok: true, result: PAYLOAD }` where the
 * outer `ok` is only a transport flag — PAYLOAD (the macro's own
 * `{ ok, markets }` / `{ ok, positions }` shape from
 * `server.js` `betting.list_open` / `betting.my_positions`) carries the real
 * success/failure + fields. The page's local `macro()` helper used to return
 * the raw fetch body untouched, so `m?.ok` was always the transport-true
 * value and `m.markets` / `p.positions` were always `undefined` — the "Open
 * Markets" and "Your Positions" lists were permanently stuck on the empty
 * state no matter what the backend actually had.
 *
 * `macro()` now unwraps via `j.result ?? j`. These tests mock global fetch
 * with the REAL nested envelope shape and assert the lists render from it.
 * Heavy sibling components (workbench, quote detail, prediction markets,
 * quote ticker) do their own fetching and are stubbed inert so the test
 * stays on the page's own markets/positions load path.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, fireEvent, act } from '@testing-library/react';
import React from 'react';

vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'lens-shell' }, children),
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/components/lens/RecentMineCard', () => ({ RecentMineCard: () => null }));
vi.mock('@/components/lens/AutoActionStrip', () => ({ AutoActionStrip: () => null }));
vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/components/lens/FirstRunTour', () => ({ FirstRunTour: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/LensVerticalHero', () => ({ LensVerticalHero: () => null }));
vi.mock('@/hooks/useRealtimeLens', () => ({
  useRealtimeLens: () => ({ latestData: null, isLive: false, lastUpdated: null }),
}));
vi.mock('@/components/lens/QuoteCardList', () => ({ default: () => null }));
vi.mock('@/components/markets/MarketsWorkbench', () => ({ default: () => null }));
vi.mock('@/components/markets/MarketsQuoteDetail', () => ({ MarketsQuoteDetail: () => null }));
vi.mock('@/components/markets/PredictionMarkets', () => ({ default: () => null }));

// Import AFTER mocks are registered.
import MarketsPage from '@/app/lenses/markets/page';

// `envelope()` mirrors the REAL /api/lens/run transport shape.
function envelope(macroResult: unknown) {
  return { ok: true, result: macroResult };
}
function jsonResponse(body: unknown) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response);
}

const MARKET = {
  id: 5,
  world_id: 'concordia-hub',
  question: 'Will the dome hold through the season?',
  resolution_kind: 'substrate',
  pool_yes_sparks: 300,
  pool_no_sparks: 100,
  opened_at: 1735000000,
  closes_at: null,
};

const POSITION = {
  id: 9,
  market_id: 5,
  side: 'yes' as const,
  stake_sparks: 20,
  payout_sparks: null,
  question: 'Will the dome hold through the season?',
  status: 'open',
};

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { vi.restoreAllMocks(); });

describe('markets lens — envelope unwrap (finding 15)', () => {
  it('EMPTY: an empty result.markets/result.positions renders the honest empty states', async () => {
    // @ts-expect-error test global
    global.fetch = vi.fn(() => jsonResponse(envelope({ ok: true, markets: [], positions: [] })));
    const { getByText } = render(<MarketsPage />);
    await waitFor(() => expect(getByText(/No open markets right now/i)).toBeInTheDocument());
    expect(getByText(/No positions yet/i)).toBeInTheDocument();
  });

  it('POPULATED: renders real markets from result.markets, not a top-level `markets` field', async () => {
    // @ts-expect-error test global
    global.fetch = vi.fn((url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      if (body.name === 'list_open') return jsonResponse(envelope({ ok: true, markets: [MARKET] }));
      if (body.name === 'my_positions') return jsonResponse(envelope({ ok: true, positions: [] }));
      return jsonResponse(envelope({ ok: true }));
    });
    const { getByText, queryByText } = render(<MarketsPage />);
    await waitFor(() => expect(getByText('Will the dome hold through the season?')).toBeInTheDocument());
    // pre-fix this list was permanently empty no matter the backend data.
    expect(queryByText(/No open markets right now/i)).toBeNull();
    expect(getByText(/YES 75%/)).toBeInTheDocument();
  });

  it('POPULATED: renders real positions from result.positions, not a top-level `positions` field', async () => {
    // @ts-expect-error test global
    global.fetch = vi.fn((url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      if (body.name === 'list_open') return jsonResponse(envelope({ ok: true, markets: [] }));
      if (body.name === 'my_positions') return jsonResponse(envelope({ ok: true, positions: [POSITION] }));
      return jsonResponse(envelope({ ok: true }));
    });
    const { getByText, queryByText, container } = render(<MarketsPage />);
    await waitFor(() => expect(getByText('Will the dome hold through the season?')).toBeInTheDocument());
    expect(queryByText(/No positions yet/i)).toBeNull();
    expect(container.textContent).toMatch(/YES · 20 ⚡/);
  });

  it('placing a bet re-reads result.ok, not the always-true transport ok, and refreshes the lists', async () => {
    let betsPlaced = 0;
    // @ts-expect-error test global
    global.fetch = vi.fn((url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      if (body.name === 'list_open') return jsonResponse(envelope({ ok: true, markets: [MARKET] }));
      if (body.name === 'my_positions') return jsonResponse(envelope({ ok: true, positions: [] }));
      if (body.name === 'place_bet') {
        betsPlaced += 1;
        return jsonResponse(envelope({ ok: true, betId: 1 }));
      }
      return jsonResponse(envelope({ ok: true }));
    });
    const { getByText } = render(<MarketsPage />);
    await waitFor(() => expect(getByText('Will the dome hold through the season?')).toBeInTheDocument());

    await act(async () => { fireEvent.click(getByText(/YES · 300 ⚡/)); });
    await waitFor(() => expect(getByText(/Wagered 10 ⚡ YES on market #5/)).toBeInTheDocument());
    expect(betsPlaced).toBe(1);
  });

  it('a genuine macro-level failure on place_bet surfaces the real reason, not a silent success', async () => {
    // @ts-expect-error test global
    global.fetch = vi.fn((url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      if (body.name === 'list_open') return jsonResponse(envelope({ ok: true, markets: [MARKET] }));
      if (body.name === 'my_positions') return jsonResponse(envelope({ ok: true, positions: [] }));
      if (body.name === 'place_bet') return jsonResponse(envelope({ ok: false, reason: 'insufficient_sparks' }));
      return jsonResponse(envelope({ ok: true }));
    });
    const { getByText } = render(<MarketsPage />);
    await waitFor(() => expect(getByText('Will the dome hold through the season?')).toBeInTheDocument());

    await act(async () => { fireEvent.click(getByText(/NO · 100 ⚡/)); });
    await waitFor(() => expect(getByText(/Failed: insufficient_sparks/)).toBeInTheDocument());
  });
});
