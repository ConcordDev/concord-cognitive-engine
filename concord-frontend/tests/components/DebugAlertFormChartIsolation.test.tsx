// DebugAlertFormChartIsolation.test.tsx
//
// FIX-debug-005: the Metrics Alert Rules form shares a component with
// the recharts time-series chart, and the chart's data/series props
// were rebuilt inline on every render — so each keystroke in the rule
// form re-rendered the whole SVG chart (heavy lag under load, with
// keystrokes landing late or in the wrong field). The chart is now
// memoized with stable props. This pin counts chart renders while
// typing in the form: the count must not move.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';

let chartRenders = 0;
vi.mock('@/components/viz', () => ({
  ChartKit: () => {
    chartRenders += 1;
    return React.createElement('div', { 'data-testid': 'chart' });
  },
}));
vi.mock('@/components/debug/ProjectContext', () => ({
  useDebugProject: () => ({ projectId: 'proj-1' }),
}));
vi.mock('@/components/common/StickyDeleteConfirm', () => ({
  StickyDeleteConfirm: () => null,
}));
vi.mock('lucide-react', () => {
  const createIcon = (name: string) => {
    const Component = (props: Record<string, unknown>) => React.createElement('span', { 'data-testid': `icon-${name}`, ...props });
    Component.displayName = name;
    return Component;
  };
  return {
    BellRing: createIcon('BellRing'), Gauge: createIcon('Gauge'), Loader2: createIcon('Loader2'),
    Pencil: createIcon('Pencil'), Plus: createIcon('Plus'), RefreshCw: createIcon('RefreshCw'),
    Trash2: createIcon('Trash2'),
  };
});

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRunMock(...a),
}));

import { MetricsAndAlerts } from '@/components/debug/MetricsAndAlerts';

describe('Alert Rules form typing does not re-render the chart (FIX-debug-005)', () => {
  beforeEach(() => {
    chartRenders = 0;
    lensRunMock.mockReset();
    lensRunMock.mockImplementation(async (_domain: string, action: string) => {
      if (action === 'metric-series') {
        return {
          data: {
            ok: true,
            result: {
              metrics: ['heap_used_mb'],
              points: [
                { at: new Date().toISOString(), value: 42, max: 50 },
                { at: new Date().toISOString(), value: 43, max: 51 },
              ],
              stats: { count: 2, avg: 42.5, min: 42, max: 51, latest: 43 },
            },
          },
        };
      }
      if (action === 'alert-list') return { data: { ok: true, result: { rules: [] } } };
      return { data: { ok: true, result: {} } };
    });
  });
  afterEach(() => cleanup());

  it('chart render count is flat while typing the rule name', async () => {
    render(React.createElement(MetricsAndAlerts));
    await screen.findByTestId('chart');
    // Settle: the mount load flips the active metric once, which
    // legitimately redraws the chart. Wait for the count to hold still
    // across two polls before treating it as the baseline.
    let settled = chartRenders;
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 25));
      if (chartRenders === settled && settled > 0) break;
      settled = chartRenders;
    }
    expect(settled).toBeGreaterThan(0);

    const name = screen.getByPlaceholderText('Rule name');
    fireEvent.change(name, { target: { value: 'cpu hot' } });
    fireEvent.change(name, { target: { value: 'cpu hot!' } });
    expect((name as HTMLInputElement).value).toBe('cpu hot!');
    expect(chartRenders).toBe(settled);
  });
});
