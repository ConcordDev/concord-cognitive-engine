/**
 * Trades page northstar greeting.
 *
 * The Trades concept (docs/lens-northstar/68) opens on the serif
 * headline "The job on the board, Ramaj" above the dispatch card.
 * This pins the page header carrying it with the signed-in username.
 * The trade panels are mocked away — the greeting lives in the
 * page's own header.
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
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/components/lens/LiveIndicator', () => ({ LiveIndicator: () => null }));
vi.mock('@/components/lens/RealtimeDataPanel', () => ({ RealtimeDataPanel: () => null }));
const nullPanel = { default: () => null };
vi.mock('@/components/trades/ProjectDeskPanel', () => nullPanel);
vi.mock('@/components/trades/DispatchBoardPanel', () => nullPanel);
vi.mock('@/components/trades/SchedulingCalendarPanel', () => nullPanel);
vi.mock('@/components/trades/TechniciansPanel', () => nullPanel);
vi.mock('@/components/trades/FieldTrackingPanel', () => nullPanel);
vi.mock('@/components/trades/RouteOptimizerPanel', () => nullPanel);
vi.mock('@/components/trades/QuotesPanel', () => nullPanel);
vi.mock('@/components/trades/BookingsPanel', () => nullPanel);
vi.mock('@/components/trades/TimesheetsPanel', () => nullPanel);
vi.mock('@/components/trades/InvoicesPanel', () => nullPanel);
vi.mock('@/components/trades/PaymentsPanel', () => nullPanel);
vi.mock('@/components/trades/CustomerPortalPanel', () => nullPanel);
vi.mock('@/components/trades/RecurringPlansPanel', () => nullPanel);
vi.mock('@/components/trades/PricebookPanel', () => nullPanel);
vi.mock('@/components/trades/NotificationsPanel', () => nullPanel);
vi.mock('@/components/trades/ReviewsPanel', () => nullPanel);
vi.mock('@/components/trades/ReportingPanel', () => nullPanel);
vi.mock('@/components/trades/WorkbenchPanel', () => nullPanel);
vi.mock('@/components/trades/TradesFeed', () => ({ TradesFeed: () => null }));

import TradesLensPage from '@/app/lenses/trades/page';

describe('Trades page greeting', () => {
  it('opens on the concept headline addressed to the signed-in user', () => {
    render(<TradesLensPage />);
    const greeting = screen.getByTestId('trades-greeting');
    expect(greeting.textContent).toBe('The job on the board, ramaj');
    expect(greeting.className).toContain('font-vault');
  });
});
