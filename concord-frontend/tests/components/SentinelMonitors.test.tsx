import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

// Mock lucide-react icons for jsdom environment
vi.mock('lucide-react', async () => {
  const makeMockIcon = (name: string) => {
    const Icon = React.forwardRef<SVGSVGElement, Record<string, unknown>>((props, ref) =>
      React.createElement('span', { 'data-testid': `icon-${name}`, ref, ...props })
    );
    Icon.displayName = name;
    return Icon;
  };
  return {
    __esModule: true,
    Radio: makeMockIcon('Radio'),
    Loader2: makeMockIcon('Loader2'),
    Play: makeMockIcon('Play'),
    Power: makeMockIcon('Power'),
    Trash2: makeMockIcon('Trash2'),
    BellRing: makeMockIcon('BellRing'),
    Check: makeMockIcon('Check'),
    Plus: makeMockIcon('Plus'),
  };
});

// Mock the API client
const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
}));

import { SentinelMonitors } from '@/components/sentinel/SentinelMonitors';

const envelope = (result: unknown, extra: Record<string, unknown> = {}) => ({
  data: { ok: true, result, error: null, ...extra },
});

const sampleMonitor = {
  monitorId: 'mon-1',
  name: 'Critical scanner',
  scope: 'global',
  minSeverity: 'high',
  intervalMinutes: 30,
  enabled: true,
  runCount: 4,
  alertCount: 2,
  lastRunAt: '2026-02-28T06:00:00Z',
  nextRunAt: '2026-02-28T06:30:00Z',
  createdAt: '2026-02-28T05:00:00Z',
};

const disabledMonitor = {
  ...sampleMonitor,
  monitorId: 'mon-2',
  name: 'Idle watcher',
  minSeverity: 'low',
  enabled: false,
  intervalMinutes: 120,
  runCount: 0,
  alertCount: 0,
  lastRunAt: null,
};

const ackedAlert = {
  alertId: 'alert-1',
  monitorId: 'mon-1',
  monitorName: 'Critical scanner',
  threatId: 'threat-aaa',
  severity: 'high',
  description: 'Acknowledged threat detail',
  at: '2026-02-28T06:01:00Z',
  acknowledged: true,
};

const unackedAlert = {
  alertId: 'alert-2',
  monitorId: 'mon-1',
  monitorName: 'Critical scanner',
  threatId: 'threat-bbb',
  severity: 'critical',
  description: 'Unacknowledged threat detail',
  at: '2026-02-28T06:02:00Z',
  acknowledged: false,
};

/**
 * Configure lensRun's default behaviour. `opts` lets a test override
 * the monitors / alerts / unacknowledged the list calls return, and the
 * shape of the monitor.run response.
 */
function setupLensRun(opts: {
  monitors?: unknown[];
  alerts?: unknown[];
  unacknowledged?: number;
  runOk?: boolean;
  runResult?: unknown;
  runError?: string;
  threats?: unknown[];
} = {}) {
  const {
    monitors = [],
    alerts = [],
    unacknowledged = 0,
    runOk = true,
    runResult = { scanned: 5, newCount: 2 },
    runError,
    threats = [{ id: 'threat-bbb', severity: 'critical', description: 'live threat' }],
  } = opts;

  lensRun.mockImplementation((domain: string, action: string) => {
    if (domain === 'sentinel' && action === 'monitor.list') {
      return Promise.resolve(envelope({ monitors }));
    }
    if (domain === 'sentinel' && action === 'alerts.list') {
      return Promise.resolve(envelope({ alerts, unacknowledged }));
    }
    if (domain === 'shield' && action === 'threats') {
      return Promise.resolve(envelope({ threats }));
    }
    if (domain === 'sentinel' && action === 'monitor.run') {
      return Promise.resolve({
        data: { ok: runOk, result: runOk ? runResult : null, error: runError ?? null },
      });
    }
    // monitor.create / monitor.toggle / monitor.delete / alerts.acknowledge
    return Promise.resolve(envelope({ ok: true }));
  });
}

