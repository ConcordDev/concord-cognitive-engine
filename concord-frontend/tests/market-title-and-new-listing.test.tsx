/**
 * FIX-market-004 + FIX-market-005.
 * 004: listing titles accepted 250+ chars with no limit. (The market
 * lens's own create form carries no title field — the listing takes
 * its DTU's title — so the unbounded title inputs are the seller
 * form's, in the marketplace ListingsPanel.) Both now cap at the
 * platform's 120-char title convention with a counter.
 * 005: the market lens's 'New listing' CTA focused the search box
 * (the first input in the lens) instead of opening the form. It now
 * asks the listings panel to open its create form. (The panel's
 * empty state deliberately offers a single 'List a DTU' CTA instead
 * of the Create Listing button — a shipped, pinned choice.)
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

describe('FIX-market-004 — listing title bound', () => {
  const s = read('components/marketplace/ListingsPanel.tsx');
  it('create and edit titles are capped at the shared title bound, and the counters name that same bound', () => {
    // GB-1539: the cap is the shared BOUNDS.TITLE (the server's checkTitle ceiling) —
    // the visible counter must read the same constant, never a stale literal.
    expect(s.match(/maxLength=\{BOUNDS\.TITLE\}/g)?.length).toBeGreaterThanOrEqual(2);
    expect(s).toContain('{draft.title.length} / {BOUNDS.TITLE}');
    expect(s).toContain('{editDraft.title.length} / {BOUNDS.TITLE}');
    expect(s).not.toMatch(/title\.length\} \/ 120/);
  });
});

describe('FIX-market-005 — New listing opens the form', () => {
  it('the page CTA dispatches the open event instead of focusing search', () => {
    const s = read('app/lenses/market/page.tsx');
    expect(s).toContain("window.dispatchEvent(new CustomEvent('market:open-new-listing'))");
    expect(s).toContain('[data-market-create-form]');
  });
  it('the panel listens for the open event', () => {
    const s = read('components/market/MarketListingsPanel.tsx');
    expect(s).toContain("window.addEventListener('market:open-new-listing', open)");
    expect(s).toContain('data-market-create-form');
  });
});
