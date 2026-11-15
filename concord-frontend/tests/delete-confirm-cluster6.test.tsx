/**
 * delete-confirm-cluster6 — CB-0445 (theme 5: confirms that fail).
 *
 * The genus's second and third forms: a confirm that exists but fails
 * its purpose — it vanishes before it can be clicked (hvac-002, pinned
 * here against the StickyDeleteConfirm the hvac-001 fix landed), it
 * never names the record (automotive-009, philosophy-006), its own
 * label swap shifts the layout so the click misses (ml-013) — plus the
 * last two no-confirm singles (invariant-004, tools-004; the tools
 * surface already conforms at head and is pinned).
 *
 * Every test drives the real panel: arm sends nothing, the armed
 * confirm names the record, Cancel restores the arm control, Confirm
 * fires the delete/void/clear verb exactly once.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';

/* ── shared lensRun router (both call styles) ─────────────────────── */

type Handler = (input: Record<string, unknown>) => unknown;
const routes = new Map<string, Handler>();
const lensRunMock = vi.fn((...args: unknown[]) => {
  let domain = ''; let action = ''; let input: Record<string, unknown> = {};
  const first = args[0] as Record<string, unknown> | string;
  if (typeof first === 'object' && first !== null) {
    domain = String(first.domain); action = String(first.action);
    input = (first.input as Record<string, unknown>) || {};
  } else {
    domain = String(first); action = String(args[1]);
    input = (args[2] as Record<string, unknown>) || {};
  }
  const handler = routes.get(`${domain}:${action}`);
  const result = handler ? handler(input) : {};
  return Promise.resolve({ data: { ok: true, result } });
});

vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRunMock(...a) }));

vi.mock('@/components/viz', () => ({
  ChartKit: () => null,
  TimelineView: () => null,
}));

vi.mock('@/store/ui', () => ({
  useUIStore: (sel: (s: { addToast: () => void }) => unknown) => sel({ addToast: () => {} }),
}));

/* hvac hooks (the desk panel reads artifacts through useLensData) */
const lensDataState: { items: unknown[] } = { items: [] };
const hvacRemove = vi.fn(() => Promise.resolve({}));
vi.mock('@/lib/hooks/use-lens-data', () => ({
  useLensData: () => ({
    items: lensDataState.items,
    isLoading: false, isError: false, error: null,
    refetch: vi.fn(), create: vi.fn(() => Promise.resolve({})),
    update: vi.fn(() => Promise.resolve({})), remove: hvacRemove,
  }),
}));
vi.mock('@/lib/hooks/use-lens-artifacts', () => ({
  useRunArtifact: () => ({ mutateAsync: vi.fn(() => Promise.resolve({ ok: true, result: {} })), isPending: false }),
}));
vi.mock('framer-motion', () => ({
  motion: new Proxy({}, { get: () => (props: Record<string, unknown>) => React.createElement('div', props, props.children as React.ReactNode) }),
}));

import { GarageSection } from '@/components/automotive/GarageSection';
import { PhilosophyChannels } from '@/components/philosophy/PhilosophyChannels';
import { DatasetHubPanel } from '@/components/ml/DatasetHubPanel';
import { ExperimentTracker } from '@/components/ml/ExperimentTracker';
import { FormalVerificationWorkbench } from '@/components/invariant/FormalVerificationWorkbench';
import { ESignatureTool } from '@/components/tools/ESignatureTool';
import { HvacDeskPanel } from '@/components/hvac/HvacDeskPanel';

function callsFor(action: string) {
  return lensRunMock.mock.calls.filter((args) => {
    const first = args[0] as Record<string, unknown> | string;
    return typeof first === 'object' && first !== null
      ? first.action === action
      : args[1] === action;
  });
}

beforeEach(() => {
  routes.clear();
  lensRunMock.mockClear();
  hvacRemove.mockClear();
  lensDataState.items = [];
});

/* ── FIX-automotive-009: the vehicle confirm names the vehicle ────── */

