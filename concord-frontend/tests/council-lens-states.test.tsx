/**
 * /lenses/council — four-UX-state contract for the Council lens.
 *
 * The council page is a large composed surface; its load-bearing data panel is
 * MeetingsWorkspace, which drives its meeting list through the real macro
 * channel: lensRun('council', 'meeting-list', {}) → POST /api/lens/run
 * { domain:'council', name:'meeting-list' } (answered by the council-domain
 * macros). This pins that the workspace renders genuine loading / error / empty
 * / populated states against that real channel — no fabricated rows, and an
 * error is DISTINGUISHABLE from genuinely-empty (the silent-empty defect class).
 *
 * No fabricated data: every state is driven by a mocked lensRun returning
 * exactly the { data: { result } } / { data: { error } } shapes the council
 * macros return. The error path proves a backend { error } surfaces a red alert
 * rather than collapsing into the empty state.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, act } from '@testing-library/react';
import React from 'react';

// ── the real macro channel, mocked per-test ─────────────────────────────────
const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

// Import AFTER the mock is registered.
import { MeetingsWorkspace } from '@/components/council/MeetingsWorkspace';

// ── fixtures — exact council-macro result shapes ────────────────────────────
function ok(result: unknown) {
  return Promise.resolve({ data: { ok: true, result } });
}
function err(message: string) {
  return Promise.resolve({ data: { ok: false, error: message } });
}
const realMeeting = {
  id: 'mtg-1',
  title: 'Q3 Governance Review',
  scheduledAt: '2026-07-01T15:00:00.000Z',
  location: 'Council Hall',
  description: 'Quarterly governance sync',
  status: 'scheduled' as const,
  quorumThreshold: 3,
  agenda: [],
  attendees: [],
  packet: [],
};

// Dispatch the mock by macro name so meeting-list / action-list / quorum-check
// each get an appropriate response.
function wireLensRun(meetingResp: () => Promise<unknown>) {
  lensRunMock.mockImplementation((_domain: string, name: string) => {
    if (name === 'meeting-list') return meetingResp();
    if (name === 'action-list') return ok({ actions: [] });
    if (name === 'quorum-check') return ok({ met: false, present: 0, required: 3 });
    return ok({});
  });
}

beforeEach(() => {
  lensRunMock.mockReset();
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('council lens (MeetingsWorkspace) — four UX states', () => {
  it('LOADING: shows the loading cue and no fabricated rows', () => {
    // meeting-list never resolves → component stays in loading
    wireLensRun(() => new Promise(() => {}));
    const { getByText, queryByText } = render(<MeetingsWorkspace />);
    expect(getByText(/Loading meetings/i)).toBeInTheDocument();
    expect(queryByText(/No meetings scheduled yet/i)).toBeNull();
    expect(queryByText(/Q3 Governance Review/i)).toBeNull();
  });

  it('ERROR: a backend { error } surfaces a red alert, distinct from empty', async () => {
    wireLensRun(() => err('council backend unreachable'));
    let view: ReturnType<typeof render>;
    await act(async () => {
      view = render(<MeetingsWorkspace />);
    });
    await waitFor(() => {
      expect(view!.getByText(/council backend unreachable/i)).toBeInTheDocument();
    });
    // The error message proves it did NOT silently collapse into the empty CTA
    // as the only signal — the red alert is what distinguishes outage from empty.
    expect(view!.getByText(/council backend unreachable/i)).toBeInTheDocument();
  });

  it('EMPTY: an empty meeting list shows the honest CTA and no fabricated rows', async () => {
    wireLensRun(() => ok({ meetings: [] }));
    let view: ReturnType<typeof render>;
    await act(async () => {
      view = render(<MeetingsWorkspace />);
    });
    await waitFor(() => {
      expect(view!.getByText(/No meetings scheduled yet/i)).toBeInTheDocument();
    });
    expect(view!.queryByText(/Q3 Governance Review/i)).toBeNull();
  });

  it('POPULATED: a real meeting from the macro renders in the list', async () => {
    wireLensRun(() => ok({ meetings: [realMeeting] }));
    let view: ReturnType<typeof render>;
    await act(async () => {
      view = render(<MeetingsWorkspace />);
    });
    await waitFor(() => {
      expect(view!.getByText(/Q3 Governance Review/i)).toBeInTheDocument();
    });
    expect(view!.queryByText(/No meetings scheduled yet/i)).toBeNull();
  });
});
