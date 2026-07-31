import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';

import { GraphView } from '@/components/atlas/GraphView';

let originalRAF: typeof window.requestAnimationFrame;
let originalCAF: typeof window.cancelAnimationFrame;

/** Runs the draw loop's body a bounded number of times (instead of a pure
 *  no-op) so the per-frame render/hover/highlight logic gets exercised, then
 *  stops re-invoking to avoid recursing forever — `step()` calls
 *  requestAnimationFrame(step) again at its own tail. Physics moves nodes
 *  away from their seeded position once real frames run, so this is only
 *  used by tests that don't depend on a node staying at its initial
 *  coordinates for a click hit-test. */
function runRealFramesForThisTest(maxFrames = 3) {
  let count = 0;
  window.requestAnimationFrame = vi.fn((cb: FrameRequestCallback) => {
    count += 1;
    if (count <= maxFrames) cb(performance.now());
    return 0;
  }) as unknown as typeof window.requestAnimationFrame;
}

beforeAll(() => {
  originalRAF = window.requestAnimationFrame;
  originalCAF = window.cancelAnimationFrame;
  // Default: no-op, so click-position tests can rely on a node staying at
  // its deterministic seeded coordinate.
  window.requestAnimationFrame = vi.fn(() => 0) as unknown as typeof window.requestAnimationFrame;
  window.cancelAnimationFrame = vi.fn() as unknown as typeof window.cancelAnimationFrame;
  // Mock canvas getContext so the renderer doesn't error.
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    fillText: vi.fn(),
    strokeText: vi.fn(),
    measureText: vi.fn(() => ({ width: 0 })),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
    setTransform: vi.fn(),
    canvas: { width: 600, height: 400 },
  })) as typeof HTMLCanvasElement.prototype.getContext;
});

afterAll(() => {
  window.requestAnimationFrame = originalRAF;
  window.cancelAnimationFrame = originalCAF;
});

describe('GraphView', () => {
  it('renders a canvas element', () => {
    const { container } = render(
      <GraphView
        nodes={[{ id: 'a' }, { id: 'b' }]}
        edges={[{ source: 'a', target: 'b' }]}
      />,
    );
    expect(container.querySelector('canvas')).toBeInTheDocument();
  });

  it('renders without throwing when given an empty graph', () => {
    expect(() =>
      render(<GraphView nodes={[]} edges={[]} />),
    ).not.toThrow();
  });

  it('renders without throwing when an edge references a missing node', () => {
    expect(() =>
      render(
        <GraphView
          nodes={[{ id: 'a' }]}
          edges={[{ source: 'a', target: 'missing' }]}
        />,
      ),
    ).not.toThrow();
  });

  it('clicking a node updates selectedIdRef/neighborIdsRef via their useEffect sync and shows the selection panel', () => {
    // Deterministic seed position: for a single node (angle 0), x = 320 + r,
    // y = 200, where r = 120 + Math.random()*60. Pin Math.random so the node
    // lands at a known, clickable point instead of a random one.
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5); // r = 150
    try {
      const { container } = render(
        <GraphView nodes={[{ id: 'solo', label: 'Solo Node' }]} edges={[]} />,
      );
      const canvas = container.querySelector('canvas')!;

      // The click handler reads the last mousemove position, not the click
      // event's own coordinates, so move first.
      fireEvent.mouseMove(canvas, { clientX: 470, clientY: 200 });
      fireEvent.click(canvas, { clientX: 470, clientY: 200 });

      expect(screen.getByText('Solo Node')).toBeInTheDocument();
      expect(screen.getByText(/0 connections/)).toBeInTheDocument();
    } finally {
      randomSpy.mockRestore();
    }
  });

  it('Escape clears the selection', () => {
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    try {
      render(<GraphView nodes={[{ id: 'solo', label: 'Solo Node' }]} edges={[]} />);
      const canvas = document.querySelector('canvas')!;
      fireEvent.mouseMove(canvas, { clientX: 470, clientY: 200 });
      fireEvent.click(canvas, { clientX: 470, clientY: 200 });
      expect(screen.getByText('Solo Node')).toBeInTheDocument();

      fireEvent.keyDown(window, { key: 'Escape' });
      expect(screen.queryByText('Solo Node')).not.toBeInTheDocument();
    } finally {
      randomSpy.mockRestore();
    }
  });

  it('hovering a node and calling onNodeClick fire without throwing, with two connected nodes', () => {
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const onNodeClick = vi.fn();
    try {
      const { container } = render(
        <GraphView
          nodes={[{ id: 'a', label: 'A', weight: 0.8 }, { id: 'b', label: 'B' }]}
          edges={[{ source: 'a', target: 'b' }]}
          onNodeClick={onNodeClick}
          focusedId="b"
        />,
      );
      const canvas = container.querySelector('canvas')!;
      // Node 'a' at angle 0: x = 320+150=470, y=200.
      fireEvent.mouseMove(canvas, { clientX: 470, clientY: 200 });
      fireEvent.click(canvas, { clientX: 470, clientY: 200 });
      expect(onNodeClick).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }));
      // 1 neighbor (b) besides itself.
      expect(screen.getByText(/1 connection/)).toBeInTheDocument();

      fireEvent.mouseLeave(canvas);
    } finally {
      randomSpy.mockRestore();
    }
  });

  it('runs several real animation frames (physics + draw loop) without throwing', () => {
    runRealFramesForThisTest(3);
    try {
      const { container } = render(
        <GraphView
          nodes={[{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C', weight: 1.2 }]}
          edges={[{ source: 'a', target: 'b' }, { source: 'b', target: 'c', type: 'derived' }]}
          focusedId="c"
        />,
      );
      const canvas = container.querySelector('canvas')!;
      // Send a hover partway through so the hover/highlight branch of the
      // draw loop runs on a later frame too, not just the first.
      fireEvent.mouseMove(canvas, { clientX: 320, clientY: 200 });
      expect(canvas).toBeInTheDocument();
    } finally {
      // Restore the no-op default (NOT the pristine original — a later
      // test appended to this file still needs the deterministic stub,
      // not jsdom's real timer-driven RAF) so test order never matters.
      window.requestAnimationFrame = vi.fn(() => 0) as unknown as typeof window.requestAnimationFrame;
    }
  });
});
