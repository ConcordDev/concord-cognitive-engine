import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const lensRunMock = vi.fn();
const restoreMock = vi.fn();
const persistMock = vi.fn();

vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: vi.fn() }));
vi.mock('@/hooks/useLensIdentity', () => ({ useLensIdentity: vi.fn() }));
vi.mock('@/lib/lens-state-persistence', () => ({
  useLensStatePersistence: () => ({ restore: restoreMock, persist: persistMock, clear: vi.fn() }),
}));
vi.mock('@/components/viz/ChartKit', () => ({ ChartKit: () => <div data-testid="chart" /> }));

import { EnergyWorkspace } from '@/components/energy/EnergyWorkspace';

const DASHBOARD = {
  devices: 0,
  monthKwh: 0,
  monthCost: 0,
  solarKwh: 0,
  solarOffsetPct: 0,
  ratePerKwh: 0.17,
};

beforeEach(() => {
  lensRunMock.mockReset();
  restoreMock.mockReset();
  persistMock.mockReset();
  restoreMock.mockReturnValue(null);
});

describe('EnergyWorkspace north-star flow', () => {
  it('starts with the concept empty state and opens the real meter chooser', async () => {
    lensRunMock.mockImplementation(async (_domain: string, action: string) => ({
      data: {
        ok: true,
        result: action === 'device-list' ? { devices: [] } : DASHBOARD,
      },
    }));
    const view = render(<EnergyWorkspace who="Ramaj" />);

    await waitFor(() => expect(view.getByText('No meter selected')).toBeInTheDocument());
    expect(view.getByText('The load, Ramaj')).toBeInTheDocument();
    fireEvent.click(view.getAllByRole('button', { name: 'Choose a meter' })[0]);
    expect(view.getByRole('dialog', { name: 'Choose a meter' })).toBeInTheDocument();
    expect(view.getByText(/No meters are connected yet/i)).toBeInTheDocument();
  });

  it('creates a persisted meter through device-add and enters the unified workspace', async () => {
    let created = false;
    lensRunMock.mockImplementation(async (_domain: string, action: string, input: Record<string, unknown>) => {
      if (action === 'device-add') {
        expect(input).toMatchObject({ name: 'Main panel', category: 'meter', wattage: 0 });
        created = true;
        return { data: { ok: true, result: { device: { id: 'meter_1' } } } };
      }
      if (action === 'device-list') {
        return {
          data: {
            ok: true,
            result: {
              devices: created ? [{
                id: 'meter_1',
                name: 'Main panel',
                category: 'meter',
                wattage: 0,
                alwaysOn: false,
                totalKwh: 0,
              }] : [],
            },
          },
        };
      }
      if (action === 'energy-dashboard') return { data: { ok: true, result: DASHBOARD } };
      if (action === 'live-stream') {
        return { data: { ok: true, result: { samples: [], current: 0, peak: 0, avgWatts: 0 } } };
      }
      return { data: { ok: true, result: {} } };
    });

    const view = render(<EnergyWorkspace who="Ramaj" />);
    await waitFor(() => expect(view.getByText('No meter selected')).toBeInTheDocument());
    fireEvent.click(view.getAllByRole('button', { name: 'Choose a meter' })[0]);
    fireEvent.change(view.getByLabelText('Add a meter'), { target: { value: 'Main panel' } });
    await act(async () => { fireEvent.click(view.getByRole('button', { name: 'Add' })); });

    await waitFor(() => expect(view.getAllByText('Main panel').length).toBeGreaterThan(0));
    expect(view.getByRole('navigation', { name: 'Energy workspace' })).toBeInTheDocument();
    expect(persistMock).toHaveBeenCalledWith({ view: 'now', selectedMeterId: 'meter_1' });
    expect(lensRunMock).toHaveBeenCalledWith('energy', 'live-stream', { minutes: 120, deviceId: 'meter_1' });
  });

  it('keeps a mounted child view stable while refreshing dashboard summaries', async () => {
    restoreMock.mockReturnValue({ view: 'usage', selectedMeterId: 'meter_1' });
    lensRunMock.mockImplementation(async (_domain: string, action: string) => {
      if (action === 'device-list') {
        return {
          data: {
            ok: true,
            result: {
              devices: [{
                id: 'meter_1',
                name: 'Main panel',
                category: 'meter',
                wattage: 0,
                alwaysOn: false,
                totalKwh: 0,
              }],
            },
          },
        };
      }
      if (action === 'energy-dashboard') return { data: { ok: true, result: DASHBOARD } };
      if (action === 'reading-history') {
        return { data: { ok: true, result: { series: [], totalKwh: 0, totalCost: 0 } } };
      }
      if (action === 'usage-breakdown') {
        return { data: { ok: true, result: { breakdown: [], totalKwh: 0 } } };
      }
      return { data: { ok: true, result: {} } };
    });

    const view = render(<EnergyWorkspace who="Ramaj" />);
    await waitFor(() => expect(view.getByPlaceholderText('kWh used')).toBeInTheDocument());
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
    expect(view.getByPlaceholderText('kWh used')).toBeInTheDocument();
    expect(lensRunMock.mock.calls.filter((call) => call[1] === 'reading-history')).toHaveLength(1);
  });
});
