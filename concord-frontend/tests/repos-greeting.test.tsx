/**
 * Repos page northstar greeting.
 *
 * The Repos concept (docs/lens-northstar/34) opens on the serif
 * headline "Your repos, Ramaj" above the substrate list. This pins
 * the page header carrying it with the signed-in username. The
 * workspace/explorer surfaces are mocked away — the greeting lives
 * in the page's own header.
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
vi.mock('@/components/lens/DTUExportButton', () => ({ DTUExportButton: () => null }));
vi.mock('@/components/lens/RealtimeDataPanel', () => ({ RealtimeDataPanel: () => null }));
vi.mock('@/components/repos/TrendingRepos', () => ({ TrendingRepos: () => null }));
vi.mock('@/components/repos/ConcordRepoWorkspace', () => ({ ConcordRepoWorkspace: () => null }));
vi.mock('@/components/repos-explorer/RepoBrowser', () => ({ RepoBrowser: () => null }));

import ReposLensPage from '@/app/lenses/repos/page';

describe('Repos page greeting', () => {
  it('opens on the concept headline addressed to the signed-in user', () => {
    render(<ReposLensPage />);
    const greeting = screen.getByTestId('repos-greeting');
    expect(greeting.textContent).toBe('Your repos, ramaj');
    expect(greeting.className).toContain('font-vault');
  });
});
