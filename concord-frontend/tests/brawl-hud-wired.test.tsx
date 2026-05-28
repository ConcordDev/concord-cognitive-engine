// Phase DB2 — Brawl HUDs wiring tests.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HUD = path.resolve(__dirname, '..', 'components', 'world', 'BrawlInviteToast.tsx');
const WORLD = path.resolve(__dirname, '..', 'app', 'lenses', 'world', 'page.tsx');

describe('Phase DB2 — Brawl HUDs', () => {
  const src = readFileSync(HUD, 'utf8');

  it('toast listens for concordia:brawl-invited', () => {
    expect(src).toMatch(/concordia:brawl-invited/);
  });

  it('accept calls /api/combat/brawl/accept', () => {
    expect(src).toMatch(/\/api\/combat\/brawl\/accept/);
  });

  it('decline calls /api/combat/brawl/decline', () => {
    expect(src).toMatch(/\/api\/combat\/brawl\/decline/);
  });

  it('active HUD shows sifu_brawler profile + end button', () => {
    expect(src).toMatch(/sifu_brawler/);
    expect(src).toMatch(/\/api\/combat\/brawl\/end/);
  });

  it('mounted in world lens (both components)', () => {
    const w = readFileSync(WORLD, 'utf8');
    expect(w).toMatch(/BrawlInviteToast/);
    expect(w).toMatch(/BrawlActiveHUD/);
  });
});
