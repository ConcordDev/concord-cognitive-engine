// Render + behaviour coverage for the automotive lens: VIN decoder with recall lookup, and the
// vehicle history timeline (recalls plus upcoming maintenance).

import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render as rtlRender, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { exercise } from '../../../tests/helpers/exercise';

const runDomain = vi.fn();
const VIN = '1HGCM82633A004352';
const VIN_RESULT = { vin: VIN, make: 'HONDA', model: 'Accord', year: '2003', trim: 'EX', bodyClass: 'Sedan', driveType: 'FWD', engineCylinders: '6', engineDisplacementL: '3.0', fuelType: 'Gasoline', transmission: 'Automatic', manufacturer: 'HONDA', plantCountry: 'US', plantCity: 'Marysville', vehicleType: 'Passenger', doors: '4', electrificationLevel: null, abs: 'Standard', stabilityControl: null, backupCamera: 'Standard', forwardCollisionWarning: null, laneDepartureWarning: null, autoEmergencyBraking: null };
const RECALLS = [{ nhtsaId: '19V001', campaignId: '19V001', component: 'AIR BAGS', summary: 'Inflator may rupture', consequence: 'Injury', remedy: 'Replace inflator', manufacturer: 'HONDA', reportReceivedDate: '2019-01-05', recallDate: '2019-01-05' }, { nhtsaId: '20V002', campaignId: '20V002', component: 'FUEL', summary: 'Leak', consequence: 'Fire', remedy: 'Reseal', manufacturer: 'HONDA', reportReceivedDate: '2020-02-01', recallDate: '2020-02-01' }];
let decodeFails = false;
function resultFor(action: string): unknown {
  switch (action) {
    case 'vin-decode': return VIN_RESULT;
    case 'recall-lookup': return { recalls: RECALLS };
    case 'maintenanceSchedule': return { mileage: 98000, allCaughtUp: false, services: [{ service: 'Oil change', intervalMiles: 5000, intervalMonths: 6, priority: 'high', notes: 'Synthetic', milesUntilDue: -500, overdue: true, status: 'due-now' }, { service: 'Brake inspection', intervalMiles: 20000, intervalMonths: 12, priority: 'medium', milesUntilDue: 1500, overdue: false, status: 'upcoming' }, { service: 'Wipers', intervalMiles: 15000, intervalMonths: 12, priority: 'low', milesUntilDue: 9000, overdue: false, status: 'ok' }] };
    default: return { ok: true };
  }
}
vi.mock('@/lib/api/client', () => ({
  lensRun: vi.fn(async () => ({ data: { ok: true, result: {} } })),
  api: { get: vi.fn(async () => ({ data: {} })), post: vi.fn(async () => ({ data: {} })) },
  apiHelpers: { lens: { runDomain: (...a: unknown[]) => runDomain(...a), list: vi.fn(async () => ({ data: { artifacts: [], total: 0 } })) } },
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/components/dtu/SaveAsDtuButton', () => ({ SaveAsDtuButton: () => <button>save-as-dtu</button> }));
vi.mock('framer-motion', () => ({
  useReducedMotion: () => false,
  MotionConfig: ({ children }: { children?: React.ReactNode }) => children,
  motion: new Proxy({}, { get: () => (p: Record<string, unknown>) => <div>{p.children as React.ReactNode}</div> }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { VehicleHistory } from '../VehicleHistory';
import { VinDecoder } from '../VinDecoder';

const render = (ui: React.ReactElement) => rtlRender(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 10)); });
const press = async (re: RegExp, nth = 0) => {
  const hits = screen.queryAllByRole('button').filter((x) => re.test((x.textContent || x.getAttribute('aria-label') || x.getAttribute('title') || '').trim()));
  if (hits[nth]) await act(async () => { fireEvent.click(hits[nth]); await new Promise((r) => setTimeout(r, 10)); });
  return !!hits[nth];
};
afterEach(() => cleanup());
beforeEach(() => {
  decodeFails = false;
  runDomain.mockReset();
  runDomain.mockImplementation(async (_d: string, action: string) => (decodeFails ? { data: { ok: false, error: 'invalid VIN' } } : { data: { ok: true, result: resultFor(action) } }));
});

describe('automotive panels', () => {
  it('VIN decoder rejects an invalid VIN, decodes a valid one with recalls, and reports a failure', async () => {
    const view = render(<VinDecoder />);
    await settle();
    const input = screen.getAllByRole('textbox')[0];
    fireEvent.change(input, { target: { value: 'SHORT' } });
    await act(async () => { fireEvent.submit(document.querySelector('form') as HTMLFormElement); });
    expect(runDomain).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: VIN } });
    await act(async () => { fireEvent.submit(document.querySelector('form') as HTMLFormElement); await new Promise((r) => setTimeout(r, 20)); });
    await settle();
    expect(view.container.textContent).toMatch(/HONDA|Accord|AIR BAGS/);
    expect(runDomain.mock.calls.map((c) => c[1])).toEqual(expect.arrayContaining(['vin-decode', 'recall-lookup']));
    await exercise({ passes: 2, text: VIN, skip: /delete|remove|cancel|close|dismiss|clear|^back|^×$/i });
    decodeFails = true;
    await act(async () => { fireEvent.submit(document.querySelector('form') as HTMLFormElement); await new Promise((r) => setTimeout(r, 20)); });
    expect(document.body.textContent).toMatch(/invalid VIN|decode failed/i);
  });

  it('vehicle history pulls the VIN, recalls and maintenance into a timeline and expands a recall', async () => {
    const view = render(<VehicleHistory />);
    await settle();
    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: VIN } });
    const odo = document.querySelector('input[type="number"]') as HTMLInputElement | null;
    if (odo) fireEvent.change(odo, { target: { value: '98000' } });
    await press(/Pull|History|Check|Look ?up|Run|Decode/i);
    await settle();
    expect(view.container.textContent).toMatch(/Oil change|AIR BAGS|HONDA/);
    for (const b of screen.queryAllByRole('button').filter((x) => /AIR BAGS|FUEL|expand|chevron/i.test(x.textContent || x.getAttribute('aria-label') || ''))) await act(async () => { fireEvent.click(b); });
    await exercise({ passes: 2, text: '120000', skip: /delete|remove|cancel|close|dismiss|clear|^back|^×$/i });
    expect(runDomain.mock.calls.map((c) => c[1])).toEqual(expect.arrayContaining(['vin-decode', 'recall-lookup', 'maintenanceSchedule']));
  });

  it('both panels stay standing offline', async () => {
    runDomain.mockImplementation(async () => ({ data: { ok: false, error: 'offline' } }));
    for (const el of [<VinDecoder key="v" />, <VehicleHistory key="h" />]) {
      const view = render(el);
      await settle();
      await exercise({ passes: 1 });
      expect(view.container).toBeTruthy();
      cleanup();
    }
  });
});
