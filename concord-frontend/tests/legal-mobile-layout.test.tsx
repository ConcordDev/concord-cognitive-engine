/**
 * FIX-legal-010 — Legal at 390px.
 *
 * Three stacked defects: the workbench sub-tab strip was a scroll-edge
 * pill strip (Q&A and Case Law off-screen); the Practice shell's fixed
 * w-44 left rail ate ~half the viewport and clipped the Matters pane
 * and its create form; the page's own "Ask a question" button sat at
 * bottom-8 inside the mobile nav zone. The strip now wraps below sm,
 * ClioShell stacks below sm (rail → full-width horizontal nav strip,
 * main pane full width), and the button sits on the mobile CTA line.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

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
vi.mock('@/components/legal/ClioSection', () => ({ ClioSection: () => <div>practice workbench</div> }));
vi.mock('@/components/legal/ContractAnalyzer', () => ({ default: () => null }));
vi.mock('@/components/legal/CaseTracker', () => ({ default: () => null }));
vi.mock('@/components/legal/LegalQA', () => ({ default: () => null }));
vi.mock('@/components/legal/LegalCaseSearch', () => ({ LegalCaseSearch: () => null }));
vi.mock('@/components/legal/LegalActionPanel', () => ({ LegalActionPanel: () => null }));
vi.mock('@/components/legal/CourtProcedureReference', () => ({ CourtProcedureReference: () => null }));
vi.mock('@/components/panel-polish', () => ({
  PipingProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useRealtimeLens', () => ({
  useRealtimeLens: () => ({ data: null, insights: [], isLive: false, lastUpdated: null }),
}));

import LegalLensPage from '@/app/lenses/legal/page';
import { ClioShell } from '@/components/legal/ClioShell';

describe('FIX-legal-010 — workbench strip at 390px', () => {
  it('wraps below sm so Q&A and Case Law are visible', () => {
    render(<LegalLensPage />);
    const nav = screen.getByRole('navigation', { name: 'Legal workbench' });
    expect(nav.className).toContain('flex-wrap');
    expect(nav.className).toContain('sm:flex-nowrap');
    for (const label of ['Practice', 'Analyzer', 'Docket', 'Q&A', 'Case Law']) {
      expect(screen.getByRole('button', { name: new RegExp(label.replace('&', '\\&')) })).toBeTruthy();
    }
    const ask = screen.getByRole('button', { name: /Ask a question/ });
    expect(ask.className).toContain('bottom-[calc(4rem+env(safe-area-inset-bottom,0px))]');
    expect(ask.className).toContain('lg:bottom-8');
  });
});

describe('FIX-legal-010 — Practice shell at 390px', () => {
  it('stacks: rail becomes a full-width strip and the main pane takes the width', () => {
    const { container } = render(
      <ClioShell activeNav="matters" onNavChange={() => {}}>
        <div>matters pane</div>
      </ClioShell>,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain('flex-col');
    expect(root.className).toContain('sm:flex-row');
    const aside = container.querySelector('aside');
    expect(aside!.className).toContain('w-full');
    expect(aside!.className).toContain('sm:w-44');
    const main = container.querySelector('main');
    expect(main!.className).toContain('min-w-0');
    expect(screen.getByText('matters pane')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Matters/ })).toBeTruthy();
  });
});
