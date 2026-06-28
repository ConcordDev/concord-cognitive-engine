/**
 * /lenses/deities — four-UX-state contract (Phase-2 NON-SCORE gate).
 *
 * Pins that the Deity Pantheon renders genuine loading / error (with a working
 * Retry) / empty / populated states against the real macro surface
 * (lensRun('deity', …) → POST /api/lens/run), plus a11y (loading is
 * role=status; error is role=alert with a Retry control).
 *
 * No fabricated data: every state is driven by a mocked lensRun standing in for
 * the real backend, in the exact shape server/domains/deities.js returns. The
 * headless LensShell + the cross-mounted helper panels (PantheonExplorer,
 * MyDevotionPanel, RecentMineCard, …) are render-only stubs so the test stays
 * focused on the page's own state machine for the pantheon list.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';

// ── lensRun mock — the page's single backend channel ────────────────────────
const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
}));

// ── headless shell + lens-helper mounts: render-only stubs ──────────────────
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'lens-shell' }, children),
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/components/lens/RecentMineCard', () => ({ RecentMineCard: () => null }));
vi.mock('@/components/lens/AutoActionStrip', () => ({ AutoActionStrip: () => null }));
vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/components/lens/FirstRunTour', () => ({ FirstRunTour: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/LensVerticalHero', () => ({ LensVerticalHero: () => null }));
vi.mock('@/components/deities/PantheonExplorer', () => ({ PantheonExplorer: () => null }));
vi.mock('@/components/deities/MyDevotionPanel', () => ({ MyDevotionPanel: () => null }));
vi.mock('@/components/deities/DeityDetailPanel', () => ({
  DeityDetailPanel: ({ deityId }: { deityId: string }) =>
    React.createElement('div', { 'data-testid': 'detail-panel' }, `detail:${deityId}`),
}));

// Import AFTER mocks are registered.
import DeitiesPage from '@/app/lenses/deities/page';

// Helper: lensRun returns an axios-shaped { data: { ok, result, error } }.
function reply(result: Record<string, unknown> | null, ok = true, error: string | null = null) {
  return Promise.resolve({ data: { ok, result, error } });
}

const DEITY = {
  id: 'deity_abc',
  author_user_id: 'author_one_xyz',
  name: 'Veyra',
  domainTitle: 'Patron of the tide',
  created_at: 1782582945,
  pilgrim_count: 3,
  originPeer: null,
};

beforeEach(() => {
  lensRun.mockReset();
});

describe('deities lens — four UX states', () => {
  it('LOADING: shows a role=status indicator while the pantheon is in flight', async () => {
    // list never resolves → the page stays in the loading state.
    lensRun.mockImplementation(() => new Promise(() => {}));
    const { getByText, container } = render(<DeitiesPage />);
    await waitFor(() => expect(getByText(/Gathering the pantheon/i)).toBeInTheDocument());
    expect(container.querySelector('[role="status"]')).toBeTruthy();
    expect(container.querySelector('[role="status"]')?.getAttribute('aria-busy')).toBe('true');
  });

  it('EMPTY: shows the honest "be the first to compose one" CTA when no deities exist', async () => {
    lensRun.mockImplementation((_d: string, name: string) => {
      if (name === 'list') return reply({ deities: [] });
      return reply({ deities: [] });
    });
    const { getByText } = render(<DeitiesPage />);
    await waitFor(() => expect(getByText(/Be the first to/i)).toBeInTheDocument());
  });

  it('ERROR: a failed load shows role=alert + a working Retry that re-runs the macro', async () => {
    let calls = 0;
    lensRun.mockImplementation((_d: string, name: string) => {
      if (name === 'list') {
        calls += 1;
        // first load fails, retry succeeds with a populated pantheon.
        if (calls === 1) return reply(null, false, 'pantheon_unreachable');
        return reply({ deities: [DEITY] });
      }
      return reply({ deities: [] });
    });
    const { getByText, queryByText, container } = render(<DeitiesPage />);

    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    expect(getByText(/pantheon_unreachable/i)).toBeInTheDocument();

    const before = lensRun.mock.calls.filter((c) => c[1] === 'list').length;
    await act(async () => { fireEvent.click(getByText('Retry')); });
    await waitFor(() =>
      expect(lensRun.mock.calls.filter((c) => c[1] === 'list').length).toBeGreaterThan(before));
    // recovered: the error is gone and the deity renders.
    await waitFor(() => expect(getByText('Veyra')).toBeInTheDocument());
    expect(queryByText(/pantheon_unreachable/i)).toBeNull();
  });

  it('POPULATED: a successful load renders the deity card with real values', async () => {
    lensRun.mockImplementation((_d: string, name: string) => {
      if (name === 'list') return reply({ deities: [DEITY] });
      return reply({ deities: [] });
    });
    const { getByText } = render(<DeitiesPage />);
    await waitFor(() => expect(getByText('Veyra')).toBeInTheDocument());
    expect(getByText('Patron of the tide')).toBeInTheDocument();
    expect(getByText('3')).toBeInTheDocument();      // pilgrim_count
    expect(getByText('pilgrims')).toBeInTheDocument();
  });

  it('PILGRIMAGE: clicking Pilgrimage fires deity.pilgrimage and refreshes', async () => {
    lensRun.mockImplementation((_d: string, name: string) => {
      if (name === 'list') return reply({ deities: [DEITY] });
      if (name === 'pilgrimage') return reply({ deityId: DEITY.id, newPilgrimCount: 4 });
      return reply({ deities: [] });
    });
    const { getByText } = render(<DeitiesPage />);
    await waitFor(() => expect(getByText('Veyra')).toBeInTheDocument());
    await act(async () => { fireEvent.click(getByText('Pilgrimage')); });
    await waitFor(() =>
      expect(lensRun.mock.calls.some((c) => c[1] === 'pilgrimage')).toBe(true));
  });

  it('SEARCH: a filter query routes through deity.search (not list)', async () => {
    lensRun.mockImplementation((_d: string, name: string) => {
      if (name === 'list') return reply({ deities: [DEITY] });
      if (name === 'search') return reply({ deities: [DEITY] });
      return reply({ deities: [] });
    });
    const { getByPlaceholderText, getByText } = render(<DeitiesPage />);
    await waitFor(() => expect(getByText('Veyra')).toBeInTheDocument());
    fireEvent.change(getByPlaceholderText(/Search by name/i), { target: { value: 'veyra' } });
    await waitFor(() =>
      expect(lensRun.mock.calls.some((c) => c[1] === 'search')).toBe(true));
  });
});
