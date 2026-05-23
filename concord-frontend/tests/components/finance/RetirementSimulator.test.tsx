import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { RetirementSimulator } from '@/components/finance/RetirementSimulator';

function mkResult(successProbability: number) {
  return {
    successProbability,
    medianFinalBalance: 1_200_000,
    p10Final: 400_000,
    p25Final: 700_000,
    p75Final: 1_800_000,
    p90Final: 2_400_000,
    shortfallYear: successProbability < 0.7 ? 88 : null,
    trajectories: [
      [100, 110, 120, 130],
      [100, 90, 80, 70],
    ],
    years: 4,
  };
}

describe('RetirementSimulator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lensRun.mockResolvedValue({ data: { result: mkResult(0.9) } });
  });

  it('runs on mount and renders the success result (healthy branch)', async () => {
    render(<RetirementSimulator />);
    expect(await screen.findByText('90%')).toBeInTheDocument();
    expect(screen.getByText(/healthy trajectory/)).toBeInTheDocument();
    expect(screen.getByText(/Sampled paths/)).toBeInTheDocument();
  });

  it('renders the low-success warning branch', async () => {
    lensRun.mockResolvedValue({ data: { result: mkResult(0.5) } });
    render(<RetirementSimulator />);
    expect(await screen.findByText('50%')).toBeInTheDocument();
    expect(screen.getByText(/Consider raising contributions/)).toBeInTheDocument();
  });

  it('re-runs when an input number changes', async () => {
    render(<RetirementSimulator />);
    await screen.findByText('90%');
    lensRun.mockClear();
    const numbers = screen.getAllByRole('spinbutton');
    fireEvent.change(numbers[0], { target: { value: '40' } });
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(expect.objectContaining({ action: 'retirement-monte-carlo', input: expect.objectContaining({ currentAge: 40 }) })),
    );
  });

  it('re-runs when a slider changes', async () => {
    render(<RetirementSimulator />);
    await screen.findByText('90%');
    lensRun.mockClear();
    const sliders = screen.getAllByRole('slider');
    fireEvent.change(sliders[0], { target: { value: '45' } });
    await waitFor(() => expect(lensRun).toHaveBeenCalled());
  });

  it('renders the no-result fallback after a rejection', async () => {
    lensRun.mockRejectedValue(new Error('down'));
    render(<RetirementSimulator />);
    expect(await screen.findByText(/Edit inputs to run the simulation/)).toBeInTheDocument();
  });
});
