// Crypto honesty: the Swap tab is an indicative QUOTE (crypto.swap-quote),
// never an executed trade. Price impact / gas come back null from the server
// and must render as "not estimated" (not crash, not invented numbers); a
// failed quote must say so instead of fabricating a fallback rate; there is
// no swap button; the workspace has no empty .dtu export and no fake
// "completed" swap transaction; Send says it is ledger-only.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

import { SwapPanel, SWAP_NOT_SUPPORTED } from '@/components/crypto/SwapPanel';

const tokens = [
  { id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', priceUsd: 60000, balance: 1 },
  { id: 'usd-coin', symbol: 'USDC', name: 'USD Coin', priceUsd: 1, balance: 100 },
];

function typeAmount(v: string) {
  const inputs = screen.getAllByPlaceholderText('0.0');
  fireEvent.change(inputs[0], { target: { value: v } });
}

beforeEach(() => lensRunMock.mockReset());

describe('SwapPanel is quote-only', () => {
  it('renders the real indicative quote with null impact/gas as "not estimated"', async () => {
    lensRunMock.mockResolvedValue({
      data: {
        ok: true,
        result: {
          amountOut: 29910, rate: 60000, priceImpactPercent: null, gasEstimateUsd: null,
          minimumReceived: 29760.45, feeUsd: 90, route: ['BITCOIN', 'USD-COIN'],
        },
      },
    });
    render(<SwapPanel tokens={tokens} defaultFromSymbol="BTC" defaultToSymbol="USDC" />);
    typeAmount('0.5');
    await waitFor(() => expect(screen.getAllByText('not estimated')).toHaveLength(2));
    expect(screen.getByText(/1 BTC = 60,000 USDC/)).toBeTruthy();
    expect(screen.getByTestId('swap-not-supported').textContent).toContain(SWAP_NOT_SUPPORTED);
    const names = screen.getAllByRole('button').map((b) => b.getAttribute('aria-label') || b.textContent || '');
    expect(names.filter((n) => /^Swap \w+ →/.test(n))).toEqual([]);
    expect(names).toContain('Swap settings');
  });

  it('a failed quote says unavailable and invents no fallback rate', async () => {
    lensRunMock.mockResolvedValue({ data: { ok: false, error: 'coingecko unreachable' } });
    render(<SwapPanel tokens={tokens} defaultFromSymbol="BTC" defaultToSymbol="USDC" />);
    typeAmount('0.5');
    await waitFor(() => expect(screen.getByText(/Quote unavailable: coingecko unreachable/)).toBeTruthy());
    expect(screen.queryByText(/Rate/)).toBeNull();
    expect(screen.queryByText(/fallback/i)).toBeNull();
  });
});

describe('Crypto workspace source honesty', () => {
  const ws = readFileSync(join(__dirname, '../components/crypto/CryptoWalletWorkspace.tsx'), 'utf8');
  const panel = readFileSync(join(__dirname, '../components/crypto/SwapPanel.tsx'), 'utf8');
  it('has no empty .dtu export and no fake executed swap', () => {
    expect(ws).not.toContain('DTUExportButton');
    expect(ws).not.toMatch(/onSwap|Swap simulated|Gas estimate built in/);
    expect(panel).not.toMatch(/gasEstimateUsd: 1\.2|priceImpactPercent: 0\.12|onSwap/);
  });
  it('Send says it is ledger-only and chain broadcast is not supported yet', () => {
    expect(ws).toContain('data-testid="send-ledger-only"');
    expect(ws).toMatch(/Broadcasting to a blockchain isn&apos;t supported yet/);
    expect(ws).toContain('Record send');
  });
});

describe('WalletShell renders no dead action tiles', () => {
  it('omits Send/Receive/Swap tiles that have no handler, and shows only wired ones', async () => {
    const { WalletShell } = await import('@/components/crypto/WalletShell');
    const { unmount } = render(<WalletShell totalFiat={0} assets={[]} txs={[]} />);
    expect(screen.queryByTestId('wallet-shell-actions')).toBeNull();
    expect(screen.queryByText(/24h/)).toBeNull();
    unmount();
    const onReceive = vi.fn();
    render(<WalletShell totalFiat={0} assets={[]} txs={[]} onReceive={onReceive} />);
    expect(screen.getByRole('button', { name: 'Receive' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Receive' }));
    expect(onReceive).toHaveBeenCalled();
  });

  it('the crypto shell preview passes real transactions and no invented 24h delta', () => {
    const src = readFileSync(join(__dirname, '../components/lens/ShellPreview.tsx'), 'utf8');
    expect(src).toContain("action: 'transactions-list'");
    expect(src).not.toMatch(/totalDeltaPct: 0/);
  });
});
