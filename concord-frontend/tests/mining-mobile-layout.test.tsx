/**
 * FIX-mining-005 + FIX-mining-010 — Mining at 390px.
 *
 * 005: the NorthStar floating "Add a site" CTA only switches to the Sites
 * tab; while already on Sites it floated over the panel's inline
 * site-entry form row. The page now passes the CTA only from the other
 * tabs — the inline form is the add path on Sites itself.
 * 010: the shared NorthStarFrame tab strip was a single-row
 * overflow-x-auto pill strip (trailing tabs clipped at 390px, page
 * sideways-scrollable). The strip half is cured by the landed shell
 * genus (c86910c5c, FIX-courtship-004 / fork-008 / deities-007): the
 * strip scrolls cleanly at 390px — native bar hidden, active pill
 * kept in view, right-edge fade while more tabs sit off-screen.
 * This seat's half: the frame root clips stray horizontal overflow
 * from panel content (overflow-x-clip).
 *
 * jsdom has no layout engine, so the pins assert the responsive contract
 * the classes encode (the desk's live re-walk verifies the rendered fit).
 */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/components/mining/MineSiteManager', () => ({ MineSiteManager: () => <div>sites panel</div> }));
vi.mock('@/components/mining/GeologyWorkbench', () => ({ GeologyWorkbench: () => <div>geology panel</div> }));
vi.mock('@/components/mining/MinePlanWorkbench', () => ({ MinePlanWorkbench: () => null }));
vi.mock('@/components/mining/FleetManager', () => ({ FleetManager: () => null }));
vi.mock('@/components/mining/GisPitMap', () => ({ GisPitMap: () => null }));
vi.mock('@/components/mining/MshaLookup', () => ({ MshaLookup: () => null }));
vi.mock('@/components/mining/EnvironmentalCompliance', () => ({ EnvironmentalCompliance: () => null }));
vi.mock('@/components/mining/MiningActionPanel', () => ({ MiningActionPanel: () => null }));
vi.mock('@/components/panel-polish', () => ({
  PipingProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import MiningLensPage from '@/app/lenses/mining/page';

describe('FIX-mining-005 — floating CTA vs the site-entry form', () => {
  it('shows no floating CTA on the Sites tab, and restores it from other tabs', () => {
    render(<MiningLensPage />);
    expect(screen.getByText('sites panel')).toBeTruthy();
    expect(screen.queryByTestId('north-star-cta')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Geology/ }));
    expect(screen.getByText('geology panel')).toBeTruthy();
    const cta = screen.getByTestId('north-star-cta');
    expect(cta.textContent).toContain('Add a site');
    fireEvent.click(cta);
    expect(screen.getByText('sites panel')).toBeTruthy();
    expect(screen.queryByTestId('north-star-cta')).toBeNull();
  });
});

describe('FIX-mining-010 — tab strip and frame at 390px', () => {
  it('scrolls the tab strip cleanly (landed shell genus) and clips horizontal overflow at the frame root', () => {
    const { container } = render(<MiningLensPage />);
    const nav = screen.getByRole('navigation', { name: 'Mining Operations views' });
    expect(nav.className).toContain('no-scrollbar');
    expect(nav.className).toContain('overflow-x-auto');
    expect(nav.className).not.toContain('flex-wrap');
    for (const label of ['Sites & Safety', 'Geology', 'Mine Plan', 'Fleet & Schedule', 'GIS Map', 'MSHA Compliance', 'Environmental', 'Quick Calcs']) {
      expect(screen.getByRole('button', { name: new RegExp(label.replace('&', '\\&')) })).toBeTruthy();
    }
    const frameRoot = container.querySelector('[data-lens-theme="mining"]');
    expect(frameRoot).toBeTruthy();
    expect(frameRoot!.className).toContain('overflow-x-clip');
  });
});
