/**
 * Fractal page northstar greeting.
 *
 * The Fractal concept (docs/lens-northstar/42, "Visuals") opens on
 * the serif headline "One image, Ramaj" beside the render. This pins
 * the page header carrying it with the signed-in username. The
 * renderer/repos surfaces are mocked away — the greeting lives in
 * the page's own header.
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
vi.mock('@/components/fractal/FractalRepos', () => ({ FractalRepos: () => null }));
vi.mock('@/components/fractal/FractalRenderer', () => ({ FractalRenderer: () => null }));

import FractalLensPage from '@/app/lenses/fractal/page';

describe('Fractal page greeting', () => {
  it('opens on the concept headline addressed to the signed-in user', () => {
    render(<FractalLensPage />);
    const greeting = screen.getByTestId('fractal-greeting');
    expect(greeting.textContent).toBe('One image, ramaj');
    expect(greeting.className).toContain('font-vault');
  });
});
