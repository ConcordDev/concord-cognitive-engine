import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import React from 'react';

// fireEvent.change helper for controlled inputs (no @testing-library/user-event in this repo)
function typeInto(el: Element, value: string) {
  fireEvent.change(el, { target: { value } });
}

// ---------------------------------------------------------------- viz stubs
vi.mock('@/components/viz', () => ({
  __esModule: true,
  ChartKit: (props: Record<string, unknown>) =>
    React.createElement('div', { 'data-testid': 'chartkit' }, `chart:${(props.data as unknown[] | undefined)?.length ?? 0}`),
  TimelineView: (props: Record<string, unknown>) =>
    React.createElement('div', { 'data-testid': 'timeline' }, `timeline:${(props.events as unknown[] | undefined)?.length ?? 0}`),
}));

// ---------------------------------------------------------------- icon stubs
vi.mock('lucide-react', async () => {
  const makeMockIcon = (name: string) => {
    const Icon = React.forwardRef<SVGSVGElement, Record<string, unknown>>((props, ref) =>
      React.createElement('span', { 'data-testid': `icon-${name}`, ref, ...props }),
    );
    Icon.displayName = name;
    return Icon;
  };
  return {
    __esModule: true,
    Activity: makeMockIcon('Activity'),
    LayoutDashboard: makeMockIcon('LayoutDashboard'),
    Search: makeMockIcon('Search'),
    GitBranch: makeMockIcon('GitBranch'),
    BellRing: makeMockIcon('BellRing'),
    Globe2: makeMockIcon('Globe2'),
    Radio: makeMockIcon('Radio'),
    Loader2: makeMockIcon('Loader2'),
    Plus: makeMockIcon('Plus'),
    Trash2: makeMockIcon('Trash2'),
    Play: makeMockIcon('Play'),
    RefreshCw: makeMockIcon('RefreshCw'),
    Check: makeMockIcon('Check'),
    AlertTriangle: makeMockIcon('AlertTriangle'),
  };
});

// ---------------------------------------------------------------- lensRun mock
// Per-action telemetry stub. lensRun resolves to { data: { ok, result, error } }
// and the component's run() returns r.data directly.
const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  __esModule: true,
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

import { ObservePlatform } from '@/components/observe/ObservePlatform';

// in-memory backing stores so create/list/delete flows behave realistically
let dashboards: Array<Record<string, unknown>>;
let monitors: Array<Record<string, unknown>>;
let checks: Array<Record<string, unknown>>;

function envelope(result: unknown, ok = true, error: string | null = null) {
  return { data: { ok, result, error } };
}

