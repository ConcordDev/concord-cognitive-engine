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
 * ENVELOPE-UNWRAP FIX (finding 14): POST /api/lens/run ALWAYS answers
 * `{ ok: true, result: PAYLOAD }` where the outer `ok` is only a transport
 * flag — PAYLOAD (`{ ok, teaching, studying }` / `{ ok, cohortId }` / etc.)
 * is the macro's own success/failure + fields (server.js:39486-39494,
 * `res.json({ ok: true, result })`). The page's `macro()` helper used to
 * return the raw fetch body untouched, so every caller reading `r.teaching`
 * / `r.studying` / `r.cohortId` / `r.submissionId` read `undefined` forever
 * (and `r.ok` was always the transport-true value, masking real macro
 * failures like `{ ok:false, reason:'no_db' }`). `macro()` now unwraps via
 * `j.result ?? j`. Every mocked fetch body below uses the REAL nested
 * `{ ok: true, result: PAYLOAD }` shape so these tests actually exercise
 * that unwrap, not the old flat shape.
 *
 * No fabricated data: every state is driven by a mocked global fetch returning
 * exactly the shape the live `/api/lens/run` route produces for the
 * `list_cohorts` macro. The heavy children (workspace + library panels, which
 * do their own fetching) are stubbed inert so the test stays on the page's
 * own list/status state machine.
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

// Import AFTER mocks are registered.
import ClassroomPage from '@/app/lenses/classroom/page';

// ── fetch stub helpers ──────────────────────────────────────────────────────
// `envelope()` mirrors the REAL /api/lens/run transport shape: the outer
// `ok` is just "the HTTP call succeeded" — `result` carries the macro's own
// verdict + fields. Every macro() caller in the page reads fields off what
// macro() unwraps down to (i.e. what's inside `result` here).
function envelope(macroResult: unknown) {
  return { ok: true, result: macroResult };
}
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
    const fn = vi.fn(() => jsonResponse(envelope(COHORTS_EMPTY)));
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
    global.fetch = vi.fn(() => jsonResponse(envelope(COHORTS_EMPTY)));
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
      fail ? Promise.reject(new Error('network down')) : jsonResponse(envelope(COHORTS_POPULATED)),
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
    global.fetch = vi.fn(() => jsonResponse(envelope({ ok: false, reason: 'no_db' })));
    const { container, getByText, queryByText } = render(<ClassroomPage />);
    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    expect(getByText(/no_db/i)).toBeInTheDocument();
    expect(queryByText(/No cohorts you teach/i)).toBeNull();
  });

  it('POPULATED: renders the real teaching + studying cohort rows from the macro body', async () => {
    // @ts-expect-error test global
    global.fetch = vi.fn(() => jsonResponse(envelope(COHORTS_POPULATED)));
    const { getByText } = render(<ClassroomPage />);
    await waitFor(() => expect(getByText('Algebra I')).toBeInTheDocument());
    expect(getByText('Intro Biology')).toBeInTheDocument();
    // enrolled count from the row is rendered ("3 students")
    expect(getByText(/3 students/i)).toBeInTheDocument();
  });
});

describe('classroom lens — create/submit flows read fields off the unwrapped result (finding 14)', () => {
  it('flashes the real cohortId from result.cohortId after creating a cohort', async () => {
    // @ts-expect-error test global
    global.fetch = vi.fn((url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      if (body.name === 'create_cohort') return jsonResponse(envelope({ ok: true, cohortId: 77 }));
      return jsonResponse(envelope(COHORTS_EMPTY));
    });
    const { getByText, getByRole, getByPlaceholderText } = render(<ClassroomPage />);
    await waitFor(() => expect(getByText(/No cohorts you teach/i)).toBeInTheDocument());

    fireEvent.change(getByPlaceholderText('Cohort name'), { target: { value: 'Algebra II' } });
    await act(async () => { fireEvent.click(getByRole('button', { name: 'Create' })); });

    await waitFor(() => expect(getByText(/Cohort #77 created/)).toBeInTheDocument());
    // pre-fix this read the top-level (always-undefined) `cohortId`, i.e. "Cohort #undefined created".
    expect(() => getByText(/Cohort #undefined/)).toThrow();
  });

  it('flashes the real submissionId from result.submissionId after submitting homework', async () => {
    // @ts-expect-error test global
    global.fetch = vi.fn((url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      if (body.name === 'submit_homework') return jsonResponse(envelope({ ok: true, submissionId: 314 }));
      return jsonResponse(envelope(COHORTS_EMPTY));
    });
    const { getByText, getByRole, getAllByPlaceholderText, getByPlaceholderText } = render(<ClassroomPage />);
    await waitFor(() => expect(getByText(/No cohorts you teach/i)).toBeInTheDocument());

    // Two "Cohort id" inputs exist (Enrol + Submit panels) — target the Submit one.
    fireEvent.change(getAllByPlaceholderText('Cohort id')[1], { target: { value: '12' } });
    fireEvent.change(getByPlaceholderText('DTU id'), { target: { value: 'dtu_abc123' } });
    await act(async () => { fireEvent.click(getByRole('button', { name: 'Submit' })); });

    await waitFor(() => expect(getByText(/Submitted \(#314\)/)).toBeInTheDocument());
    // pre-fix this read the top-level (always-undefined) `submissionId`, i.e. "Submitted (#undefined)".
    expect(() => getByText(/Submitted \(#undefined\)/)).toThrow();
  });

  it('surfaces the real macro-level failure reason on create (result.ok:false is not masked as success)', async () => {
    // @ts-expect-error test global
    global.fetch = vi.fn((url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      if (body.name === 'create_cohort') return jsonResponse(envelope({ ok: false, reason: 'missing_name' }));
      return jsonResponse(envelope(COHORTS_EMPTY));
    });
    const { getByText, getByRole, getByPlaceholderText } = render(<ClassroomPage />);
    await waitFor(() => expect(getByText(/No cohorts you teach/i)).toBeInTheDocument());

    fireEvent.change(getByPlaceholderText('Cohort name'), { target: { value: 'X' } });
    await act(async () => { fireEvent.click(getByRole('button', { name: 'Create' })); });

    await waitFor(() => expect(getByText(/Failed: missing_name/)).toBeInTheDocument());
  });
});
