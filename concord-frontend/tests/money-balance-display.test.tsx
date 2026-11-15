/**
 * FIX-auction-009 + FIX-marketplace-004 (balance leg) — neither lens
 * showed a CC balance although bids, escrow and purchases draw on
 * the wallet. Both now display the balance through the platform's
 * shared useWalletBalance hook (display-only; no money movement is
 * wired by these changes).
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

describe('money-lens balance display', () => {
  it('auction board + bid dialog show the balance', () => {
    const s = read('components/auction/BoardPanel.tsx');
    expect(s).toContain('useWalletBalance');
    expect(s).toContain('Balance:');
    expect(s).toContain('Your balance: {ccBalance.toLocaleString()} CC.');
  });

  it('marketplace app header shows the balance', () => {
    const s = read('components/marketplace/MarketplaceApp.tsx');
    expect(s).toContain('useWalletBalance');
    expect(s).toContain('Your balance: ${ccBalance} CC');
  });
});
