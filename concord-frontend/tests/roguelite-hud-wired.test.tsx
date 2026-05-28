// Phase DB3 — Roguelite HUD + shop wiring tests.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

  it('purchase calls /api/roguelite/unlock', () => {
    expect(src).toMatch(/\/api\/roguelite\/unlock/);
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
