/**
 * FIX-market-002 — 'Your Library' read `listings.library` from the
 * marketplace listings payload, but that route is the browse macro
 * alias and its payload carries no library field, so the stat was
 * 0 for every account. It now grounds on the caller's own DTU total
 * from /api/dtus/mine (the Analytics Total DTUs substrate), with a
 * payload library still taking precedence if one ever ships.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

describe('FIX-market-002 — Your Library count', () => {
  const s = read('components/market/MarketListingsPanel.tsx');
  it('grounds the count on /api/dtus/mine', () => {
    expect(s).toContain('apiHelpers.dtus.myDtus({ limit: 1 })');
    expect(s).toContain("queryKey: ['market-my-dtus']");
    expect(s).not.toContain('const libraryCount = listings?.library?.length ?? 0;');
  });
});