describe('SentinelMonitors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows loading state initially', () => {
    // lensRun never resolves -> stays in loading
    lensRun.mockReturnValue(new Promise(() => {}));
    render(<SentinelMonitors />);
    expect(screen.getByText('Loading monitors…')).toBeDefined();
  });

  it('renders empty monitors and empty alerts states', async () => {
    setupLensRun({ monitors: [], alerts: [] });
    render(<SentinelMonitors />);

    await waitFor(() => {
      expect(screen.getByText('No monitors yet.')).toBeDefined();
    });
    expect(screen.getByText('No alerts. Run a monitor to generate them.')).toBeDefined();
    expect(screen.getByText('New monitor')).toBeDefined();
    expect(screen.getByText('Alert inbox')).toBeDefined();

    // List calls fired with the right args
    expect(lensRun).toHaveBeenCalledWith('sentinel', 'monitor.list', {});
    expect(lensRun).toHaveBeenCalledWith('sentinel', 'alerts.list', {});
  });

  it('renders populated monitors with name, severity, counts and last run', async () => {
    setupLensRun({ monitors: [sampleMonitor, disabledMonitor] });
    render(<SentinelMonitors />);

    await waitFor(() => {
      expect(screen.getByText('Critical scanner')).toBeDefined();
    });
    expect(screen.getByText('Idle watcher')).toBeDefined();
    expect(screen.getByText('≥high')).toBeDefined();
    expect(screen.getByText('≥low')).toBeDefined();
    expect(screen.getByText('every 30m')).toBeDefined();
    expect(screen.getByText('every 120m')).toBeDefined();
    expect(screen.getByText('4 runs')).toBeDefined();
    expect(screen.getByText('2 alerts')).toBeDefined();
    // lastRunAt present -> "last <time>" rendered for the enabled monitor only
    expect(screen.getByText(/^last /)).toBeDefined();
  });

  it('renders populated alerts: acked vs unacked + unack badge + Ack all', async () => {
    setupLensRun({ alerts: [ackedAlert, unackedAlert], unacknowledged: 1 });
    render(<SentinelMonitors />);

    await waitFor(() => {
      expect(screen.getByText('Acknowledged threat detail')).toBeDefined();
    });
    expect(screen.getByText('Unacknowledged threat detail')).toBeDefined();
    // severity labels appear in alert badges (also present as <option> in the select)
    expect(screen.getAllByText('high').length).toBeGreaterThan(0);
    expect(screen.getAllByText('critical').length).toBeGreaterThan(0);
    // unack badge
    expect(screen.getByText('1 new')).toBeDefined();
    // "Ack all" appears when unack > 0
    expect(screen.getByText('Ack all')).toBeDefined();
    // Only the unacked alert has an "Ack" button
    expect(screen.getAllByText('Ack')).toHaveLength(1);
    // threat id + monitor name in footer
    expect(screen.getByText('threat-bbb')).toBeDefined();
    expect(screen.getAllByText('Critical scanner').length).toBeGreaterThan(0);
  });

  it('createMonitor is guarded when name is empty, then fires with trimmed name + onChanged', async () => {
    const onChanged = vi.fn();
    setupLensRun({ monitors: [] });
    render(<SentinelMonitors onChanged={onChanged} />);

    await waitFor(() => {
      expect(screen.getByText('No monitors yet.')).toBeDefined();
    });

    const createBtn = screen.getByText('Create monitor').closest('button')!;
    // disabled when name empty
    expect(createBtn).toHaveProperty('disabled', true);

    // Type a name
    const input = screen.getByLabelText('Monitor name') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '  Net scanner  ' } });
    expect(createBtn).toHaveProperty('disabled', false);

    fireEvent.click(createBtn);

    await waitFor(() => {
      expect(lensRun).toHaveBeenCalledWith('sentinel', 'monitor.create', {
        name: 'Net scanner',
        minSeverity: 'medium',
        intervalMinutes: 60,
      });
    });
    await waitFor(() => {
      expect(onChanged).toHaveBeenCalled();
    });
  });

  it('createMonitor does nothing when name is only whitespace', async () => {
    setupLensRun({ monitors: [] });
    render(<SentinelMonitors />);
    await waitFor(() => {
      expect(screen.getByText('No monitors yet.')).toBeDefined();
    });

    const input = screen.getByLabelText('Monitor name') as HTMLInputElement;
    // whitespace-only keeps button disabled; invoke handler logic via Enter path is not present,
    // so assert no create call was made after a whitespace change.
    fireEvent.change(input, { target: { value: '   ' } });
    const createBtn = screen.getByText('Create monitor').closest('button')!;
    expect(createBtn).toHaveProperty('disabled', true);
    expect(lensRun).not.toHaveBeenCalledWith(
      'sentinel',
      'monitor.create',
      expect.anything(),
    );
  });

  it('severity select and interval input change handlers feed createMonitor', async () => {
    setupLensRun({ monitors: [] });
    render(<SentinelMonitors />);
    await waitFor(() => {
      expect(screen.getByText('No monitors yet.')).toBeDefined();
    });

    const name = screen.getByLabelText('Monitor name') as HTMLInputElement;
    fireEvent.change(name, { target: { value: 'Tuned' } });

    const select = screen.getByRole('combobox') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'critical' } });
    expect(select.value).toBe('critical');

    const interval = screen.getByRole('spinbutton') as HTMLInputElement;
    fireEvent.change(interval, { target: { value: '15' } });
    expect(interval.value).toBe('15');

    fireEvent.click(screen.getByText('Create monitor').closest('button')!);

    await waitFor(() => {
      expect(lensRun).toHaveBeenCalledWith('sentinel', 'monitor.create', {
        name: 'Tuned',
        minSeverity: 'critical',
        intervalMinutes: 15,
      });
    });
  });

  it('toggle fires monitor.toggle with inverted enabled', async () => {
    setupLensRun({ monitors: [sampleMonitor] });
    render(<SentinelMonitors />);

    await waitFor(() => {
      expect(screen.getByText('Critical scanner')).toBeDefined();
    });

    fireEvent.click(screen.getByLabelText('Disable'));

    await waitFor(() => {
      expect(lensRun).toHaveBeenCalledWith('sentinel', 'monitor.toggle', {
        monitorId: 'mon-1',
        enabled: false,
      });
    });
  });

  it('remove fires monitor.delete', async () => {
    setupLensRun({ monitors: [sampleMonitor] });
    render(<SentinelMonitors />);

    await waitFor(() => {
      expect(screen.getByText('Critical scanner')).toBeDefined();
    });

    fireEvent.click(screen.getByLabelText('Delete monitor'));

    await waitFor(() => {
      expect(lensRun).toHaveBeenCalledWith('sentinel', 'monitor.delete', {
        monitorId: 'mon-1',
      });
    });
  });

  it('runMonitor pulls shield.threats then monitor.run and shows success status', async () => {
    const onChanged = vi.fn();
    setupLensRun({
      monitors: [sampleMonitor],
      runOk: true,
      runResult: { scanned: 7, newCount: 3 },
    });
    render(<SentinelMonitors onChanged={onChanged} />);

    await waitFor(() => {
      expect(screen.getByText('Critical scanner')).toBeDefined();
    });

    fireEvent.click(screen.getByText('Run').closest('button')!);

    await waitFor(() => {
      expect(lensRun).toHaveBeenCalledWith('shield', 'threats', { limit: 100 });
    });
    await waitFor(() => {
      expect(lensRun).toHaveBeenCalledWith('sentinel', 'monitor.run', {
        monitorId: 'mon-1',
        threats: [{ id: 'threat-bbb', severity: 'critical', description: 'live threat' }],
      });
    });
    await waitFor(() => {
      expect(
        screen.getByText('Critical scanner: scanned 7 threats, 3 new alert(s)'),
      ).toBeDefined();
    });
    expect(onChanged).toHaveBeenCalled();
  });

  it('runMonitor shows failure status when monitor.run is not ok', async () => {
    setupLensRun({
      monitors: [sampleMonitor],
      runOk: false,
      runError: 'monitor run failed badly',
    });
    render(<SentinelMonitors />);

    await waitFor(() => {
      expect(screen.getByText('Critical scanner')).toBeDefined();
    });

    fireEvent.click(screen.getByText('Run').closest('button')!);

    await waitFor(() => {
      expect(screen.getByText('monitor run failed badly')).toBeDefined();
    });
  });

  it('acknowledge fires alerts.acknowledge with alertId', async () => {
    setupLensRun({ alerts: [unackedAlert], unacknowledged: 1 });
    render(<SentinelMonitors />);

    await waitFor(() => {
      expect(screen.getByText('Unacknowledged threat detail')).toBeDefined();
    });

    fireEvent.click(screen.getByText('Ack').closest('button')!);

    await waitFor(() => {
      expect(lensRun).toHaveBeenCalledWith('sentinel', 'alerts.acknowledge', {
        alertId: 'alert-2',
      });
    });
  });

  it('acknowledgeAll fires alerts.acknowledge with all:true', async () => {
    setupLensRun({ alerts: [unackedAlert], unacknowledged: 1 });
    render(<SentinelMonitors />);

    await waitFor(() => {
      expect(screen.getByText('Ack all')).toBeDefined();
    });

    fireEvent.click(screen.getByText('Ack all').closest('button')!);

    await waitFor(() => {
      expect(lensRun).toHaveBeenCalledWith('sentinel', 'alerts.acknowledge', {
        all: true,
      });
    });
  });

  it('handles null result envelopes by defaulting to empty lists', async () => {
    lensRun.mockImplementation((domain: string, action: string) => {
      if (action === 'monitor.list') return Promise.resolve({ data: { ok: true, result: null } });
      if (action === 'alerts.list') return Promise.resolve({ data: { ok: true, result: null } });
      return Promise.resolve(envelope({ ok: true }));
    });
    render(<SentinelMonitors />);

    await waitFor(() => {
      expect(screen.getByText('No monitors yet.')).toBeDefined();
    });
    expect(screen.getByText('No alerts. Run a monitor to generate them.')).toBeDefined();
  });
});
