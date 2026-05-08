import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { render } from '@testing-library/react';

import { GraphView } from '@/components/atlas/GraphView';

let originalRAF: typeof window.requestAnimationFrame;
let originalCAF: typeof window.cancelAnimationFrame;

beforeAll(() => {
  originalRAF = window.requestAnimationFrame;
  originalCAF = window.cancelAnimationFrame;
  // Stub rAF to a no-op so the layout loop doesn't run forever in jsdom.
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
});
