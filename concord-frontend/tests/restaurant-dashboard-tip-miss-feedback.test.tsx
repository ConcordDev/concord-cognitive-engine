// Minigame-depth audit (2026-07-11) — POLISH_AUDIT's minigame ranking #8
// item: "Restaurant — tuned & solid; missing miss-feedback + tip-amount
// popup." Verified true against `components/world/RestaurantDashboard.tsx`
// before this fix: a failed serve() (ok:false — e.g. a race against the
// server-side expiry sweep) fired no juice and showed no message at all,
// and a successful serve only ever moved the aggregate `tips_cc` summary
// tally — the real per-serve `payment`/`tip` the server computes
// (`lib/restaurant.js#serveOrder`) was discarded.
//
// Renders the real component, mocks the endpoints it actually calls, and
// asserts both surfaces now render.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import { RestaurantDashboard } from '@/components/world/RestaurantDashboard';

function jsonResponse(body: unknown, ok = true) {
  return Promise.resolve({ ok, json: () => Promise.resolve(body) } as Response);
}

const BUILDING = { id: 'bld-1', building_type: 'restaurant', x: 0, z: 0, name: 'The Copper Pot' };
const ORDER = { id: 'ord-1', dish_id: 'stew', customer_npc_id: 'npc-abcdefgh', expires_at: Math.floor(Date.now() / 1000) + 300, status: 'pending', ordered_at: Math.floor(Date.now() / 1000) };

describe('RestaurantDashboard — tip popup + miss feedback (real wiring)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn((url: string) => {
      if (url === '/api/restaurant/building/bld-1') {
        return jsonResponse({
          ok: true,
          restaurant: { id: 'rest-1' },
          summary: { id: 'rest-1', name: 'The Copper Pot', revenue_cc: 40, tips_cc: 6, orders_served: 4, orders_missed: 1 },
          pending: [ORDER],
        });
      }
      if (url === '/api/config/client') return jsonResponse({ ok: false });
      return jsonResponse({ ok: false });
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => { vi.unstubAllGlobals(); });

  async function renderReady() {
    const utils = render(<RestaurantDashboard building={BUILDING} worldId="w1" onClose={() => {}} />);
    await waitFor(() => { expect(utils.getByText('serve')).toBeTruthy(); });
    return utils;
  }

  it('a successful serve shows the real per-order tip amount, not just the aggregate tally', async () => {
    const { getByText, findByTestId } = await renderReady();
    fetchMock = vi.fn((url: string) => {
      if (url === '/api/restaurant/order/ord-1/serve') {
        return jsonResponse({ ok: true, payment: 10, tip: 2, total: 12, tipFrac: 0.2, combo: 1, comboMult: 1 });
      }
      if (url === '/api/restaurant/building/bld-1') {
        return jsonResponse({ ok: true, restaurant: { id: 'rest-1' }, summary: {}, pending: [] });
      }
      return jsonResponse({ ok: false });
    });
    vi.stubGlobal('fetch', fetchMock);

    fireEvent.click(getByText('serve'));

    const popup = await findByTestId('restaurant-tip-popup');
    expect(popup.textContent).toContain('+10 cc');
    expect(popup.textContent).toContain('+2 tip');
  });

  it('a failed serve (e.g. expired race) shows a miss message instead of failing silently', async () => {
    const { getByText, findByTestId } = await renderReady();
    fetchMock = vi.fn((url: string) => {
      if (url === '/api/restaurant/order/ord-1/serve') {
        return jsonResponse({ ok: false, error: 'expired' });
      }
      if (url === '/api/restaurant/building/bld-1') {
        return jsonResponse({ ok: true, restaurant: { id: 'rest-1' }, summary: {}, pending: [] });
      }
      return jsonResponse({ ok: false });
    });
    vi.stubGlobal('fetch', fetchMock);

    fireEvent.click(getByText('serve'));

    const missEl = await findByTestId('restaurant-miss-message');
    expect(missEl.textContent).toMatch(/too slow|expired/i);
  });
});
