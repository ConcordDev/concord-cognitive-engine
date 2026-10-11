/**
 * Lock 100 CC with an empty wallet must say so. The page used to read the
 * outer envelope as success and banner "Locked 100 CC for 6mo."
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, screen } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
}));

vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/lens/NorthStarFrame', () => ({
  NorthStarFrame: ({
    children,
    cta,
  }: {
    children: React.ReactNode;
    cta?: { label: string; onClick: () => void };
  }) => (
    <div>
      {cta ? (
        <button type="button" onClick={cta.onClick}>
          {cta.label}
        </button>
      ) : null}
      {children}
    </div>
  ),
}));
vi.mock('@/components/lens/FirstRunTour', () => ({ FirstRunTour: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/components/staking/StakingMarkets', () => ({ StakingMarkets: () => null }));
vi.mock('@/components/staking/StakingPools', () => ({ StakingPools: () => null }));
vi.mock('@/components/staking/RewardsEstimator', () => ({ RewardsEstimator: () => null }));
vi.mock('@/components/staking/AprHistoryChart', () => ({ AprHistoryChart: () => null }));
vi.mock('@/components/staking/StakePositions', () => ({ StakePositions: () => null }));
vi.mock('@/components/staking/EarningsLedger', () => ({ EarningsLedger: () => null }));
vi.mock('@/components/staking/ReceiptTokens', () => ({ ReceiptTokens: () => null }));
vi.mock('@/components/staking/MaturityReminders', () => ({ MaturityReminders: () => null }));

import StakingPage from '@/app/lenses/staking/page';

beforeEach(() => {
  lensRun.mockReset();
});

describe('staking open_stake failure', () => {
  it('shows Failed: insufficient balance and does not claim a lock', async () => {
    lensRun.mockResolvedValue({
      data: { ok: false, result: { balance: 0, required: 100 }, error: 'insufficient_balance' },
    });
    render(<StakingPage />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Lock 100 CC' })[0]);
    const banner = await waitFor(() => screen.getByRole('status'));
    expect(banner).toHaveTextContent('Failed: insufficient balance');
    expect(screen.queryByText(/Locked 100 CC/)).toBeNull();
    expect(lensRun).toHaveBeenCalledWith(
      'staking',
      'open_stake',
      expect.objectContaining({ principalCc: 100, months: 6, poolId: 'core' }),
    );
  });
});
