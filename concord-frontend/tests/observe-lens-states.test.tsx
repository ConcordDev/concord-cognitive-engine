/**
 * /lenses/observe — envelope-unwrap contract for Observer Mode (finding 16).
 *
 * POST /api/lens/run ALWAYS answers `{ ok: true, result: PAYLOAD }` where the
 * outer `ok` is only a transport flag — PAYLOAD (the macro's own
 * `{ ok, dtuId, ripple }` / `{ ok:false, reason }` shape from
 * `observer.compose_report` in server.js) carries the real success/failure +
 * fields. The page's local `macro()` helper used to `setReport()` the raw
 * fetch body untouched, so `report.ok` was always the transport-true value
 * (masking real backend failures behind a "Report composed" success banner)
 * and `report.dtuId` / `report.ripple` were always `undefined` despite an
 * apparently successful compose.
 *
 * `macro()` now unwraps via `j.result ?? j`. These tests mock global fetch
 * with the REAL nested envelope shape and assert the report banner reads the
 * real verdict + fields. Heavy sibling components (repos, action panel,
 * telemetry platform) do their own fetching and are stubbed inert so the
 * test stays on the page's own compose-report flow.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, fireEvent, act } from '@testing-library/react';
import React from 'react';

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
vi.mock('@/components/observe/ObservabilityRepos', () => ({ ObservabilityRepos: () => null }));
vi.mock('@/components/observe/ObserveActionPanel', () => ({ ObserveActionPanel: () => null }));
vi.mock('@/components/observe/ObservePlatform', () => ({ ObservePlatform: () => null }));
vi.mock('@/components/panel-polish', () => ({
  PipingProvider: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));

// Import AFTER mocks are registered.
import ObservePage from '@/app/lenses/observe/page';

// `envelope()` mirrors the REAL /api/lens/run transport shape.
function envelope(macroResult: unknown) {
  return { ok: true, result: macroResult };
}
function jsonResponse(body: unknown) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response);
}

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { vi.restoreAllMocks(); });

describe('observe lens — envelope unwrap (finding 16)', () => {
  it('renders the real dtuId + ripple from result on a successful compose', async () => {
    // @ts-expect-error test global
    global.fetch = vi.fn(() => jsonResponse(envelope({
      ok: true,
      dtuId: 'empirical_report:u1:abc123',
      ripple: { events: 3, factions: ['Concord'] },
    })));
    const { getByText, container } = render(<ObservePage />);

    await act(async () => { fireEvent.click(getByText('Compose Report')); });

    await waitFor(() => expect(getByText(/Report composed/)).toBeInTheDocument());
    expect(getByText(/empirical_report:u1:abc123/)).toBeInTheDocument();
    // pre-fix dtuId/ripple were always undefined despite the "composed" banner.
    expect(container.textContent).not.toMatch(/DTU id: undefined/);
    expect(container.textContent).toMatch(/"events": 3/);
  });

  it('surfaces a genuine macro-level failure instead of a false success banner', async () => {
    // @ts-expect-error test global
    global.fetch = vi.fn(() => jsonResponse(envelope({ ok: false, reason: 'no_actor' })));
    const { getByText, container } = render(<ObservePage />);

    await act(async () => { fireEvent.click(getByText('Compose Report')); });

    // pre-fix `report.ok` was always the transport-true value, so this
    // rendered as a fake success ("Report composed.") instead of a failure.
    await waitFor(() => expect(getByText(/Failed: no_actor/)).toBeInTheDocument());
    expect(container.textContent).not.toMatch(/Report composed/);
  });

  it('a thrown/unreachable compose call is treated as a null report (no crash, no fake success)', async () => {
    // @ts-expect-error test global
    global.fetch = vi.fn(() => Promise.reject(new Error('network down')));
    const { getByText, queryByText } = render(<ObservePage />);

    await act(async () => { fireEvent.click(getByText('Compose Report')); });

    await waitFor(() => expect(queryByText('Composing report…')).toBeNull());
    expect(queryByText(/Report composed/)).toBeNull();
  });
});
