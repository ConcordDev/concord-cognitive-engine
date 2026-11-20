/**
 * FIX-market-004 + FIX-market-005.
 * 004: listing titles accepted 250+ chars with no limit. (The market
 * lens's own create form carries no title field — the listing takes
 * its DTU's title — so the unbounded title inputs are the seller
 * form's, in the marketplace ListingsPanel.) Both now cap at the
 * platform's 120-char title convention with a counter.
 * (005 retired 2026-11-19: the Market lens became the Auction House; its
 * consign flow is pinned by tests/market-auction-house.test.tsx.)
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

describe('FIX-market-004 — listing title bound', () => {
  const s = read('components/marketplace/ListingsPanel.tsx');
  // The cap moved to the platform-wide BOUNDS.TITLE (lib/bounds.ts). The
  // counter must read the same bound the input enforces: a counter saying
  // "/ 120" over an input that takes 200 was the drift this now catches.
  it('create and edit titles are capped by the platform title bound, with counters that say the same bound', () => {
    expect(s.match(/value=\{(draft|editDraft)\.title\}[^>]*maxLength=\{BOUNDS\.TITLE\}/g)?.length).toBe(2);
    expect(s).toContain('{draft.title.length} / {BOUNDS.TITLE}');
    expect(s).toContain('{editDraft.title.length} / {BOUNDS.TITLE}');
    expect(s).not.toMatch(/title\.length\} \/ \d+/);
  });
});
