/** PhysicsFieldLab — calls the un-shadowed advanced engines with launch vectors / source lists. */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRunMock(...a) }));

import { PhysicsFieldLab } from '@/components/physics/PhysicsFieldLab';

beforeEach(() => {
  lensRunMock.mockReset();
  lensRunMock.mockImplementation((_d: string, action: string) => Promise.resolve({ data: { ok: true, result: action === 'kinematicsSimAdvanced'
    ? { bodies: [{ name: 'No drag', maxHeight: 27.8, range: 154.8, flightTime: 4.72, maxSpeed: 40, impactVelocity: 32.8 }], trajectories: { 'No drag': [{ t: 0, x: 0, y: 1 }, { t: 4.72, x: 154.8, y: 0, event: 'impact' }] } }
    : { grid: { size: 2, resolution: 0.1, physicalSize: 0.2 }, amplitudeMap: [[1, -1], [0.5, 0]], statistics: { maxAmplitude: 1, minAmplitude: -1, constructivePercent: 43, destructivePercent: 8, nodalPercent: 17 }, sources: [{ source: '(-0.4, 0)', frequency: 1000, wavelength: 0.343 }], beatFrequency: 0 } } }));
});

describe('PhysicsFieldLab', () => {
  it('launches bodies on kinematicsSimAdvanced with velocity resolved from speed and angle', async () => {
    render(<PhysicsFieldLab />);
    fireEvent.click(screen.getByRole('button', { name: /launch/i }));
    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith('physics', 'kinematicsSimAdvanced', expect.objectContaining({ dt: 0.005 })));
    const body = lensRunMock.mock.calls[0][2].bodies[0];
    expect(body.velocity.x).toBeCloseTo(40 * Math.cos((35 * Math.PI) / 180), 6);
    expect(body.velocity.y).toBeCloseTo(40 * Math.sin((35 * Math.PI) / 180), 6);
    expect((await screen.findAllByText('154.8 m')).length).toBeGreaterThan(0);
    await screen.findByRole('img', { name: 'Trajectories' });
  });

  it('computes the interference field on waveInterferenceAdvanced and draws it', async () => {
    render(<PhysicsFieldLab />);
    fireEvent.click(screen.getByRole('button', { name: /compute field/i }));
    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith('physics', 'waveInterferenceAdvanced', expect.objectContaining({ gridSize: 30, waveSpeed: 343 })));
    await screen.findByRole('img', { name: 'Interference field' });
    expect(screen.getByText(/17% near-nodal/)).toBeTruthy();
  });
});
