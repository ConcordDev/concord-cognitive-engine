import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));
vi.mock('@/components/viz/ChartKit', () => ({ ChartKit: () => null }));

import { TrendPanel } from '@/components/self/TrendPanel';
import { getLensState } from '@/lib/lens-state-persistence';

function trendCalls() {
  return lensRunMock.mock.calls
    .filter((c) => c[1] === 'trend')
    .map((c) => c[2] as { metric?: string; days?: number });
}

beforeEach(() => {
  window.localStorage.clear();
  lensRunMock.mockReset();
  lensRunMock.mockImplementation(async (_domain: string, _action: string, params?: { metric?: string; days?: number }) => ({
    data: {
      ok: true,
      result: {
        metric: params?.metric, label: 'Mood', unit: '', higherBetter: true, days: params?.days,
        series: [{ day: '2026-11-01', value: 3 }],
        stats: { count: 1, avg: 3, min: 3, max: 3, latest: 3, deltaPct: 0 },
      },
    },
  }));
});

// FIX-self-005 / FIX-self-015 — the Trends panel unmounts on every tab
// switch inside the Self lens, and its metric/range useState reset to
// Steps / 30d on return. Both prefs now persist through the shared
// lens UI-state store and restore on remount.
describe('FIX-self-005/015 — trend metric + range survive a tab reopen', () => {
  it('choosing Mood + 1y persists both; a remount restores them and queries with them', async () => {
    const first = render(<TrendPanel refreshKey={0} />);
    const select = screen.getByLabelText('Trend metric') as HTMLSelectElement;
    expect(select.value).toBe('steps');
    await waitFor(() => expect(trendCalls()).toContainEqual({ metric: 'steps', days: 30 }));

    fireEvent.change(select, { target: { value: 'mood' } });
    fireEvent.click(screen.getByRole('button', { name: '1y' }));
    await waitFor(() => expect(trendCalls()).toContainEqual({ metric: 'mood', days: 365 }));
    expect(getLensState('self')?.trendMetric).toBe('mood');
    expect(getLensState('self')?.trendDays).toBe(365);

    first.unmount();
    lensRunMock.mockClear();
    render(<TrendPanel refreshKey={0} />);
    expect((screen.getByLabelText('Trend metric') as HTMLSelectElement).value).toBe('mood');
    expect(screen.getByRole('button', { name: '1y' }).getAttribute('aria-pressed')).toBe('true');
    await waitFor(() => expect(trendCalls()).toContainEqual({ metric: 'mood', days: 365 }));
    expect(trendCalls()).not.toContainEqual({ metric: 'steps', days: 30 });
  });
});
