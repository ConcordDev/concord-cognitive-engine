// CB-0492 Part B — find-controls genus, final three (RCA-missing-find-controls):
// FIX-queue-006 (Jobs list), FIX-supplychain-007 (shipments / POs /
// scenarios), FIX-telecommunications-005 (Sites list search + sort).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const h = vi.hoisted(() => ({ calls: [] as Array<{ domain: string; action: string; input: unknown }> }));

vi.mock('@/lib/api/client', () => ({
  lensRun: (a: unknown, b?: unknown, c?: unknown) => {
    const domain = typeof a === 'string' ? a : (a as { domain: string }).domain;
    const action = typeof a === 'string' ? (b as string) : (a as { action: string }).action;
    const input = typeof a === 'string' ? c : (a as { input: unknown }).input;
    h.calls.push({ domain, action, input });
    const ok = (result: unknown) => Promise.resolve({ ok: true, data: { ok: true, result } });
    if (domain === 'supplychain' && action === 'shipmentList') {
      return ok({
        shipments: [
          { id: 's1', reference: 'SH-ALPHA', carrier: 'Maersk', trackingNumber: 'T1', origin: 'Shanghai', destination: 'Los Angeles', status: 'in_transit', value: 100, plannedEtaDays: 20, createdAt: 1, etaAt: 2, etaDriftDays: 0, late: false, health: 'ok', checkpoints: [], route: [] },
          { id: 's2', reference: 'SH-BETA', carrier: 'Hapag', trackingNumber: 'T2', origin: 'Rotterdam', destination: 'New York', status: 'in_transit', value: 200, plannedEtaDays: 15, createdAt: 1, etaAt: 2, etaDriftDays: 0, late: false, health: 'ok', checkpoints: [], route: [] },
        ],
        inTransit: 2, delivered: 0, delayed: 0,
      });
    }
    if (domain === 'supplychain' && action === 'scenarioList') {
      return ok({
        scenarios: [
          { id: 'sc1', name: 'Port closure drill', disruption: 'port_closure', baseDemand: 10, baseLeadTime: 5, baseUnitCost: 2, onHand: 50, options: [], recommendation: 'Dual-source', resilient: true, createdAt: 1 },
          { id: 'sc2', name: 'Demand spike plan', disruption: 'demand_spike', baseDemand: 10, baseLeadTime: 5, baseUnitCost: 2, onHand: 50, options: [], recommendation: 'Buffer stock', resilient: false, createdAt: 2 },
        ],
      });
    }
    if (domain === 'supplychain' && action === 'workOrderList') {
      return ok({
        workOrders: [
          { id: 'w1', poNumber: 'PO-100', item: 'Steel beams', supplier: 'Acme Metals', quantity: 4, unitCost: 10, totalCost: 40, stage: 'ordered', createdAt: 1, dueAt: 2, receivedQty: 0, overdue: false, progressPct: 10, history: [] },
          { id: 'w2', poNumber: 'PO-200', item: 'Copper wire', supplier: 'Globex', quantity: 9, unitCost: 5, totalCost: 45, stage: 'ordered', createdAt: 1, dueAt: 2, receivedQty: 0, overdue: false, progressPct: 10, history: [] },
        ],
        byStage: { ordered: 2 }, stages: ['ordered'], openValue: 85, overdueCount: 0,
      });
    }
    if (domain === 'telecommunications' && action === 'towerList') {
      const tower = (id: string, name: string, heightM: number) => ({
        id, name, lat: 41.7, lon: -73.9, heightM, powerWatts: 40, gainDbi: 16, freqMhz: 1800,
        technology: '4G', terrain: 'suburban', status: 'active', backhaul: 'fiber', sectors: 3,
      });
      return ok({ towers: [tower('t1', 'North Ridge', 30), tower('t2', 'South Vale', 55)] });
    }
    return ok({});
  },
}));
vi.mock('@/hooks/useSmartPolling', () => ({ useSmartPolling: () => {} }));
vi.mock('@/components/viz', () => ({ MapView: () => null }));

