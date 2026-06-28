/**
 * /lenses/energy — four-UX-state contract for the energy lens.
 *
 * The energy monitor's device surface is EnergyDevicesPanel, which drives its
 * device list + top-consumers ranking through the REAL macro channel:
 *   lensRun('energy', 'device-list', {})        → POST /api/lens/run
 *   lensRun('energy', 'top-consumers', { days }) → POST /api/lens/run
 * (answered by the energy-domain registerLensAction handlers in
 * server/domains/energy.js). This pins that the panel renders genuine
 * loading / error (with a WORKING Retry that RE-FETCHES, not window.reload) /
 * empty / populated states against that real channel — no fabricated rows, and
 * an error is DISTINGUISHABLE from genuinely-empty (the silent-empty defect
 * class: a swallowed load failure must NOT render the same as an empty list).
 *
 * DISPATCH FIDELITY: /api/lens/run unwraps exactly one { ok, result } layer, so
 * the transport flag r.data.ok is ALWAYS true on a dispatched call and a handler
 * rejection surfaces (via lensRun's normalization) as r.data.ok === false. The
 * error fixtures cover BOTH a transport failure ({ ok:false }) AND a handler
 * rejection unwrapped into { ok:true, result:{ ok:false, error } } — the panel
 * must surface either, never collapse into the empty CTA.
 *
 * No fabricated data: every state is driven by a mocked lensRun returning
 * exactly the { data: { ok, result } } shapes the energy macros return.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, act, fireEvent } from '@testing-library/react';
import React from 'react';

// ── the real macro channel, mocked per-test ─────────────────────────────────
const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

// Import AFTER the mock is registered.
import { EnergyDevicesPanel } from '@/components/energy/EnergyDevicesPanel';

// ── fixtures — exact energy-macro dispatch shapes ───────────────────────────
// lensRun fully normalizes the {ok,result} envelope: a success lands as
// { data: { ok:true, result } }, a rejection (transport OR handler) lands as
// { data: { ok:false, result:null, error } }.
function ok(result: unknown) {
  return Promise.resolve({ data: { ok: true, result, error: null } });
}
function reject(message: string) {
  return Promise.resolve({ data: { ok: false, result: null, error: message } });
}

const REAL_DEVICE = {
  id: 'dev_1',
  name: 'Heat Pump',
  category: 'hvac',
  wattage: 3500,
  alwaysOn: false,
  totalKwh: 42.5,
};
const REAL_CONSUMER = { deviceId: 'dev_1', name: 'Heat Pump', kwh: 42.5, cost: 8.5 };

// Route the mock by macro name so device-list / top-consumers each get their
// own response.
function wireLensRun(
  listResp: () => Promise<unknown>,
  consumersResp: () => Promise<unknown> = () => ok({ devices: [] }),
) {
  lensRunMock.mockImplementation((_domain: string, name: string) => {
    if (name === 'device-list') return listResp();
    if (name === 'top-consumers') return consumersResp();
    return ok({});
  });
}

const noop = () => {};

beforeEach(() => { lensRunMock.mockReset(); });
afterEach(() => { vi.clearAllMocks(); });

describe('energy lens (EnergyDevicesPanel) — wiring', () => {
  it('drives the device-list + top-consumers macros on the energy domain at mount', async () => {
    wireLensRun(() => ok({ devices: [] }));
    await act(async () => { render(<EnergyDevicesPanel onChange={noop} />); });
    await waitFor(() => expect(lensRunMock).toHaveBeenCalled());
    const names = lensRunMock.mock.calls.map((c) => c[1]);
    expect(names).toContain('device-list');
    expect(names).toContain('top-consumers');
    expect(lensRunMock.mock.calls[0][0]).toBe('energy');
  });
});

describe('energy lens (EnergyDevicesPanel) — four UX states', () => {
  it('LOADING: shows a role=status cue and no fabricated rows while device-list is in flight', () => {
    wireLensRun(() => new Promise(() => {}), () => new Promise(() => {}));
    const { getByRole, queryByText } = render(<EnergyDevicesPanel onChange={noop} />);
    const status = getByRole('status');
    expect(status).toBeInTheDocument();
    expect(status.getAttribute('aria-busy')).toBe('true');
    // no empty CTA and no fabricated device while loading
    expect(queryByText(/No devices\. Add appliances/i)).toBeNull();
    expect(queryByText(/Heat Pump/i)).toBeNull();
  });

  it('EMPTY: an empty list shows the honest CTA, distinct from loading, with no rows', async () => {
    wireLensRun(() => ok({ devices: [] }));
    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<EnergyDevicesPanel onChange={noop} />); });
    await waitFor(() => expect(view!.getByText(/No devices\. Add appliances/i)).toBeInTheDocument());
    // empty ≠ loading ≠ error
    expect(view!.queryByRole('status')).toBeNull();
    expect(view!.queryByRole('alert')).toBeNull();
    expect(view!.queryByText(/Heat Pump/i)).toBeNull();
  });

  it('ERROR (transport): a { ok:false } verdict surfaces role=alert, never silent-empty', async () => {
    wireLensRun(() => reject('STATE unavailable'));
    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<EnergyDevicesPanel onChange={noop} />); });
    await waitFor(() => expect(view!.getByRole('alert')).toBeInTheDocument());
    expect(view!.getByText(/STATE unavailable/i)).toBeInTheDocument();
    // DISTINGUISHABLE from genuinely-empty
    expect(view!.queryByText(/No devices\. Add appliances/i)).toBeNull();
  });

  it('ERROR (handler reject): an unwrapped result.ok===false also surfaces, never silent-empty', async () => {
    // The real dispatch double-nests a handler reject; lensRun normalizes it to
    // { data: { ok:false, error } }. Same shape as transport — assert the panel
    // surfaces the handler message and not the empty CTA.
    wireLensRun(() => reject('device index corrupt'));
    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<EnergyDevicesPanel onChange={noop} />); });
    await waitFor(() => expect(view!.getByRole('alert')).toBeInTheDocument());
    expect(view!.getByText(/device index corrupt/i)).toBeInTheDocument();
    expect(view!.queryByText(/No devices\. Add appliances/i)).toBeNull();
  });

  it('ERROR: a thrown/rejected lensRun (network down) surfaces an alert, not a stuck spinner', async () => {
    wireLensRun(() => Promise.reject(new Error('network down')));
    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<EnergyDevicesPanel onChange={noop} />); });
    await waitFor(() => expect(view!.getByRole('alert')).toBeInTheDocument());
    expect(view!.getByText(/network down/i)).toBeInTheDocument();
    expect(view!.queryByRole('status')).toBeNull();
  });

  it('ERROR → Retry RE-FETCHES the macro and recovers to populated', async () => {
    let fail = true;
    wireLensRun(
      () => (fail ? reject('temporary outage') : ok({ devices: [REAL_DEVICE] })),
      () => ok({ devices: [REAL_CONSUMER] }),
    );
    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<EnergyDevicesPanel onChange={noop} />); });
    await waitFor(() => expect(view!.getByRole('alert')).toBeInTheDocument());
    const callsBefore = lensRunMock.mock.calls.length;

    fail = false;
    const retry = view!.getByRole('button', { name: /Retry/i });
    await act(async () => { fireEvent.click(retry); });

    // Retry must re-invoke the backend (not window.reload) and recover.
    await waitFor(() => expect(view!.queryByRole('alert')).toBeNull());
    expect(lensRunMock.mock.calls.length).toBeGreaterThan(callsBefore);
    expect(view!.getAllByText(/Heat Pump/i).length).toBeGreaterThan(0);
  });

  it('POPULATED: a real device from the macro renders with its fields', async () => {
    wireLensRun(
      () => ok({ devices: [REAL_DEVICE] }),
      () => ok({ devices: [REAL_CONSUMER] }),
    );
    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<EnergyDevicesPanel onChange={noop} />); });
    await waitFor(() => expect(view!.getAllByText(/Heat Pump/i).length).toBeGreaterThan(0));
    // the device's real fields render (category + logged kWh)
    expect(view!.getByText(/42\.5 kWh logged/i)).toBeInTheDocument();
    // top-consumers ranking also rendered from the real macro
    expect(view!.getByText(/Top consumers/i)).toBeInTheDocument();
    expect(view!.queryByText(/No devices\. Add appliances/i)).toBeNull();
  });
});
