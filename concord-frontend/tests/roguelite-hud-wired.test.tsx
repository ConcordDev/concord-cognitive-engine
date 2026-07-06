// Phase DB3 — Roguelite HUD + shop wiring tests.
//
// The "purchase calls /api/roguelite/unlock" case (2026-07-06 re-fix,
// verification-audit campaign) used to only regex-match the component's
// source text — it would still pass even if the purchase button were wired
// to call the wrong endpoint or nothing at all, as long as the literal
// string '/api/roguelite/unlock' appeared anywhere in the file. Rewritten to
// render the real `RogueliteUnlockShop`, mock the global `fetch` it actually
// calls (it uses raw fetch, not the axios `api` client or `lensRun`), open
// the shop via the real `concordia:open-roguelite-shop` event, click the
// real purchase button, and assert fetch was actually invoked with the real
// endpoint + method + the specific unlock's id/cost — and that the resulting
// UI reflects the mocked server's response.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, act, fireEvent, waitFor } from '@testing-library/react';
import { RogueliteUnlockShop } from '@/components/world/RogueliteRunHUD';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, '..', 'components', 'world', 'RogueliteRunHUD.tsx');
const WORLD = path.resolve(__dirname, '..', 'app', 'lenses', 'world', 'page.tsx');

describe('Phase DB3 — Roguelite HUDs', () => {
  const src = readFileSync(SRC, 'utf8');

  it('polls /api/roguelite/active + balance', () => {
    expect(src).toMatch(/\/api\/roguelite\/active/);
    expect(src).toMatch(/\/api\/roguelite\/balance/);
  });

  it('shop fetches /api/roguelite/catalog + /unlocks', () => {
    expect(src).toMatch(/\/api\/roguelite\/catalog/);
    expect(src).toMatch(/\/api\/roguelite\/unlocks/);
  });

  describe('purchase — real fetch wiring (rendered, not source-matched)', () => {
    const CATALOG = [{ id: 'unlock-ember-blade', name: 'Ember Blade', cost: 250, description: 'A blade wreathed in ember.' }];
    let fetchMock: ReturnType<typeof vi.fn>;

    function jsonResponse(body: unknown, ok = true) {
      return Promise.resolve({ ok, json: () => Promise.resolve(body) } as Response);
    }

    beforeEach(() => {
      fetchMock = vi.fn((url: string, init?: RequestInit) => {
        if (url === '/api/roguelite/catalog') return jsonResponse({ ok: true, unlocks: CATALOG });
        if (url === '/api/roguelite/unlocks') return jsonResponse({ ok: true, unlocks: [] });
        if (url === '/api/roguelite/balance') return jsonResponse({ ok: true, balance: 1000 });
        if (url === '/api/roguelite/unlock' && init?.method === 'POST') return jsonResponse({ ok: true });
        return jsonResponse({ ok: false });
      });
      vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('purchase calls /api/roguelite/unlock', async () => {
      const { findByText } = render(<RogueliteUnlockShop />);

      // Open via the real event this shop listens for.
      act(() => { window.dispatchEvent(new CustomEvent('concordia:open-roguelite-shop')); });

      const buyButton = await findByText('250 souls');
      fireEvent.click(buyButton);

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith('/api/roguelite/unlock', expect.objectContaining({
          method: 'POST',
          credentials: 'include',
          body: JSON.stringify({ unlockId: 'unlock-ember-blade', costCc: 250 }),
        }));
      });

      // The success flash only renders if the component actually parsed a
      // real `{ ok: true }` response from the mocked purchase call.
      await findByText('Unlocked: Ember Blade');
    });
  });

  it('shop listens for concordia:open-roguelite-shop event', () => {
    expect(src).toMatch(/concordia:open-roguelite-shop/);
  });

  it('mounted in world lens', () => {
    const w = readFileSync(WORLD, 'utf8');
    expect(w).toMatch(/RogueliteRunHUD/);
    expect(w).toMatch(/RogueliteUnlockShop/);
  });
});
