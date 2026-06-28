/**
 * /lenses/forum — four-UX-state contract for the Forum lens.
 *
 * The forum page is a large composed surface; its load-bearing data panel is
 * FmTopicsPanel (the default tab of ForumSection), which drives the topic list
 * through the real macro channel:
 *   lensRun('forum', 'topic-list', {...}) → POST /api/lens/run
 *   { domain:'forum', name:'topic-list' }  (answered by the forum-domain macros)
 * plus category-list / subforum-list / saved-list for the surrounding chrome.
 *
 * This pins genuine LOADING / ERROR / EMPTY / POPULATED states against that real
 * channel — no fabricated rows — and proves a backend { ok:false, error } (or a
 * swallowed fetch surfacing as ok:false) renders a DISTINCT red alert with a
 * WORKING retry that RE-FETCHES, rather than collapsing into the empty state
 * (the silent-empty defect class).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, act, fireEvent } from '@testing-library/react';
import React from 'react';

// ── the real macro channel, mocked per-test ─────────────────────────────────
const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

// Import AFTER the mock is registered.
import { FmTopicsPanel } from '@/components/forum/FmTopicsPanel';

// ── fixtures — exact forum-macro result shapes ──────────────────────────────
function ok(result: unknown) {
  return Promise.resolve({ data: { ok: true, result } });
}
function err(message: string) {
  return Promise.resolve({ data: { ok: false, result: null, error: message } });
}
const realTopic = {
  id: 'top_1',
  categoryId: null,
  subforumId: null,
  title: 'Sidechain compression tips',
  body: 'How do you set the release?',
  format: 'plain',
  images: [],
  tags: ['mixing'],
  author: 'you',
  pinned: false,
  locked: false,
  score: 7,
  replyCount: 2,
  awards: [],
};

// Dispatch by macro name. `topicListResp` is the load-bearing response under
// test; the chrome macros return benign empties so only the topic list varies.
function wireLensRun(topicListResp: () => Promise<unknown>) {
  lensRunMock.mockImplementation((_domain: string, name: string) => {
    if (name === 'topic-list') return topicListResp();
    if (name === 'category-list') return ok({ categories: [], count: 0 });
    if (name === 'subforum-list') return ok({ subforums: [], count: 0 });
    if (name === 'saved-list') return ok({ saved: [], count: 0 });
    return ok({});
  });
}

const noop = () => {};

beforeEach(() => {
  lensRunMock.mockReset();
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('forum lens (FmTopicsPanel) — four UX states', () => {
  it('LOADING: shows the spinner and no fabricated rows', () => {
    // topic-list never resolves → component stays in loading
    wireLensRun(() => new Promise(() => {}));
    const { container, queryByText } = render(<FmTopicsPanel onChange={noop} />);
    expect(container.querySelector('.animate-spin')).toBeTruthy();
    expect(queryByText(/No topics yet/i)).toBeNull();
    expect(queryByText(/Sidechain compression tips/i)).toBeNull();
  });

  it('ERROR: a backend { ok:false, error } surfaces a red alert, distinct from empty', async () => {
    wireLensRun(() => err('forum backend unreachable'));
    let view: ReturnType<typeof render>;
    await act(async () => {
      view = render(<FmTopicsPanel onChange={noop} />);
    });
    await waitFor(() => {
      expect(view!.getByText(/forum backend unreachable/i)).toBeInTheDocument();
    });
    // The red alert proves it did NOT silently collapse into the empty CTA —
    // the error is what distinguishes an outage from a genuinely-empty forum.
    expect(view!.getByRole('alert')).toBeInTheDocument();
    expect(view!.queryByText(/No topics yet/i)).toBeNull();
  });

  it('ERROR retry RE-FETCHES (not window.reload) and recovers to POPULATED', async () => {
    // First load fails; the Retry button re-invokes lensRun and succeeds.
    let attempt = 0;
    lensRunMock.mockImplementation((_domain: string, name: string) => {
      if (name === 'topic-list') {
        attempt += 1;
        return attempt === 1 ? err('transient outage') : ok({ topics: [realTopic], count: 1 });
      }
      if (name === 'category-list') return ok({ categories: [], count: 0 });
      if (name === 'subforum-list') return ok({ subforums: [], count: 0 });
      if (name === 'saved-list') return ok({ saved: [], count: 0 });
      return ok({});
    });
    let view: ReturnType<typeof render>;
    await act(async () => {
      view = render(<FmTopicsPanel onChange={noop} />);
    });
    await waitFor(() => expect(view!.getByText(/transient outage/i)).toBeInTheDocument());

    const callsBefore = lensRunMock.mock.calls.filter((c) => c[1] === 'topic-list').length;
    await act(async () => {
      fireEvent.click(view!.getByRole('button', { name: /retry/i }));
    });
    // The retry issued a fresh topic-list fetch (re-fetch, not a page reload)…
    const callsAfter = lensRunMock.mock.calls.filter((c) => c[1] === 'topic-list').length;
    expect(callsAfter).toBeGreaterThan(callsBefore);
    // …and recovered into the populated list.
    await waitFor(() => expect(view!.getByText(/Sidechain compression tips/i)).toBeInTheDocument());
    expect(view!.queryByRole('alert')).toBeNull();
  });

  it('EMPTY: an empty topic list shows the honest CTA and no fabricated rows', async () => {
    wireLensRun(() => ok({ topics: [], count: 0 }));
    let view: ReturnType<typeof render>;
    await act(async () => {
      view = render(<FmTopicsPanel onChange={noop} />);
    });
    await waitFor(() => {
      expect(view!.getByText(/No topics yet/i)).toBeInTheDocument();
    });
    expect(view!.queryByText(/Sidechain compression tips/i)).toBeNull();
    expect(view!.queryByRole('alert')).toBeNull();
  });

  it('POPULATED: a real topic from the macro renders in the list', async () => {
    wireLensRun(() => ok({ topics: [realTopic], count: 1 }));
    let view: ReturnType<typeof render>;
    await act(async () => {
      view = render(<FmTopicsPanel onChange={noop} />);
    });
    await waitFor(() => {
      expect(view!.getByText(/Sidechain compression tips/i)).toBeInTheDocument();
    });
    expect(view!.getByText(/2 replies/i)).toBeInTheDocument();
    expect(view!.queryByText(/No topics yet/i)).toBeNull();
  });
});
