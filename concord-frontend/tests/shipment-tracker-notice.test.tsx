/**
 * ShipmentTracker — tracking refusals are visible in the panel
 * (FIX-logistics-012).
 *
 * The macro refuses when live tracking isn't configured on the
 * server, but the panel used to swallow the refusal into
 * console.error: the typed number cleared, the list stayed empty,
 * and nothing said why. These pins hold the honest behaviour: the
 * list load's trackingConfigured flag shows the unavailable state
 * before submit, a refused Track keeps the typed number and shows
 * the server's reason, and a successful Track still clears + lists.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRun(...a),
}));

import { ShipmentTracker } from '@/components/logistics/ShipmentTracker';

const NOT_CONFIGURED_ERROR = 'Live shipment tracking is not configured on this server — it requires SHIPENGINE_API_KEY or EASYPOST_API_KEY, and Concord does not synthesize tracking status.';

async function until(pred: () => boolean, ms = 2500) {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error('until: timed out');
    await act(async () => { await new Promise((r) => setTimeout(r, 25)); });
  }
}

beforeEach(() => { lensRun.mockReset(); });
afterEach(() => { cleanup(); });

describe('ShipmentTracker unavailable state (FIX-logistics-012)', () => {
  it('shows the not-configured state before submit, from the list load', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { shipments: [], trackingConfigured: false } } });
    render(<ShipmentTracker />);
    await until(() => screen.queryByText(/Live tracking isn't configured on this server/) != null);
  });

  it('a refused Track shows the server reason and keeps the typed number', async () => {
    lensRun.mockImplementation(async (req: { action?: string }) => {
      if (req?.action === 'shipments-list') return { data: { ok: true, result: { shipments: [], trackingConfigured: false } } };
      if (req?.action === 'shipment-track') return { data: { ok: false, error: NOT_CONFIGURED_ERROR } };
      return { data: { ok: true, result: {} } };
    });
    render(<ShipmentTracker />);
    await until(() => screen.queryByText(/Live tracking isn't configured on this server/) != null);
    const input = screen.getByPlaceholderText('Tracking number') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '1Z999AA10123456784' } });
    fireEvent.click(screen.getByRole('button', { name: /Track/ }));
    await until(() => screen.queryByText(/not configured on this server — it requires/) != null);
    expect(input.value).toBe('1Z999AA10123456784');
  });

  it('a successful Track clears the input and refreshes the list', async () => {
    let tracked = false;
    lensRun.mockImplementation(async (req: { action?: string }) => {
      if (req?.action === 'shipments-list') {
        return { data: { ok: true, result: { shipments: tracked ? [{ id: 's1', trackingNumber: '1Z999', carrier: 'UPS', from: 'A', to: 'B', status: 'in_transit', events: [] }] : [], trackingConfigured: true } } };
      }
      if (req?.action === 'shipment-track') { tracked = true; return { data: { ok: true, result: { shipment: { id: 's1' } } } }; }
      return { data: { ok: true, result: {} } };
    });
    render(<ShipmentTracker />);
    await until(() => screen.queryByText('No shipments tracked.') != null);
    const input = screen.getByPlaceholderText('Tracking number') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '1Z999' } });
    fireEvent.click(screen.getByRole('button', { name: /Track/ }));
    await until(() => screen.queryByText('1Z999') != null);
    expect(input.value).toBe('');
    expect(screen.queryByText(/isn't configured/)).not.toBeInTheDocument();
  });
});
