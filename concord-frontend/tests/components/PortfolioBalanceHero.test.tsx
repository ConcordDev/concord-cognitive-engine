/**
 * PortfolioBalanceHero — the crypto lens's Coinbase-style "big balance"
 * hero. Pins: real value-change flash (never a timer-driven fake), the
 * loading skeleton gating the balance so it never shows a bogus $0.00,
 * hide/show + refresh wiring, and the discoverable "H" shortcut hint.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

vi.mock('@/components/lens/LiveIndicator', () => ({ LiveIndicator: () => null }));

import { PortfolioBalanceHero } from '@/components/crypto/PortfolioBalanceHero';

describe('PortfolioBalanceHero', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('renders the real portfolio total, formatted', () => {
    render(
      <PortfolioBalanceHero
        totalValue={1234.5}
        netFlow={10}
        totalEarned={100}
        chainCount={2}
        walletCount={1}
        showBalances
        onToggleBalances={vi.fn()}
        onRefresh={vi.fn()}
      />
    );
    expect(screen.getByTestId('portfolio-balance')).toHaveTextContent('$1,234.50');
    expect(screen.getByText(/2 chains/)).toBeInTheDocument();
    expect(screen.getByText(/1 wallet\b/)).toBeInTheDocument();
  });

  it('masks the balance when showBalances is false — never leaks the real number', () => {
    render(
      <PortfolioBalanceHero
        totalValue={9999}
        netFlow={0}
        totalEarned={0}
        chainCount={1}
        walletCount={1}
        showBalances={false}
        onToggleBalances={vi.fn()}
        onRefresh={vi.fn()}
      />
    );
    expect(screen.getByTestId('portfolio-balance')).toHaveTextContent('••••••');
    expect(screen.queryByText('9,999')).not.toBeInTheDocument();
  });

  it('shows a loading skeleton instead of a bogus $0.00 while data is still loading', () => {
    render(
      <PortfolioBalanceHero
        totalValue={0}
        netFlow={0}
        totalEarned={0}
        chainCount={0}
        walletCount={0}
        showBalances
        onToggleBalances={vi.fn()}
        onRefresh={vi.fn()}
        isLoading
      />
    );
    expect(screen.queryByTestId('portfolio-balance')).not.toBeInTheDocument();
  });

  it('calls onToggleBalances / onRefresh on click', () => {
    const onToggleBalances = vi.fn();
    const onRefresh = vi.fn();
    render(
      <PortfolioBalanceHero
        totalValue={100}
        netFlow={0}
        totalEarned={0}
        chainCount={1}
        walletCount={1}
        showBalances
        onToggleBalances={onToggleBalances}
        onRefresh={onRefresh}
      />
    );
    fireEvent.click(screen.getByTitle('Hide balances (H)'));
    expect(onToggleBalances).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTitle('Refresh'));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('advertises the H shortcut as a discoverable kbd chip, not a hidden gesture', () => {
    render(
      <PortfolioBalanceHero
        totalValue={100}
        netFlow={0}
        totalEarned={0}
        chainCount={1}
        walletCount={1}
        showBalances
        onToggleBalances={vi.fn()}
        onRefresh={vi.fn()}
      />
    );
    expect(screen.getByText('H').tagName.toLowerCase()).toBe('kbd');
  });

  it('flashes green when the real total goes up between renders, then clears — never on a timer alone', () => {
    const { rerender } = render(
      <PortfolioBalanceHero
        totalValue={100}
        netFlow={0}
        totalEarned={10}
        chainCount={1}
        walletCount={1}
        showBalances
        onToggleBalances={vi.fn()}
        onRefresh={vi.fn()}
      />
    );
    expect(screen.getByTestId('portfolio-balance').className).not.toMatch(/neon-green|neon-pink/);

    rerender(
      <PortfolioBalanceHero
        totalValue={150}
        netFlow={0}
        totalEarned={10}
        chainCount={1}
        walletCount={1}
        showBalances
        onToggleBalances={vi.fn()}
        onRefresh={vi.fn()}
      />
    );
    expect(screen.getByTestId('portfolio-balance').className).toMatch(/text-neon-green/);

    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.getByTestId('portfolio-balance').className).not.toMatch(/neon-green|neon-pink/);
  });

  it('flashes pink (down) when the real total decreases', () => {
    const { rerender } = render(
      <PortfolioBalanceHero
        totalValue={200}
        netFlow={0}
        totalEarned={10}
        chainCount={1}
        walletCount={1}
        showBalances
        onToggleBalances={vi.fn()}
        onRefresh={vi.fn()}
      />
    );
    rerender(
      <PortfolioBalanceHero
        totalValue={120}
        netFlow={0}
        totalEarned={10}
        chainCount={1}
        walletCount={1}
        showBalances
        onToggleBalances={vi.fn()}
        onRefresh={vi.fn()}
      />
    );
    expect(screen.getByTestId('portfolio-balance').className).toMatch(/text-neon-pink/);
  });

  it('does not flash while loading, and does not flash on the transition out of loading', () => {
    const { rerender } = render(
      <PortfolioBalanceHero
        totalValue={0}
        netFlow={0}
        totalEarned={0}
        chainCount={0}
        walletCount={0}
        showBalances
        onToggleBalances={vi.fn()}
        onRefresh={vi.fn()}
        isLoading
      />
    );
    rerender(
      <PortfolioBalanceHero
        totalValue={500}
        netFlow={0}
        totalEarned={0}
        chainCount={1}
        walletCount={1}
        showBalances
        onToggleBalances={vi.fn()}
        onRefresh={vi.fn()}
        isLoading={false}
      />
    );
    expect(screen.getByTestId('portfolio-balance').className).not.toMatch(/neon-green|neon-pink/);
  });
});
