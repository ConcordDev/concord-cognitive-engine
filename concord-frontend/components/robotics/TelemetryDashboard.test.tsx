/**
 * A robot with no sensor log must render the stored telemetry shape:
 * null sensors, null battery, empty joints, and telemetryReason.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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

beforeEach(() => {
  lensRun.mockReset();
});

describe('TelemetryDashboard no_sensor_log', () => {
  it('shows the reason and dashes instead of throwing or printing 0%', async () => {
    lensRun.mockResolvedValue(emptyLog);
    render(<TelemetryDashboard robot={robot} />);
    expect(await screen.findByText('No sensor samples logged — use the Sensors tab / sensorLog')).toBeInTheDocument();
    expect(screen.getByText('No joint samples logged.')).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
    expect(screen.queryByText('null')).not.toBeInTheDocument();
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
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });
});
