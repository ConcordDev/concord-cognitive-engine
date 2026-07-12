/**
 * AircraftPanel (aviation lens) — edit-in-place form for an existing aircraft
 * profile.
 *
 * Wave 4 gap-closure: `aviation.aircraft-update` (server/domains/aviation.js)
 * was a real macro (updates cruiseKts/fuelBurnGph/fuelCapacityGal/hobbsHours/
 * tachHours on an existing profile) with zero frontend callers — add/list/
 * delete only. Pins that clicking Edit reveals an inline form seeded with the
 * aircraft's real current values, and that Save calls `aircraft-update` with
 * exactly those 5 numeric fields (never tail/make/model/kind, which the macro
 * doesn't accept) before refreshing the list.
 *
 * lensRun is mocked at the `@/lib/api/client` boundary — no fabricated data.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
}));
vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const make = (name: string) => {
    const Icon = React.forwardRef<SVGSVGElement, Record<string, unknown>>((props, ref) =>
      React.createElement('span', { 'data-testid': `icon-${name}`, ref, ...props }));
    Icon.displayName = name;
    return Icon;
  };
  return new Proxy(actual, {
    get: (target, prop: string) => (prop in target ? make(prop) : (target as Record<string, unknown>)[prop]),
  });
});

import { AircraftPanel } from '@/components/aviation/AircraftPanel';

const AIRCRAFT = {
  id: 'ac_1', tail: 'N12345', make: 'Cessna', model: '172', year: 1998, kind: 'single_engine_piston',
  cruiseKts: 110, fuelBurnGph: 8.5, fuelCapacityGal: 56, maxTakeoffWeightLbs: 2450, emptyWeightLbs: 1500,
  hobbsHours: 1234.5, tachHours: 1100.2,
};

function reply(data: Record<string, unknown>) {
  return Promise.resolve({ data: { ok: true, result: data } });
}

beforeEach(() => { lensRun.mockReset(); });

describe('AircraftPanel — edit an existing aircraft profile (aircraft-update)', () => {
  it('lists real aircraft from aircraft-list', async () => {
    lensRun.mockImplementation((spec: { action: string }) => {
      if (spec.action === 'aircraft-list') return reply({ aircraft: [AIRCRAFT] });
      return reply({});
    });
    const { getByText } = render(<AircraftPanel />);
    await waitFor(() => expect(getByText('N12345')).toBeInTheDocument());
    expect(getByText(/Cessna 172/)).toBeInTheDocument();
  });

  it('Edit reveals an inline form seeded with the real current values', async () => {
    lensRun.mockImplementation((spec: { action: string }) => {
      if (spec.action === 'aircraft-list') return reply({ aircraft: [AIRCRAFT] });
      return reply({});
    });
    const { getByText, getByLabelText } = render(<AircraftPanel />);
    await waitFor(() => expect(getByText('N12345')).toBeInTheDocument());

    fireEvent.click(getByLabelText('Edit'));

    const cruise = getByLabelText('Cruise kts') as HTMLInputElement;
    const burn = getByLabelText('Burn gph') as HTMLInputElement;
    const hobbs = getByLabelText('Hobbs') as HTMLInputElement;
    const tach = getByLabelText('Tach') as HTMLInputElement;
    expect(cruise.value).toBe('110');
    expect(burn.value).toBe('8.5');
    expect(hobbs.value).toBe('1234.5');
    expect(tach.value).toBe('1100.2');
  });

  it('Save calls aircraft-update with exactly the 5 editable numeric fields, then refreshes', async () => {
    lensRun.mockImplementation((spec: { action: string; input?: Record<string, unknown> }) => {
      if (spec.action === 'aircraft-list') return reply({ aircraft: [AIRCRAFT] });
      if (spec.action === 'aircraft-update') return reply({ aircraft: { ...AIRCRAFT, hobbsHours: 1300 } });
      return reply({});
    });
    const { getByText, getByLabelText } = render(<AircraftPanel />);
    await waitFor(() => expect(getByText('N12345')).toBeInTheDocument());

    fireEvent.click(getByLabelText('Edit'));
    fireEvent.change(getByLabelText('Hobbs'), { target: { value: '1300' } });
    fireEvent.click(getByText('Save'));

    await waitFor(() => expect(lensRun.mock.calls.some((c) => c[0]?.action === 'aircraft-update')).toBe(true));
    const call = lensRun.mock.calls.find((c) => c[0]?.action === 'aircraft-update')!;
    expect(call[0].domain).toBe('aviation');
    expect(call[0].input).toEqual({
      id: 'ac_1', cruiseKts: 110, fuelBurnGph: 8.5, fuelCapacityGal: 56, hobbsHours: 1300, tachHours: 1100.2,
    });
    // never sends the non-editable identity fields
    expect(call[0].input.tail).toBeUndefined();
    expect(call[0].input.make).toBeUndefined();
    expect(call[0].input.model).toBeUndefined();

    // form closes and the list is re-fetched (at least 2 aircraft-list calls: initial + post-save refresh)
    await waitFor(() => expect(lensRun.mock.calls.filter((c) => c[0]?.action === 'aircraft-list').length).toBeGreaterThanOrEqual(2));
    expect(() => getByLabelText('Cruise kts')).toThrow();
  });

  it('Cancel discards the edit without calling aircraft-update', async () => {
    lensRun.mockImplementation((spec: { action: string }) => {
      if (spec.action === 'aircraft-list') return reply({ aircraft: [AIRCRAFT] });
      return reply({});
    });
    const { getByText, getByLabelText } = render(<AircraftPanel />);
    await waitFor(() => expect(getByText('N12345')).toBeInTheDocument());

    fireEvent.click(getByLabelText('Edit'));
    await waitFor(() => expect(getByLabelText('Cruise kts')).toBeInTheDocument());
    fireEvent.click(getByText('Cancel'));

    expect(() => getByLabelText('Cruise kts')).toThrow();
    expect(lensRun.mock.calls.some((c) => c[0]?.action === 'aircraft-update')).toBe(false);
  });
});
