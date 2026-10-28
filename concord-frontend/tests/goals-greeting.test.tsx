/**
 * Goals page northstar greeting.
 *
 * The Goals concept (docs/lens-northstar/07) opens on the serif headline
 * "What matters this quarter, Ramaj" above the starter chips. This pins
 * the headline carrying the signed-in username. Panels are mocked away —
 * the greeting lives in the page's own header.
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
vi.mock('@/components/lens/RealtimeDataPanel', () => ({ RealtimeDataPanel: () => null }));
vi.mock('@/components/goals/GoalsListPanel', () => ({ GoalsListPanel: () => null, GOALS_NEW_EVENT: 'goals:new' }));
vi.mock('@/components/goals/ChallengesPanel', () => ({ ChallengesPanel: () => null }));
vi.mock('@/components/goals/MilestonesPanel', () => ({ MilestonesPanel: () => null }));
vi.mock('@/components/goals/OKRWorkspace', () => ({ OKRWorkspace: () => null }));
vi.mock('@/components/goals/GoalsAnalyticsTools', () => ({ GoalsAnalyticsTools: () => null }));
vi.mock('@/components/goals/AgentAutonomyPanel', () => ({ AgentAutonomyPanel: () => null }));
vi.mock('@/components/goals/ProductivityFeed', () => ({ ProductivityFeed: () => null }));

import GoalsLensPage from '@/app/lenses/goals/page';

describe('Goals page greeting', () => {
  it('opens on the concept headline addressed to the signed-in user', () => {
    render(<GoalsLensPage />);
    const greeting = screen.getByTestId('goals-greeting');
    expect(greeting.textContent).toBe('What matters this quarter, ramaj');
    expect(greeting.className).toContain('font-vault');
  });
});
