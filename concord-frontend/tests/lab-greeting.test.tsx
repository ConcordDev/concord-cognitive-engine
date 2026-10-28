/**
 * Lab page northstar greeting.
 *
 * The Lab concept (docs/lens-northstar/76) opens on the serif
 * headline "The experiment, Ramaj" — protocol, then result. This
 * pins the page header carrying it with the signed-in username.
 * The workbench/org surfaces are mocked away — the greeting lives
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
vi.mock('@/components/lab/ArxivLabFeed', () => ({ ArxivLabFeed: () => null }));
vi.mock('@/components/lab/ELNWorkbench', () => ({ ELNWorkbench: () => null }));
vi.mock('@/components/lab/LabOrgPanel', () => ({ LabOrgPanel: () => null }));
vi.mock('@/components/lens/RealtimeDataPanel', () => ({ RealtimeDataPanel: () => null }));
vi.mock('@/lib/hooks/use-lens-data', () => ({
  useLensData: () => ({ items: [], create: vi.fn(), update: vi.fn(), remove: vi.fn() }),
}));
vi.mock('@/lib/hooks/use-lens-artifacts', () => ({ useRunArtifact: () => vi.fn() }));
vi.mock('@/lib/api/client', () => ({ apiHelpers: { lens: { runDomain: vi.fn() } } }));
vi.mock('@/store/ui', () => ({ useUIStore: () => ({}) }));
vi.mock('@tanstack/react-query', () => ({
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  },
}));

import LabLensPage from '@/app/lenses/lab/page';

describe('Lab page greeting', () => {
  it('opens on the concept headline addressed to the signed-in user', () => {
    render(<LabLensPage />);
    const greeting = screen.getByTestId('lab-greeting');
    expect(greeting.textContent).toBe('The experiment, ramaj');
    expect(greeting.className).toContain('font-vault');
  });
});