function defaultHandler(action: string, params: Record<string, unknown>) {
  switch (action) {
    // ---- metrics
    case 'metricList':
      return envelope({
        metrics: [
          { name: 'app.latency_ms', points: 42, latest: 180 },
          { name: 'app.error_rate', points: 12, latest: 0.02 },
        ],
      });
    case 'metricQuery':
      return envelope({
        series: [
          { label: '10:00', value: 120 },
          { label: '10:01', value: 140 },
          { label: '10:02', value: null },
        ],
        stats: { count: 3, min: 120, max: 140, avg: 130, last: 140 },
      });
    case 'metricIngest':
      return envelope({ metrics: 3 });

    // ---- dashboards
    case 'dashboardList':
      return envelope({ dashboards });
    case 'dashboardSave': {
      const id = (params.id as string) || `dash_${dashboards.length + 1}`;
      const dash = { id, title: params.title, widgets: params.widgets || [] };
      const idx = dashboards.findIndex((d) => d.id === id);
      if (idx >= 0) dashboards[idx] = dash; else dashboards.push(dash);
      return envelope({ dashboard: dash });
    }
    case 'dashboardDelete':
      dashboards = dashboards.filter((d) => d.id !== params.id);
      return envelope({ ok: true });

    // ---- logs
    case 'logSearch':
      return envelope({
        results: [
          { id: 'l1', level: 'error', service: 'api', message: 'request timeout after 30s' },
          { id: 'l2', level: 'warn', service: 'web', message: 'slow render' },
          { id: 'l3', level: 'info', service: 'app', message: 'started ok' },
        ],
        facets: {
          level: [{ value: 'error', count: 5 }, { value: 'info', count: 9 }],
          service: [{ value: 'api', count: 7 }, { value: 'web', count: 3 }],
        },
        matched: 14,
      });
    case 'logIngest':
      return envelope({ ingested: 2 });

    // ---- traces
    case 'traceList':
      return envelope({
        traces: [
          { id: 't1', rootService: 'gateway', rootName: 'GET /checkout', totalMs: 240, spanCount: 4, hasError: true },
          { id: 't2', rootService: 'web', rootName: 'GET /home', totalMs: 80, spanCount: 2, hasError: false },
        ],
      });
    case 'serviceMap':
      return envelope({
        nodes: [
          { service: 'gateway', calls: 10, avgMs: 120, errors: 0 },
          { service: 'payments', calls: 4, avgMs: 90, errors: 2 },
        ],
        edges: [{ from: 'gateway', to: 'payments', count: 4 }],
      });
    case 'traceDetail':
      return envelope({
        trace: {
          id: params.traceId,
          totalMs: 240,
          waterfall: [
            { id: 's1', service: 'gateway', name: 'GET /checkout', durationMs: 240, offsetPct: 0, widthPct: 100, error: false },
            { id: 's3', service: 'payments', name: 'charge', durationMs: 90, offsetPct: 16, widthPct: 37, error: true },
          ],
        },
      });
    case 'traceIngest':
      return envelope({ spanCount: 4 });

    // ---- monitors
    case 'monitorList':
      return envelope({ monitors });
    case 'monitorSave': {
      const m = {
        id: `mon_${monitors.length + 1}`,
        name: `${params.metric} ${params.op || ''} ${params.threshold ?? ''}`.trim(),
        type: params.type,
        severity: params.severity,
        state: 'ok',
      };
      monitors.push(m);
      return envelope({ monitor: m });
    }
    case 'monitorDelete':
      monitors = monitors.filter((m) => m.id !== params.id);
      return envelope({ ok: true });
    case 'monitorEvaluate':
      return envelope({
        alerting: 1,
        evaluated: monitors.length,
        evaluations: monitors.map((m, i) => (
          i === 0
            ? { id: m.id, state: 'alert', breached: true, reason: 'avg 320 > 200' }
            : { id: m.id, state: 'no_data', breached: false, reason: 'no data' }
        )),
      });

    // ---- synthetics
    case 'syntheticList':
      return envelope({ checks });
    case 'syntheticSave': {
      const c = {
        id: `chk_${checks.length + 1}`,
        name: params.name,
        method: 'GET',
        intervalMinutes: params.intervalMinutes,
        status: 'unknown',
        uptimePct: null,
      };
      checks.push(c);
      return envelope({ check: c });
    }
    case 'syntheticRun': {
      const c = checks.find((x) => x.id === params.id);
      if (c) { c.status = 'up'; c.uptimePct = 99; }
      return envelope({ check: { name: c?.name || 'check', status: 'up' }, run: { latencyMs: 142 } });
    }
    case 'syntheticDelete':
      checks = checks.filter((c) => c.id !== params.id);
      return envelope({ ok: true });

    // ---- oncall
    case 'oncallStatus':
      return envelope({
        current: { person: 'alice' },
        schedule: [{ person: 'alice', startsAt: '2026-06-01T00:00:00Z', endsAt: '' }],
        routes: [{ id: 'r1', name: 'primary', channel: 'dm', target: '@alice', minSeverity: 'sev3' }],
        recentPages: [
          { id: 'p1', severity: 'sev2', summary: 'db latency spike', at: '2026-06-20T10:00:00Z', pagedPerson: 'alice', routesFired: ['r1'], ackedBy: null },
          { id: 'p2', severity: 'sev3', summary: 'minor blip', at: '2026-06-19T10:00:00Z', pagedPerson: 'bob', routesFired: ['r1'], ackedBy: 'bob' },
        ],
      });
    case 'oncallSetup':
      return envelope({ ok: true });
    case 'pageOnCall':
      return envelope({ page: { pagedPerson: 'alice' }, routesNotified: 1 });
    case 'acknowledgePage':
      return envelope({ ok: true });

    default:
      return envelope({});
  }
}

