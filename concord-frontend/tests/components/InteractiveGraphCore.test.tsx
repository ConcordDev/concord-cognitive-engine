/**
 * InteractiveGraph minimap — pins the deterministic-hash fix.
 *
 * Nodes with no real x/y used to fall back to `Math.random() * 100` for
 * their minimap dot position, so a node re-rendered without a stable
 * position jittered to a new spot every render instead of staying put.
 * `hashPercent(id, salt)` is a deterministic 0..100 spread keyed off the
 * node id, so the same node always lands at the same minimap dot.
 *
 * cytoscape itself is mocked out (a generic chainable stub) — the minimap
 * block renders straight off the `nodes` prop and never touches the `cy`
 * instance, so this only needs cytoscape's init effect to not throw.
 */

import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

function makeChainable(): unknown {
  const chainable: unknown = new Proxy(() => chainable, {
    get: (_t, prop) => {
      if (prop === 'then' || prop === Symbol.toPrimitive) return undefined;
      return (..._args: unknown[]) => chainable;
    },
  });
  return chainable;
}

vi.mock('cytoscape', () => ({
  default: vi.fn(() => makeChainable()),
}));

import { InteractiveGraph } from '@/components/graphs/InteractiveGraphCore';

describe('InteractiveGraph minimap', () => {
  it('renders a minimap dot per node using the deterministic hash fallback (no real x/y on the node)', () => {
    const { container } = render(
      <InteractiveGraph
        nodes={[
          { id: 'node-a', label: 'A', tier: 'regular' },
          { id: 'node-b', label: 'B', tier: 'mega' },
        ]}
        edges={[]}
        showMinimap
      />,
    );

    const dots = container.querySelectorAll('.absolute.w-1\\.5.h-1\\.5.rounded-full');
    expect(dots.length).toBe(2);
    for (const dot of Array.from(dots)) {
      const style = (dot as HTMLElement).style;
      // Both left/top must be a finite in-range percentage, not NaN/undefined
      // (which Math.random()'s replacement could never produce, but a typo
      // in the hash call could).
      const left = parseFloat(style.left);
      const top = parseFloat(style.top);
      expect(left).toBeGreaterThanOrEqual(0);
      expect(left).toBeLessThan(100);
      expect(top).toBeGreaterThanOrEqual(0);
      expect(top).toBeLessThan(100);
    }
  });

  it('the same node id always renders at the same minimap position across remounts (deterministic, not Math.random)', () => {
    const nodes = [{ id: 'stable-node', label: 'Stable', tier: 'regular' as const }];
    const first = render(<InteractiveGraph nodes={nodes} edges={[]} showMinimap />);
    const firstDot = first.container.querySelector('.absolute.w-1\\.5.h-1\\.5.rounded-full') as HTMLElement;
    const firstLeft = firstDot.style.left;
    const firstTop = firstDot.style.top;
    first.unmount();

    const second = render(<InteractiveGraph nodes={nodes} edges={[]} showMinimap />);
    const secondDot = second.container.querySelector('.absolute.w-1\\.5.h-1\\.5.rounded-full') as HTMLElement;
    expect(secondDot.style.left).toBe(firstLeft);
    expect(secondDot.style.top).toBe(firstTop);
  });
});
