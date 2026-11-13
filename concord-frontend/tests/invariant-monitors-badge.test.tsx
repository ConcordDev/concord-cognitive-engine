// Audit fix sweep (PR #2356) — FIX-invariant-003: the Monitors-active
// badge carried the global lock-70 class, whose CSS ::after paints a
// hardcoded '70%' — so the badge read 70% with 0/0 monitors. The chip
// now renders the real active percentage and only when monitors
// exist; with none, there is no percentage at all.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import React from 'react';

const h = vi.hoisted(() => ({ summary: { total: 0, active: 0, violating: 0 } }));

vi.mock('@/lib/api/client', () => ({
  lensRun: vi.fn((domain: string, action: string) => {
    if (action === 'listMonitors') {
      return Promise.resolve({ data: { ok: true, result: { summary: h.summary } } });
    }
    return Promise.resolve({
      data: {
        ok: true,
        result: { summary: { total: 0, open: 0, resolved: 0, critical: 0, high: 0, medium: 0, low: 0 } },
      },
    });
  }),
}));
vi.mock('framer-motion', () => ({
  motion: new Proxy({}, {
    get: () => ({ children, ...props }: { children: React.ReactNode }) =>
      React.createElement('div', props, children),
  }),
}));

import { OverviewPanel } from '@/components/invariant/OverviewPanel';

describe('invariant overview — monitors badge percentage', () => {
  beforeEach(() => { h.summary = { total: 0, active: 0, violating: 0 }; });

  it('with 0/0 monitors there is no lock-70 class and no percentage chip', async () => {
    const view = render(<OverviewPanel />);
    await waitFor(() => expect(view.container.textContent).toContain('0/0'));
    expect(view.container.querySelector('.lock-70')).toBeNull();
    expect(view.container.textContent).not.toContain('70%');
  });

  it('with monitors, the chip shows the real active percentage', async () => {
    h.summary = { total: 4, active: 3, violating: 0 };
    const view = render(<OverviewPanel />);
    await waitFor(() => expect(view.container.textContent).toContain('3/4'));
    expect(view.container.querySelector('.lock-70')).toBeNull();
    expect(view.container.textContent).toContain('75%');
  });
});
