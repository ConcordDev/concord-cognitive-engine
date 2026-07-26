/**
 * GraphView — click-to-focus (Obsidian "local graph" idiom) + legend.
 *
 * R1-2 wave 3 premium pass. Two real behaviors added to the existing
 * force-laid graph:
 *   1. Clicking a node calls onNodeClick, marks it selected (rendered as a
 *      dismissible chip naming the node + its real connection count), and
 *      clicking the same node again clears the selection. Escape also
 *      clears it.
 *   2. A legend below the canvas lists the graph's actual group tags +
 *      counts (never a fixed/decorative key).
 *
 * requestAnimationFrame is stubbed as a no-op (same convention as the
 * pre-existing GraphView.test.tsx) so the physics loop never mutates node
 * positions — hit-testing runs against the deterministic seeded layout,
 * which we pin by stubbing Math.random.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';

import { GraphView } from '@/components/atlas/GraphView';

let originalRAF: typeof window.requestAnimationFrame;
let originalCAF: typeof window.cancelAnimationFrame;
let originalRandom: typeof Math.random;

beforeEach(() => {
  originalRAF = window.requestAnimationFrame;
  originalCAF = window.cancelAnimationFrame;
  originalRandom = Math.random;
  window.requestAnimationFrame = vi.fn(() => 0) as unknown as typeof window.requestAnimationFrame;
  window.cancelAnimationFrame = vi.fn() as unknown as typeof window.cancelAnimationFrame;
  Math.random = () => 0; // deterministic seeded layout (no radius jitter)
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

afterEach(() => {
  window.requestAnimationFrame = originalRAF;
  window.cancelAnimationFrame = originalCAF;
  Math.random = originalRandom;
});

// With Math.random stubbed to 0: node i of n seeds at
// x = 320 + cos(angle)*120, y = 200 + sin(angle)*120, angle = (i/n)*2*PI.
// For a 2-node graph: node 0 -> (440, 200), node 1 -> (200, 200).
const NODE_A_POS = { clientX: 440, clientY: 200 };
const NODE_B_POS = { clientX: 200, clientY: 200 };

/** Real pointer behavior: hit-testing reads the last tracked mouse
 * position, which is only updated on 'mousemove' — a click with no prior
 * move (as any real user's click always has) wouldn't hit-test anywhere,
 * so tests move the mouse to the target first, same as a real click. */
function clickAt(el: Element, pos: { clientX: number; clientY: number }) {
  fireEvent.mouseMove(el, pos);
  fireEvent.click(el, pos);
}

describe('GraphView — click-to-focus', () => {
  it('clicking a node calls onNodeClick and shows a selection chip with its connection count', () => {
    const onNodeClick = vi.fn();
    const { container } = render(
      <GraphView
        nodes={[{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Beta' }]}
        edges={[{ source: 'a', target: 'b' }]}
        onNodeClick={onNodeClick}
      />,
    );
    const canvas = container.querySelector('canvas')!;
    clickAt(canvas, NODE_A_POS);

    expect(onNodeClick).toHaveBeenCalledTimes(1);
    expect(onNodeClick.mock.calls[0][0].id).toBe('a');
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('1 connection')).toBeInTheDocument();
  });

  it('clicking the same node twice toggles the selection off', () => {
    const { container } = render(
      <GraphView
        nodes={[{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Beta' }]}
        edges={[{ source: 'a', target: 'b' }]}
      />,
    );
    const canvas = container.querySelector('canvas')!;
    clickAt(canvas, NODE_A_POS);
    expect(screen.getByText('Alpha')).toBeInTheDocument();

    clickAt(canvas, NODE_A_POS);
    expect(screen.queryByText('Alpha')).not.toBeInTheDocument();
  });

  it('the × control clears the selection', () => {
    const { container } = render(
      <GraphView
        nodes={[{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Beta' }]}
        edges={[{ source: 'a', target: 'b' }]}
      />,
    );
    const canvas = container.querySelector('canvas')!;
    clickAt(canvas, NODE_A_POS);
    expect(screen.getByText('Alpha')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Clear selection'));
    expect(screen.queryByText('Alpha')).not.toBeInTheDocument();
  });

  it('Escape clears the selection', () => {
    const { container } = render(
      <GraphView
        nodes={[{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Beta' }]}
        edges={[{ source: 'a', target: 'b' }]}
      />,
    );
    const canvas = container.querySelector('canvas')!;
    clickAt(canvas, NODE_A_POS);
    expect(screen.getByText('Alpha')).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByText('Alpha')).not.toBeInTheDocument();
  });

  it('clicking empty space does not select anything', () => {
    const onNodeClick = vi.fn();
    const { container } = render(
      <GraphView
        nodes={[{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Beta' }]}
        edges={[{ source: 'a', target: 'b' }]}
        onNodeClick={onNodeClick}
      />,
    );
    const canvas = container.querySelector('canvas')!;
    clickAt(canvas, { clientX: 0, clientY: 0 });
    expect(onNodeClick).not.toHaveBeenCalled();
  });

  it('shows the correct node on a click at node B\'s seeded position', () => {
    const onNodeClick = vi.fn();
    const { container } = render(
      <GraphView
        nodes={[{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Beta' }]}
        edges={[{ source: 'a', target: 'b' }]}
        onNodeClick={onNodeClick}
      />,
    );
    const canvas = container.querySelector('canvas')!;
    clickAt(canvas, NODE_B_POS);
    expect(onNodeClick.mock.calls[0][0].id).toBe('b');
  });
});

describe('GraphView — legend', () => {
  it('renders one entry per real group tag with its actual count, sorted by frequency', () => {
    render(
      <GraphView
        nodes={[
          { id: 'a', group: 'restaurant' },
          { id: 'b', group: 'restaurant' },
          { id: 'c', group: 'park' },
        ]}
        edges={[]}
      />,
    );
    expect(screen.getByText('restaurant')).toBeInTheDocument();
    expect(screen.getByText('· 2')).toBeInTheDocument();
    expect(screen.getByText('park')).toBeInTheDocument();
    expect(screen.getByText('· 1')).toBeInTheDocument();
  });

  it('omits the legend entirely for a single-group graph (nothing to distinguish)', () => {
    const { container } = render(
      <GraphView
        nodes={[{ id: 'a', group: 'place' }, { id: 'b', group: 'place' }]}
        edges={[]}
      />,
    );
    expect(container.querySelector('.gap-x-3')).not.toBeInTheDocument();
  });
});
