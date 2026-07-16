/**
 * Live composable dashboard widget grid — closes docs/WAVE4_INVENTORY.md
 * row 135 ("saveDashboard stores a panel-id list, not a live composable
 * widget grid").
 *
 * The old behavior (a "N panels" bookmark list) was already honest, not a
 * bug — this pins the NEW real capability layered alongside it: selecting a
 * saved dashboard calls the real `dashboardData` macro and renders each
 * widget as a real tile driven by real resolved data, with an honest
 * "no data available for this panel" tile for a widget id that matches no
 * real data source (never a fabricated graph). The existing save/create/
 * delete flow is asserted unchanged.
 *
 * No fabricated data: every assertion is driven by a mocked lensRun()
 * returning exactly the shapes server/domains/commandcenter.js's macros
 * return (saveDashboard / listDashboards / deleteDashboard / dashboardData).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));
// ChartKit wraps recharts (ResizeObserver/SVG layout not meaningful under
// jsdom) — the established pattern elsewhere in this suite is a no-op mock;
// the real resolved values are asserted via the plain-text tile header this
// component renders alongside the chart, not via recharts internals.
vi.mock('@/components/viz/ChartKit', () => ({ ChartKit: () => <div data-testid="chartkit-mock" /> }));

import { DashboardsSection } from '@/components/command-center/OpsCockpit';

function ok<T>(result: T) {
  return Promise.resolve({ data: { ok: true, result } });
}

/** Routes the OpsCockpit `run(macro, params)` helper's positional
 * `lensRun('command-center', macro, params)` calls to per-macro handlers. */
function routeCC(handlers: Record<string, unknown | ((params: Record<string, unknown>) => unknown)>) {
  lensRunMock.mockImplementation((_domain: string, macro: string, params: Record<string, unknown>) => {
    if (macro in handlers) {
      const h = handlers[macro];
      return typeof h === 'function' ? (h as (p: Record<string, unknown>) => unknown)(params) : h;
    }
    return Promise.reject(new Error(`unexpected macro ${macro}`));
  });
}

const dashboard = { id: 'dash_1', name: 'Ops overview', widgets: [{ type: 'panel', id: 'heap_mb' }], updatedAt: '2026-01-01T00:00:00Z' };