describe('ObservePlatform', () => {
  beforeEach(() => {
    dashboards = [];
    monitors = [];
    checks = [];
    lensRunMock.mockReset();
    lensRunMock.mockImplementation((_domain: string, action: string, params: Record<string, unknown> = {}) =>
      Promise.resolve(defaultHandler(action, params)),
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  async function switchTab(label: string) {
    fireEvent.click(screen.getByRole('button', { name: new RegExp(label, 'i') }));
  }

  // ============================================================ METRICS
  it('renders the metrics tab by default and lists metrics', async () => {
    render(<ObservePlatform />);
    expect(screen.getByText('Telemetry platform')).toBeDefined();
    await waitFor(() => expect(screen.getByText('app.latency_ms')).toBeDefined());
    expect(screen.getByText(/Metrics \(2\)/)).toBeDefined();
  });

  it('ingests a metric (success) and surfaces an ok notice', async () => {
    render(<ObservePlatform />);
    await waitFor(() => expect(screen.getByText('app.latency_ms')).toBeDefined());

    const valueInput = screen.getByPlaceholderText('value');
    typeInto(valueInput, '199');
    fireEvent.click(screen.getByRole('button', { name: /Ingest/i }));

    await waitFor(() => expect(screen.getByText(/Ingested → 3 metrics/)).toBeDefined());
  });

  it('shows a validation error when ingesting without a numeric value', async () => {
    render(<ObservePlatform />);
    await waitFor(() => expect(screen.getByText('app.latency_ms')).toBeDefined());
    fireEvent.click(screen.getByRole('button', { name: /Ingest/i }));
    await waitFor(() => expect(screen.getByText(/numeric value required/i)).toBeDefined());
  });

  it('queries a metric series and renders the chart + stats', async () => {
    render(<ObservePlatform />);
    await waitFor(() => expect(screen.getByText('app.latency_ms')).toBeDefined());

    fireEvent.click(screen.getByText('app.latency_ms'));
    await waitFor(() => expect(screen.getByTestId('chartkit')).toBeDefined());
    expect(screen.getByText(/count 3/)).toBeDefined();
    expect(screen.getByText(/avg 130/)).toBeDefined();
  });

  it('changes aggregation + window selects and re-queries via the Query button', async () => {
    render(<ObservePlatform />);
    await waitFor(() => expect(screen.getByText('app.latency_ms')).toBeDefined());
    fireEvent.click(screen.getByText('app.latency_ms'));
    await waitFor(() => expect(screen.getByTestId('chartkit')).toBeDefined());

    // agg select is the first <select> (avg/sum/min/max/count/last)
    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[0], { target: { value: 'max' } });
    fireEvent.change(selects[1], { target: { value: '360' } });
    fireEvent.click(screen.getByRole('button', { name: /Query/i }));
    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith('observe', 'metricQuery', expect.objectContaining({ agg: 'max' })));
  });

  it('refresh button re-fetches the metrics list', async () => {
    render(<ObservePlatform />);
    await waitFor(() => expect(screen.getByText('app.latency_ms')).toBeDefined());
    lensRunMock.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith('observe', 'metricList', expect.anything()));
  });

  // ============================================================ DASHBOARDS
  it('creates a dashboard, adds and removes a widget', async () => {
    render(<ObservePlatform />);
    await switchTab('Dashboards');
    await waitFor(() => expect(screen.getByText(/Saved \(0\)/)).toBeDefined());

    typeInto(screen.getByPlaceholderText('New dashboard title'), 'Latency board');
    fireEvent.click(screen.getByRole('button', { name: /Create/i }));
    await waitFor(() => expect(screen.getByText('Dashboard created.')).toBeDefined());

    // add a timeseries widget
    fireEvent.click(screen.getByRole('button', { name: /\+ timeseries/i }));
    await waitFor(() => expect(screen.getByText('timeseries widget')).toBeDefined());

    // remove it
    const widgetCard = screen.getByText('timeseries widget').closest('div')!.parentElement!;
    fireEvent.click(within(widgetCard).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.getByText(/Empty layout/)).toBeDefined());
  });

  it('shows a validation error creating a dashboard with no title', async () => {
    render(<ObservePlatform />);
    await switchTab('Dashboards');
    await waitFor(() => expect(screen.getByText(/Saved \(0\)/)).toBeDefined());
    fireEvent.click(screen.getByRole('button', { name: /Create/i }));
    await waitFor(() => expect(screen.getByText('Title required.')).toBeDefined());
  });

  it('selects then deletes a saved dashboard', async () => {
    render(<ObservePlatform />);
    await switchTab('Dashboards');
    typeInto(screen.getByPlaceholderText('New dashboard title'), 'Board A');
    fireEvent.click(screen.getByRole('button', { name: /Create/i }));
    await waitFor(() => expect(screen.getByText(/Saved \(1\)/)).toBeDefined());

    // select via the saved list entry
    fireEvent.click(screen.getByRole('button', { name: 'Board A' }));
    // delete it
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.getByText(/Saved \(0\)/)).toBeDefined());
  });

  // ============================================================ LOGS
  it('renders log search results + facets on the logs tab', async () => {
    render(<ObservePlatform />);
    await switchTab('Log Search');
    await waitFor(() => expect(screen.getByText('request timeout after 30s')).toBeDefined());
    expect(screen.getByText(/14 hits/)).toBeDefined();
    // facet click triggers a scoped search
    fireEvent.click(screen.getByRole('button', { name: /error/i }));
    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith('observe', 'logSearch', expect.objectContaining({ query: 'level:error' })));
  });

  it('ingests log lines (success) and shows an ok notice', async () => {
    render(<ObservePlatform />);
    await switchTab('Log Search');
    await waitFor(() => expect(screen.getByText('request timeout after 30s')).toBeDefined());

    typeInto(screen.getByPlaceholderText(/request timeout after 30s/), 'ERROR api boom');
    fireEvent.click(screen.getByRole('button', { name: /Ingest/i }));
    await waitFor(() => expect(screen.getByText(/Ingested 2 lines/)).toBeDefined());
  });

  it('shows a validation error ingesting empty logs and searches via Enter key', async () => {
    render(<ObservePlatform />);
    await switchTab('Log Search');
    await waitFor(() => expect(screen.getByText('request timeout after 30s')).toBeDefined());

    fireEvent.click(screen.getByRole('button', { name: /Ingest/i }));
    await waitFor(() => expect(screen.getByText('Add log lines.')).toBeDefined());

    const searchInput = screen.getByPlaceholderText(/free text/i);
    typeInto(searchInput, 'service:api');
    fireEvent.keyDown(searchInput, { key: 'Enter' });
    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith('observe', 'logSearch', expect.objectContaining({ query: 'service:api' })));
  });

  // ============================================================ TRACES
  it('lists traces, the service map, and opens a span waterfall with an error span', async () => {
    render(<ObservePlatform />);
    await switchTab('APM / Traces');
    await waitFor(() => expect(screen.getByText(/gateway · GET \/checkout/)).toBeDefined());
    // service map node rendered
    expect(screen.getByText(/payments · 4× · 90ms/)).toBeDefined();

    fireEvent.click(screen.getByText(/gateway · GET \/checkout/));
    await waitFor(() => expect(screen.getByText(/Span waterfall/)).toBeDefined());
    // error span shows the warning glyph
    expect(screen.getByText(/90ms ⚠/)).toBeDefined();
  });

  it('records a sample trace and surfaces an ok notice', async () => {
    render(<ObservePlatform />);
    await switchTab('APM / Traces');
    await waitFor(() => expect(screen.getByText(/gateway · GET \/checkout/)).toBeDefined());

    fireEvent.click(screen.getByRole('button', { name: /Record sample trace/i }));
    await waitFor(() => expect(screen.getByText(/Trace recorded \(4 spans\)/)).toBeDefined());
  });

  // ============================================================ MONITORS
  it('saves a monitor, evaluates (alert + no_data), and deletes it', async () => {
    render(<ObservePlatform />);
    await switchTab('Monitors');
    await waitFor(() => expect(screen.getByText(/Monitors \(0\)/)).toBeDefined());

    fireEvent.click(screen.getByRole('button', { name: /^.*Save$/i }));
    await waitFor(() => expect(screen.getByText('Monitor saved.')).toBeDefined());
    await waitFor(() => expect(screen.getByText(/Monitors \(1\)/)).toBeDefined());

    fireEvent.click(screen.getByRole('button', { name: /Evaluate all/i }));
    await waitFor(() => expect(screen.getByText(/1 alerting/)).toBeDefined());
    expect(screen.getByText('avg 320 > 200')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.getByText(/Monitors \(0\)/)).toBeDefined());
  });

  it('toggles monitor type to anomaly (hides threshold inputs) and validates empty metric', async () => {
    render(<ObservePlatform />);
    await switchTab('Monitors');
    await waitFor(() => expect(screen.getByText(/Monitors \(0\)/)).toBeDefined());

    // threshold value input is present for type=threshold
    expect(screen.getByPlaceholderText('threshold')).toBeDefined();
    // the type <select> is the one whose current value is 'threshold'
    const typeSelect = screen.getAllByRole('combobox').find(
      (s) => (s as HTMLSelectElement).value === 'threshold',
    )!;
    fireEvent.change(typeSelect, { target: { value: 'anomaly' } });
    await waitFor(() => expect(screen.queryByPlaceholderText('threshold')).toBeNull());

    // clear metric → validation error
    typeInto(screen.getByPlaceholderText('metric'), '');
    fireEvent.click(screen.getByRole('button', { name: /^.*Save$/i }));
    await waitFor(() => expect(screen.getByText('Metric required.')).toBeDefined());
  });

  // ============================================================ SYNTHETICS
  it('creates a synthetic check, runs it (up), and deletes it', async () => {
    render(<ObservePlatform />);
    await switchTab('Synthetics');
    await waitFor(() => expect(screen.getByText(/Checks \(0\)/)).toBeDefined());

    const urlInput = screen.getByPlaceholderText(/example.com\/health/);
    typeInto(urlInput, '');
    typeInto(urlInput, 'https://svc.test/health');
    typeInto(screen.getByPlaceholderText('name (optional)'), 'svc health');
    fireEvent.click(screen.getByRole('button', { name: /Create/i }));
    await waitFor(() => expect(screen.getByText('Check created.')).toBeDefined());
    await waitFor(() => expect(screen.getByText('svc health')).toBeDefined());

    // run the check (Play button) — there's exactly one check row
    const buttons = screen.getAllByRole('button');
    const runBtn = buttons.find((b) => b.querySelector('[data-testid="icon-Play"]') && !b.textContent?.includes('Create'));
    fireEvent.click(runBtn!);
    await waitFor(() => expect(screen.getByText(/svc health: up \(142ms\)/)).toBeDefined());

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.getByText(/Checks \(0\)/)).toBeDefined());
  });

  it('rejects an invalid synthetic URL', async () => {
    render(<ObservePlatform />);
    await switchTab('Synthetics');
    await waitFor(() => expect(screen.getByText(/Checks \(0\)/)).toBeDefined());

    const urlInput = screen.getByPlaceholderText(/example.com\/health/);
    typeInto(urlInput, '');
    typeInto(urlInput, 'not-a-url');
    fireEvent.click(screen.getByRole('button', { name: /Create/i }));
    await waitFor(() => expect(screen.getByText('Valid URL required.')).toBeDefined());
  });

  // ============================================================ ON-CALL
  it('renders on-call status, page timeline, and acknowledges a page', async () => {
    render(<ObservePlatform />);
    await switchTab('On-Call');
    await waitFor(() => expect(screen.getAllByText('alice').length).toBeGreaterThan(0));
    // timeline rendered with the 2 page events
    expect(screen.getByTestId('timeline').textContent).toBe('timeline:2');
    // route row rendered
    expect(screen.getByText(/primary · dm → @alice/)).toBeDefined();

    // unacked page has an Acknowledge button
    fireEvent.click(screen.getByRole('button', { name: 'Acknowledge' }));
    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith('observe', 'acknowledgePage', { id: 'p1' }));
  });

  it('pages on-call and adds a person + route', async () => {
    render(<ObservePlatform />);
    await switchTab('On-Call');
    await waitFor(() => expect(screen.getAllByText('alice').length).toBeGreaterThan(0));

    typeInto(screen.getByPlaceholderText('page summary'), 'on fire');
    fireEvent.click(screen.getByRole('button', { name: /Page now/i }));
    await waitFor(() => expect(screen.getByText(/Paged alice · 1 routes notified/)).toBeDefined());

    // add a person
    typeInto(screen.getByPlaceholderText('add person'), 'carol');
    const addButtons = screen.getAllByRole('button', { name: 'Add' });
    fireEvent.click(addButtons[0]);
    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith('observe', 'oncallSetup', expect.objectContaining({ schedule: expect.any(Array) })));

    // add a route — needs a target
    typeInto(screen.getByPlaceholderText('target'), '#alerts');
    fireEvent.click(addButtons[1]);
    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith('observe', 'oncallSetup', expect.objectContaining({ routes: expect.any(Array) })));
  });

  it('shows a validation error adding a route without a target', async () => {
    render(<ObservePlatform />);
    await switchTab('On-Call');
    await waitFor(() => expect(screen.getAllByText('alice').length).toBeGreaterThan(0));

    const addButtons = screen.getAllByRole('button', { name: 'Add' });
    // second Add button is the route one
    fireEvent.click(addButtons[1]);
    await waitFor(() => expect(screen.getByText('Route target required.')).toBeDefined());
  });

  // ============================================================ shell
  it('switches through all seven tabs', async () => {
    render(<ObservePlatform />);
    for (const label of ['Metrics', 'Dashboards', 'Log Search', 'APM / Traces', 'Monitors', 'Synthetics', 'On-Call']) {
      await switchTab(label);
    }
    // final tab is On-Call
    await waitFor(() => expect(screen.getByText(/On-call schedule/)).toBeDefined());
  });
});
