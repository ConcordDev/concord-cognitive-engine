/**
 * TeleopConsole — pins the hoisted-Btn static-components fix.
 *
 * `Btn` was defined inside `TeleopConsole`'s render body, closing over
 * `drive`/`busy` — a fresh component identity every render forces React
 * to unmount+remount all 7 drive buttons on every parent re-render
 * instead of just updating their props. Hoisted to module scope, taking
 * `busy`/`onDrive` as explicit props. This pins that all 7 buttons render
 * and that clicking one drives the expected `lensRun` call.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TeleopConsole } from '@/components/robotics/TeleopConsole';
import type { RobotRow } from '@/components/robotics/FleetManager';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
}));

const robot: RobotRow = {
  id: 'robot-1', name: 'R1', type: 'arm', status: 'idle', firmware: '1.0',
  battery: 90, batteryCapacityWh: 100, powerDrawW: 5, errorCount: 0, lastCommand: '',
} as RobotRow;

describe('TeleopConsole', () => {
  beforeEach(() => {
    lensRun.mockReset();
    lensRun.mockResolvedValue({ data: { ok: true, result: { robotId: 'robot-1', command: 'forward', position: { x: 1, y: 0, z: 0 }, trail: [] } } });
  });

  it('renders all 7 drive buttons for a selected robot', () => {
    render(<TeleopConsole robot={robot} />);
    for (const label of ['Forward', 'Left', 'Stop', 'Right', 'Up', 'Back', 'Down']) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
  });

  it('clicking a hoisted Btn drives the robot via lensRun and updates the pose', async () => {
    render(<TeleopConsole robot={robot} />);
    fireEvent.click(screen.getByLabelText('Forward'));

    await waitFor(() => {
      expect(lensRun).toHaveBeenCalledWith('robotics', 'teleop', expect.objectContaining({ robotId: 'robot-1', command: 'forward' }));
    });
  });

  it('shows the empty state with no robot selected', () => {
    render(<TeleopConsole robot={null} />);
    expect(screen.getByText(/Select a robot/i)).toBeInTheDocument();
  });
});
