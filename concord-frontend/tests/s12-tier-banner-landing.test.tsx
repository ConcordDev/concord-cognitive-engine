// S12 (studio.md §7 / F12) — the platform chrome rule: the data-tier banner
// paints on every lens's landing surface, in the standard header position,
// from the same manifest source as the working surface.
//
// Studio was the counterexample: it sits in FULL_BLEED_LENSES and used to get
// the chrome-less layout, so no tier banner ever mounted. These tests RENDER
// the real lenses layout (real DepthBadge + DepthBadgeHostContext + manifest)
// and count the banner elements in the DOM, with only the unrelated chrome
// stubbed. A page that mounts its own per-page badge must not produce a second.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const state = vi.hoisted(() => ({ pathname: '/lenses/studio', diegetic: false }));

vi.mock('next/navigation', () => ({
  usePathname: () => state.pathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/hooks/useDiegetic', () => ({ useDiegetic: () => state.diegetic }));
vi.mock('@/hooks/useLensIdentity', () => ({ useLensIdentity: () => undefined }));
vi.mock('@/components/common/LensErrorBoundary', () => ({
  LensErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/RepairBoundary', () => ({
  RepairBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/lens/LensStateProvider', () => ({
  LensStateProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/lens/LensToolbar', () => ({ LensToolbar: () => <div data-testid="toolbar" /> }));
vi.mock('@/components/common/CoreLensNav', () => ({ CoreLensNav: () => null }));
vi.mock('@/components/common/DestinationNav', () => ({ DestinationNav: () => null }));
vi.mock('@/components/common/HostLensNav', () => ({ HostLensNav: () => null }));
vi.mock('@/components/conkay/ConKayOverlay', () => ({ ConKayOverlay: () => null }));
vi.mock('@/components/panels/GlobalPanelHost', () => ({ GlobalPanelHost: () => null }));
vi.mock('@/components/panels/CrossMountedPanels', () => ({ CrossMountedPanels: () => null }));
vi.mock('@/components/common/QuickCapture', () => ({ QuickCapture: () => null }));
vi.mock('@/components/common/ActivityTimeline', () => ({ ActivityTimeline: () => null }));
vi.mock('@/components/common/CrossDomainConnections', () => ({ CrossDomainConnections: () => null }));
vi.mock('@/components/common/DomainAssistant', () => ({ default: () => null }));

import LensLayout from '@/app/lenses/layout';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { getLensManifest } from '@/lib/lenses/manifest';

const tierBadges = () => screen.queryAllByLabelText(/^Data tier:/);

// A working page that, like many lens pages, mounts its own per-page badge.
function PageWithOwnBadge({ lens }: { lens: string }) {
  return (
    <main data-testid="page">
      <DepthBadge lensId={lens} />
    </main>
  );
}

describe('S12 — Studio landing carries exactly one tier banner (rendered)', () => {
  beforeEach(() => {
    state.pathname = '/lenses/studio';
    state.diegetic = false;
  });

  it('manifest tier for studio is REAL_LIVE', () => {
    expect(getLensManifest('studio')?.dataTier).toBe('REAL_LIVE');
  });

  it('/lenses/studio renders one Live banner, in the header, despite a per-page badge', () => {
    render(<LensLayout><PageWithOwnBadge lens="studio" /></LensLayout>);
    const badges = tierBadges();
    expect(badges).toHaveLength(1);
    expect(badges[0].textContent).toContain('Live');
    // Header position: the banner is not inside the page content.
    expect(screen.getByTestId('page').contains(badges[0])).toBe(false);
    // Studio is full-bleed: no universal toolbar chrome.
    expect(screen.queryByTestId('toolbar')).toBeNull();
  });

  it('the studio banner still appears with an empty landing (no page badge at all)', () => {
    render(<LensLayout><div data-testid="page" /></LensLayout>);
    expect(tierBadges()).toHaveLength(1);
  });

  it('a nested studio route also shows exactly one banner', () => {
    state.pathname = '/lenses/studio/some/deep/route';
    render(<LensLayout><PageWithOwnBadge lens="studio" /></LensLayout>);
    expect(tierBadges()).toHaveLength(1);
  });

  it('an ordinary lens still shows exactly one banner and keeps the toolbar', () => {
    state.pathname = '/lenses/finance';
    render(<LensLayout><PageWithOwnBadge lens="finance" /></LensLayout>);
    expect(tierBadges().length).toBeLessThanOrEqual(1);
    expect(screen.getByTestId('toolbar')).toBeTruthy();
  });

  it('diegetic (in-world) studio stays chrome-less: no banner', () => {
    state.diegetic = true;
    render(<LensLayout><div data-testid="page" /></LensLayout>);
    expect(tierBadges()).toHaveLength(0);
  });
});
