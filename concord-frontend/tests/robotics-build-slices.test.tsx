/**
 * Robotics full build (GB-1021) — R-S1 gate propagation + receipts · R-S3 IK angles.
 *
 * R-S1 (F2): the page gates Telemetry/Teleop/Sensor Logs on its own fleet
 * state; FleetManager's register/remove/update now fire onFleetChange so the
 * page refreshes in-session (no reload). Register and Queue Mission also
 * leave a receipt naming the act (F4). R-S3: the IK readout lists the joint
 * angles the CCD solver converged to (the server always returned them; the
 * panel never printed them).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
  api: { get: vi.fn(), post: vi.fn() },
  apiHelpers: { get: vi.fn(), post: vi.fn() },
}));

import { FleetManager } from '@/components/robotics/FleetManager';
import { MissionSequencer } from '@/components/robotics/MissionSequencer';
import { KinematicsStudio } from '@/components/robotics/KinematicsStudio';

const ROBOT = { id: 'r1', name: 'PR2ROBO-UNIQUE-STRING-1031', type: 'arm', status: 'idle', firmware: '1.0.0', battery: 100, batteryCapacityWh: 50, powerDrawW: 35, errorCount: 0, lastCommand: '' };
const EMPTY_FLEET = { data: { ok: true, result: { robots: [], total: 0, online: 0, running: 0, errors: 0 } } };
const ONE_FLEET = { data: { ok: true, result: { robots: [ROBOT], total: 1, online: 1, running: 0, errors: 0 } } };

beforeEach(() => { lensRun.mockReset(); });

describe('R-S1 — fleet changes notify the page; creates receipt', () => {
  it('registering a robot fires onFleetChange and leaves a receipt naming it', async () => {
    const onFleetChange = vi.fn();
    let listCalls = 0;
    lensRun.mockImplementation((_d: string, action: string) => {
      if (action === 'fleetList') { listCalls += 1; return Promise.resolve(listCalls > 1 ? ONE_FLEET : EMPTY_FLEET); }
      if (action === 'fleetRegister') return Promise.resolve({ data: { ok: true, result: { robot: ROBOT } } });
      return Promise.resolve({ data: { ok: true, result: {} } });
    });
    render(<FleetManager onFleetChange={onFleetChange} />);
    const nameInput = await screen.findByPlaceholderText('Robot name');
    fireEvent.change(nameInput, { target: { value: 'PR2ROBO-UNIQUE-STRING-1031' } });
    fireEvent.click(screen.getByRole('button', { name: /^Register$/ }));
    await waitFor(() => expect(onFleetChange).toHaveBeenCalled());
    expect(await screen.findByText(/Registered "PR2ROBO-UNIQUE-STRING-1031" \(arm\)/)).toBeTruthy();
    expect(screen.getByText(/Telemetry, Teleop and Sensor Logs are now unlocked/)).toBeTruthy();
  });

  it('removing a robot fires onFleetChange (the gate can re-close in-session)', async () => {
    const onFleetChange = vi.fn();
    lensRun.mockImplementation((_d: string, action: string) => {
      if (action === 'fleetList') return Promise.resolve(ONE_FLEET);
      if (action === 'fleetRemove') return Promise.resolve({ data: { ok: true, result: {} } });
      return Promise.resolve({ data: { ok: true, result: {} } });
    });
    render(<FleetManager onFleetChange={onFleetChange} />);
    await screen.findByText('PR2ROBO-UNIQUE-STRING-1031');
    fireEvent.click(screen.getByRole('button', { name: 'Remove robot' }));
    await waitFor(() => expect(onFleetChange).toHaveBeenCalled());
  });

  it('queueing a mission leaves a receipt naming it and its step count', async () => {
    lensRun.mockImplementation((_d: string, action: string) => {
      if (action === 'missionList') return Promise.resolve({ data: { ok: true, result: { missions: [] } } });
      if (action === 'missionCreate') return Promise.resolve({ data: { ok: true, result: { mission: { id: 'm1' } } } });
      return Promise.resolve({ data: { ok: true, result: {} } });
    });
    render(<MissionSequencer robots={[ROBOT]} />);
    const nameInput = await screen.findByPlaceholderText('Mission name');
    fireEvent.change(nameInput, { target: { value: 'PR2ROBO-UNIQUE-STRING-1031' } });
    fireEvent.click(screen.getByRole('button', { name: /Queue Mission/ }));
    expect(await screen.findByText(/Mission "PR2ROBO-UNIQUE-STRING-1031" queued — 4 steps, status QUEUED/)).toBeTruthy();
  });
});

describe('R-S3 — IK outcome completeness', () => {
  it('the IK readout lists the joint angles it converged to', async () => {
    // (explicit timeout: the shared env is slow under parallel suites)
    lensRun.mockImplementation((_d: string, action: string) => {
      if (action === 'inverseKinematics') return Promise.resolve({ data: { ok: true, result: {
        angles: [10.5, -20.25, 30], points: [{ x: 0, y: 0 }, { x: 100, y: 20 }, { x: 150, y: 60 }, { x: 120, y: 120 }],
        endEffector: { x: 120, y: 120 }, target: { x: 120, y: 120 }, reachable: true, error: 0.32, converged: true, iterations: 4,
      } } });
      if (action === 'forwardKinematics') return Promise.resolve({ data: { ok: true, result: {
        points: [{ x: 0, y: 0 }], endEffector: { x: 0, y: 0 }, orientation: 0, maxReach: 290, extension: '0%', dof: 3,
      } } });
      return Promise.resolve({ data: { ok: true, result: {} } });
    });
    const { container } = render(<KinematicsStudio />);
    fireEvent.click(await screen.findByRole('button', { name: 'Inverse Kinematics' }));
    // The canvas is selected structurally, never by its viewBox attribute:
    // the lockfile's jsdom 30.0.1 selector engine never matches a camelCase
    // SVG attribute selector ('svg[viewBox="0 0 460 460"]' reads null while
    // the canvas stands in the DOM — the deterministic GB-1077/GB-1078
    // exclusion; jsdom 30.1.x matches it, which is why hand-assembled envs
    // passed). Identity is pinned by reading the attribute directly, which
    // no selector engine mediates. The waitFor covers genuinely slow first
    // renders in loaded full-tree runs.
    const svg = await waitFor(() => {
      const el = container.querySelector('.panel svg');
      expect(el).toBeTruthy();
      expect(el?.getAttribute('viewBox')).toBe('0 0 460 460');
      return el as Element;
    }, { timeout: 10000 });
    fireEvent.click(svg);
    expect(await screen.findByText('Joint angles')).toBeTruthy();
    expect(screen.getByText(/J1 10\.50° · J2 -20\.25° · J3 30\.00°/)).toBeTruthy();
    expect(screen.getByText('Residual error')).toBeTruthy();
  }, 20000);
});
