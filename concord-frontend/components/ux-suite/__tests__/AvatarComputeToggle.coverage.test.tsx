// Coverage for the avatar compute-mode toggle: selected-mode chip, dormant note vs live stats,
// and mode switching.

import React from 'react';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const h = vi.hoisted(() => ({ setMode: vi.fn(), state: { mode: 'auto', isWorkerActive: true, stats: { samples: 0, lastMs: 0, p50: 0, p99: 0 } } }));
vi.mock('@/hooks/useAvatarAnimator', () => ({
  useAvatarAnimator: () => ({ mode: h.state.mode, setMode: h.setMode, isWorkerActive: h.state.isWorkerActive, getStats: () => h.state.stats }),
}));

afterEach(() => { cleanup(); h.setMode.mockClear(); });

describe('AvatarComputeToggle', () => {
  it('shows the dormant note and switches modes', async () => {
    const { AvatarComputeToggle } = await import('../AvatarComputeToggle');
    const view = render(<AvatarComputeToggle />);
    expect(view.container.textContent).toMatch(/Dormant in this lens/);
    for (const label of ['Main thread', 'Worker only', 'Auto']) {
      await act(async () => { fireEvent.click(screen.getAllByText(label, { selector: "span" })[0].closest('button') as HTMLElement); });
    }
    expect(h.setMode.mock.calls.map((c) => c[0])).toEqual(['main-thread', 'worker-only', 'auto']);
  });

  it('reports the selected mode and live stats for each mode', async () => {
    const { AvatarComputeToggle } = await import('../AvatarComputeToggle');
    h.state.stats = { samples: 12, lastMs: 1.234, p50: 0.9, p99: 4.5 };
    for (const [mode, worker, re] of [['main-thread', true, /main thread \(your selection\)/], ['worker-only', true, /worker only/], ['worker-only', false, /worker only/], ['auto', false, /mode/], ['auto', true, /mode/]] as const) {
      h.state.mode = mode; h.state.isWorkerActive = worker;
      const view = render(<AvatarComputeToggle />);
      expect(view.container.textContent).toMatch(re);
      expect(view.container.textContent).toContain('1.23 ms');
      expect(view.container.textContent).not.toMatch(/Dormant/);
      cleanup();
    }
  });
});
