import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const lensRunMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api/client', () => ({
  lensRun: lensRunMock,
}));

import { CalculatorsPanel } from '@/components/veterinary/CalculatorsPanel';

describe('veterinary CostCalc', () => {
  beforeEach(() => {
    lensRunMock.mockReset();
  });

  it('names the procedures with no price when the estimate is not_recorded', async () => {
    lensRunMock.mockResolvedValue({
      data: {
        ok: true,
        error: null,
        result: {
          procedures: [],
          totalEstimate: null,
          reason: 'not_recorded',
          unavailable: ['dental', 'procedures[1]'],
          tip: null,
        },
      },
    });

    render(<CalculatorsPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'dental' }));
    fireEvent.click(screen.getByRole('button', { name: 'Estimate' }));

    expect(await screen.findByText('Not recorded: dental, an unnamed procedure')).toBeInTheDocument();
    expect(lensRunMock).toHaveBeenCalledWith('veterinary', 'costEstimate', {
      data: { procedures: [{ type: 'dental' }] },
    });
  });

  it('falls back to the server message instead of a blank when nothing is unavailable', async () => {
    lensRunMock.mockResolvedValue({
      data: { ok: true, error: null, result: { message: 'Add procedures to estimate costs.' } },
    });

    render(<CalculatorsPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Estimate' }));

    await waitFor(() => {
      expect(screen.getByText('Add procedures to estimate costs.')).toBeInTheDocument();
    });
  });
});
