/**
 * /lenses/classroom — four-UX-state contract for the Classroom lens.
 *
 * The classroom page drives its cohort lists through a fetch-based macro()
 * helper → POST /api/lens/run { domain:'classroom', name:'list_cohorts' }
 * (answered by the inline classroom cohort macros in server.js). This pins
 * that the page renders genuine loading / error (with a WORKING Try-again that
 * RE-FETCHES) / empty / populated states against that real channel.
 *
 * SWALLOWED-FETCH FIX (Phase-2 gate): macro() catches every error to null, so a
 * failed list_cohorts used to render IDENTICALLY to an empty cohort list — a
 * silent-empty that hid backend outages. The page now tracks loading + loadError
 * and surfaces a role=alert with a working retry; these tests pin that an
 * unreachable / { ok:false } list_cohorts is DISTINGUISHABLE from genuinely-empty.
 *
 * No fabricated data: every state is driven by a mocked global fetch returning
 * exactly the { ok, teaching, studying } shape the list_cohorts macro returns.
 * The heavy children (workspace + library panels, which do their own fetching)
 * are stubbed inert so the test stays on the page's own list/status state machine.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, waitFor, act, within } from '@testing-library/react';
import React from 'react';

// ── headless shell + lens chrome: render-only stubs ─────────────────────────
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

// Child panels fetch on their own — stub inert so the test is scoped to the
// page's own cohort list + load-status state machine.
vi.mock('@/components/classroom/ClassroomWorkspace', () => ({ ClassroomWorkspace: () => null }));
vi.mock('@/components/classroom/OpenLibrarySearch', () => ({ OpenLibrarySearch: () => null }));
vi.mock('@/components/classroom/ClassroomActionPanel', () => ({ ClassroomActionPanel: () => null }));
vi.mock('@/components/panel-polish', () => ({
  PipingProvider: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));

// Import AFTER mocks are registered.
import ClassroomPage from '@/app/lenses/classroom/page';

// ── fetch stub helpers ──────────────────────────────────────────────────────
function jsonResponse(body: unknown) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response);
}

const COHORTS_EMPTY = { ok: true, teaching: [], studying: [] };
const COHORTS_POPULATED = {
  ok: true,
  teaching: [{ id: 12, name: 'Algebra I', rubric_dtu_id: null, created_at: 1735689600, enrolled: 3 }],
  studying: [{ id: 34, name: 'Intro Biology', rubric_dtu_id: null, teacher_user_id: 'teacher-abc12345' }],
};

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { vi.restoreAllMocks(); });

describe('classroom lens — wiring', () => {
  it('drives the list_cohorts macro on the classroom domain at mount', async () => {
    const fn = vi.fn(() => jsonResponse(COHORTS_EMPTY));
    // @ts-expect-error test global
    global.fetch = fn;
    render(<ClassroomPage />);
    await waitFor(() => expect(fn).toHaveBeenCalled());
    const [, init] = fn.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body.domain).toBe('classroom');
    expect(body.name).toBe('list_cohorts');
  });
});

describe('classroom lens — four UX states', () => {
  it('LOADING: shows a role=status indicator while list_cohorts is in flight', async () => {
    // never-resolving fetch → page stays in initial loading.
    // @ts-expect-error test global
    global.fetch = vi.fn(() => new Promise<Response>(() => {}));
    const { getByRole, getByText } = render(<ClassroomPage />);
    await waitFor(() => expect(getByRole('status')).toBeInTheDocument());
    expect(getByRole('status').getAttribute('aria-busy')).toBe('true');
    expect(getByText(/Loading classroom cohorts/i)).toBeInTheDocument();
  });

  it('EMPTY: shows the honest empty cues once an empty list resolves (not the loading state)', async () => {
    // @ts-expect-error test global
    global.fetch = vi.fn(() => jsonResponse(COHORTS_EMPTY));
    const { getByText, queryByRole } = render(<ClassroomPage />);
    await waitFor(() => expect(getByText(/No cohorts you teach/i)).toBeInTheDocument());
    expect(getByText(/No cohorts you're enrolled in/i)).toBeInTheDocument();
    // empty is distinct from loading: the role=status spinner is gone.
    expect(queryByRole('status')).toBeNull();
  });

  it('ERROR: an unreachable list_cohorts shows role=alert + a working Try-again that re-fetches', async () => {
    let fail = true;
    // @ts-expect-error test global
    global.fetch = vi.fn(() =>
      fail ? Promise.reject(new Error('network down')) : jsonResponse(COHORTS_POPULATED),
    );
    const { container, getByText, queryByText } = render(<ClassroomPage />);
    // swallowed-fetch must NOT silently render "No cohorts" — it surfaces an alert.
    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    expect(getByText(/Could not reach the classroom service/i)).toBeInTheDocument();
    // and it is NOT the genuinely-empty cue
    expect(queryByText(/No cohorts you teach/i)).toBeNull();

    // Try-again must re-invoke the backend and recover to populated.
    fail = false;
    const alert = container.querySelector('[role="alert"]') as HTMLElement;
    const retry = within(alert).getByRole('button', { name: /Try again/i });
    await act(async () => { fireEvent.click(retry); });
    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeFalsy());
    expect(getByText('Algebra I')).toBeInTheDocument();
  });

  it('ERROR: a { ok:false } verdict (not just a thrown fetch) also surfaces, never silent-empty', async () => {
    // @ts-expect-error test global
    global.fetch = vi.fn(() => jsonResponse({ ok: false, reason: 'no_db' }));
    const { container, getByText, queryByText } = render(<ClassroomPage />);
    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    expect(getByText(/no_db/i)).toBeInTheDocument();
    expect(queryByText(/No cohorts you teach/i)).toBeNull();
  });

  it('POPULATED: renders the real teaching + studying cohort rows from the macro body', async () => {
    // @ts-expect-error test global
    global.fetch = vi.fn(() => jsonResponse(COHORTS_POPULATED));
    const { getByText } = render(<ClassroomPage />);
    await waitFor(() => expect(getByText('Algebra I')).toBeInTheDocument());
    expect(getByText('Intro Biology')).toBeInTheDocument();
    // enrolled count from the row is rendered ("3 students")
    expect(getByText(/3 students/i)).toBeInTheDocument();
  });
});
