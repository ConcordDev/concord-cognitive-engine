/**
 * Legal page northstar greeting.
 *
 * The Legal concept (docs/lens-northstar/60) opens on the serif
 * headline "The matter in front of you, Ramaj" — one document,
 * organization only, not legal advice. This pins the page header
 * carrying it with the signed-in username. The practice surfaces
 * are mocked away — the greeting lives in the page's own header.
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
vi.mock('@/components/mobile/MobileTabBar', () => ({ MobileTabBar: () => null }));
vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/ShellPreview', () => ({ ShellPreview: () => null }));
vi.mock('@/components/lens/LensAgentFab', () => ({ default: () => null }));
vi.mock('@/components/lens/LiveIndicator', () => ({ LiveIndicator: () => null }));
vi.mock('@/components/lens/RealtimeDataPanel', () => ({ RealtimeDataPanel: () => null }));
vi.mock('@/components/feeds/LensFeedPanel', () => ({ LensFeedPanel: () => null }));
vi.mock('@/components/lens/LiveFeed', () => ({ default: () => null }));
vi.mock('@/components/legal/ClioSection', () => ({ ClioSection: () => null }));
vi.mock('@/components/legal/ContractAnalyzer', () => ({ default: () => null }));
vi.mock('@/components/legal/CaseTracker', () => ({ default: () => null }));
vi.mock('@/components/legal/LegalQA', () => ({ default: () => null }));
vi.mock('@/components/legal/LegalCaseSearch', () => ({ LegalCaseSearch: () => null }));
vi.mock('@/components/legal/LegalActionPanel', () => ({ LegalActionPanel: () => null }));
vi.mock('@/components/legal/CourtProcedureReference', () => ({ CourtProcedureReference: () => null }));
vi.mock('@/components/panel-polish', () => ({
  PipingProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import LegalLensPage from '@/app/lenses/legal/page';

describe('Legal page greeting', () => {
  it('opens on the concept headline addressed to the signed-in user', () => {
    render(<LegalLensPage />);
    const greeting = screen.getByTestId('legal-greeting');
    expect(greeting.textContent).toBe('The matter in front of you, ramaj');
    expect(greeting.className).toContain('font-vault');
  });
});
