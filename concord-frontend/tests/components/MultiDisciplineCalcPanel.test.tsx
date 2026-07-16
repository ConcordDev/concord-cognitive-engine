/// <reference types="@testing-library/jest-dom/vitest" />
/**
 * Closes docs/WAVE4_INVENTORY.md's engineering row — `boltedConnection`/
 * `transformerSizing` real AISC/ANSI math (server/lib/compute/
 * engineering-compute.js) was genuinely unreachable at the macro layer.
 * Backend half (server/domains/engineering.js#connectionCheck /
 * #transformerSizing) is covered by server/tests/depth/
 * engineering-connection-transformer-behavior.test.js. This file pins the
 * frontend half: the "Bolted connection" sub-card in StructuralSection and
 * the "Transformer sizing" sub-card in ElectricalSection call the real new
 * macros with real params and render the real returned result — never a
 * fabricated one.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRunMock = vi.fn();

vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

import { MultiDisciplineCalcPanel } from '@/components/engineering/MultiDisciplineCalcPanel';

describe('MultiDisciplineCalcPanel — bolted connection (engineering.connectionCheck)', () => {
  beforeEach(() => {
    lensRunMock.mockReset();
  });

  it('calls connectionCheck with the real default params and renders the real returned result', async () => {
    lensRunMock.mockResolvedValue({
      data: {
        ok: true,
        result: {
          value: 84.82300164692441,
          unit: 'kips',
          formula: 'R = Fv·Ab·n·planes',
          warnings: [],
          shearPlanes: 1,
          perBoltKips: 21.205750411731103,
          boltAreaSqIn: 0.44178646691106466,
        },
      },
    });

    render(<MultiDisciplineCalcPanel />);
    fireEvent.click(screen.getByText('Check Connection'));

    await waitFor(() => expect(lensRunMock).toHaveBeenCalled());
    const call = lensRunMock.mock.calls.find((c) => c[1] === 'connectionCheck');
    expect(call).toBeTruthy();
    expect(call?.[0]).toBe('engineering');
    // Default form state — no fabricated params, exactly what the form shows.
    expect(call?.[2]).toMatchObject({
      boltDiameter: 0.75,
      boltGrade: 'a325',
      numBolts: 4,
      loadType: 'single',
    });

    // Renders the REAL value the macro returned, not a re-derived one.
    await waitFor(() => expect(screen.getByText(/Connection — allowable shear capacity/)).toBeInTheDocument());
    expect(screen.getByText('84.823')).toBeInTheDocument();
    expect(screen.getByText('R = Fv·Ab·n·planes')).toBeInTheDocument();
  });

  it('renders an honest failure card (never a fabricated success) when the real function rejects invalid input', async () => {
    lensRunMock.mockResolvedValue({
      data: {
        ok: true,
        // /api/lens/run's own unwrap leaves a failed sub-call's {ok:false,
        // error, inputs} nested under `result` — see the honest-failure
        // contract in server/domains/engineering.js#connectionCheck.
        result: { ok: false, error: 'positive values required', inputs: { boltDiameter: 0, numBolts: 4 } },
      },
    });

    render(<MultiDisciplineCalcPanel />);
    fireEvent.click(screen.getByText('Check Connection'));

    await waitFor(() => expect(screen.getByText('positive values required')).toBeInTheDocument());
  });
});

describe('MultiDisciplineCalcPanel — transformer sizing (engineering.transformerSizing)', () => {
  beforeEach(() => {
    lensRunMock.mockReset();
  });

  it('calls transformerSizing with the real default params and renders the real returned result', async () => {
    lensRunMock.mockResolvedValue({
      data: {
        ok: true,
        result: {
          value: 150,
          unit: 'kVA',
          formula: 'kVA = loadKva · growth',
          warnings: [],
          requiredKva: 125,
          selectedKva: 150,
          primaryAmps: 180.42195912175808,
          powerFactor: 0.9,
        },
      },
    });

    render(<MultiDisciplineCalcPanel />);
    fireEvent.click(screen.getByText('Size Transformer'));

    await waitFor(() => expect(lensRunMock).toHaveBeenCalled());
    const call = lensRunMock.mock.calls.find((c) => c[1] === 'transformerSizing');
    expect(call).toBeTruthy();
    expect(call?.[0]).toBe('engineering');
    expect(call?.[2]).toMatchObject({
      loadKva: 100,
      voltage: 480,
      phase: 3,
      powerFactor: 0.9,
      growthFactor: 1.25,
    });

    await waitFor(() => expect(screen.getByText(/Transformer — selected kVA/)).toBeInTheDocument());
    // "150" (the headline value) also appears again in the extras grid as
    // selectedKva — assert on the unique primaryAmps extra instead so the
    // real returned value (not a re-derived one) is unambiguously checked.
    expect(screen.getAllByText('150').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('180.422')).toBeInTheDocument();
    expect(screen.getByText('kVA = loadKva · growth')).toBeInTheDocument();
  });

  it('renders an honest failure card when required inputs are invalid', async () => {
    lensRunMock.mockResolvedValue({
      data: {
        ok: true,
        result: { ok: false, error: 'loadKva must be > 0', inputs: { loadKva: -5, voltage: 480 } },
      },
    });

    render(<MultiDisciplineCalcPanel />);
    fireEvent.click(screen.getByText('Size Transformer'));

    await waitFor(() => expect(screen.getByText('loadKva must be > 0')).toBeInTheDocument());
  });
});
