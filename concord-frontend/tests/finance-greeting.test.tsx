/**
 * Finance page northstar greeting.
 *
 * The Finance concept (docs/lens-northstar/54) opens on the serif
 * headline "What you hold, Ramaj" — the book stays one list. This
 * pins the page header carrying it with the signed-in username. The
 * group panels are mocked away — the greeting lives in the page's
 * own header.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { username: 'ramaj' } }),
}));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useLensIdentity', () => ({ useLensIdentity: () => {} }));
vi.mock('@/hooks/useRealtimeLens', () => ({
  useRealtimeLens: () => ({ latestData: null, insights: [], isLive: false, lastUpdated: null }),
}));
vi.mock('@/lib/api/client', () => ({
  lensRun: () => Promise.resolve({ data: { ok: true, result: {} } }),
}));
vi.mock('@/lib/finance/price-feed', () => ({
  PriceFeedProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useSharedPriceFeed: () => ({ status: 'idle', quotes: {} }),
  priceFeedLabel: () => '',
}));
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/lens/DTUExportButton', () => ({ DTUExportButton: () => null }));
vi.mock('@/components/ui', () => ({
  StatTile: () => null,
  ErrorState: () => null,
  Skeleton: () => null,
  StatusDot: () => null,
}));
vi.mock('@/components/finance/SnapshotModal', () => ({ SnapshotModal: () => null }));
vi.mock('@/components/finance/SnapshotHistory', () => ({ SnapshotHistory: () => null }));
vi.mock('@/components/finance/OverviewPanel', () => ({ OverviewPanel: () => null }));
vi.mock('@/components/finance/FinanceGroupPanels', () => ({
  PositionsGroupPanel: () => null,
  CashflowGroupPanel: () => null,
  AccountsGroupPanel: () => null,
  PlanningGroupPanel: () => null,
  BillsBudgetGroupPanel: () => null,
  MacroGroupPanel: () => null,
  AssistantGroupPanel: () => null,
}));

import FinanceTerminalPage from '@/app/lenses/finance/page';

describe('Finance page greeting', () => {
  it('opens on the concept headline addressed to the signed-in user', () => {
    render(<FinanceTerminalPage />);
    const greeting = screen.getByTestId('finance-greeting');
    expect(greeting.textContent).toBe('What you hold, ramaj');
    expect(greeting.className).toContain('font-vault');
  });
});