describe('FIX-automotive-009 — Garage vehicle delete confirm', () => {
  it('names the vehicle and its records in the armed confirm; arm sends nothing; cancel restores', async () => {
    routes.set('automotive:vehicles-list', () => ({
      vehicles: [{ id: 'veh_1', number: '1', name: 'car2', make: 'Honda', model: 'Civic', year: 2019, odometer: 50000, odometerUnit: 'mi', fuelUnit: 'gal', licensePlate: 'ABC123' }],
    }));
    routes.set('automotive:fuel-list', () => ({ fuel: [] }));
    routes.set('automotive:service-list', () => ({ service: [] }));
    routes.set('automotive:service-reminders', () => ({ reminders: [] }));
    routes.set('automotive:expenses-list', () => ({ expenses: [], byCategory: {}, total: 0 }));
    routes.set('automotive:trips-list', () => ({ trips: [], totalMiles: 0, businessMiles: 0 }));
    routes.set('automotive:documents-list', () => ({ documents: [] }));
    routes.set('automotive:vehicle-stats', () => ({
      lifetimeMpg: null, totalSpend: 0, fuelSpend: 0, fillCount: 0, serviceCount: 0, milesTracked: 0, costPerMile: null,
    }));
    render(<GarageSection />);
    await screen.findAllByText('car2');

    fireEvent.click(screen.getByRole('button', { name: 'Delete vehicle' }));
    const confirm = await screen.findByRole('button', { name: 'Confirm delete vehicle' });
    expect(confirm).toHaveTextContent('Delete "car2" and its records?');
    expect(callsFor('vehicles-delete')).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel delete' }));
    expect(callsFor('vehicles-delete')).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Delete vehicle' })).toBeInTheDocument();
  });
});

/* ── FIX-philosophy-006: the channel confirm names the channel ────── */

describe('FIX-philosophy-006 — channel delete confirm', () => {
  it('names the channel in the armed confirm; confirm fires channel-delete once', async () => {
    routes.set('philosophy:channel-list', () => ({
      channels: [{ id: 'ch_1', title: 'Deep Questions', description: '', blockCount: 2, role: 'owner' }],
    }));
    routes.set('philosophy:channel-detail', () => ({
      channel: { id: 'ch_1', title: 'Deep Questions', description: '', role: 'owner' }, blocks: [],
    }));
    render(<PhilosophyChannels />);
    await screen.findByText('Deep Questions');

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const confirm = await screen.findByRole('button', { name: 'Confirm delete' });
    expect(confirm).toHaveTextContent('Delete "Deep Questions"?');
    expect(callsFor('channel-delete')).toHaveLength(0);

    fireEvent.click(confirm);
    await waitFor(() => expect(callsFor('channel-delete')).toHaveLength(1));
  });
});

/* ── FIX-ml-013: stable confirm controls (no same-button label swap) ── */

describe('FIX-ml-013 — dataset delete confirm', () => {
  it('arms a separate confirm button naming the dataset; the arm button is replaced, not relabelled', async () => {
    routes.set('ml:dataset-list', () => ({
      datasets: [{ id: 'ds_1', name: 'Iris QA', type: 'tabular', splits: { train: 0.7, val: 0.15, test: 0.15 }, latestVersion: 1, versions: [], createdAt: '2026-01-01' }],
    }));
    render(<DatasetHubPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'My Datasets' }));
    await screen.findByText('Iris QA');

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const confirm = await screen.findByRole('button', { name: 'Confirm delete' });
    expect(confirm).toHaveTextContent('Delete "Iris QA"?');
    expect(screen.queryByText(/Click again to confirm/)).not.toBeInTheDocument();
    expect(callsFor('dataset-delete')).toHaveLength(0);

    fireEvent.click(confirm);
    await waitFor(() => expect(callsFor('dataset-delete')).toHaveLength(1));
  });
});

describe('FIX-ml-013 — experiment delete confirm', () => {
  it('arms a separate confirm button naming the experiment', async () => {
    routes.set('ml:experiment-list', () => ({
      experiments: [{ id: 'exp_1', name: 'Run Alpha', status: 'completed', modelId: 'm1', datasetId: 'd1', createdAt: '2026-01-01', hyperparams: { epochs: 10 }, metrics: [] }],
    }));
    render(<ExperimentTracker />);
    fireEvent.click(await screen.findByText('Run Alpha'));

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const confirm = await screen.findByRole('button', { name: 'Confirm delete' });
    expect(confirm).toHaveTextContent('Delete "Run Alpha"?');
    expect(callsFor('experiment-delete')).toHaveLength(0);

    fireEvent.click(confirm);
    await waitFor(() => expect(callsFor('experiment-delete')).toHaveLength(1));
  });
});

