/**
 * whiteboard.workspace-summary was previously UNSURFACED — real backend
 * aggregate (boardCount/elementCount/stickyCount/sharedCount/
 * openCommentCount, see server/domains/whiteboard.js) with zero frontend
 * callers. WhiteboardWorkspaceSummary wires it into a StatTile header strip
 * (mirrors HistoryDashboardStrip's history.history-dashboard pattern).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';

vi.mock('@/lib/realtime/socket', () => ({
  subscribe: vi.fn(() => () => {}),
  connectSocket: vi.fn(),
}));

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

import { WhiteboardWorkspaceSummary } from '@/components/whiteboard/WhiteboardWorkspaceSummary';

function ok(result: unknown) {
  return Promise.resolve({ data: { ok: true, result, error: null } });
}

describe('WhiteboardWorkspaceSummary — surfaces whiteboard.workspace-summary', () => {
  beforeEach(() => {
    lensRunMock.mockReset();
  });

  it('dispatches whiteboard.workspace-summary on mount with no input', async () => {
    lensRunMock.mockReturnValue(ok({ boardCount: 3, elementCount: 40, stickyCount: 12, sharedCount: 1, openCommentCount: 2 }));
    render(<WhiteboardWorkspaceSummary />);
    await waitFor(() => {
      expect(lensRunMock).toHaveBeenCalledWith('whiteboard', 'workspace-summary', {}, expect.any(String));
    });
  });

  it('renders every field straight off the macro result — no client-side computation', async () => {
    lensRunMock.mockReturnValue(ok({ boardCount: 3, elementCount: 40, stickyCount: 12, sharedCount: 1, openCommentCount: 2 }));
    const { findByText } = render(<WhiteboardWorkspaceSummary />);
    expect(await findByText('Boards')).toBeTruthy();
    expect(await findByText('Elements')).toBeTruthy();
    expect(await findByText('Stickies')).toBeTruthy();
    expect(await findByText('Shared')).toBeTruthy();
    expect(await findByText('Open comments')).toBeTruthy();
    // StatTile formats small integers via toFixed(0) — exact values, no rounding surprises.
    expect(await findByText('3')).toBeTruthy();
    expect(await findByText('40')).toBeTruthy();
    expect(await findByText('12')).toBeTruthy();
    expect(await findByText('2')).toBeTruthy();
  });

  it('re-dispatches when refreshToken changes (mutation-triggered refresh)', async () => {
    lensRunMock.mockReturnValue(ok({ boardCount: 1, elementCount: 1, stickyCount: 0, sharedCount: 0, openCommentCount: 0 }));
    const { rerender } = render(<WhiteboardWorkspaceSummary refreshToken={0} />);
    await waitFor(() => expect(lensRunMock).toHaveBeenCalledTimes(1));
    rerender(<WhiteboardWorkspaceSummary refreshToken={1} />);
    await waitFor(() => expect(lensRunMock).toHaveBeenCalledTimes(2));
  });

  it('degrades silently (renders nothing) on macro error — never blocks the board', async () => {
    lensRunMock.mockReturnValue(Promise.resolve({ data: { ok: false, result: null, error: 'boom' } }));
    const { container } = render(<WhiteboardWorkspaceSummary />);
    await waitFor(() => expect(lensRunMock).toHaveBeenCalled());
    await waitFor(() => expect(container.textContent).not.toContain('Boards'));
  });
});