import { JobList, type QueueJob } from '@/components/queue/JobList';
import { SupplyChainPlanner } from '@/components/supplychain/SupplyChainPlanner';
import { RFPlanner } from '@/components/telecommunications/RFPlanner';

afterEach(() => { cleanup(); h.calls.length = 0; });

function wrap(node: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

const JOB = (id: string, name: string, queue: string): QueueJob => ({
  id, queue, name, status: 'pending', priority: 'normal', payload: {}, attempts: 0,
  maxAttempts: 3, error: null, result: null, createdAt: '', updatedAt: '', runAt: '',
});
const noop = () => {};

describe('FIX-queue-006 Jobs list search', () => {
  it('filters jobs by name/queue with an honest no-match state', async () => {
    wrap(<JobList jobs={[JOB('j1', 'Alpha job', 'emails'), JOB('j2', 'Beta job', 'reports')]} busyId={null} onProcess={noop} onRetry={noop} onRemove={noop} onSelect={noop} />);
    expect(await screen.findByText('Alpha job')).toBeTruthy();
    expect(screen.getByText('Beta job')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Search jobs'), { target: { value: 'alpha' } });
    expect(screen.queryByText('Beta job')).toBeNull();
    fireEvent.change(screen.getByLabelText('Search jobs'), { target: { value: 'emails' } });
    expect(screen.getByText('Alpha job')).toBeTruthy();
    expect(screen.queryByText('Beta job')).toBeNull();
    fireEvent.change(screen.getByLabelText('Search jobs'), { target: { value: 'zzz' } });
    expect(screen.getByText(/No jobs match/)).toBeTruthy();
  });
});

describe('FIX-supplychain-007 shipments / scenarios / POs search', () => {
  it('searches the held shipments', async () => {
    wrap(<SupplyChainPlanner />);
    expect(await screen.findByText('SH-ALPHA')).toBeTruthy();
    expect(screen.getByText('SH-BETA')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Search shipments'), { target: { value: 'rotterdam' } });
    expect(screen.queryByText('SH-ALPHA')).toBeNull();
    expect(screen.getByText('SH-BETA')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Search shipments'), { target: { value: 'zzz' } });
    expect(screen.getByText(/No shipments match/)).toBeTruthy();
  });

  it('searches the held scenarios', async () => {
    wrap(<SupplyChainPlanner />);
    fireEvent.click(await screen.findByRole('button', { name: /What-if scenarios/ }));
    expect(await screen.findByText('Port closure drill')).toBeTruthy();
    expect(screen.getByText('Demand spike plan')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Search scenarios'), { target: { value: 'spike' } });
    expect(screen.queryByText('Port closure drill')).toBeNull();
    fireEvent.change(screen.getByLabelText('Search scenarios'), { target: { value: 'zzz' } });
    expect(screen.getByText(/No scenarios match/)).toBeTruthy();
  });

  it('searches the held purchase orders', async () => {
    wrap(<SupplyChainPlanner />);
    fireEvent.click(await screen.findByRole('button', { name: /PO workflow/ }));
    expect(await screen.findByText('PO-100')).toBeTruthy();
    expect(screen.getByText('PO-200')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Search purchase orders'), { target: { value: 'globex' } });
    expect(screen.queryByText('PO-100')).toBeNull();
    expect(screen.getByText('PO-200')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Search purchase orders'), { target: { value: 'zzz' } });
    expect(screen.getByText(/No purchase orders match/)).toBeTruthy();
  });
});

describe('FIX-telecommunications-005 Sites search + sort', () => {
  it('filters sites by name and sorts the list', async () => {
    wrap(<RFPlanner />);
    expect(await screen.findByText('North Ridge')).toBeTruthy();
    expect(screen.getByText('South Vale')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Search sites'), { target: { value: 'north' } });
    expect(screen.queryByText('South Vale')).toBeNull();
    fireEvent.change(screen.getByLabelText('Search sites'), { target: { value: 'zzz' } });
    expect(screen.getByText(/No sites match/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Search sites'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Sort sites'), { target: { value: 'tallest' } });
    const text = document.body.textContent || '';
    expect(text.indexOf('South Vale')).toBeLessThan(text.indexOf('North Ridge'));
  });
});
