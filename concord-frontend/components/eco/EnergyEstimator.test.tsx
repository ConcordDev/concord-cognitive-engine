/**
 * The estimator starts blank. A quote with no annual production shows the
 * server's absence line and does not read null kWh.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const post = vi.hoisted(() => vi.fn());

vi.mock('lucide-react', () => ({ Sun: () => null, Zap: () => null, Loader2: () => null }));
vi.mock('@/lib/api/client', () => ({ api: { post: (...args: unknown[]) => post(...args) } }));

import { EnergyEstimator } from './EnergyEstimator';

describe('EnergyEstimator', () => {
  beforeEach(() => {
    post.mockReset();
    post.mockResolvedValue({
      data: {
        result: {
          annualKwh: null,
          monthlyKwh: null,
          capacityFactor: null,
          co2AvoidedKgPerYear: null,
          systemKwp: null,
          source: null,
          reason: 'not_recorded',
          message: 'Not recorded: lat, lng, systemKw.',
        },
      },
    });
  });

  it('does not send a blank site as 0°, 0° and 0 kW', async () => {
    render(<EnergyEstimator />);
    expect((screen.getByLabelText('Latitude') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('System size (kW)') as HTMLInputElement).value).toBe('');
    fireEvent.change(screen.getByLabelText('Latitude'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: /Estimate production/ }));
    expect(await screen.findByText('Not recorded: lat, lng, systemKw.')).toBeInTheDocument();
    const body = post.mock.calls[0][1] as { input: Record<string, unknown> };
    expect(body.input.lat).toBe(0);
    expect(body.input.lng).toBeUndefined();
    expect(body.input.systemKw).toBeUndefined();
    expect(screen.queryByText(/kWh/)).not.toBeInTheDocument();
  });
});
