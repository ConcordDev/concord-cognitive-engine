/**
 * Research page northstar greeting.
 *
 * The Research concept (docs/lens-northstar/74) opens on the serif
 * headline "What are you reading, Ramaj" above the library search.
 * This pins the page header carrying it with the signed-in username.
 * The desk panels are mocked away — the greeting lives in the
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
vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/LiveIndicator', () => ({ LiveIndicator: () => null }));
vi.mock('@/components/lens/DTUExportButton', () => ({ DTUExportButton: () => null }));
vi.mock('@/components/research/SearchDeskPanel', () => ({ SearchDeskPanel: () => null }));
vi.mock('@/components/research/ResearchLibrarySection', () => ({ ResearchLibrarySection: () => null }));
vi.mock('@/components/research/CrossRefPanel', () => ({ CrossRefPanel: () => null }));
vi.mock('@/components/research/ResearchArxiv', () => ({ ResearchArxiv: () => null }));
vi.mock('@/components/research/ResearchWorkbench', () => ({ ResearchWorkbench: () => null }));

import ResearchLensPage from '@/app/lenses/research/page';

describe('Research page greeting', () => {
  it('opens on the concept headline addressed to the signed-in user', () => {
    render(<ResearchLensPage />);
    const greeting = screen.getByTestId('research-greeting');
    expect(greeting.textContent).toBe('What are you reading, ramaj');
    expect(greeting.className).toContain('font-vault');
  });
});
