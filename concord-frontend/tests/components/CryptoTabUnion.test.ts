// FIX-crypto-002 — investigated at branch state; this source pin holds
// the invariant that makes the walked divergence impossible: the
// workspace has ONE view state. The tab strip's highlight, every tab
// section, and every goto-hotkey read or write the same `activeTab`
// state, so a hotkey cannot swap the content while the strip keeps
// another tab selected. (The walk ran against the Nov 9 deployed
// build; the current workspace is a single-state view machine.)

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(__dirname, '../../components/crypto/CryptoWalletWorkspace.tsx'), 'utf8');

describe('crypto tab union (FIX-crypto-002)', () => {
  it("the 's' hotkey writes the same state the strip highlights", () => {
    expect(src).toContain("keys: 's', description: 'Swap'");
    expect(src).toContain("action: () => setActiveTab('swap')");
    expect(src).toContain('const on = activeTab === tab.key');
  });

  it('the Swap section renders from that same state', () => {
    expect(src).toContain("{activeTab === 'swap' && (");
    expect(src).toContain("{activeTab === 'chart' && (");
  });

  it('there is no second tab/view state to diverge into', () => {
    const viewStates = src.match(/useState<[^>]*>\('(?:portfolio|chart|swap)'\)|useState\('(?:portfolio|chart|swap)'\)/g) || [];
    expect(viewStates.length).toBe(1);
  });
});
