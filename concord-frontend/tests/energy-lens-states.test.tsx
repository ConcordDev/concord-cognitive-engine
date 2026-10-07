import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EnergyDevicesPanel, type EnergyDevice } from '@/components/energy/EnergyDevicesPanel';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

const DEVICE: EnergyDevice = {
  id: 'dev_1',
  name: 'Heat Pump',
  category: 'hvac',
  wattage: 3500,
  alwaysOn: false,
  totalKwh: 42.5,
};
const refresh = vi.fn(async () => {});

beforeEach(() => {
  lensRunMock.mockReset();
  refresh.mockClear();
  lensRunMock.mockResolvedValue({ data: { ok: true, result: { devices: [] } } });
});

describe('EnergyDevicesPanel', () => {
  it('loads the real top-consumers macro without duplicating the workspace device-list call', async () => {
    await act(async () => {
      render(<EnergyDevicesPanel devices={[]} loading={false} loadError={null} refresh={refresh} />);
    });
    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith('energy', 'top-consumers', { days: 30 }));
    expect(lensRunMock.mock.calls.some((call) => call[1] === 'device-list')).toBe(false);
  });

  it('renders distinct loading, error, empty, and populated states', async () => {
    const view = render(<EnergyDevicesPanel devices={[]} loading loadError={null} refresh={refresh} />);
    expect(view.getByRole('status')).toHaveAttribute('aria-busy', 'true');

    await act(async () => {
      view.rerender(<EnergyDevicesPanel devices={[]} loading={false} loadError="STATE unavailable" refresh={refresh} />);
    });
    expect(view.getByRole('alert')).toHaveTextContent('STATE unavailable');

    await act(async () => {
      view.rerender(<EnergyDevicesPanel devices={[]} loading={false} loadError={null} refresh={refresh} />);
    });
    expect(view.getByText(/No devices\. Add appliances/i)).toBeInTheDocument();

    await act(async () => {
      view.rerender(<EnergyDevicesPanel devices={[DEVICE]} loading={false} loadError={null} refresh={refresh} />);
    });
    expect(view.getByText('Heat Pump')).toBeInTheDocument();
    expect(view.getByText(/42\.5 kWh logged/i)).toBeInTheDocument();
  });

  it('retries the parent-owned device query', async () => {
    const view = render(<EnergyDevicesPanel devices={[]} loading={false} loadError="temporary outage" refresh={refresh} />);
    fireEvent.click(view.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });

  it('offers the real meter category when adding a device', async () => {
    const view = render(<EnergyDevicesPanel devices={[]} loading={false} loadError={null} refresh={refresh} />);
    await act(async () => { fireEvent.click(view.getByRole('button', { name: /Add/i })); });
    expect(view.getByRole('option', { name: 'meter' })).toBeInTheDocument();
  });
});
