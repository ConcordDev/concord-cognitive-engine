/**
 * Affect S-AFF-8 — chrome honesty (FE pins).
 *
 * F11: Reset produced no visible effect and no feedback — its failure
 * path was console-only. The strip now states the reset's outcome.
 * F19: the Trends charts rescaled their axis to the data maximum on a
 * fixed scale. ChartKit gained an optional yDomain (rulers don't
 * rescale); the pin asserts the domain reaches the YAxis, and that
 * omitting it leaves the axis untouched for every other caller.
 */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';

type QState = { data: unknown; isLoading: boolean; isError: boolean; error: unknown };
const q: Record<string, QState> = {
  'affect-state': {
    data: { state: { v: 0.5, a: 0.25, s: 0.8, c: 0.8, g: 0.7, t: 0.7, f: 0.2 } },
    isLoading: false, isError: false, error: null,
  },
  'affect-policy': { data: { policy: {} }, isLoading: false, isError: false, error: null },
  'affect-health': { data: { healthy: true, sessions: 1 }, isLoading: false, isError: false, error: null },
  'affect-events': { data: { events: [] }, isLoading: false, isError: false, error: null },
};
const mutationState: Record<string, unknown> = {
  mutate: vi.fn(), isPending: false, isSuccess: false, isError: false, error: null,
};
const refetch = vi.fn();

vi.mock('@tanstack/react-query', () => ({
  useQuery: (opts: { queryKey: unknown[] }) => {
    const key = String((opts.queryKey || [])[0] || '');
    const st = q[key] || { data: null, isLoading: false, isError: false, error: null };
    return { ...st, refetch };
  },
  useMutation: () => mutationState,
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock('@/lib/api/client', () => ({
  apiHelpers: {
    affect: {
      state: vi.fn(), policy: vi.fn(), health: vi.fn(), events: vi.fn(), reset: vi.fn(), emit: vi.fn(),
    },
  },
  lensRun: vi.fn(),
}));

vi.mock('@/store/ui', () => ({
  useUIStore: (selector: (s: { addToast: () => void }) => unknown) => selector({ addToast: vi.fn() }),
}));

vi.mock('@/components/common/EmptyState', () => ({
  ErrorState: () => null,
}));

let capturedYAxis: Record<string, unknown> | null = null;
vi.mock('recharts', () => {
  const Passthrough = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return {
    ResponsiveContainer: Passthrough,
    LineChart: Passthrough,
    BarChart: Passthrough,
    AreaChart: Passthrough,
    ScatterChart: Passthrough,
    Line: () => null,
    Bar: () => null,
    Area: () => null,
    Scatter: () => null,
    XAxis: () => null,
    CartesianGrid: () => null,
    Tooltip: () => null,
    Legend: () => null,
    YAxis: (props: Record<string, unknown>) => {
      capturedYAxis = props;
      return null;
    },
  };
});

import { AffectSessionProvider } from '@/components/affect/AffectSessionContext';
import { AffectStateStrip } from '@/components/affect/AffectStateStrip';
import { ChartKit } from '@/components/viz/ChartKit';

describe('Affect S-AFF-8 — Reset states its outcome (F11)', () => {
  it('a successful reset shows the confirmation line', () => {
    mutationState.isSuccess = true;
    mutationState.isError = false;
    const { getByText } = render(
      <AffectSessionProvider>
        <AffectStateStrip />
      </AffectSessionProvider>
    );
    expect(getByText(/Session reset — state returned to baseline/)).toBeTruthy();
  });

  it('a failed reset shows an alert, not silence', () => {
    mutationState.isSuccess = false;
    mutationState.isError = true;
    mutationState.error = new Error('ATS not loaded');
    const { getByRole } = render(
      <AffectSessionProvider>
        <AffectStateStrip />
      </AffectSessionProvider>
    );
    expect(getByRole('alert').textContent).toContain('Reset failed — ATS not loaded');
  });
});

describe('Affect S-AFF-8 — fixed-scale charts keep their ruler (F19)', () => {
  it('yDomain reaches the YAxis', () => {
    capturedYAxis = null;
    render(
      <ChartKit
        kind="line"
        data={[{ day: '2026-06-28', avgMood: 3 }]}
        xKey="day"
        series={[{ key: 'avgMood', label: 'Daily avg mood' }]}
        yDomain={[1, 5]}
      />
    );
    expect(capturedYAxis?.domain).toEqual([1, 5]);
  });

  it('without yDomain the axis keeps its default (no domain forced)', () => {
    capturedYAxis = null;
    render(
      <ChartKit
        kind="bar"
        data={[{ day: '2026-06-28', avgMood: 3 }]}
        xKey="day"
        series={[{ key: 'avgMood', label: 'Daily avg mood' }]}
      />
    );
    expect(capturedYAxis?.domain).toBeUndefined();
  });
});
