/**
 * whiteboard.frame-update and whiteboard.embed-update were previously
 * UNSURFACED — create/delete had a UI, editing didn't (see
 * docs/lens-specs/whiteboard-capability-map.md). WhiteboardCollabPanel's
 * FramesTab/EmbedsTab now render an inline Edit affordance next to the
 * existing Delete button that calls the real macros with the fields they
 * actually accept (frame-update: label/x/y/w/h/order; embed-update:
 * x/y/w/h/title — NOT url, which the macro doesn't support).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, fireEvent, screen } from '@testing-library/react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

import { WhiteboardCollabPanel } from '@/components/whiteboard/WhiteboardCollabPanel';

function ok(result: unknown) {
  return Promise.resolve({ data: { ok: true, result, error: null } });
}

function wireLensRun(overrides: Record<string, unknown> = {}) {
  lensRunMock.mockImplementation((arg: { domain: string; action: string; input?: Record<string, unknown> }) => {
    const key = `${arg.domain}.${arg.action}`;
    if (key in overrides) return ok(overrides[key]);
    return ok({});
  });
}

describe('WhiteboardCollabPanel — frame-update (Frames tab edit affordance)', () => {
  beforeEach(() => { lensRunMock.mockReset(); });

  it('renders an Edit button next to Delete for each frame', async () => {
    wireLensRun({
      'whiteboard.frame-list': { frames: [{ id: 'fr_1', label: 'Ideas', x: 0, y: 0, w: 400, h: 300, order: 0, memberIds: [] }] },
    });
    render(<WhiteboardCollabPanel boardId="board-1" shapes={[]} />);
    await waitFor(() => expect(screen.getByText('Ideas')).toBeTruthy());
    expect(screen.getByLabelText('Edit')).toBeTruthy();
    expect(screen.getByLabelText('Delete')).toBeTruthy();
  });

  it('clicking Edit, changing the label/size, and saving calls whiteboard.frame-update with the real field shape', async () => {
    wireLensRun({
      'whiteboard.frame-list': { frames: [{ id: 'fr_1', label: 'Ideas', x: 0, y: 0, w: 400, h: 300, order: 0, memberIds: [] }] },
      'whiteboard.frame-update': { frame: { id: 'fr_1', label: 'Renamed', x: 0, y: 0, w: 500, h: 300, order: 0, memberIds: [] } },
    });
    render(<WhiteboardCollabPanel boardId="board-1" shapes={[]} />);
    await waitFor(() => expect(screen.getByText('Ideas')).toBeTruthy());

    fireEvent.click(screen.getByLabelText('Edit'));
    // Two "Frame name…" inputs exist (the top "add new frame" input + the
    // inline edit input) — the edit one is pre-filled with the frame's label.
    const labelInput = screen.getAllByPlaceholderText('Frame name…').find(
      (el) => (el as HTMLInputElement).value === 'Ideas',
    ) as HTMLInputElement;
    expect(labelInput).toBeTruthy();
    fireEvent.change(labelInput, { target: { value: 'Renamed' } });
    const widthInput = screen.getByTitle('Width') as HTMLInputElement;
    fireEvent.change(widthInput, { target: { value: '500' } });
    fireEvent.click(screen.getByLabelText('Save'));

    await waitFor(() => {
      expect(lensRunMock).toHaveBeenCalledWith({
        domain: 'whiteboard', action: 'frame-update',
        input: { boardId: 'board-1', id: 'fr_1', label: 'Renamed', w: 500, h: 300 },
      });
    });
  });

  it('Cancel discards the edit without calling frame-update', async () => {
    wireLensRun({
      'whiteboard.frame-list': { frames: [{ id: 'fr_1', label: 'Ideas', x: 0, y: 0, w: 400, h: 300, order: 0, memberIds: [] }] },
    });
    render(<WhiteboardCollabPanel boardId="board-1" shapes={[]} />);
    await waitFor(() => expect(screen.getByText('Ideas')).toBeTruthy());

    fireEvent.click(screen.getByLabelText('Edit'));
    fireEvent.click(screen.getByLabelText('Cancel'));

    expect(lensRunMock).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'frame-update' }));
    expect(screen.getByText('Ideas')).toBeTruthy();
  });
});

describe('WhiteboardCollabPanel — embed-update (Embeds tab edit affordance)', () => {
  beforeEach(() => { lensRunMock.mockReset(); });

  it('clicking Edit, renaming the title, and saving calls whiteboard.embed-update with only the fields the macro accepts', async () => {
    wireLensRun({
      'whiteboard.embed-list': {
        embeds: [{ id: 'em_1', url: 'https://example.com', kind: 'link', title: 'Example', description: '', x: 40, y: 40, w: 200, h: 120 }],
      },
      'whiteboard.embed-update': { embed: { id: 'em_1', title: 'New title' } },
    });
    render(<WhiteboardCollabPanel boardId="board-1" shapes={[]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Embeds' }));
    await waitFor(() => expect(screen.getByText('Example')).toBeTruthy());

    fireEvent.click(screen.getByLabelText('Edit'));
    const titleInput = screen.getByPlaceholderText('Embed title…') as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: 'New title' } });
    fireEvent.click(screen.getByLabelText('Save'));

    await waitFor(() => {
      expect(lensRunMock).toHaveBeenCalledWith({
        domain: 'whiteboard', action: 'embed-update',
        input: { boardId: 'board-1', id: 'em_1', title: 'New title' },
      });
    });
    // The macro doesn't accept a `url` field — verify no call ever tried to send one.
    for (const call of lensRunMock.mock.calls) {
      const arg = call[0] as { action?: string; input?: Record<string, unknown> };
      if (arg?.action === 'embed-update') expect(arg.input).not.toHaveProperty('url');
    }
  });
});
