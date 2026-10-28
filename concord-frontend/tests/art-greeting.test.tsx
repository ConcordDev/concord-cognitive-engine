/**
 * Art page northstar greeting.
 *
 * The Art concept (docs/lens-northstar/40) opens on the serif
 * headline "Make a mark, Ramaj" — the canvas is the desk. This pins
 * the page header carrying it with the signed-in username. The mode
 * panels are mocked away — the greeting lives in the page's own
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
vi.mock('@/hooks/useLensIdentity', () => ({ useLensIdentity: () => {} }));
vi.mock('@/hooks/useRealtimeLens', () => ({
  useRealtimeLens: () => ({ latestData: null, alerts: [], insights: [], isLive: false, lastUpdated: null }),
}));
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/lens/RecentMineCard', () => ({ RecentMineCard: () => null }));
vi.mock('@/components/lens/AutoActionStrip', () => ({ AutoActionStrip: () => null }));
vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/LiveIndicator', () => ({ LiveIndicator: () => null }));
vi.mock('@/components/lens/DTUExportButton', () => ({ DTUExportButton: () => null }));
vi.mock('@/components/art/StudioPanel', () => ({ StudioPanel: () => null }));
vi.mock('@/components/art/GalleryPanel', () => ({ GalleryPanel: () => null }));
vi.mock('@/components/art/CanvasPanel', () => ({ CanvasPanel: () => null }));
vi.mock('@/components/art/MarketplacePanel', () => ({ MarketplacePanel: () => null }));
vi.mock('@/components/art/MyArtPanel', () => ({ MyArtPanel: () => null }));
vi.mock('@/components/art/MuseumPanel', () => ({ MuseumPanel: () => null }));
vi.mock('@/components/art/PaletteWorkshopPanel', () => ({ PaletteWorkshopPanel: () => null }));
vi.mock('@/components/art/ArtWorkbenchPanel', () => ({ ArtWorkbenchPanel: () => null }));

import ArtLensPage from '@/app/lenses/art/page';

describe('Art page greeting', () => {
  it('opens on the concept headline addressed to the signed-in user', () => {
    render(<ArtLensPage />);
    const greeting = screen.getByTestId('art-greeting');
    expect(greeting.textContent).toBe('Make a mark, ramaj');
    expect(greeting.className).toContain('font-vault');
  });
});
