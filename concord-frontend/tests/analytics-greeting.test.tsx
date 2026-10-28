/**
 * Analytics page northstar greeting.
 *
 * The Analytics concept (docs/lens-northstar/64) opens on the serif
 * headline "The one chart, Ramaj" — pick one stream, the chart draws
 * when it has points. This pins the page header carrying it with the
 * signed-in username. The desk panels are mocked away — the
 * greeting lives in the page's own header.
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
vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/LiveIndicator', () => ({ LiveIndicator: () => null }));
vi.mock('@/components/analytics/AnalyticsDeskPanel', () => ({ AnalyticsDeskPanel: () => null }));
vi.mock('@/components/analytics/PlatformGrowth', () => ({ PlatformGrowth: () => null }));
vi.mock('@/components/analytics/EventAnalytics', () => ({ EventAnalytics: () => null }));
vi.mock('@/components/analytics/AdvancedAnalytics', () => ({ AdvancedAnalytics: () => null }));
vi.mock('@/components/analytics/FunnelsPanel', () => ({ FunnelsPanel: () => null }));

import AnalyticsPage from '@/app/lenses/analytics/page';

describe('Analytics page greeting', () => {
  it('opens on the concept headline addressed to the signed-in user', () => {
    render(<AnalyticsPage />);
    const greeting = screen.getByTestId('analytics-greeting');
    expect(greeting.textContent).toBe('The one chart, ramaj');
    expect(greeting.className).toContain('font-vault');
  });
});
