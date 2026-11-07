// Render + behaviour coverage for the energy lens: the billing panel (rate, bill estimate,
// projection, goals) and the workspace shell (views, meter picker, quick add) with sibling panels
// stubbed.

import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { actionOf, exercise } from '../../../tests/helpers/exercise';

const lensRunMock = vi.fn();
const DEV = (id: string, category: string) => ({ id, name: `Device ${id}`, category, wattage: 120, alwaysOn: false, totalKwh: 14.2 });

function resultFor(action: string): unknown {
  switch (action) {
    case 'rate-get': return { rate: { ratePerKwh: 0.18, utility: 'City Power' }, isDefault: false };
    case 'bill-estimate': return { month: '2026-03', consumedKwh: 420, solarKwh: 80, netKwh: 340, ratePerKwh: 0.18, estimatedBill: 61.2, solarSavings: 14.4 };
    case 'cost-projection': return { hasData: true, isCurrentMonth: true, loggedKwh: 210, distinctDays: 12, daysInMonth: 31, dailyAvgKwh: 17.5, projectedKwh: 542, projectedNetKwh: 462, billSoFar: 37.8, projectedBill: 83.2, confidence: 'medium' };
    case 'goal-list': return { goals: [{ id: 'g1', label: 'Stay under 400', targetKwh: 400, period: 'month', usedKwh: 420, pct: 105, overBudget: true }, { id: 'g2', label: 'Weekday cap', targetKwh: 100, period: 'week', usedKwh: 40, pct: 40, overBudget: false }] };
    case 'device-list': return { devices: [DEV('m1', 'meter'), DEV('m2', 'meter'), DEV('a1', 'appliance')] };
    case 'energy-dashboard': return { devices: 3, monthKwh: 420, monthCost: 61.2, solarKwh: 80, solarOffsetPct: 19, ratePerKwh: 0.18 };
    default: return { ok: true, id: 'new-1', device: DEV('m9', 'meter') };
  }
}
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRunMock(...a),
  api: { get: vi.fn(async () => ({ data: {} })), post: vi.fn(async () => ({ data: {} })) },
  apiHelpers: { lens: { runDomain: vi.fn(async () => ({ data: { ok: true, result: {} } })), list: vi.fn(async () => ({ data: { artifacts: [], total: 0 } })) } },
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useLensIdentity', () => ({ useLensIdentity: () => {} }));
vi.mock('@/lib/lens-state-persistence', () => ({ useLensStatePersistence: () => ({ restore: () => ({ view: 'now', selectedMeterId: 'm1' }), persist: vi.fn() }) }));
for (const n of ['EiaPanel', 'EnergyActionStack', 'EnergyCheapestWindowPanel', 'EnergyDevicesPanel', 'EnergyDisaggregationPanel', 'EnergyGridCalcPanel', 'EnergyInsightsPanel', 'EnergyLivePanel', 'EnergySolarPanel', 'EnergyTouPanel', 'EnergyUsagePanel', 'SolarCarbonPanel']) vi.doMock(`../${n}`, () => ({ [n]: () => <span>{n}-stub</span> }));
vi.mock('@/components/feeds/LensFeedPanel', () => ({ LensFeedPanel: () => <span>feed-stub</span> }));
vi.mock('framer-motion', () => ({
  useReducedMotion: () => false,
  MotionConfig: ({ children }: { children?: React.ReactNode }) => children,
  motion: new Proxy({}, { get: () => (p: Record<string, unknown>) => <div>{p.children as React.ReactNode}</div> }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });
const sent = () => lensRunMock.mock.calls.map((c) => actionOf(c));
const press = async (re: RegExp, nth = 0) => {
  const hits = screen.queryAllByRole('button').filter((x) => re.test((x.textContent || x.getAttribute('aria-label') || x.getAttribute('title') || '').trim()));
  if (hits[nth]) await act(async () => { fireEvent.click(hits[nth]); await new Promise((r) => setTimeout(r, 20)); });
  return !!hits[nth];
};
afterEach(() => cleanup());
beforeEach(() => {
  lensRunMock.mockReset();
  lensRunMock.mockImplementation(async (...a: unknown[]) => ({ data: { ok: true, result: resultFor(actionOf(a)), error: null } }));
});

describe('energy billing panel', () => {
  it('shows the bill and projection, sets the rate, sets and deletes goals, and validates', async () => {
    const { EnergyBillingPanel } = await import('../EnergyBillingPanel');
    const onChange = vi.fn();
    const view = render(<EnergyBillingPanel onChange={onChange} />);
    await settle();
    expect(view.container.textContent).toMatch(/61|City Power|420/);
    await press(/Save rate|Set rate|Update/i);
    expect(document.body.textContent).toMatch(/rate greater than zero/i);
    await exercise({ passes: 3, text: '0.21', skip: /delete|remove|trash|discard|cancel|close|dismiss|reset|clear|^back|^×$/i });
    await press(/Add goal|Set goal|Save goal/i);
    await press(/Delete|Trash|Remove/i);
    expect(sent()).toEqual(expect.arrayContaining(['rate-get', 'bill-estimate', 'cost-projection', 'goal-list']));
    expect(sent().some((x) => /rate-set|goal-set|goal-delete/.test(x))).toBe(true);
    expect(onChange).toHaveBeenCalled();
  });
  it('reports a load failure and renders without data', async () => {
    const { EnergyBillingPanel } = await import('../EnergyBillingPanel');
    lensRunMock.mockImplementation(async () => ({ data: { ok: false, error: 'meter feed down' } }));
    const view = render(<EnergyBillingPanel onChange={vi.fn()} />);
    await settle();
    expect(view.container.textContent).toMatch(/meter feed down|Could not load/);
    cleanup();
    lensRunMock.mockImplementation(async (...a: unknown[]) => ({ data: { ok: true, result: actionOf(a) === 'cost-projection' ? { hasData: false } : actionOf(a) === 'goal-list' ? { goals: [] } : actionOf(a) === 'bill-estimate' ? null : { rate: null, isDefault: true } } }));
    const empty = render(<EnergyBillingPanel onChange={vi.fn()} />);
    await settle();
    expect(empty.container.textContent?.length).toBeGreaterThan(10);
  });
});

describe('energy workspace', () => {
  it('drives the meter picker: rename, delete, add, errors, close', { timeout: 60000 }, async () => {
    const { EnergyWorkspace } = await import('../EnergyWorkspace');
    render(<EnergyWorkspace />);
    await settle();
    const type = async (label: RegExp, value: string) => { await act(async () => { fireEvent.change(screen.getByLabelText(label), { target: { value } }); }); };
    await press(/Change meter|Choose a meter/);
    await press(/^Add$/);
    expect(document.body.textContent).toMatch(/name is required/i);
    await act(async () => { fireEvent.click(screen.getByLabelText(/Rename Device m1/)); });
    await type(/New name for Device m1/, '');
    await press(/^Save$/);
    await type(/New name for Device m1/, 'Main meter');
    await press(/^Save$/);
    await act(async () => { fireEvent.click(screen.getByLabelText(/Rename Device m2/)); });
    await press(/^Cancel$/);
    lensRunMock.mockImplementationOnce(async () => ({ data: { ok: false, error: 'rename refused' } }));
    await act(async () => { fireEvent.click(screen.getByLabelText(/Rename Device m2/)); });
    await press(/^Save$/);
    await press(/^Cancel$/);
    await act(async () => { fireEvent.click(screen.getByLabelText(/Delete Device m2/)); });
    await press(/^Cancel$/);
    await act(async () => { fireEvent.click(screen.getByLabelText(/Delete Device m1/)); });
    await press(/Delete meter/);
    if (!screen.queryByLabelText(/Add a meter/)) await press(/Change meter|Choose a meter/);
    await type(/Add a meter/, 'Garage meter');
    await press(/^Add$/);
    if (!screen.queryByLabelText(/Add a meter/)) await press(/Change meter|Choose a meter/);
    await type(/Add a meter/, 'Shed');
    lensRunMock.mockImplementationOnce(async () => ({ data: { ok: false, error: 'add refused' } }));
    await press(/^Add$/);
    await press(/Device m2/);
    await press(/Change meter|Choose a meter/);
    await act(async () => { fireEvent.click(screen.getByLabelText(/Close meter picker/)); });
    expect(sent()).toEqual(expect.arrayContaining(['device-update', 'device-delete', 'device-add']));
  });
  it('offers the empty state when no meters exist', async () => {
    const { EnergyWorkspace } = await import('../EnergyWorkspace');
    lensRunMock.mockImplementation(async (...a: unknown[]) => ({ data: { ok: true, result: actionOf(a) === 'device-list' ? { devices: [] } : resultFor(actionOf(a)) } }));
    render(<EnergyWorkspace />);
    await settle();
    await press(/Choose a meter/);
    expect(document.body.textContent).toMatch(/Add a meter/);
  });
  it('loads meters and the dashboard, walks every view, picks a meter and adds one', { timeout: 60000 }, async () => {
    const { EnergyWorkspace } = await import('../EnergyWorkspace');
    const view = render(<EnergyWorkspace />);
    await settle();
    expect(sent()).toEqual(expect.arrayContaining(['device-list', 'energy-dashboard']));
    for (const v of ['Usage', 'Devices', 'Solar', 'Billing', 'Insights', 'Rates', 'Grid', 'Share', 'Now']) { await press(new RegExp(`^${v}$`)); await settle(); }
    await press(/Device m1|Device m2|meter/i); await press(/Device m2/);
    await press(/Add (a )?meter|New meter|\+/i);
    expect(view.container.textContent?.length).toBeGreaterThan(50);
  });
  it('shows a load error and a retry', async () => {
    const { EnergyWorkspace } = await import('../EnergyWorkspace');
    lensRunMock.mockImplementation(async () => ({ data: { ok: false, error: 'grid offline' } }));
    const view = render(<EnergyWorkspace />);
    await settle();
    await press(/Retry|Try again/i);
    expect(view.container.textContent).toMatch(/grid offline|Failed/);
  });
});
