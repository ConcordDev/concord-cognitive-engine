/**
 * CB-0513 — debug cluster pins.
 *
 * FIX-debug-012 — alert rules gain an Edit path: alert-update has
 *   always accepted name/threshold/op/severity; the panel only ever
 *   sent `enabled`. Editing loads the rule into the form; metric and
 *   kind are create-only and render read-only.
 * FIX-debug-013 — a captured trace can be deleted (trace-delete +
 *   a sticky confirm on the row).
 * FIX-debug-014 — the active metric's samples can be cleared
 *   (metric-clear + sticky confirm in the series view).
 * FIX-debug-003 — empty submits speak: the Create Alert Rule form
 *   and the Record Exception form name the missing field beside the
 *   disabled control instead of sitting silent.
 * FIX-debug-007 — the Release Track form names its missing version.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));
vi.mock('@/components/viz', () => ({
  ChartKit: () => null,
  TimelineView: () => null,
}));
vi.mock('@/components/debug/ProjectContext', () => ({
  useDebugProject: () => ({ projectId: 'p1' }),
}));

import { MetricsAndAlerts } from '@/components/debug/MetricsAndAlerts';
import { TraceViewer } from '@/components/debug/TraceViewer';
import { IssueInbox } from '@/components/debug/IssueInbox';
import { ReleaseTracker } from '@/components/debug/ReleaseTracker';

const ok = (result: unknown) => Promise.resolve({ data: { ok: true, result, error: null } });

const RULE = {
  id: 'a1', name: 'CPU high', kind: 'metric', metric: 'cpu', op: '>',
  threshold: 90, severity: 'warning', enabled: true, state: 'ok',
  triggerCount: 0, lastTriggeredAt: null, lastValue: null,
};

beforeEach(() => {
  lensRunMock.mockReset();
});

function metricsRouter(overrides: Record<string, unknown> = {}) {
  return (_d: string, action: string, input: Record<string, unknown>) => {
    if (action in overrides) return ok(overrides[action]);
    if (action === 'metric-series') {
      return ok(input?.metric
        ? { metrics: ['cpu'], points: [{ at: '2026-11-13T00:00:00Z', value: 3 }], stats: { count: 1, avg: 3, min: 3, max: 3, latest: 3 } }
        : { metrics: ['cpu'], points: [], stats: null });
    }
    if (action === 'alert-list') return ok({ rules: [], count: 0, alerting: 0 });
    return ok({});
  };
}

describe('FIX-debug-003 — Create Alert Rule names what is missing', () => {
  it('shows the missing fields and clears them as the form fills', async () => {
    lensRunMock.mockImplementation(metricsRouter());
    render(<MetricsAndAlerts />);
    expect(await screen.findByText(/Add a rule name, a metric, a threshold to create the rule/)).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('Rule name'), { target: { value: 'CPU high' } });
    expect(await screen.findByText(/Add a metric, a threshold to create the rule/)).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('metric'), { target: { value: 'cpu' } });
    fireEvent.change(screen.getByPlaceholderText('threshold'), { target: { value: '90' } });
    expect(screen.queryByText(/to create the rule/)).toBeNull();
  });
});

describe('FIX-debug-012 — alert rules can be edited', () => {
  it('loads the rule into the form and saves name/threshold/severity via alert-update', async () => {
    lensRunMock.mockImplementation(metricsRouter({ 'alert-list': { rules: [RULE], count: 1, alerting: 0 } }));
    render(<MetricsAndAlerts />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    expect(await screen.findByRole('button', { name: /Save changes/ })).toBeTruthy();
    const metricInput = screen.getByPlaceholderText('metric') as HTMLInputElement;
    expect(metricInput.disabled).toBe(true);
    expect(metricInput.value).toBe('cpu');
    fireEvent.change(screen.getByPlaceholderText('threshold'), { target: { value: '42' } });
    fireEvent.click(screen.getByRole('button', { name: /Save changes/ }));
    await waitFor(() => {
      const call = lensRunMock.mock.calls.find((c) => c[1] === 'alert-update');
      expect(call).toBeTruthy();
      expect(call![2]).toMatchObject({ id: 'a1', name: 'CPU high', threshold: 42, op: '>', severity: 'warning' });
    });
  });
});

describe('FIX-debug-014 — samples can be cleared', () => {
  it('clears the active metric through the sticky confirm', async () => {
    lensRunMock.mockImplementation(metricsRouter());
    render(<MetricsAndAlerts />);
    fireEvent.click(await screen.findByRole('button', { name: 'Clear cpu samples' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm clear samples' }));
    await waitFor(() => {
      const call = lensRunMock.mock.calls.find((c) => c[1] === 'metric-clear');
      expect(call).toBeTruthy();
      expect(call![2]).toMatchObject({ metric: 'cpu', projectId: 'p1' });
    });
  });
});

describe('FIX-debug-013 — traces can be deleted', () => {
  it('deletes through the sticky confirm and reloads the list', async () => {
    let deleted = false;
    lensRunMock.mockImplementation((_d: string, action: string) => {
      if (action === 'trace-list') {
        return ok({ traces: deleted ? [] : [{ id: 't1', name: 'req-x', spanCount: 1, totalDurationMs: 5, errorCount: 0, rootService: 'web', recordedAt: '2026-11-13T00:00:00Z' }] });
      }
      if (action === 'trace-delete') { deleted = true; return ok({ deleted: 't1' }); }
      return ok({});
    });
    render(<TraceViewer />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete trace req-x' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm delete trace' }));
    await waitFor(() => {
      expect(lensRunMock.mock.calls.some((c) => c[1] === 'trace-delete' && (c[2] as { id: string }).id === 't1')).toBe(true);
    });
    expect(await screen.findByText(/No traces — capture one/)).toBeTruthy();
  });
});

describe('FIX-debug-003 — Record Exception names its missing field', () => {
  it('shows the note while the message is empty and clears it on input', async () => {
    lensRunMock.mockImplementation((_d: string, action: string) => {
      if (action === 'issue-list') return ok({ issues: [], count: 0 });
      if (action === 'release-list') return ok({ releases: [] });
      return ok({});
    });
    render(<IssueInbox />);
    expect(await screen.findByText('An exception message is required to record an exception.')).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('Exception message'), { target: { value: 'Boom' } });
    expect(screen.queryByText('An exception message is required to record an exception.')).toBeNull();
  });
});

describe('FIX-debug-007 — Release Track names its missing version', () => {
  it('shows the note while the version is empty and clears it on input', async () => {
    lensRunMock.mockImplementation((_d: string, action: string) => {
      if (action === 'release-list') return ok({ releases: [] });
      return ok({});
    });
    render(<ReleaseTracker />);
    expect(await screen.findByText(/A version is required to track a release/)).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('Version (e.g. v1.4.0)'), { target: { value: 'v2.0.0' } });
    expect(screen.queryByText(/A version is required to track a release/)).toBeNull();
  });
});
