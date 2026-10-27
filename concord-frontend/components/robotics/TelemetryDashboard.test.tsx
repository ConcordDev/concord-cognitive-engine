/**
 * robotics.telemetry returns null (not a fake number) for anything it has no
 * sensor data for. Every null must render "Not available" plus a plain reason,
 * and a real 0 must still render as 0.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { RobotRow } from './FleetManager';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));
vi.mock('@/components/viz', () => ({ ChartKit: () => <div data-testid="chart" /> }));
vi.mock('lucide-react', () => ({
  Activity: () => null,
  Play: () => null,
  Pause: () => null,
  AlertTriangle: () => null,
  Cpu: () => null,
  Thermometer: () => null,
  Radio: () => null,
  Loader2: () => null,
}));

import { TelemetryDashboard } from './TelemetryDashboard';

const robot = {
  id: 'r1',
  name: 'Arm',
  type: 'arm',
  status: 'idle',
  firmware: '1',
  battery: 100,
  batteryCapacityWh: 50,
  powerDrawW: 10,
  errorCount: 0,
  lastCommand: '',
} as RobotRow;

const emptyLog = {
  data: {
    ok: true,
    result: {
      robotId: 'r1',
      name: 'Arm',
      type: 'arm',
      status: 'idle',
      timestamp: '2026-10-27T00:00:00Z',
      joints: [],
      dof: null,
      sensors: null,
      battery: null,
      faults: [],
      faultCount: 0,
      health: 'nominal',
      telemetrySource: 'none',
      telemetryReason: 'no_sensor_log',
    },
  },
};

/** Visible text of the whole dashboard, for the no-garbage-text assertions. */
function pageText(): string {
  return document.body.textContent || '';
}

function expectNoGarbage() {
  const text = pageText();
  expect(text).not.toMatch(/\bnull\b/);
  expect(text).not.toMatch(/\bundefined\b/);
  expect(text).not.toMatch(/\bNaN\b/);
  expect(text).not.toMatch(/null%/);
  expect(text).not.toMatch(/no_sensor_log|not_recorded|snake/);
}

beforeEach(() => {
  lensRun.mockReset();
});

describe('TelemetryDashboard — no sensor log (all null)', () => {
  it('renders Not available with the plain reason for every null field', async () => {
    lensRun.mockResolvedValue(emptyLog);
    render(<TelemetryDashboard robot={robot} />);

    expect(
      await screen.findByText('Not available — no sensor samples logged yet (log some in the Sensors tab).'),
    ).toBeInTheDocument();
    // Battery, core temp, CPU load, proximity.
    expect(screen.getAllByText('Not available')).toHaveLength(4);
    expect(screen.getAllByText('Not available — no joint samples logged.')).toHaveLength(1);
    expect(screen.getByText('Joint state (Not available)')).toBeInTheDocument();
    expectNoGarbage();
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
  });
});

describe('TelemetryDashboard — measured values', () => {
  it('renders a real 0 for battery, sensors and joint angle as 0, not Not available', async () => {
    lensRun.mockResolvedValue({
      data: {
        ok: true,
        result: {
          ...emptyLog.data.result,
          sensors: { temperature: 0, cpuLoad: 0, proximity: 0 },
          battery: 0,
          joints: [{ joint: 1, angle: 0, unit: 'deg' }],
          dof: 1,
          telemetrySource: 'sensor_log',
          telemetryReason: null,
        },
      },
    });
    render(<TelemetryDashboard robot={robot} />);

    expect(await screen.findByText('Joint state (1 DOF)')).toBeInTheDocument();
    // Battery and CPU load both measured 0.
    expect(screen.getAllByText('0%')).toHaveLength(2);
    expect(screen.getByText('0°C')).toBeInTheDocument();
    expect(screen.getByText('0m')).toBeInTheDocument();
    expect(screen.getByText('0°')).toBeInTheDocument();
    expect(screen.queryAllByText('Not available')).toHaveLength(0);
    expectNoGarbage();
  });

  it('renders an arbitrary logged channel and a real battery', async () => {
    lensRun.mockResolvedValue({
      data: {
        ok: true,
        result: {
          ...emptyLog.data.result,
          sensors: { lidar: 3.5, temperature: 21 },
          battery: 64,
          joints: [{ joint: 1, angle: 30, unit: 'deg' }],
          dof: 1,
          telemetrySource: 'sensor_log',
          telemetryReason: null,
        },
      },
    });
    render(<TelemetryDashboard robot={robot} />);

    expect(await screen.findByText('lidar')).toBeInTheDocument();
    expect(screen.getByText('3.5')).toBeInTheDocument();
    expect(screen.getByText('64%')).toBeInTheDocument();
    expect(screen.getByText('30°')).toBeInTheDocument();
    // Cpu load and proximity were not logged on a robot that has samples:
    // those cards say Not available with the generic "not recorded" reason.
    expect(screen.getAllByText('Not available')).toHaveLength(2);
    expect(screen.getAllByText('not recorded').length).toBeGreaterThanOrEqual(2);
    expectNoGarbage();
  });

  it('shows the velocity and torque gap instead of inventing values', async () => {
    lensRun.mockResolvedValue({
      data: {
        ok: true,
        result: {
          ...emptyLog.data.result,
          sensors: { temperature: 21 },
          battery: 80,
          joints: [{ joint: 1, angle: 12, unit: 'deg' }],
          dof: 1,
          telemetrySource: 'sensor_log',
          telemetryReason: null,
        },
      },
    });
    render(<TelemetryDashboard robot={robot} />);

    expect(await screen.findByText('Velocity and torque: Not available — not recorded.')).toBeInTheDocument();
    expectNoGarbage();
  });

  it('never prints a raw reason code the UI does not know', async () => {
    lensRun.mockResolvedValue({
      data: { ok: true, result: { ...emptyLog.data.result, telemetryReason: 'some_future_code' } },
    });
    render(<TelemetryDashboard robot={robot} />);

    expect(await screen.findByText('Not available — not recorded.')).toBeInTheDocument();
    expect(pageText()).not.toContain('some_future_code');
    expectNoGarbage();
  });
});
