/**
 * FIX-lattice-008 — Lattice at 390px.
 *
 * The section strip was a single-row scroll-edge pill strip: only
 * Overview/Consent/part of Brains showed, and the active highlight sat
 * off-screen for Training/Schedule/Repos. The strip now wraps below sm
 * (sm+ keeps the scrollable pill strip) and the page root clips stray
 * horizontal overflow. The Schedule cadence table was a bare w-full
 * table whose columns squeezed until the last (Enabled) clipped; it
 * now carries a min-width so its overflow-x-auto wrapper scrolls.
 */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/components/lattice/OverviewPanel', () => ({ OverviewPanel: () => <div>overview panel</div> }));
vi.mock('@/components/lattice/ConsentPanel', () => ({ ConsentPanel: () => null }));
vi.mock('@/components/lattice/BrainsPanel', () => ({ BrainsPanel: () => null }));
vi.mock('@/components/lattice/TrainingRuns', () => ({ TrainingRuns: () => null }));
vi.mock('@/components/lattice/RefreshPanel', () => ({ RefreshPanel: () => null }));
vi.mock('@/components/lattice/AuditAndDrift', () => ({ AuditAndDrift: () => null }));
vi.mock('@/components/lattice/FederationPanel', () => ({ FederationPanel: () => null }));
vi.mock('@/components/lattice/LatticeRepos', () => ({ LatticeRepos: () => null }));

vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) => {
    if (queryKey[0] === 'lattice-schedule') {
      return {
        data: { ok: true, canEdit: false, schedule: [{ brain_id: 'conscious', enabled: true, cadence: 'daily', next_run_at: null, updated_at: null }] },
        isLoading: false, isError: false, isFetching: false, refetch: vi.fn(),
      };
    }
    return { data: { ok: true, tests: [] }, isLoading: false, isError: false, isFetching: false, refetch: vi.fn() };
  },
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

import LatticeLensPage from '@/app/lenses/lattice/page';
import { RefreshSchedule } from '@/components/lattice/RefreshSchedule';

describe('FIX-lattice-008 — section strip at 390px', () => {
  it('wraps below sm and tracks the active section visibly', () => {
    render(<LatticeLensPage />);
    const nav = screen.getByRole('navigation', { name: 'Lattice sections' });
    expect(nav.className).toContain('flex-wrap');
    expect(nav.className).toContain('sm:flex-nowrap');
    for (const label of ['Overview', 'Consent', 'Brains', 'Training', 'Schedule', 'Refresh', 'Audit', 'Federation', 'Repos']) {
      expect(screen.getByRole('button', { name: new RegExp(label) })).toBeTruthy();
    }
    fireEvent.click(screen.getByRole('button', { name: /Schedule/ }));
    expect(screen.getByRole('button', { name: /Schedule/ }).getAttribute('aria-current')).toBe('page');
  });
});

describe('FIX-lattice-008 — cadence table at 390px', () => {
  it('carries a min-width so the scroll wrapper engages instead of squeezing columns', () => {
    const { container } = render(<RefreshSchedule />);
    const table = container.querySelector('table');
    expect(table).toBeTruthy();
    expect(table!.className).toContain('min-w-[560px]');
    expect(table!.textContent).toContain('conscious');
  });
});
