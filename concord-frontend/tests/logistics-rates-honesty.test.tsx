// INC-66: RateQuoter must not present fabricated carrier prices as live
// quotes. carrier_rates_not_configured stays an honest error; geocoded
// estimates never show dollars or a Guaranteed badge.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const calls: Array<{ action: string; input: Record<string, unknown> }> = [];
let respond: () => unknown = () => ({ ok: false, error: 'carrier_rates_not_configured' });

vi.mock('@/lib/api/client', () => ({
  lensRun: vi.fn((spec: { domain: string; action: string; input: Record<string, unknown> }) => {
    calls.push({ action: spec.action, input: spec.input });
    return Promise.resolve({ data: respond() });
  }),
}));

import { RateQuoter } from '@/components/logistics/RateQuoter';

const src = readFileSync(join(__dirname, '../components/logistics/RateQuoter.tsx'), 'utf8');

describe('INC-66 logistics rates honesty', () => {
  beforeEach(() => {
    calls.length = 0;
    respond = () => ({ ok: false, error: 'carrier_rates_not_configured' });
  });

  it('source never invents a Guaranteed badge from transit time alone', () => {
    expect(src).toMatch(/q\.guaranteed === true/);
    expect(src).toMatch(/!estimate && q\.guaranteed === true/);
    expect(src).toMatch(/carrier_rates_not_configured/);
    expect(src).toMatch(/not a carrier quote/);
  });

  it('shows not-configured copy and no dollar amounts when keys are unset', async () => {
    render(<RateQuoter />);
    fireEvent.change(screen.getByPlaceholderText(/Origin/), { target: { value: 'Albany, NY' } });
    fireEvent.change(screen.getByPlaceholderText(/Destination/), { target: { value: 'Albany, NY' } });
    fireEvent.click(screen.getByRole('button', { name: /Compare rates/ }));
    await waitFor(() => {
      expect(screen.getByText(/Carrier rates are not configured/)).toBeTruthy();
    });
    expect(screen.queryByText(/Guaranteed/)).toBeNull();
    expect(screen.queryByText(/\$\d/)).toBeNull();
    expect(calls.map((c) => c.action)).toEqual(['rates-quote']);
  });

  it('marks a geocoded estimate and never paints dollars or Guaranteed', async () => {
    respond = () => ({
      ok: true,
      result: {
        estimate: true,
        guaranteed: false,
        label: 'not a carrier quote',
        distanceMi: 0.12,
        note: null,
        quotes: [{
          carrierId: 'car_1',
          carrierName: 'UPS Repro',
          carrierCode: 'UPS',
          rateUsd: null,
          transitDays: null,
          serviceLevel: null,
          guaranteed: false,
          estimate: true,
          label: 'not a carrier quote',
        }],
      },
    });
    render(<RateQuoter />);
    fireEvent.change(screen.getByPlaceholderText(/Origin/), { target: { value: 'Albany, NY' } });
    fireEvent.change(screen.getByPlaceholderText(/Destination/), { target: { value: 'Albany, NY' } });
    fireEvent.click(screen.getByRole('button', { name: /Compare rates/ }));
    await waitFor(() => {
      expect(screen.getByText('Estimate')).toBeTruthy();
    });
    expect(screen.getByText(/· not a carrier quote/)).toBeTruthy();
    expect(screen.queryByText(/Guaranteed/)).toBeNull();
    expect(screen.queryByText(/\$\d/)).toBeNull();
    expect(screen.getAllByText('Not a carrier quote').length).toBeGreaterThan(0);
  });

  it('shows Guaranteed only for a non-estimate broker-marked quote', async () => {
    respond = () => ({
      ok: true,
      result: {
        estimate: false,
        source: 'shipengine',
        quotes: [{
          carrierId: 'car_1',
          carrierName: 'FedEx',
          carrierCode: 'FDX',
          rateUsd: 22,
          transitDays: 5,
          serviceLevel: 'fedex_2day',
          guaranteed: true,
          estimate: false,
        }],
      },
    });
    render(<RateQuoter />);
    fireEvent.change(screen.getByPlaceholderText(/Origin/), { target: { value: 'Austin, TX' } });
    fireEvent.change(screen.getByPlaceholderText(/Destination/), { target: { value: 'Boston, MA' } });
    fireEvent.click(screen.getByRole('button', { name: /Compare rates/ }));
    await waitFor(() => {
      expect(screen.getByText('$22.00')).toBeTruthy();
    });
    expect(screen.getByText(/Guaranteed/)).toBeTruthy();
  });
});
