/**
 * Projects page northstar greeting.
 *
 * The Projects concept (docs/lens-northstar/62) opens on the serif
 * headline "What's in flight, Ramaj" above the honest empty state.
 * This pins the page header carrying it with the signed-in username.
 * The section/repos surfaces are mocked away — the greeting lives
 * in the page's own header.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { username: 'ramaj' } }),
}));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useRealtimeLens', () => ({
  useRealtimeLens: () => ({ latestData: null, insights: [], isLive: false, lastUpdated: null }),
}));
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/lens/SessionRail', () => ({ SessionRail: () => null }));
vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/LiveIndicator', () => ({ LiveIndicator: () => null }));
vi.mock('@/components/lens/RealtimeDataPanel', () => ({ RealtimeDataPanel: () => null }));
vi.mock('@/components/projects/ProjectsSection', () => ({ ProjectsSection: () => null }));
vi.mock('@/components/projects/ProjectMgmtRepos', () => ({ ProjectMgmtRepos: () => null }));

import ProjectsLensPage from '@/app/lenses/projects/page';

describe('Projects page greeting', () => {
  it('opens on the concept headline addressed to the signed-in user', () => {
    render(<ProjectsLensPage />);
    const greeting = screen.getByTestId('projects-greeting');
    expect(greeting.textContent).toBe("What's in flight, ramaj");
    expect(greeting.className).toContain('font-vault');
  });
});
