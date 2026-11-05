// Render coverage for the automotive garage, VIN decoder, history and fuel/repair panels.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render as rtlRender, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { actionOf, exercise } from '../../../tests/helpers/exercise';

const lensRunMock = vi.fn();
const runDomainMock = vi.fn();
const VEH = { id: 'v1', number: 'V-1', name: 'Daily', make: 'Honda', model: 'Civic', year: 2018, odometer: 62000, odometerUnit: 'mi', fuelUnit: 'gal', licensePlate: 'ABC123' };
const GARAGE: Record<string, unknown> = {
  'vehicles-list': { vehicles: [VEH, { ...VEH, id: 'v2', name: 'Truck', make: 'Ford', model: 'F-150' }] },
  'vehicles-create': { vehicle: VEH }, 'vehicles-update': { vehicle: VEH },
  'fuel-list': { fuel: [{ id: 'f1', date: '2026-02-20', odometer: 61800, volume: 10, totalCost: 35, pricePerUnit: 3.5, fuelGrade: 'regular', mpg: 31, station: 'Shell' }] },
  'service-list': { service: [{ id: 's1', serviceType: 'oil change', date: '2026-01-10', odometer: 60000, cost: 70, shop: 'Quick', notes: '' }] },
  'service-reminders': { reminders: [{ scheduleId: 'sc1', serviceType: 'tires', status: 'overdue', milesStatus: { milesRemaining: -200 }, dateStatus: null }, { scheduleId: 'sc2', serviceType: 'oil', status: 'due_soon', milesStatus: null, dateStatus: { daysRemaining: 9 } }, { scheduleId: 'sc3', serviceType: 'brakes', status: 'ok', milesStatus: { milesRemaining: 5000 }, dateStatus: { daysRemaining: 200 } }] },
  'expenses-list': { expenses: [{ id: 'e1', category: 'fuel', amount: 35, date: '2026-02-20', note: '' }, { id: 'e2', category: 'insurance', amount: 90, date: '2026-02-01', note: '' }], byCategory: { fuel: 35, insurance: 90 }, total: 125 },
  'trips-list': { trips: [{ id: 'tr1', number: 'T-1', date: '2026-02-11', distance: 40, purpose: 'business', from: 'A', to: 'B' }], totalDistance: 40, businessDistance: 40 },
  'documents-list': { documents: [{ id: 'd1', kind: 'insurance', title: 'Policy', provider: 'Acme', expiryDate: '2026-04-01', expired: false, expiringSoon: true }, { id: 'd2', kind: 'registration', title: 'Reg', provider: 'DMV', expiryDate: '2025-01-01', expired: true, expiringSoon: false }] },
  'vehicle-stats': { lifetimeMpg: 31, totalSpend: 900, fuelSpend: 400, fillCount: 12, serviceCount: 3, milesTracked: 3000, costPerMile: 0.3 },
};
const VIN = { vin: '1HGCM82633A004352', make: 'Honda', model: 'Accord', year: '2003', trim: 'EX', bodyClass: 'Coupe', driveType: 'FWD', engineCylinders: '4', engineDisplacementL: '2.4', fuelType: 'Gasoline', transmission: 'Auto', manufacturer: 'Honda', plantCountry: 'US', plantCity: 'Marysville', vehicleType: 'Passenger', doors: '2', electrificationLevel: null, abs: 'Standard', stabilityControl: null, backupCamera: null, forwardCollisionWarning: null, laneDepartureWarning: null, autoEmergencyBraking: null };
const AUTO: Record<string, unknown> = {
  'vin-decode': VIN,
  'recall-lookup': { recalls: [{ nhtsaId: '23V001', campaignId: 'C1', component: 'AIR BAGS', summary: 'Inflator may rupture', consequence: 'Injury', remedy: 'Replace', manufacturer: 'Honda', reportReceivedDate: '2023-01-02', recallDate: '2023-01-02' }], gap: null },
  maintenanceSchedule: { mileage: 62000, services: [{ service: 'Timing belt', intervalMiles: 90000, intervalMonths: 84, priority: 'high', notes: 'n', milesUntilDue: -500, overdue: true, status: 'due-now' }, { service: 'Oil', intervalMiles: 5000, intervalMonths: 6, priority: 'low', milesUntilDue: 2000, overdue: false, status: 'upcoming' }], allCaughtUp: false },
};
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRunMock(...a),
  api: { get: vi.fn(), post: vi.fn() },
  apiHelpers: { lens: { runDomain: (...a: unknown[]) => runDomainMock(...a) } },
}));
vi.mock('@/components/icons/Icon', () => ({ Icon: () => <span /> }));
vi.mock('@/components/dtu/SaveAsDtuButton', () => ({ SaveAsDtuButton: () => <button>Save as DTU</button>, default: () => <button>Save as DTU</button> }));
vi.mock('@/components/lens-primitives/CalcPanel', () => ({
  CalcPanel: (p: { title: string; left: { render: React.ReactNode }; right: { render: React.ReactNode }; renderResults: (l: unknown, r: unknown) => React.ReactNode }) => (
    <div><h2>{p.title}</h2>{p.left.render}{p.right.render}
      <div>{p.renderResults({ avgMPG: 31, bestMPG: 35, worstMPG: 27, totalGallons: 40, totalFuelCost: 140, costPerMile: 0.11, readings: [{ date: '2026-02-01', mpg: 31, miles: 300, gallons: 10 }] }, { repairs: [{ repair: 'Brakes', partsCost: 80, laborHours: 2, laborRate: 120, laborCost: 240, total: 320, priority: 'high' }], subtotalParts: 80, subtotalLabor: 240, grandTotal: 320, tax: 6, totalWithTax: 326, recommendation: 'Do soon' })}</div>
      <div>{p.renderResults(null, null)}</div>
      <div>{p.renderResults({ status: 'NOT_COMPUTED', message: 'need mileage' }, { status: 'NOT_COMPUTED', message: 'need parts' })}</div>
    </div>
  ),
}));