describe('DashboardsSection — live widget grid', () => {
  beforeEach(() => { lensRunMock.mockReset(); });

  it('renders a real vital-metric tile with the actual resolved metric name and latest value', async () => {
    routeCC({
      listDashboards: ok({ dashboards: [dashboard], count: 1 }),
      dashboardData: ok({
        dashboardId: 'dash_1',
        name: 'Ops overview',
        count: 1,
        resolvedCount: 1,
        unresolvedCount: 0,
        widgets: [
          {
            id: 'heap_mb', type: 'panel', kind: 'vital',
            data: {
              metric: 'heap_mb',
              points: [{ t: 1000, v: 100 }, { t: 2000, v: 180 }, { t: 3000, v: 140 }],
              count: 3,
              stats: { min: 100, max: 180, avg: 140, latest: 140 },
            },
          },
        ],
      }),
    });

    render(<DashboardsSection />);
    await waitFor(() => expect(screen.getByText('Ops overview')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Ops overview'));

    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith('command-center', 'dashboardData', { dashboardId: 'dash_1' }));
    // The tile shows the real metric name and the real latest value (140),
    // not a placeholder.
    await waitFor(() => expect(screen.getByText('140')).toBeInTheDocument());
    expect(screen.getAllByText('heap_mb').length).toBeGreaterThan(0);
    expect(screen.getByText(/1\/1 panel/)).toBeInTheDocument();
    expect(screen.getByTestId('chartkit-mock')).toBeInTheDocument();
  });

  it('renders a real alert-rule tile with the actual rule state, never a chart', async () => {
    routeCC({
      listDashboards: ok({ dashboards: [dashboard], count: 1 }),
      dashboardData: ok({
        dashboardId: 'dash_1',
        name: 'Ops overview',
        count: 1,
        resolvedCount: 1,
        unresolvedCount: 0,
        widgets: [
          {
            id: 'rule_1', type: 'panel', kind: 'alert-rule',
            data: {
              ruleId: 'rule_1', name: 'Heap high', metric: 'heap_mb', comparator: 'gt',
              threshold: 150, severity: 'high', state: 'breaching', lastValue: 180,
              lastFiredAt: '2026-01-01T00:00:00Z', acknowledged: false, fireCount: 2,
            },
          },
        ],
      }),
    });

    render(<DashboardsSection />);
    await waitFor(() => expect(screen.getByText('Ops overview')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Ops overview'));

    await waitFor(() => expect(screen.getByText('Heap high')).toBeInTheDocument());
    expect(screen.getByText('180')).toBeInTheDocument();
    expect(screen.getByText(/heap_mb gt 150/)).toBeInTheDocument();
    expect(screen.getByText(/breaching · unacknowledged/)).toBeInTheDocument();
    expect(screen.getByText(/fired 2×/)).toBeInTheDocument();
    // Never a fabricated chart for a non-vital widget.
    expect(screen.queryByTestId('chartkit-mock')).not.toBeInTheDocument();
  });

  it('renders an honest "no data available" tile for an unresolvable widget, never a fabricated graph', async () => {
    routeCC({
      listDashboards: ok({ dashboards: [dashboard], count: 1 }),
      dashboardData: ok({
        dashboardId: 'dash_1',
        name: 'Ops overview',
        count: 1,
        resolvedCount: 0,
        unresolvedCount: 1,
        widgets: [
          { id: 'totally_made_up_metric_xyz', type: 'panel', data: null, error: 'no data source for this widget' },
        ],
      }),
    });

    render(<DashboardsSection />);
    await waitFor(() => expect(screen.getByText('Ops overview')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Ops overview'));

    await waitFor(() => expect(screen.getByText('totally_made_up_metric_xyz')).toBeInTheDocument());
    expect(screen.getByText('no data available for this panel')).toBeInTheDocument();
    expect(screen.queryByTestId('chartkit-mock')).not.toBeInTheDocument();
    expect(screen.getByText(/0\/1 panel/)).toBeInTheDocument();
  });

  it('save/create flow is unaffected: saves a dashboard with the typed panel ids and reloads the list', async () => {
    let saved: Record<string, unknown> | null = null;
    routeCC({
      listDashboards: () => ok({ dashboards: saved ? [{ id: 'dash_new', name: saved.name, widgets: saved.widgets, updatedAt: 'now' }] : [], count: saved ? 1 : 0 }),
      saveDashboard: (params) => { saved = params; return ok({ dashboard: { id: 'dash_new', ...params } }); },
    });

    render(<DashboardsSection />);
    await waitFor(() => expect(screen.getByText(/No saved dashboards yet/)).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText('SRE morning view'), { target: { value: 'My layout' } });
    fireEvent.change(screen.getByPlaceholderText('vitals, alerts, incidents'), { target: { value: 'heap_mb, rule_1' } });
    fireEvent.click(screen.getByText('Save Layout'));

    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith('command-center', 'saveDashboard', {
      name: 'My layout',
      widgets: [{ type: 'panel', id: 'heap_mb' }, { type: 'panel', id: 'rule_1' }],
    }));
    await waitFor(() => expect(screen.getByText('My layout')).toBeInTheDocument());
  });

  it('delete flow is unaffected: removes the dashboard and does not open the live grid', async () => {
    routeCC({
      listDashboards: ok({ dashboards: [dashboard], count: 1 }),
      deleteDashboard: (params) => { expect(params).toEqual({ dashboardId: 'dash_1' }); return ok({ deleted: 'dash_1', remaining: 0 }); },
    });

    render(<DashboardsSection />);
    await waitFor(() => expect(screen.getByText('Ops overview')).toBeInTheDocument());

    const card = screen.getByText('Ops overview').closest('div')!.parentElement!;
    fireEvent.click(within(card).getByLabelText('Delete dashboard'));

    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith('command-center', 'deleteDashboard', { dashboardId: 'dash_1' }));
    // Deleting must not have also triggered dashboardData (click-through /
    // event bubbling into the card's own view() handler).
    expect(lensRunMock).not.toHaveBeenCalledWith('command-center', 'dashboardData', expect.anything());
  });
});
