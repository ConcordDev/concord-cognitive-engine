import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { AVMEstimator } from '@/components/realestate/AVMEstimator';

const AVM = {
  estimate: 560000,
  lowEstimate: 510000,
  highEstimate: 610000,
  confidenceErrorPct: 0.09,
  pricePerSqft: 280,
  rentEstimate: 3200,
  factors: { conditionMult: 1.05, ageDepreciation: 0.97, bedBathBoost: 1.02, lotPremium: 0.04 },
};

describe('AVMEstimator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lensRun.mockResolvedValue({ data: { ok: true, result: AVM } });
  });

  it('renders the form fields with defaults and no result', () => {
    render(<AVMEstimator />);
    expect(screen.getByText('Home value estimator (AVM)')).toBeInTheDocument();
    expect((screen.getByLabelText('Sqft', { selector: 'input' }) as HTMLInputElement).value).toBe('2000');
    expect(screen.queryByText('Estimated value')).not.toBeInTheDocument();
  });

  it('estimates value and renders the result block with factors', async () => {
    render(<AVMEstimator />);
    fireEvent.click(screen.getByRole('button', { name: /Estimate value/ }));
    expect(await screen.findByText('$560,000')).toBeInTheDocument();
    expect(screen.getByText(/Range:/)).toBeInTheDocument();
    expect(screen.getByText(/±9%/)).toBeInTheDocument();
    expect(screen.getByText('$280')).toBeInTheDocument();
    expect(screen.getByText('$3,200/mo')).toBeInTheDocument();
    expect(screen.getByText('×1.05')).toBeInTheDocument();
    expect(screen.getByText('+4.0%')).toBeInTheDocument();
    expect(lensRun).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'avm-estimate', input: expect.objectContaining({ sqft: 2000, condition: 'good' }) }),
    );
  });

  it('updates form inputs and condition select then estimates with new values', async () => {
    render(<AVMEstimator />);
    fireEvent.change(screen.getByLabelText('Sqft', { selector: 'input' }), { target: { value: '3000' } });
    fireEvent.change(screen.getByLabelText('Beds', { selector: 'input' }), { target: { value: '4' } });
    fireEvent.change(screen.getByLabelText('Baths', { selector: 'input' }), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('Year built', { selector: 'input' }), { target: { value: '2005' } });
    fireEvent.change(screen.getByLabelText('Lot sqft', { selector: 'input' }), { target: { value: '9000' } });
    fireEvent.change(screen.getByLabelText('Zip $/sqft', { selector: 'input' }), { target: { value: '300' } });
    fireEvent.change(screen.getByLabelText('Condition', { selector: 'select' }), { target: { value: 'excellent' } });
    fireEvent.click(screen.getByRole('button', { name: /Estimate value/ }));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'avm-estimate',
          input: expect.objectContaining({ sqft: 3000, beds: 4, baths: 3, condition: 'excellent', zipMedianPpsf: 300 }),
        }),
      ),
    );
  });

  it('does not call lensRun when sqft is cleared', () => {
    render(<AVMEstimator />);
    fireEvent.change(screen.getByLabelText('Sqft', { selector: 'input' }), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /Estimate value/ }));
    expect(lensRun).not.toHaveBeenCalled();
  });

  it('renders nothing extra when result is null', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: null } });
    render(<AVMEstimator />);
    fireEvent.click(screen.getByRole('button', { name: /Estimate value/ }));
    await waitFor(() => expect(lensRun).toHaveBeenCalled());
    expect(screen.queryByText('Estimated value')).not.toBeInTheDocument();
  });

  it('tolerates a rejected estimate request', async () => {
    lensRun.mockRejectedValue(new Error('boom'));
    render(<AVMEstimator />);
    fireEvent.click(screen.getByRole('button', { name: /Estimate value/ }));
    await waitFor(() => expect(lensRun).toHaveBeenCalled());
    expect(screen.queryByText('Estimated value')).not.toBeInTheDocument();
  });
});