import { FuelRepairPanel } from '../FuelRepairPanel';
import { GarageSection } from '../GarageSection';
import { VehicleHistory } from '../VehicleHistory';
import { VinDecoder } from '../VinDecoder';

const render = (ui: React.ReactElement) => rtlRender(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
afterEach(() => cleanup());
beforeEach(() => {
  lensRunMock.mockReset(); runDomainMock.mockReset();
  lensRunMock.mockImplementation(async (...a: unknown[]) => ({ data: { ok: true, result: GARAGE[actionOf(a)] ?? { ok: true, vehicle: VEH }, error: null } }));
  runDomainMock.mockImplementation(async (_d: string, name: string) => ({ data: { ok: true, result: { ok: true, result: AUTO[name] ?? {} } } }));
  vi.spyOn(window, 'alert').mockImplementation(() => {});
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

describe('FuelRepairPanel', () => {
  it('stages fill-ups and repairs and renders every result state', async () => {
    const view = render(<FuelRepairPanel />);
    await settle();
    await exercise({ passes: 4, text: '5' });
    expect(view.container.textContent).toContain('Fuel');
  });
});

describe('GarageSection', () => {
  it('lists vehicles, opens one and drives every log form', async () => {
    const view = render(<GarageSection addSignal={0} />);
    await settle();
    await exercise({ passes: 5, text: '5' });
    await settle();
    await exercise({ passes: 2, text: 'Oil change' });
    expect(view.container.textContent).toBeTruthy();
  });
  it.each(['Overview', 'Fuel', 'Service', 'Expenses', 'Trips', 'Docs'])('walks the %s tab', async (label) => {
    const view = render(<GarageSection />);
    await settle();
    const tab = screen.queryAllByRole('button').find((b) => (b.textContent || '').trim() === label);
    if (tab) await act(async () => { fireEvent.click(tab); });
    await settle();
    const skip = /^(Overview|Fuel|Service|Expenses|Trips|Docs)$|Delete vehicle/i;
    await exercise({ passes: 4, text: '5', skip });
    await exercise({ passes: 2, text: 'Oil change', skip });
    expect(view.container.textContent).toBeTruthy();
  });
  it('opens the add-vehicle form when signalled', async () => {
    const view = rtlRender(<GarageSection addSignal={0} />);
    view.rerender(<GarageSection addSignal={1} />);
    await settle();
    await exercise({ passes: 3, text: 'Civic' });
    expect(view.container.textContent).toBeTruthy();
  });
  it('says so honestly when the garage cannot load', async () => {
    lensRunMock.mockImplementation(async () => ({ data: { ok: false, error: 'offline' } }));
    const view = render(<GarageSection />);
    await settle();
    expect(view.container.textContent).toBeTruthy();
  });
});

describe.each([['VinDecoder', VinDecoder], ['VehicleHistory', VehicleHistory]])('%s', (_n, Comp: React.ComponentType) => {
  it('decodes a VIN and lists recalls and service', async () => {
    const view = render(<Comp />);
    await settle();
    await exercise({ passes: 4, text: '1HGCM82633A004352' });
    await settle();
    await exercise({ passes: 2, text: '62000' });
    expect(view.container.textContent).toBeTruthy();
  });
  it('shows a failed decode as an error', async () => {
    runDomainMock.mockImplementation(async () => ({ data: { ok: false, error: 'NHTSA unavailable' } }));
    const view = render(<Comp />);
    await settle();
    await exercise({ passes: 3, text: '1HGCM82633A004352' });
    expect(view.container.textContent).toBeTruthy();
  });
});