/* ── FIX-invariant-004: Temporal Logic Clear confirms first ───────── */

describe('FIX-invariant-004 — temporal history clear', () => {
  it('arm sends nothing and shows a confirm; cancel restores; confirm fires clearHistory', async () => {
    render(<FormalVerificationWorkbench />);
    fireEvent.click(screen.getByRole('button', { name: /Temporal Logic/ }));

    fireEvent.click(await screen.findByRole('button', { name: 'Clear history' }));
    const confirm = await screen.findByRole('button', { name: 'Confirm clear history' });
    expect(confirm).toHaveTextContent('Clear history?');
    expect(callsFor('clearHistory')).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel delete' }));
    expect(callsFor('clearHistory')).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Clear history' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm clear history' }));
    await waitFor(() => expect(callsFor('clearHistory')).toHaveLength(1));
  });
});

/* ── FIX-tools-004 (verify-only pin): envelope Void already confirms ── */

describe('FIX-tools-004 — envelope void (already conforming at head)', () => {
  it('arm sends nothing; Confirm void fires esign-void once', async () => {
    const summary = {
      id: 'env_1', number: 'ENV-1', title: 'MSA for Acme', status: 'out_for_signature', documentHash: 'abc',
      parties: [{ id: 'p1', name: 'Sam', role: 'signer', status: 'pending', signedAt: null }],
      signedCount: 0, partyCount: 1, createdAt: '2026-01-01', completedAt: null,
    };
    routes.set('tools:esign-list', () => ({ envelopes: [summary], total: 1 }));
    routes.set('tools:esign-detail', () => ({
      envelope: {
        id: 'env_1', number: 'ENV-1', title: 'MSA for Acme', document: 'doc', documentHash: 'abc',
        status: 'out_for_signature',
        parties: [{ id: 'p1', name: 'Sam', email: 's@x.io', role: 'signer', status: 'pending', signature: null, signedAt: null }],
        audit: [], createdAt: '2026-01-01', completedAt: null, esignDisclosure: '',
      },
    }));
    render(<ESignatureTool />);
    fireEvent.click(await screen.findByText('MSA for Acme'));

    fireEvent.click(await screen.findByRole('button', { name: 'Void envelope' }));
    const confirm = await screen.findByRole('button', { name: 'Confirm void' });
    expect(confirm).toHaveTextContent('Void this envelope?');
    expect(callsFor('esign-void')).toHaveLength(0);

    fireEvent.click(confirm);
    await waitFor(() => expect(callsFor('esign-void')).toHaveLength(1));
  });
});

/* ── FIX-hvac-002 (verify-only pin): the CRM client confirm stays armed ── */

describe('FIX-hvac-002 — CRM client delete confirm (cured by the hvac-001 fix, pinned)', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('a Client row arms the confirm, it is still armed after 10 seconds, and Confirm removes the client', async () => {
    lensDataState.items = [{
      id: 'art_client_1', title: 'qa-zt2 client',
      data: { name: 'qa-zt2 client', type: 'Client', status: 'active', description: '', notes: '', client: '', totalCost: 0 },
      meta: { tags: [], status: 'active', visibility: 'private' },
      createdAt: '2026-06-27', updatedAt: '2026-06-27', version: 1,
    }];
    render(<HvacDeskPanel mode="clients" />);
    await screen.findByText('qa-zt2 client');

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(await screen.findByRole('button', { name: 'Confirm delete' })).toBeInTheDocument();
    expect(hvacRemove).not.toHaveBeenCalled();

    vi.useFakeTimers();
    act(() => { vi.advanceTimersByTime(10_000); });
    vi.useRealTimers();
    expect(screen.getByRole('button', { name: 'Confirm delete' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));
    await waitFor(() => expect(hvacRemove).toHaveBeenCalledWith('art_client_1'));
  });
});
