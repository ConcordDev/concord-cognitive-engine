/**
 * whiteboard.vision was previously UNSURFACED — real backend (LLaVA/Qwen2.5-VL
 * via server/lib/vision-inference.js, `callVision`/`callVisionUrl`) with no
 * upload/analyze affordance calling it (see
 * docs/lens-specs/whiteboard-capability-map.md). Image embeds are the existing
 * "image element pin" the macro needs, so this wires an "Analyze" action onto
 * each image embed in the Embeds tab that calls whiteboard.vision with the
 * embed's URL and renders the result inline — or an honest failure message,
 * never a fabricated success.
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
function fail(error: string) {
  return Promise.resolve({ data: { ok: false, result: null, error } });
}

function wireLensRun(overrides: Record<string, unknown | (() => ReturnType<typeof ok> | ReturnType<typeof fail>)>) {
  lensRunMock.mockImplementation((arg: { domain: string; action: string; input?: Record<string, unknown> }) => {
    const key = `${arg.domain}.${arg.action}`;
    if (key in overrides) {
      const v = overrides[key];
      return typeof v === 'function' ? (v as () => unknown)() : ok(v);
    }
    return ok({});
  });
}

const IMAGE_EMBED = { id: 'em_img', url: 'https://example.com/board.png', kind: 'image', title: 'Board photo', description: '', x: 40, y: 40, w: 200, h: 120 };
const LINK_EMBED = { id: 'em_link', url: 'https://example.com', kind: 'link', title: 'Example', description: '', x: 40, y: 40, w: 200, h: 120 };

describe('WhiteboardCollabPanel — vision (Embeds tab Analyze affordance)', () => {
  beforeEach(() => { lensRunMock.mockReset(); });

  it('renders an Analyze button only for image embeds, not other embed kinds', async () => {
    wireLensRun({ 'whiteboard.embed-list': { embeds: [IMAGE_EMBED, LINK_EMBED] } });
    render(<WhiteboardCollabPanel boardId="board-1" shapes={[]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Embeds' }));
    await waitFor(() => expect(screen.getByText('Board photo')).toBeTruthy());

    // Exactly one Analyze button — the image embed, not the link embed.
    expect(screen.getAllByLabelText('Analyze').length).toBe(1);
  });

  it('clicking Analyze calls whiteboard.vision with the embed URL and renders the returned description', async () => {
    wireLensRun({
      'whiteboard.embed-list': { embeds: [IMAGE_EMBED] },
      'whiteboard.vision': { content: 'A whiteboard with three sticky notes and an arrow diagram.', source: 'ollama_llava', model: 'qwen2.5vl:7b' },
    });
    render(<WhiteboardCollabPanel boardId="board-1" shapes={[]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Embeds' }));
    await waitFor(() => expect(screen.getByText('Board photo')).toBeTruthy());

    fireEvent.click(screen.getByLabelText('Analyze'));

    await waitFor(() => {
      expect(lensRunMock).toHaveBeenCalledWith({
        domain: 'whiteboard', action: 'vision',
        input: { imageUrl: 'https://example.com/board.png' },
      });
    });
    await waitFor(() => expect(screen.getByText(/three sticky notes and an arrow diagram/)).toBeTruthy());
  });

  it('shows a loading state while the call is in flight', async () => {
    let resolveCall: (v: unknown) => void = () => {};
    wireLensRun({
      'whiteboard.embed-list': { embeds: [IMAGE_EMBED] },
      'whiteboard.vision': () => new Promise((resolve) => { resolveCall = resolve; }),
    });
    render(<WhiteboardCollabPanel boardId="board-1" shapes={[]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Embeds' }));
    await waitFor(() => expect(screen.getByText('Board photo')).toBeTruthy());

    const analyzeBtn = screen.getByLabelText('Analyze') as HTMLButtonElement;
    fireEvent.click(analyzeBtn);
    await waitFor(() => expect(analyzeBtn.disabled).toBe(true));

    resolveCall({ data: { ok: true, result: { content: 'done' }, error: null } });
    await waitFor(() => expect(screen.getByText('done')).toBeTruthy());
  });

  it('renders an honest failure message when the vision brain is unreachable — never a fabricated success', async () => {
    wireLensRun({
      'whiteboard.embed-list': { embeds: [IMAGE_EMBED] },
      'whiteboard.vision': () => fail('LLaVA HTTP 503'),
    });
    render(<WhiteboardCollabPanel boardId="board-1" shapes={[]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Embeds' }));
    await waitFor(() => expect(screen.getByText('Board photo')).toBeTruthy());

    fireEvent.click(screen.getByLabelText('Analyze'));

    await waitFor(() => expect(screen.getByText(/Analysis failed/)).toBeTruthy());
    expect(screen.getByText(/LLaVA HTTP 503/)).toBeTruthy();
    // No fabricated "Vision analysis" success box appears alongside the failure.
    expect(screen.queryByText('Vision analysis')).toBeNull();
  });
});
