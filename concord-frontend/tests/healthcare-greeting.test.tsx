/**
 * Healthcare page northstar greeting.
 *
 * The Healthcare concept (docs/lens-northstar/58) opens on the serif
 * headline "Who is in front of you, Ramaj" — one encounter, chart
 * first. This pins the page header carrying it with the signed-in
 * username. The clinical sections are mocked away — the greeting
 * lives in the page's own header.
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
vi.mock('@/components/lens/ShellPreview', () => ({ ShellPreview: () => null }));
vi.mock('@/components/mobile/MobileTabBar', () => ({ MobileTabBar: () => null }));
vi.mock('@/components/lens/SubLensQuickNav', () => ({ SubLensQuickNav: () => null }));
vi.mock('@/components/lens/LiveIndicator', () => ({ LiveIndicator: () => null }));
vi.mock('@/components/lens/RealtimeDataPanel', () => ({ RealtimeDataPanel: () => null }));
vi.mock('@/components/lens/LiveFeed', () => ({
  default: () => null,
  adaptToLiveFeedArticles: () => [],
}));
vi.mock('@/components/feeds/LensFeedPanel', () => ({ LensFeedPanel: () => null }));
vi.mock('@/components/healthcare/EpicSection', () => ({ EpicSection: () => null }));

import HealthcareLensPage from '@/app/lenses/healthcare/page';

describe('Healthcare page greeting', () => {
  it('opens on the concept headline addressed to the signed-in user', () => {
    render(<HealthcareLensPage />);
    const greeting = screen.getByTestId('healthcare-greeting');
    expect(greeting.textContent).toBe('Who is in front of you, ramaj');
    expect(greeting.className).toContain('font-vault');
  });
});
