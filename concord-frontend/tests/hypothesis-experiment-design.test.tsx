/** ExperimentDesignPanel — sends the engine's expected shapes and renders its numbers. */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRunMock(...a) }));

import { ExperimentDesignPanel } from '@/components/hypothesis/ExperimentDesignPanel';

beforeEach(() => {
  lensRunMock.mockReset();
  lensRunMock.mockImplementation((_d: string, action: string) => {
    const results: Record<string, unknown> = {
      abTest: { control: { rate: '8%' }, variant: { rate: '9.2%' }, absoluteDifference: '1.2 pp', relativeUplift: '15%', zStatistic: 2.14, pValue: 0.032, significant: true, confidenceInterval: { level: '95%', lower: '0.1 pp', upper: '2.3 pp' }, statisticalPower: '57%', sampleSizeForPower80: 8200, recommendation: 'Variant wins with 15% uplift (p=0.032)' },
      powerAnalysis: { solve: 'sampleSize', requiredN: 63, perGroup: 63, totalForTwoGroups: 126, effectMagnitude: 'medium' },
      bayesianInference: { prior: { alpha: 1, beta: 1 }, posterior: { alpha: 28, beta: 14, mean: 0.667, mode: 0.675 }, credibleInterval: { lower: 0.52, upper: 0.81 }, bayesFactor: 4.1, evidenceStrength: 'substantial' },
    };
    return Promise.resolve({ data: { ok: true, result: results[action] } });
  });
});

describe('ExperimentDesignPanel', () => {
  it('A/B test sends control/variant counts and shows the verdict', async () => {
    render(<ExperimentDesignPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Analyze' }));
    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith('hypothesis', 'abTest', {
      control: { visitors: 5000, conversions: 400 }, variant: { visitors: 5000, conversions: 460 }, alpha: 0.05,
    }));
    await screen.findByText(/Variant wins with 15% uplift/);
  });

  it('power analysis solves for per-group sample size', async () => {
    render(<ExperimentDesignPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Solve' }));
    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith('hypothesis', 'powerAnalysis', { solve: 'sampleSize', alpha: 0.05, effectSize: 0.5, power: 0.8 }));
    const big = await screen.findByText('63');
    expect(within(big.parentElement as HTMLElement).getByText(/per group · 126 total/)).toBeTruthy();
  });

  it('Bayesian update sends a beta prior and draws the posterior', async () => {
    render(<ExperimentDesignPanel />);
    fireEvent.click(screen.getByRole('button', { name: /update belief/i }));
    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith('hypothesis', 'bayesianInference', {
      prior: { distribution: 'beta', alpha: 1, beta: 1 }, observations: { successes: 27, trials: 40 },
    }));
    await screen.findByText('Beta(28, 14)');
    expect(screen.getByRole('img', { name: /prior and posterior/i })).toBeTruthy();
  });
});
