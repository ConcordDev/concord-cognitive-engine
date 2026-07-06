/// <reference types="@testing-library/jest-dom/vitest" />
// Pins the /api/lens/run envelope-unwrap fix: the endpoint always responds
// { ok: true, result: PAYLOAD } where PAYLOAD is the macro's own return
// value (walker.arbitrage -> { ok, opps, count }, walker.trade_routes ->
// { ok, walkers, count }). Reading `opps`/`count` off the top-level response
// (pre-fix) left them permanently undefined.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

import WalkerArbitrageMap from './WalkerArbitrageMap';

function mockLensRunFetch() {
  global.fetch = vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body || '{}'));
    if (body.domain === 'walker' && body.name === 'arbitrage') {
      return {
        ok: true,
        json: async () => ({
          ok: true,
          result: {
            ok: true,
            worldId: body.input?.worldId,
            opps: [
              { commodity: 'zinc', buyRegion: 'heartmere', buyScarcity: 0.1, sellRegion: 'fall-kill', sellScarcity: 0.5, delta: 0.4 },
            ],
            count: 1,
          },
        }),
      };
    }
    if (body.domain === 'walker' && body.name === 'trade_routes') {
      return {
        ok: true,
        json: async () => ({
          ok: true,
          result: { ok: true, worldId: body.input?.worldId, walkers: [{ id: 'w1' }, { id: 'w2' }], count: 2 },
        }),
      };
    }
    return { ok: false, json: async () => ({ ok: false }) };
  }) as unknown as typeof fetch;
}

describe('WalkerArbitrageMap', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('reads opps + walker count from the nested .result payload', async () => {
    mockLensRunFetch();
    render(<WalkerArbitrageMap worldId="concordia-hub" />);

    // Collapsed toggle button shows both counts derived from the macro payloads.
    await waitFor(() => {
      expect(screen.getByText(/2 walkers/)).toBeInTheDocument();
      expect(screen.getByText(/1 arbitrage/)).toBeInTheDocument();
    });
  });
});
