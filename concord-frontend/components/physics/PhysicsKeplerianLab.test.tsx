/// <reference types="@testing-library/jest-dom/vitest" />
// Pins PhysicsKeplerianLab, the frontend half of un-shadowing
// domains/physics.js's richer Keplerian/Hohmann-transfer orbital engine via
// the new additive `physics.orbitalMechanicsAdvanced` macro (see
// server/domains/physics.js and server/tests/depth/
// physics-orbital-advanced-behavior.test.js for the backend half).
//
// Covers: the macro is called with the expected flat Keplerian-elements +
// Hohmann-transfer-target shape, a successful result renders the dynamics
// and Hohmann-transfer readout plus the orbit-point plot, and an error
// response surfaces honestly (no fabricated numbers on failure).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRun(...a),
}));

import { PhysicsKeplerianLab } from './PhysicsKeplerianLab';

const sampleResult = {
  elements: { semiMajorAxis: 6678000, eccentricity: 0, inclination: 0 },
  dynamics: {
    period: 5432.9, periodMinutes: 90.5, periapsis: 6678000, apoapsis: 6678000,
    velocityAtPeriapsis: 7725.56, velocityAtApoapsis: 7725.56, meanMotion: 0.001157,
  },
  hohmannTransfer: {
    targetAltitude: 42164000, deltaV1: 2425.68, deltaV2: 1466.79,
    totalDeltaV: 3892.47, transferTime: 18990.75,
  },
  orbitPoints: [
    { theta: 0, radius: 6678000, x: 6678000, y: 0, z: 0 },
    { theta: 90, radius: 6678000, x: 0, y: 6678000, z: 0 },
    { theta: 180, radius: 6678000, x: -6678000, y: 0, z: 0 },
    { theta: 270, radius: 6678000, x: 0, y: -6678000, z: 0 },
  ],
};

describe('PhysicsKeplerianLab', () => {
  beforeEach(() => {
    lensRun.mockReset();
  });

  it('calls physics.orbitalMechanicsAdvanced (the new additive macro, not the shadowed orbitalMechanics) with the Keplerian-elements + Hohmann-target shape, and renders the readout', async () => {
    lensRun.mockResolvedValueOnce({ data: { ok: true, result: sampleResult, error: null } });

    render(<PhysicsKeplerianLab />);
    fireEvent.click(screen.getByText('Propagate orbit'));

    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        'physics',
        'orbitalMechanicsAdvanced',
        expect.objectContaining({
          orbit: expect.objectContaining({
            semiMajorAxis: 6678000,
            eccentricity: 0,
            inclination: 0,
            centralBodyMass: 5.972e24,
          }),
          targetAltitude: 42164000,
        }),
      ),
    );

    // Never calls the shadowed flat macro name.
    expect(lensRun).not.toHaveBeenCalledWith('physics', 'orbitalMechanics', expect.anything());

    // Hohmann-transfer readout renders the real numeric result.
    expect(await screen.findByText(/Total Δv: 3892.47 m\/s/)).toBeInTheDocument();
    expect(screen.getByText(/2425.68 m\/s/)).toBeInTheDocument();
    expect(screen.getByText(/1466.79 m\/s/)).toBeInTheDocument();

    // Orbit-point plot rendered as an SVG (4 sample points → a closed polygon).
    const plot = screen.getByRole('img', { name: 'Orbit path plot' });
    expect(plot).toBeInTheDocument();
    expect(plot.querySelector('polygon')).toBeInTheDocument();
  });

  it('surfaces an honest error banner instead of fabricating a result when the macro fails', async () => {
    lensRun.mockResolvedValueOnce({ data: { ok: false, result: null, error: 'orbit computation failed' } });

    render(<PhysicsKeplerianLab />);
    fireEvent.click(screen.getByText('Propagate orbit'));

    expect(await screen.findByRole('alert')).toHaveTextContent('orbit computation failed');
    expect(screen.queryByText(/Total Δv/)).not.toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'Orbit path plot' })).not.toBeInTheDocument();
  });

  it('lets the user edit the starting orbit and Hohmann target before running', async () => {
    lensRun.mockResolvedValueOnce({ data: { ok: true, result: sampleResult, error: null } });

    render(<PhysicsKeplerianLab />);
    fireEvent.change(screen.getByLabelText('semi-major axis a (m)'), { target: { value: '7000000' } });
    fireEvent.change(screen.getByLabelText('eccentricity e (0–1)'), { target: { value: '0.2' } });
    fireEvent.change(screen.getByLabelText('target orbital radius (m)'), { target: { value: '20000000' } });
    fireEvent.click(screen.getByText('Propagate orbit'));

    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        'physics',
        'orbitalMechanicsAdvanced',
        expect.objectContaining({
          orbit: expect.objectContaining({ semiMajorAxis: 7000000, eccentricity: 0.2 }),
          targetAltitude: 20000000,
        }),
      ),
    );
  });
});
