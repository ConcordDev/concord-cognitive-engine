/**
 * shared-vote-cast: vote-count badges rendered on WhiteboardCanvas, but no
 * click-to-vote handler existed — the display side worked, the write side
 * (useWhiteboardCollab's castVote) worked, only the connecting click handler
 * was missing (docs/lens-specs/whiteboard-capability-map.md's own "most
 * concrete near-term gap"). WhiteboardCanvas now accepts an `onVoteElement`
 * prop and, in the Select tool, hit-tests the click against the same votable
 * kinds (rect/sticky/embed/frame) the vote badge renders on.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { WhiteboardCanvas, Shape } from '@/components/whiteboard/WhiteboardCanvas';

// jsdom doesn't implement a real canvas 2D context. The component already
// null-checks `getContext('2d')` and early-returns from its draw effect, so
// stubbing it to return null (instead of letting jsdom log a "not
// implemented" warning) keeps the run clean without needing the `canvas`
// npm package. Hit-testing itself is pure math over `shapes` + mouse coords
// and doesn't touch the canvas context, so it's fully exercisable this way.
beforeAll(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

const STICKY: Shape = { id: 'sticky-1', kind: 'sticky', x: 10, y: 10, w: 120, h: 80 };
const FRAME: Shape = { id: 'frame-1', kind: 'frame', x: 200, y: 200, w: 300, h: 200, label: 'Region' };
const STROKE: Shape = { id: 'stroke-1', kind: 'stroke', x: 0, y: 0, points: [{ x: 400, y: 400 }, { x: 420, y: 420 }] };

describe('WhiteboardCanvas — click-to-vote (shared-vote-cast wiring)', () => {
  it('clicking inside a votable shape (Select tool, onVoteElement set) fires onVoteElement with that shape\'s id', () => {
    const onVoteElement = vi.fn();
    const { container } = render(
      <WhiteboardCanvas initialShapes={[STICKY]} onVoteElement={onVoteElement} />,
    );
    const canvas = container.querySelector('canvas')!;
    // jsdom's getBoundingClientRect defaults to a zero rect, so clientX/Y map
    // 1:1 onto world coords at the default zoom=1/pan={0,0}. (50,50) is
    // inside the sticky's [10,10]..[130,90] box.
    fireEvent.mouseDown(canvas, { clientX: 50, clientY: 50 });
    expect(onVoteElement).toHaveBeenCalledTimes(1);
    expect(onVoteElement).toHaveBeenCalledWith('sticky-1');
  });

  it('clicking a frame region also votes (frame is a votable kind, matching the badge-render condition)', () => {
    const onVoteElement = vi.fn();
    const { container } = render(
      <WhiteboardCanvas initialShapes={[FRAME]} onVoteElement={onVoteElement} />,
    );
    const canvas = container.querySelector('canvas')!;
    fireEvent.mouseDown(canvas, { clientX: 250, clientY: 250 });
    expect(onVoteElement).toHaveBeenCalledWith('frame-1');
  });

  it('clicking empty canvas space does not fire onVoteElement', () => {
    const onVoteElement = vi.fn();
    const { container } = render(
      <WhiteboardCanvas initialShapes={[STICKY]} onVoteElement={onVoteElement} />,
    );
    const canvas = container.querySelector('canvas')!;
    fireEvent.mouseDown(canvas, { clientX: 900, clientY: 900 });
    expect(onVoteElement).not.toHaveBeenCalled();
  });

  it('a stroke (freehand drawing) is not a votable kind — clicking through its bounding area does not vote', () => {
    const onVoteElement = vi.fn();
    const { container } = render(
      <WhiteboardCanvas initialShapes={[STROKE]} onVoteElement={onVoteElement} />,
    );
    const canvas = container.querySelector('canvas')!;
    fireEvent.mouseDown(canvas, { clientX: 410, clientY: 410 });
    expect(onVoteElement).not.toHaveBeenCalled();
  });

  it('without onVoteElement, Select tool clicks are inert (pre-existing no-op behavior is preserved)', () => {
    const onChange = vi.fn();
    const { container } = render(<WhiteboardCanvas initialShapes={[STICKY]} onChange={onChange} />);
    const canvas = container.querySelector('canvas')!;
    fireEvent.mouseDown(canvas, { clientX: 50, clientY: 50 });
    fireEvent.mouseUp(canvas);
    // onChange only fires from the `shapes` effect (initial mount) — no new
    // shape should have been added by the click since the select tool with
    // no onVoteElement is a no-op, same as before this change.
    expect(onChange).toHaveBeenCalledWith([STICKY]);
  });
});
