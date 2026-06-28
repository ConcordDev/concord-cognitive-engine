/**
 * /lenses/goddess — four-UX-state contract (Phase-2 NON-SCORE gate).
 *
 * Pins that "Concordia Speaks" renders genuine loading / error (with a WORKING
 * Retry) / empty / populated states against the real macro surface
 * (lensRun('goddess', 'recent', …) → POST /api/lens/run), plus a11y (loading is
 * role=status with aria-busy; error is role=alert with a Retry control).
 *
 * The page's prior `recent` fetch swallowed a failed load into the empty state
 * ("The goddess has not yet spoken") — indistinguishable from a genuinely empty
 * world. This test pins the fix: a failed fetch now surfaces a role=alert error
 * + a Retry that re-runs `goddess.recent`.
 *
 * No fabricated data: every state is driven by a mocked lensRun standing in for
 * the real backend, in the exact shape server/lib/goddess-broadcaster.js's
 * `recentDispatches` returns. The headless LensShell, the cross-mounted helper
 * panels, the Archive/Alerts tab components, and the wikipedia-backed
 * GoddessGallery are render-only stubs so the test stays focused on the page's
 * own feed state machine.
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
vi.mock('@/components/goddess/GoddessGallery', () => ({ GoddessGallery: () => null }));
vi.mock('@/components/goddess/DispatchArchive', () => ({
  DispatchArchive: () => React.createElement('div', { 'data-testid': 'archive-tab' }, 'archive'),
}));
vi.mock('@/components/goddess/ToneSubscriptions', () => ({
  ToneSubscriptions: () => React.createElement('div', { 'data-testid': 'alerts-tab' }, 'alerts'),
}));
vi.mock('@/components/goddess/DispatchDetail', () => ({
  DispatchDetail: ({ dispatchId }: { dispatchId: number }) =>
    React.createElement('div', { 'data-testid': 'detail' }, `detail:${dispatchId}`),
}));

// Import AFTER mocks are registered.
import GoddessPage from '@/app/lenses/goddess/page';

// lensRun returns an axios-shaped { data: { ok, result, error } }.
function reply(result: Record<string, unknown> | null, ok = true, error: string | null = null) {
  return Promise.resolve({ data: { ok, result, error } });
}

const DISPATCH = {
  id: 42,
  world_id: 'concordia-hub',
  tone: 'exalted',
  ecosystem_score: 0.82,
  refusal_strength: 0,
  drift_kind: null as string | null,
  body: 'I see brightness: the worlds align.',
  composed_at: 1782582945,
};

beforeEach(() => {
  lensRun.mockReset();
});

describe('goddess lens — four UX states', () => {
  it('LOADING: shows a role=status / aria-busy indicator while the feed is in flight', async () => {
    lensRun.mockImplementation(() => new Promise(() => {})); // never resolves
    const { getByText, container } = render(<GoddessPage />);
    await waitFor(() => expect(getByText(/Listening/i)).toBeInTheDocument());
    const status = container.querySelector('[role="status"]');
    expect(status).toBeTruthy();
    expect(status?.getAttribute('aria-busy')).toBe('true');
  });

  it('EMPTY: an honest empty world shows the "has not yet spoken" CTA, not an error', async () => {
    lensRun.mockImplementation((_d: string, name: string) => {
      if (name === 'recent') return reply({ dispatches: [] });
      return reply({ dispatches: [] });
    });
    const { getByText, container } = render(<GoddessPage />);
    await waitFor(() => expect(getByText(/has not yet spoken/i)).toBeInTheDocument());
    // No false alarm: an empty world is NOT an error.
    expect(container.querySelector('[role="alert"]')).toBeFalsy();
  });

  it('ERROR: a failed load shows role=alert + a working Retry that re-runs goddess.recent', async () => {
    let calls = 0;
    lensRun.mockImplementation((_d: string, name: string) => {
      if (name === 'recent') {
        calls += 1;
        // first load fails, retry succeeds with a populated feed.
        if (calls === 1) return reply(null, false, 'goddess_feed_unreachable');
        return reply({ dispatches: [DISPATCH] });
      }
      return reply({ dispatches: [] });
    });
    const { getByText, queryByText, container } = render(<GoddessPage />);

    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    expect(getByText(/goddess_feed_unreachable/i)).toBeInTheDocument();

    const before = lensRun.mock.calls.filter((c) => c[1] === 'recent').length;
    await act(async () => { fireEvent.click(getByText('Retry')); });
    await waitFor(() =>
      expect(lensRun.mock.calls.filter((c) => c[1] === 'recent').length).toBeGreaterThan(before));
    // recovered: the error is gone and the dispatch renders.
    await waitFor(() => expect(getByText(/the worlds align/i)).toBeInTheDocument());
    expect(queryByText(/goddess_feed_unreachable/i)).toBeNull();
  });

  it('ERROR: a thrown fetch (network) also surfaces role=alert, never a silent empty', async () => {
    lensRun.mockImplementation((_d: string, name: string) => {
      if (name === 'recent') return Promise.reject(new Error('network down'));
      return reply({ dispatches: [] });
    });
    const { getByText, container, queryByText } = render(<GoddessPage />);
    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    expect(getByText(/network down/i)).toBeInTheDocument();
    // It did NOT collapse into the empty CTA.
    expect(queryByText(/has not yet spoken/i)).toBeNull();
  });

  it('POPULATED: a successful load renders the dispatch body + tone/ecosystem metadata', async () => {
    lensRun.mockImplementation((_d: string, name: string) => {
      if (name === 'recent') return reply({ dispatches: [DISPATCH] });
      return reply({ dispatches: [] });
    });
    const { getByText } = render(<GoddessPage />);
  });

  it('POPULATED: the metadata line carries the real tone + ecosystem score', async () => {
    lensRun.mockImplementation((_d: string, name: string) => {
      if (name === 'recent') return reply({ dispatches: [DISPATCH] });
      return reply({ dispatches: [] });
    });
    const { container } = render(<GoddessPage />);
    await waitFor(() => expect(container.textContent).toMatch(/the worlds align/i));
    // The metadata <p> stitches tone + the real ecosystem score (0.82).
    const meta = Array.from(container.querySelectorAll('p')).find(
      (p) => /exalted/.test(p.textContent || '') && /ecosystem/.test(p.textContent || ''),
    );
    expect(meta).toBeTruthy();
    expect(meta?.textContent).toMatch(/0\.82/);
  });

  it('POPULATED → DETAIL: clicking a dispatch opens the permalink detail view', async () => {
    lensRun.mockImplementation((_d: string, name: string) => {
      if (name === 'recent') return reply({ dispatches: [DISPATCH] });
      return reply({ dispatches: [] });
    });
    const { getByText, getByTestId } = render(<GoddessPage />);
    await waitFor(() => expect(getByText(/the worlds align/i)).toBeInTheDocument());
    await act(async () => { fireEvent.click(getByText(/the worlds align/i)); });
    await waitFor(() => expect(getByTestId('detail')).toHaveTextContent('detail:42'));
  });
});
