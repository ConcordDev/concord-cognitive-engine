/**
 * Accounting page northstar greeting.
 *
 * The Accounting concept (docs/lens-northstar/56) opens on the serif
 * headline "The books, Ramaj" above the period card. This pins the
 * page header carrying it with the signed-in username. The books
 * surfaces are mocked away — the greeting lives in the page's own
 * header.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { username: 'ramaj' } }),
}));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useRealtimeLens', () => ({
  useRealtimeLens: () => ({ latestData: null, insights: [], isLive: false, lastUpdated: null }),
}));
vi.mock('@/lib/api/client', () => ({
  api: { get: vi.fn(() => Promise.resolve({ data: {} })), post: vi.fn(() => Promise.resolve({ data: {} })) },
}));
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/LiveIndicator', () => ({ LiveIndicator: () => null }));
vi.mock('@/components/lens/RealtimeDataPanel', () => ({ RealtimeDataPanel: () => null }));
vi.mock('@/components/lens/IndicatorChart', () => ({ default: () => null }));
vi.mock('@/components/accounting/AccountingWorkbench', () => ({ default: () => null }));
vi.mock('@/components/accounting/BooksSection', () => ({ BooksSection: () => null }));
vi.mock('@/components/accounting/CategoryRulesPanel', () => ({ CategoryRulesPanel: () => null }));
vi.mock('@/components/panel-polish', () => ({
  PipingProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import AccountingLensPage from '@/app/lenses/accounting/page';

describe('Accounting page greeting', () => {
  it('opens on the concept headline addressed to the signed-in user', () => {
    render(<AccountingLensPage />);
    const greeting = screen.getByTestId('accounting-greeting');
    expect(greeting.textContent).toBe('The books, ramaj');
    expect(greeting.className).toContain('font-vault');
  });
});
