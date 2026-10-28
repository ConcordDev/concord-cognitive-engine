/**
 * Agents page northstar greeting.
 *
 * The Agents concept (docs/lens-northstar/80) opens on the serif
 * headline "Who is working, Ramaj" — one agent, one job. This pins
 * the page header carrying it with the signed-in username. The
 * fleet surfaces are mocked away — the greeting lives in the page's
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
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/lens/SessionRail', () => ({ SessionRail: () => null }));
vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/LiveIndicator', () => ({ LiveIndicator: () => null }));
vi.mock('@/components/lens/DTUExportButton', () => ({ DTUExportButton: () => null }));
vi.mock('@/components/lens/RealtimeDataPanel', () => ({ RealtimeDataPanel: () => null }));
vi.mock('@/components/agents/FleetPanel', () => ({ FleetPanel: () => null }));
vi.mock('@/components/agents/AgentRoster', () => ({ AgentRoster: () => null }));
vi.mock('@/components/agents/ForkPreviewPanel', () => ({ ForkPreviewPanel: () => null }));

import AgentsLensPage from '@/app/lenses/agents/page';

describe('Agents page greeting', () => {
  it('opens on the concept headline addressed to the signed-in user', () => {
    render(<AgentsLensPage />);
    const greeting = screen.getByTestId('agents-greeting');
    expect(greeting.textContent).toBe('Who is working, ramaj');
    expect(greeting.className).toContain('font-vault');
  });
});
