/**
 * FIX-mining-011 (audit sweep CB-0447, cluster C) — sites, drill-holes,
 * assay intervals and fleet units gain edit controls. Pins the FE
 * contracts:
 *  - a site row's Edit loads the site into the form; Save site fires
 *    site-update with the site's id (never a second site-add);
 *  - a drill-hole's Edit loads the hole form; Save fires
 *    drillhole-update; an interval's Edit loads the interval form and
 *    Save fires drillhole-update-interval, and its delete is a sticky
 *    confirm firing drillhole-delete-interval only from the confirm;
 *  - a fleet unit's Edit loads the equipment form; Save equipment
 *    fires equipment-update with the unit's id.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
}));
vi.mock('@/components/viz', () => ({ ChartKit: () => null }));

import { MineSiteManager } from '@/components/mining/MineSiteManager';
import { GeologyWorkbench } from '@/components/mining/GeologyWorkbench';
import { FleetManager } from '@/components/mining/FleetManager';

function calls(action: string) {
  return lensRun.mock.calls.filter((c) => c[1] === action);
}

const SITE = { id: 'ms1', name: 'North Pit', kind: 'surface', commodity: 'iron', status: 'active', productionTonnes: 1200, incidents: [], incidentCount: 0 };
const HOLE = {
  id: 'dh1', name: 'DDH-001', siteId: null, collarX: 1, collarY: 2, collarZ: 3,
  azimuth: 10, dip: -80, totalDepth: 100, intervalCount: 1, loggedDepth: 20,
  intervals: [{ id: 'iv1', from: 10, to: 20, lithology: 'fresh_ore', assayGrade: 1.5, recovery: 95 }],
};
const UNIT = {
  id: 'eq1', name: 'HT-1', kind: 'haul_truck', status: 'operating',
  engineHours: 100, utilization: 50, fuelLitres: 40,
  scheduledHours: 200, nextServiceHours: 500, hoursToService: 400, serviceDue: false,
};

beforeEach(() => {
  lensRun.mockReset();
  lensRun.mockImplementation(async (_domain: string, action: string) => {
    switch (action) {
      case 'site-list': return { data: { ok: true, result: { sites: [SITE], count: 1 } } };
      case 'mining-dashboard': return { data: { ok: true, result: { sites: 1, active: 1, totalProduction: 1200, incidents: 0, seriousIncidents: 0 } } };
      case 'drillhole-list': return { data: { ok: true, result: { holes: [HOLE], count: 1 } } };
      case 'fleet-dashboard': return { data: { ok: true, result: { units: [UNIT], fleetSize: 1, operating: 1, inMaintenance: 0, serviceDue: 0, totalFuelLitres: 40, totalEngineHours: 100, avgUtilization: 50, availability: 100 } } };
      case 'schedule-list': return { data: { ok: true, result: { schedules: [] } } };
      default: return { data: { ok: true, result: {} } };
    }
  });
});

describe('mining edit controls (FIX-mining-011)', () => {
  it('site Edit loads the form and Save site fires site-update with the id', async () => {
    render(<MineSiteManager />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit North Pit' }));
    const nameInput = screen.getByPlaceholderText('Site name') as HTMLInputElement;
    expect(nameInput.value).toBe('North Pit');
    fireEvent.change(nameInput, { target: { value: 'North Pit Extension' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save site' }));
    await waitFor(() => expect(calls('site-update')).toHaveLength(1));
    expect(calls('site-update')[0][2]).toMatchObject({ id: 'ms1', name: 'North Pit Extension', kind: 'surface', commodity: 'iron' });
    expect(calls('site-add')).toHaveLength(0);
  });

  it('hole Edit fires drillhole-update; interval Edit fires drillhole-update-interval', async () => {
    render(<GeologyWorkbench />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit hole DDH-001' }));
    const nameInput = screen.getByPlaceholderText('Hole ID (e.g. DDH-001)') as HTMLInputElement;
    expect(nameInput.value).toBe('DDH-001');
    fireEvent.change(nameInput, { target: { value: 'DDH-001A' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save drill-hole' }));
    await waitFor(() => expect(calls('drillhole-update')).toHaveLength(1));
    expect(calls('drillhole-update')[0][2]).toMatchObject({ id: 'dh1', name: 'DDH-001A', totalDepth: 100 });

    fireEvent.click(await screen.findByRole('button', { name: 'Edit interval 10 to 20 metres' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save interval' }));
    await waitFor(() => expect(calls('drillhole-update-interval')).toHaveLength(1));
    expect(calls('drillhole-update-interval')[0][2]).toMatchObject({ holeId: 'dh1', intervalId: 'iv1', from: 10, to: 20, assayGrade: 1.5 });
  });

  it('interval delete is a sticky confirm that fires drillhole-delete-interval only from the confirm', async () => {
    render(<GeologyWorkbench />);
    const arm = await screen.findByRole('button', { name: 'Delete interval 10 to 20 metres' });
    fireEvent.click(arm);
    expect(calls('drillhole-delete-interval')).toHaveLength(0);
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm delete interval 10 to 20 metres' }));
    await waitFor(() => expect(calls('drillhole-delete-interval')).toHaveLength(1));
    expect(calls('drillhole-delete-interval')[0][2]).toEqual({ holeId: 'dh1', intervalId: 'iv1' });
  });

  it('unit Edit loads the equipment form and Save equipment fires equipment-update with the id', async () => {
    render(<FleetManager />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit HT-1' }));
    const nameInput = screen.getByPlaceholderText('Unit name') as HTMLInputElement;
    expect(nameInput.value).toBe('HT-1');
    fireEvent.change(nameInput, { target: { value: 'HT-1 Prime' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save equipment' }));
    await waitFor(() => expect(calls('equipment-update')).toHaveLength(1));
    expect(calls('equipment-update')[0][2]).toMatchObject({ id: 'eq1', name: 'HT-1 Prime', kind: 'haul_truck', scheduledHours: 200, nextServiceHours: 500 });
    expect(calls('equipment-add')).toHaveLength(0);
  });
});
