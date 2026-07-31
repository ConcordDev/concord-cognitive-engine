/**
 * AdvancedAnalytics (LiveStream tab) — pins the filterRef-sync fix.
 *
 * `filterRef.current = nameFilter` was a direct render-body mutation,
 * moved to `useEffect(() => { filterRef.current = nameFilter; }, [nameFilter])`.
 * `poll()` reads `filterRef.current` (not `nameFilter`) inside its own
 * `useCallback` to avoid a stale closure, so typing into the filter input
 * and then triggering a poll (via the live-tail path) must see the ref
 * already updated to the new value.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AdvancedAnalytics } from '@/components/analytics/AdvancedAnalytics';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
}));

vi.mock('@/components/viz', () => ({
  ChartKit: () => null,
}));

// One broad mock shared by every tab's test — each call is
// `lensRun('analytics', action, params)`.
function mockAction(action: string): { ok: boolean; result?: unknown } {
  switch (action) {
    case 'event-stats':
      return { ok: true, result: { topEvents: [{ name: 'signup', count: 3 }] } };
    case 'event-stream':
      return { ok: true, result: { events: [], matched: 0, cursor: null } };
    case 'dashboard-list':
      return { ok: true, result: { dashboards: [] } };
    case 'dashboard-save':
      return { ok: true, result: { dashboard: { id: 'd1' } } };
    case 'path-analysis':
      return { ok: true, result: { journeys: 0, nodes: [], links: [] } };
    case 'breakdown':
      return { ok: true, result: { eventName: 'signup', dimensions: ['plan'], metric: 'count', total: 0, rows: [] } };
    case 'alert-list':
      return { ok: true, result: { alerts: [], firing: 0 } };
    case 'alert-save':
      return { ok: true, result: { alert: { id: 'a1' } } };
    case 'cohort-list':
      return { ok: true, result: { cohorts: [] } };
    case 'cohort-save':
      return { ok: true, result: { cohort: { id: 'c1' } } };
    case 'range-compare':
      return { ok: true, result: { previous: { value: 10 }, current: { value: 12 }, delta: 2, pctChange: 20, direction: 'up' } };
    default:
      return { ok: false };
  }
}

describe('AdvancedAnalytics', () => {
  beforeEach(() => {
    lensRun.mockReset();
    lensRun.mockImplementation((_domain: string, action: string) =>
      Promise.resolve({ data: mockAction(action) }),
    );
  });

  it('typing a filter updates filterRef (via its useEffect) before the next poll reads it', async () => {
    render(<AdvancedAnalytics />);
    fireEvent.click(screen.getByText('Live stream'));

    const input = await screen.findByPlaceholderText('filter by event name');
    fireEvent.change(input, { target: { value: 'signup' } });

    // The nameFilter-keyed useEffect re-polls on every filter change; assert
    // the poll that follows the typed value actually carries it through
    // filterRef.current, proving the ref-sync effect ran before poll() read it.
    await waitFor(() => {
      expect(lensRun).toHaveBeenCalledWith('analytics', 'event-stream', expect.objectContaining({ name: 'signup' }));
    });
  });

  it('Reports (default tab) adds a widget and saves a dashboard', async () => {
    render(<AdvancedAnalytics />);
    fireEvent.click(screen.getByText('metric'));
    fireEvent.change(await screen.findByPlaceholderText('dashboard name'), { target: { value: 'Signups overview' } });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => {
      expect(lensRun).toHaveBeenCalledWith('analytics', 'dashboard-save', expect.objectContaining({ name: 'Signups overview', widgets: expect.any(Array) }));
    });
  });

  it('Paths runs a journey-flow analysis', async () => {
    render(<AdvancedAnalytics />);
    fireEvent.click(screen.getByText('Paths'));
    fireEvent.click(await screen.findByText('Analyse'));

    await waitFor(() => {
      expect(lensRun).toHaveBeenCalledWith('analytics', 'path-analysis', expect.objectContaining({ maxSteps: 5 }));
    });
    expect(await screen.findByText(/No journeys yet/)).toBeInTheDocument();
  });

  it('Breakdown runs a multi-dimensional breakdown', async () => {
    render(<AdvancedAnalytics />);
    fireEvent.click(screen.getByText('Breakdown'));

    fireEvent.change(await screen.findByPlaceholderText('event name'), { target: { value: 'signup' } });
    fireEvent.change(screen.getByPlaceholderText('dimension 1'), { target: { value: 'plan' } });
    fireEvent.click(screen.getByText('Break down'));

    await waitFor(() => {
      expect(lensRun).toHaveBeenCalledWith('analytics', 'breakdown', expect.objectContaining({ eventName: 'signup', dimensions: ['plan'] }));
    });
  });

  it('Alerts saves a new metric alert', async () => {
    render(<AdvancedAnalytics />);
    fireEvent.click(screen.getByText('Alerts'));

    fireEvent.change(await screen.findByPlaceholderText('alert name'), { target: { value: 'Signup drop' } });
    // Default kind is 'threshold', which requires a threshold value before
    // save() proceeds (empty threshold is a silent no-op, by design).
    fireEvent.change(screen.getByPlaceholderText('value'), { target: { value: '10' } });
    fireEvent.click(screen.getByText('Save alert'));

    await waitFor(() => {
      expect(lensRun).toHaveBeenCalledWith('analytics', 'alert-save', expect.objectContaining({ name: 'Signup drop' }));
    });
  });

  it('Cohorts saves a behavioral cohort', async () => {
    render(<AdvancedAnalytics />);
    fireEvent.click(screen.getByText('Cohorts'));

    fireEvent.change(await screen.findByPlaceholderText('cohort name'), { target: { value: 'Power users' } });
    fireEvent.change(screen.getByPlaceholderText('did these (comma-separated)'), { target: { value: 'login, invite' } });
    fireEvent.click(screen.getByText('Save cohort'));

    await waitFor(() => {
      expect(lensRun).toHaveBeenCalledWith('analytics', 'cohort-save', expect.objectContaining({ name: 'Power users', includes: ['login', 'invite'] }));
    });
  });

  it('Compare runs a date-range comparison', async () => {
    render(<AdvancedAnalytics />);
    fireEvent.click(screen.getByText('Compare'));

    const [currentFrom, previousFrom] = screen.getAllByLabelText('from date');
    const [currentTo, previousTo] = screen.getAllByLabelText('to date');
    fireEvent.change(currentFrom, { target: { value: '2026-07-01' } });
    fireEvent.change(currentTo, { target: { value: '2026-07-15' } });
    fireEvent.change(previousFrom, { target: { value: '2026-06-01' } });
    fireEvent.change(previousTo, { target: { value: '2026-06-15' } });
    // "Compare" matches both the tab button and the panel's submit button —
    // the submit button is the last one rendered in the DOM.
    const compareButtons = screen.getAllByText('Compare');
    fireEvent.click(compareButtons[compareButtons.length - 1]);

    await waitFor(() => {
      expect(lensRun).toHaveBeenCalledWith('analytics', 'range-compare', expect.objectContaining({
        current: { from: '2026-07-01', to: '2026-07-15' },
        previous: { from: '2026-06-01', to: '2026-06-15' },
      }));
    });
  });
});
