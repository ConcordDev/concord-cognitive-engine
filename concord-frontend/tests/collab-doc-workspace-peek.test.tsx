/**
 * CollabDocWorkspace — "peek" (read-only viewer roster) affordance.
 *
 * Closes docs/WAVE4_INVENTORY.md's collab row: "No read-only 'who's viewing'
 * observer roster surface". `presenceState` (server/domains/collab.js) is a
 * pure read of the doc's presence map — only `cursorUpdate` writes to it —
 * so a doc-list "peek" eye icon can poll it to show who's currently viewing
 * a document WITHOUT the peeker joining that document's edit presence.
 *
 * This test pins the contract from the frontend side:
 *   - the peek button calls `collab.presenceState` (never `docState`/
 *     `openDoc`, never `cursorUpdate`) so peeking never adds the peeker to
 *     the roster it's displaying
 *   - it polls while open and stops polling (clears the interval) on close
 *     or unmount
 *   - it renders an honest "no one else viewing" state when the roster is
 *     empty, and real rows when it isn't — never fabricated data
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, waitFor, act, cleanup } from '@testing-library/react';
import React from 'react';

vi.mock('@/lib/hooks/useYjsDoc', () => ({
  useYjsDoc: () => ({ doc: null, synced: false, socketReady: false, resetVersion: 0 }),
}));

vi.mock('@/components/viz', () => ({
  TimelineView: () => null,
}));

vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const make = (name: string) => {
    const Icon = React.forwardRef<SVGSVGElement, Record<string, unknown>>((props, ref) =>
      React.createElement('span', { 'data-testid': `icon-${name}`, ref, ...props }));
    Icon.displayName = name;
    return Icon;
  };
  return new Proxy(actual, { get: (target, prop: string) => (prop in target ? make(prop) : (target as Record<string, unknown>)[prop]) });
});

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

import { CollabDocWorkspace } from '@/components/collab/CollabDocWorkspace';

function docListResponse(docs: Array<{ id: string; title: string }>) {
  return {
    data: {
      ok: true,
      result: {
        documents: docs.map((d) => ({
          id: d.id, title: d.title, ownerId: 'user_a', isOwner: true,
          tier: 'edit', opCount: 3, snapshotCount: 1, updatedAt: Date.now(), createdAt: Date.now(),
        })),
        total: docs.length,
      },
    },
  };
}

function emptyPresence() {
  return { data: { ok: true, result: { presence: [], online: 0, following: null, followTarget: null } } };
}

function presenceCallCount() {
  return lensRunMock.mock.calls.filter((c) => c[0] === 'collab' && c[1] === 'presenceState').length;
}

beforeEach(() => {
  lensRunMock.mockReset();
  lensRunMock.mockImplementation((domain: string, action: string) => {
    if (domain === 'collab' && action === 'docList') {
      return Promise.resolve(docListResponse([{ id: 'doc_1', title: 'Design Spec' }]));
    }
    if (domain === 'collab' && action === 'notifications') {
      return Promise.resolve({ data: { ok: true, result: { notifications: [], unread: 0 } } });
    }
    if (domain === 'collab' && action === 'presenceState') {
      return Promise.resolve(emptyPresence());
    }
    return Promise.resolve({ data: { ok: true, result: null } });
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('CollabDocWorkspace — peek roster (real timers)', () => {
  it('the peek button calls collab.presenceState, never docState/openDoc/cursorUpdate', async () => {
    const { getByText, getByLabelText } = render(<CollabDocWorkspace />);
    await waitFor(() => expect(getByText('Design Spec')).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(getByLabelText('Peek at who is viewing Design Spec'));
    });

    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith('collab', 'presenceState', { docId: 'doc_1' }));

    // Peeking must never open the document or heartbeat a cursor into it.
    const calledActions = lensRunMock.mock.calls.map((c) => c[1]);
    expect(calledActions).not.toContain('docState');
    expect(calledActions).not.toContain('cursorUpdate');
  });

  it('shows an honest "no one else viewing" state when the roster is empty', async () => {
    const { getByText, getByLabelText } = render(<CollabDocWorkspace />);
    await waitFor(() => expect(getByText('Design Spec')).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(getByLabelText('Peek at who is viewing Design Spec'));
    });

    await waitFor(() => expect(getByText(/No one else viewing right now/i)).toBeInTheDocument());
  });

  it('renders real presence rows returned by the backend (no fabricated data)', async () => {
    lensRunMock.mockImplementation((domain: string, action: string) => {
      if (domain === 'collab' && action === 'docList') {
        return Promise.resolve(docListResponse([{ id: 'doc_1', title: 'Design Spec' }]));
      }
      if (domain === 'collab' && action === 'notifications') {
        return Promise.resolve({ data: { ok: true, result: { notifications: [], unread: 0 } } });
      }
      if (domain === 'collab' && action === 'presenceState') {
        return Promise.resolve({
          data: {
            ok: true,
            result: {
              presence: [
                { userId: 'user_b', name: 'Bob', color: '#60a5fa', cursor: 12, selection: null, following: null, updatedAt: Date.now() },
              ],
              online: 1, following: null, followTarget: null,
            },
          },
        });
      }
      return Promise.resolve({ data: { ok: true, result: null } });
    });

    const { getByText, getByLabelText } = render(<CollabDocWorkspace />);
    await waitFor(() => expect(getByText('Design Spec')).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(getByLabelText('Peek at who is viewing Design Spec'));
    });

    await waitFor(() => expect(getByText('Bob')).toBeInTheDocument());
    expect(() => getByText(/No one else viewing right now/i)).toThrow();
  });

  it('closing the popover removes it from the DOM (no leftover open dialog)', async () => {
    const { getByText, getByLabelText, queryByRole } = render(<CollabDocWorkspace />);
    await waitFor(() => expect(getByText('Design Spec')).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(getByLabelText('Peek at who is viewing Design Spec'));
    });
    await waitFor(() => expect(queryByRole('dialog', { name: 'Viewers of Design Spec' })).toBeTruthy());

    await act(async () => {
      fireEvent.click(getByLabelText('Close peek'));
    });
    await waitFor(() => expect(queryByRole('dialog', { name: 'Viewers of Design Spec' })).toBeFalsy());
  });
});

// Timer-behavior assertions run under fake timers so a 4s poll interval
// doesn't cost real wall-clock time in CI. Fake timers are scoped to just
// these two tests (installed before render, uninstalled in afterEach) —
// mixing them with @testing-library's real-timer-based `waitFor` elsewhere
// in this file would deadlock, so all waiting here goes through explicit
// `act(async () => { await vi.advanceTimersByTimeAsync(...) })` flushes
// instead, per this repo's established pattern (see
// tests/liveness-panel-coordinated-refresh.test.tsx).
describe('CollabDocWorkspace — peek roster polling (fake timers)', () => {
  beforeEach(() => { vi.useFakeTimers(); });

  it('polls presenceState every ~4s while open and stops once closed', async () => {
    const { getByText, getByLabelText } = render(<CollabDocWorkspace />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(getByText('Design Spec')).toBeInTheDocument();

    act(() => { fireEvent.click(getByLabelText('Peek at who is viewing Design Spec')); });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    const callsAfterOpen = presenceCallCount();
    expect(callsAfterOpen).toBeGreaterThanOrEqual(1);

    // Advance past two poll intervals (4s each) — more calls must land.
    await act(async () => { await vi.advanceTimersByTimeAsync(9000); });
    const callsAfterPoll = presenceCallCount();
    expect(callsAfterPoll).toBeGreaterThan(callsAfterOpen);

    // Close the popover — the interval must be cleared.
    act(() => { fireEvent.click(getByLabelText('Close peek')); });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    const callsAfterClose = presenceCallCount();

    await act(async () => { await vi.advanceTimersByTimeAsync(9000); });
    const callsMuchLater = presenceCallCount();
    expect(callsMuchLater).toBe(callsAfterClose); // no further polling once closed
  });

  it('unmounting the workspace while the popover is open stops polling cleanly (no leaked interval)', async () => {
    const { getByText, getByLabelText, unmount } = render(<CollabDocWorkspace />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(getByText('Design Spec')).toBeInTheDocument();

    act(() => { fireEvent.click(getByLabelText('Peek at who is viewing Design Spec')); });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    const callsAtUnmount = presenceCallCount();
    expect(callsAtUnmount).toBeGreaterThanOrEqual(1);

    unmount();

    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
    const callsAfter = presenceCallCount();
    expect(callsAfter).toBe(callsAtUnmount); // cleanup fired on unmount, interval is gone
  });
});
